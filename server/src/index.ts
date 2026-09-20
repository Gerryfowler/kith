import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { ADDRESS_SYSTEM, OPENER_SYSTEM, PARSE_SYSTEM } from "./prompts";

export interface Env {
  ANTHROPIC_API_KEY: string;
  REVENUECAT_SECRET?: string;
  QUOTA: KVNamespace;
  MODEL: string;
  DAILY_CAP: string;
  RC_ENTITLEMENT: string;
  ALLOW_UNENTITLED?: string; // "1" only in local dev without RevenueCat
}

type Plan = "pro" | "none";

const MAX_BODY = 8 * 1024;
const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization, content-type",
  "access-control-allow-methods": "GET, POST, OPTIONS",
  "access-control-expose-headers": "x-samvar-plan",
};

const Interaction = z.object({
  people: z.array(z.string()),
  new_people: z.array(z.string()),
  initiator: z.enum(["me", "them", "mutual"]),
  depth: z.number().int(),
  channel: z.enum(["inperson", "call", "message"]),
  date: z.string(),
  place: z.string(),
  summary: z.string(),
  facts: z.array(z.object({
    person: z.string(),
    fact: z.string(),
    kind: z.enum(["family", "likes", "plans", "work", "date", "other"]),
  })),
});
const ParseOut = z.object({ interactions: z.array(Interaction) });
const OpenersOut = z.object({ openers: z.array(z.string()) });
const AddressBody = z.object({ address: z.string().min(1).max(300), hints: z.array(z.string().max(300)).max(8).default([]), locale: z.string().max(20).optional() });
const AddressOut = z.object({ address: z.string(), confidence: z.enum(["high", "medium", "low"]) });

const ParseBody = z.object({ note: z.string().min(1).max(4000), people: z.string().max(6000), today: z.string().max(80) });
const OpenersBody = z.object({
  name: z.string().max(80), tier: z.string().max(40), last: z.string().max(300),
  recent: z.string().max(600), facts: z.string().max(1500), intent: z.string().max(300),
});

function json(body: unknown, status = 200, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...CORS, ...extra },
  });
}

function bearer(req: Request): string | null {
  const m = /^Bearer\s+([A-Za-z0-9-]{8,64})$/.exec(req.headers.get("authorization") ?? "");
  return m ? m[1] : null;
}

function dayKey(): string { return new Date().toISOString().slice(0, 10); }

// Pro = active RevenueCat entitlement (covers the 7-day free trial and paid periods alike).
async function planFor(device: string, env: Env): Promise<Plan> {
  if (!env.REVENUECAT_SECRET) return env.ALLOW_UNENTITLED === "1" ? "pro" : "none";
  const cacheKey = `e:${device}`;
  const cached = await env.QUOTA.get(cacheKey);
  if (cached === "pro" || cached === "none") return cached;
  let plan: Plan = "none";
  try {
    const r = await fetch(`https://api.revenuecat.com/v1/subscribers/${encodeURIComponent(device)}`, {
      // No X-Platform header: RevenueCat rejects secret keys sent with it (403 code 7243, "should not be used in your app").
      headers: { authorization: `Bearer ${env.REVENUECAT_SECRET}` },
    });
    if (r.ok) {
      const data = (await r.json()) as { subscriber?: { entitlements?: Record<string, { expires_date: string | null }> } };
      const ent = data.subscriber?.entitlements?.[env.RC_ENTITLEMENT];
      if (ent && (ent.expires_date === null || Date.parse(ent.expires_date) > Date.now())) plan = "pro";
      else console.log(`revenuecat: no active "${env.RC_ENTITLEMENT}" entitlement for ${device}`, Object.keys(data.subscriber?.entitlements ?? {}));
    } else {
      // Visible in `wrangler tail`: a 401/403 here means the secret key is wrong or lacks read permissions.
      console.error(`revenuecat lookup failed: HTTP ${r.status} ${(await r.text()).slice(0, 200)}`);
    }
  } catch (e) { console.error("revenuecat lookup threw", String(e)); /* not entitled; the short cache self-heals */ }
  await env.QUOTA.put(cacheKey, plan, { expirationTtl: plan === "pro" ? 3600 : 300 });
  return plan;
}

