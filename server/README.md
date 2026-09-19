# Samvar API (Cloudflare Worker)

Holds the Anthropic key server-side and checks each device's subscription. The app never sees the key.

## Business model it enforces

One plan, **Samvar Pro**: everything unlimited, **7 days free**, then the subscription auto-renews (monthly or yearly). The free trial is the App Store introductory offer, so Apple enforces one trial per Apple ID and RevenueCat reports the entitlement as active from the moment the trial starts. The server therefore has one question: *does this device have an active `pro` entitlement?*

## Endpoints

| Route | Body | Returns |
|---|---|---|
| `POST /v1/parse` | `{note, people, today}` | JSON array of interactions (see `src/prompts.ts`) |
| `POST /v1/openers` | `{name, tier, last, recent, facts, intent}` | JSON array of 3 strings |
| `GET /v1/me` | — | `{plan: "pro" \| "none"}` |

Every request carries `Authorization: Bearer <deviceId>` — a random UUID the app generates on first run and also uses as the RevenueCat app user id. Responses include `x-samvar-plan`. No entitlement → `402` (the app shows the paywall and falls back to rule-based parsing). Everyone: `DAILY_CAP` calls/day, 8 KB body limit, 60 s Anthropic timeout.

## One-time setup

1. Cloudflare account → `npm install` in this folder → `npx wrangler login`.
2. `npx wrangler kv namespace create QUOTA` → paste the id into `wrangler.toml`.
3. Secrets: `npx wrangler secret put ANTHROPIC_API_KEY` (a key on the Samvar org, not your personal one) and `npx wrangler secret put REVENUECAT_SECRET` (RevenueCat → Project → API keys → secret key).
4. RevenueCat: create the project, add the iOS app, create entitlement `pro`, products `samvar_pro_monthly` / `samvar_pro_yearly` mapped to the App Store Connect subscriptions, each with a 7-day free introductory offer.
5. `npx wrangler deploy`. Add the custom domain `api.samvar.app` in the Cloudflare dashboard once DNS is on Cloudflare.
6. Local dev: set `ALLOW_UNENTITLED = "1"` in `wrangler.toml` (local only), `npm run dev`, and in the app `localStorage.setItem("samvar-api-base","http://localhost:8787")`.

## Cost model

`MODEL` is `claude-sonnet-5`. Parse ≈ 1.5k in / 0.5k out ≈ $0.008; opener ≈ 0.6k in / 0.15k out ≈ $0.003. A heavy user (60 parses + 40 openers a month) costs ≈ $0.60 against £4.99/month.

## Verify before launch

- RevenueCat subscriber endpoint shape: `GET https://api.revenuecat.com/v1/subscribers/{app_user_id}` → `subscriber.entitlements.pro.expires_date` (ISO string or null). Confirm against current RevenueCat docs.
- `@anthropic-ai/sdk` version in `package.json` supports `messages.parse` + `zodOutputFormat`.