async function count(env: Env, key: string): Promise<number> {
  return Number((await env.QUOTA.get(key)) ?? 0);
}

async function bump(env: Env, key: string, ttl: number): Promise<void> {
  const n = (await count(env, key)) + 1;
  await env.QUOTA.put(key, String(n), { expirationTtl: ttl });
}

export default {
  async fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
    const url = new URL(req.url);
    const device = bearer(req);
    if (!device) return json({ error: "unauthorised" }, 401);

    const plan = await planFor(device, env);
    const meta = { "x-samvar-plan": plan };

    if (req.method === "GET" && url.pathname === "/v1/me") return json({ plan }, 200, meta);
    if (req.method !== "POST" || !["/v1/parse", "/v1/openers", "/v1/address"].includes(url.pathname)) return json({ error: "not found" }, 404);

    if (plan !== "pro") return json({ error: "subscription required" }, 402, meta);
    if (Number(req.headers.get("content-length") ?? 0) > MAX_BODY) return json({ error: "too large" }, 413, meta);
    const dayKeyFor = `d:${device}:${dayKey()}`;
    if ((await count(env, dayKeyFor)) >= Number(env.DAILY_CAP || 200)) return json({ error: "daily cap" }, 429, meta);

    let body: unknown;
    try { body = await req.json(); } catch { return json({ error: "bad json" }, 400, meta); }

    const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY, timeout: 60_000, maxRetries: 1 });
    try {
      let out: unknown;
      if (url.pathname === "/v1/parse") {
        const b = ParseBody.safeParse(body);
        if (!b.success) return json({ error: "bad request" }, 400, meta);
        const res = await client.messages.parse({
          model: env.MODEL,
          max_tokens: 4000,
          system: PARSE_SYSTEM + '\nWrap the array as {"interactions": [...]}.',
          messages: [{ role: "user", content: `Today is ${b.data.today}.\nKnown people: ${b.data.people || "(none yet)"}\n\nNote:\n${b.data.note}` }],
          output_config: { format: zodOutputFormat(ParseOut), effort: "low" },
        });
        if (res.stop_reason === "refusal") return json({ error: "refused" }, 422, meta);
        out = res.parsed_output?.interactions ?? [];
      } else if (url.pathname === "/v1/address") {
        const b = AddressBody.safeParse(body);
        if (!b.success) return json({ error: "bad request" }, 400, meta);
        const res = await client.messages.parse({
          model: env.MODEL,
          max_tokens: 300,
          system: ADDRESS_SYSTEM,
          messages: [{ role: "user", content: `Address: ${b.data.address}\nOther addresses in this person's contacts (for country/region context): ${b.data.hints.join(" | ") || "(none)"}\nPhone locale: ${b.data.locale || "unknown"}` }],
          output_config: { format: zodOutputFormat(AddressOut), effort: "low" },
        });
        if (res.stop_reason === "refusal") return json({ error: "refused" }, 422, meta);
        out = res.parsed_output ?? { address: b.data.address, confidence: "low" };
      } else {
        const b = OpenersBody.safeParse(body);
        if (!b.success) return json({ error: "bad request" }, 400, meta);
        const d = b.data;
        const res = await client.messages.parse({
          model: env.MODEL,
          max_tokens: 1000,
          system: OPENER_SYSTEM + '\nWrap the array as {"openers": [...]}.',
          messages: [{ role: "user", content: `Friend: ${d.name} (${d.tier}).\nLast contact: ${d.last}.\nRecent: ${d.recent}.\nThings I know about them: ${d.facts}.\n${d.intent}` }],
          output_config: { format: zodOutputFormat(OpenersOut), effort: "medium" },
        });
        if (res.stop_reason === "refusal") return json({ error: "refused" }, 422, meta);
        out = (res.parsed_output?.openers ?? []).slice(0, 3);
      }
      ctx.waitUntil(bump(env, dayKeyFor, 2 * 86400));
      return json(out, 200, meta);
    } catch (err) {
      if (err instanceof Anthropic.RateLimitError) return json({ error: "busy, retry shortly" }, 503, { ...meta, "retry-after": "10" });
      if (err instanceof Anthropic.APIError) return json({ error: `upstream ${err.status}` }, 502, meta);
      return json({ error: "server error" }, 500, meta);
    }
  },
};
