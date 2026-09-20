"use strict";
/* =====================================================================
   Samvar (formerly Kith) — build your friendships like your fitness
   All data local on the device.
===================================================================== */

/* ---------- storage (with in-memory fallback for preview mode) ---------- */
const KEY="samvar-data-v1", LEGACY_KEY="kith-data-v1";
let memStore=null;
function migrate(db){
  db.candidates=(db.candidates||[]).map(c=>typeof c==="string"?{name:c}:c);
  db.geo=db.geo||{};
  (db.interactions||[]).forEach(x=>{ if(x.channel==="video") x.channel="call"; }); // old "Video" → Call
  db.settings=db.settings||{};
  if(!db.settings.depthV2){ // old 3-level richness (logistical/friendly/substantive/deep) → quick catch-up (1) / quality time (2)
    (db.interactions||[]).forEach(x=>{ x.depth=(x.depth>=3)?2:1; }); db.settings.depthV2=true; }
  db.settings=Object.assign({weekGoal:3,nudgeFreq:"daily",nudgeTime:"09:00"},db.settings||{});
  return db;
}
function loadDB(){
  try{ const raw=localStorage.getItem(KEY)||localStorage.getItem(LEGACY_KEY); if(raw) return migrate(JSON.parse(raw)); }
  catch(e){ document.getElementById("previewBanner").style.display="block"; }
  return migrate(memStore || { people:[], interactions:[], candidates:[], scoreHistory:[] });
}
function saveDB(){
  try{ localStorage.setItem(KEY, JSON.stringify(DB)); }
  catch(e){ memStore=DB; document.getElementById("previewBanner").style.display="block"; }
}
let DB=loadDB();

/* ---------- model constants ---------- */
const TIERS={
  inner:{label:"Inner",    cadence:7,  halflife:14,  weight:1.2, rhythm:"weekly",    remind:14}, // every week; reminders only after 2 weeks
  invest:{label:"Close",    cadence:30, halflife:40,  weight:1.5, rhythm:"monthly",   remind:30}, // every month; reminders from the last third (~day 20)
  warm:{label:"Friendly",  cadence:90, halflife:110, weight:0.7, rhythm:"quarterly", remind:90}, // every quarter; reminders from the last third (~day 60)
  notnow:{label:"Archived",    cadence:0,  halflife:0,  weight:0}
};
const CHANNELS={inperson:{label:"In person",base:10},call:{label:"Call",base:5},message:{label:"Message",base:2}};
// Two kinds of interaction. Multipliers keep the old "friendly"/"substantive" weights so scores don't jump.
const DEPTHS=[
  {n:1,label:"Quick catch-up",mult:2.5},
  {n:2,label:"Quality time",mult:5}
];

const DAY=86400000;
const uid=()=>Math.random().toString(36).slice(2,10);
const esc=s=>String(s).replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));

/* ---------- scoring engine ---------- */
const GROUP_DISC=[1,.74,.59,.49,.43,.38];
function groupDiscount(n){ if(n<=0) return 1; return n<=6? GROUP_DISC[n-1] : Math.max(.30, .38-.02*(n-6)); }
function interactionPoints(x){
  const base=(CHANNELS[x.channel]?.base||3) * (DEPTHS[x.depth-1]?.mult||2);
  return base * groupDiscount((x.personIds||[]).length||1);
}
function personBalance(p, asOf){
  const t=TIERS[p.tier]||TIERS.warm; if(!t.halflife) return 0;
  let b=0;
  for(const x of DB.interactions){
    if(x.ts>asOf) continue;
    if(!x.personIds.includes(p.id)) continue;
    const days=(asOf-x.ts)/DAY;
    b += interactionPoints(x) * Math.pow(0.5, days/t.halflife);
  }
  return b;
}
function healthOfP(p, asOf){ // status = time since last contact vs the circle's rhythm
  const t=TIERS[p.tier]||TIERS.warm;
  const l=lastContact(p,asOf);
  if(!l){
    const age=p.added?((asOf-p.added)/DAY):999;
    if(age<=(t.cadence||60)) return {k:"new",label:"new",color:"var(--accent)"}; // grace period
    return {k:"critical",label:"reconnect now",color:"var(--critical)"}; // past the grace period with no contact
  }
  // Four levels: new (grace period) → excellent → slipping → reconnect now
  const r=((asOf-l)/DAY)/(t.cadence||60);
  if(r<=0.9) return {k:"good",label:"excellent",color:"var(--good)"};      // inner: quiet until ~day 6
  if(r<=1.8) return {k:"warn",label:"slipping",color:"var(--warn)"};
  return {k:"critical",label:"reconnect now",color:"var(--critical)"};
}
function lastContact(p, asOf){
  let last=null;
  for(const x of DB.interactions) if(x.ts<=asOf && x.personIds.includes(p.id) && (!last||x.ts>last)) last=x.ts;
  return last;
}
function windowStats(asOf, days){
  const from=asOf-days*DAY;
  const xs=DB.interactions.filter(x=>x.ts>from && x.ts<=asOf);
  const n=xs.length;
  const deepShare = n? xs.filter(x=>x.depth>=2).length/n : 0;
  return {n, deepShare, xs};
}
function connectionScore(asOf){
  const tracked=DB.people.filter(p=>p.tier!=="notnow");
  const core=tracked.filter(p=>p.tier==="inner"||p.tier==="invest");
  // coverage: share of core people not "at risk/cold", tier-weighted
  let covNum=0, covDen=0;
  for(const p of core){
    const w=TIERS[p.tier].weight; covDen+=w;
    const b=personBalance(p,asOf);
    covNum += w * Math.min(1, b/40);
  }
  const coverage = covDen? covNum/covDen : 0;
  const s=windowStats(asOf,30);
  const volume = Math.min(1, s.n/20); // ~5 logged interactions/week = full marks
  const raw = 100*(0.55*coverage + 0.25*s.deepShare + 0.20*volume);
  return Math.round(raw);
}
function weeklySeries(weeks){
  // Starts at the first week with a logged conversation, so a new user sees one dot rather than a flat zero line.
  const now=Date.now(), first=DB.interactions.length?Math.min(...DB.interactions.map(x=>x.ts)):now, out=[];
  for(let i=weeks-1;i>=0;i--){ const t=now-i*7*DAY; if(t+7*DAY<first) continue; out.push({t, v:connectionScore(t)}); }
  return out.length?out:[{t:now, v:connectionScore(now)}];
}
// What a good score looks like for this person's circles: everyone in rhythm, half the conversations quality time,
// and the volume their rhythms imply (weekly Inner + monthly Close + quarterly Friendly), capped like the score itself.
function targetScore(){
  const ppl=DB.people.filter(p=>p.tier!=="notnow" && TIERS[p.tier]?.cadence); if(!ppl.length) return 0;
  const monthly=ppl.reduce((a,p)=>a+30/TIERS[p.tier].cadence,0);
  return Math.round(100*(0.55*1 + 0.25*0.5 + 0.20*Math.min(1, monthly/20)));
}

/* ---------- name matching & parsing ---------- */
function nameTokens(name){ return name.toLowerCase().split(/\s+/).filter(Boolean); }
function findPeopleInText(text){
  const lower=" "+text.toLowerCase().replace(/[^a-zÀ-ɏ'\- ]/g," ")+" ";
  const hits=[];
  for(const p of DB.people){
    for(const tok of [nameTokens(p.name)[0], ...(p.aliases||[]).map(a=>a.toLowerCase())]){
      if(tok && tok.length>=3 && lower.includes(" "+tok+" ")){ hits.push(p); break; }
    }
  }
  return hits;
}
const DEPTH_CUES=[
  {re:/(deep|meaningful|heart[- ]to[- ]heart|opened up|emotional|vulnerab|really connected|profound|proper|substantive|long (chat|talk|call|walk|lunch|dinner|evening)|good (long )?(chat|talk|conversation)|advice|talked (about|through)|discussed|career|worri|problem|dinner|lunch|weekend|day out|hours)/i, d:2}
];
const CHAN_CUES=[
  {re:/\b(dinner|lunch|coffee|drinks|in person|met (up|with)|walk|breakfast|pub|party|came (over|round)|visit)\b/i, c:"inperson"},
  {re:/\b(facetime|zoom|video ?call|teams|meet)\b/i, c:"call"},
  {re:/\b(called|rang|phoned|phone call|spoke on the phone|call with)\b/i, c:"call"},
  {re:/\b(text|whatsapp|message|emailed|email|dm|voice note)\b/i, c:"message"}
];
function parseSegment(seg){
  let depth=1, channel="inperson";
  for(const c of DEPTH_CUES){ if(c.re.test(seg)){ depth=c.d; break; } }
  for(const c of CHAN_CUES){ if(c.re.test(seg)){ channel=c.c; break; } }
  let ts=Date.now();
  if(/\b(yesterday|last night)\b/i.test(seg)) ts-=DAY;
  return {depth, channel, ts};
}
function parseNote(text){
  // split into sentences; group consecutive sentences by the people they mention
  const sentences=text.split(/(?<=[.!?])\s+|\n+/).filter(s=>s.trim());
  const groups=[];
  let cur=null;
  for(const s of sentences){
    const ppl=findPeopleInText(s);
    if(ppl.length){ // new group per sentence with names
      cur={text:s, people:ppl}; groups.push(cur);
    } else if(cur){ cur.text+=" "+s; }
    else { cur={text:s, people:[]}; groups.push(cur); }
  }
  if(!groups.length) groups.push({text, people:findPeopleInText(text)});
  return groups.map(g=>{
    const guess=parseSegment(g.text);
    return {id:uid(), note:g.text.trim(), personIds:g.people.map(p=>p.id), pendingNames:[], place:"", ...guess};
  });
}

/* ---------- Samvar AI: via Samvar's server (Pro / free quota), or a direct key in dev mode ---------- */
const API_BASE=(()=>{ try{ return localStorage.getItem("samvar-api-base")||"https://api.samvar.app"; }catch(e){ return "https://api.samvar.app"; } })();
function devMode(){ try{ return localStorage.getItem("samvar-dev")==="1"; }catch(e){ return false; } }
const AK_KEY="samvar-api-key";
function getApiKey(){ if(!devMode()) return ""; try{ return localStorage.getItem(AK_KEY)||localStorage.getItem("kith-api-key")||""; }catch(e){ return window.__memKey||""; } }
function setApiKey(k){ try{ localStorage.setItem(AK_KEY,k); }catch(e){ window.__memKey=k; } }
function deviceId(){
  if(!DB.settings.deviceId){ DB.settings.deviceId=(crypto.randomUUID?crypto.randomUUID():uid()+uid()+uid()); saveDB(); }
  return DB.settings.deviceId;
}
function isPro(){ const p=DB.settings.pro; return !!(p && p.active && (!p.expires || p.expires>Date.now())); }
const FREE_PEOPLE=8, FREE_LOGS=3;
function gateReached(){ return DB.people.filter(p=>p.tier!=="notnow").length>=FREE_PEOPLE && DB.interactions.length>=FREE_LOGS; }
// Everything is free until you've added 8 people and logged 3 conversations; then the trial starts.
function entitled(){ return isPro() || devMode() || !gateReached(); }
class QuotaError extends Error{}
async function samvarAI(path, payload){
  const r=await fetch(API_BASE+path,{method:"POST",
    headers:{"content-type":"application/json","authorization":"Bearer "+deviceId()},
    body:JSON.stringify(payload)});
  const plan=r.headers.get("x-samvar-plan");
  if(plan){ DB.settings.aiPlan={plan, checked:Date.now()};
    // The device's own App Store check (RevenueCat SDK) is authoritative; the server may confirm Pro but never revoke it.
    const p=DB.settings.pro||{};
    if(plan==="pro" && !(p.active && p.source==="appstore")) DB.settings.pro=Object.assign(p,{active:true,checked:Date.now()});
    saveDB(); }
  if(r.status===402) throw new QuotaError("quota");
  if(!r.ok){ const e=await r.text().catch(()=>""); throw new Error("Samvar AI "+r.status+(e?": "+e.slice(0,120):"")); }
  return r.json();
}
function paywallSheet(reason){
  const dlg=document.createElement("dialog");
  dlg.innerHTML=`<div style="text-align:center;font-size:34px;padding-top:4px">🌱</div>
    <h2 style="font-size:22px;text-align:center;letter-spacing:-.02em">Samvar is working — keep it going</h2>
    <p class="hint" style="text-align:center;margin:4px 0 12px;font-size:14px">${esc(reason||`You've added ${FREE_PEOPLE} people and logged ${FREE_LOGS} conversations. Start your free trial to carry on — 7 days, no limits.`)}</p>
    <div class="factline" style="font-size:14px"><span class="fk">✨</span><span><b>Claude reads your notes</b> — several people in one ramble, relative dates, facts worth remembering.</span></div>
    <div class="factline" style="font-size:14px"><span class="fk">💬</span><span><b>Openers written for you</b> from what you actually know about each person.</span></div>
    <div class="factline" style="font-size:14px"><span class="fk">☀️</span><span><b>Daily nudges</b>, birthday radar and streaks.</span></div>
    <div class="factline" style="font-size:14px"><span class="fk">∞</span><span><b>Unlimited</b> people, notes and openers. Your data stays on your phone.</span></div>
    <button class="btn" data-buy="monthly" style="margin-top:14px">Start free trial · monthly</button>
    <button class="btn secondary" data-buy="yearly" style="margin-top:8px">Start free trial · yearly</button>
    <div style="display:flex;gap:8px;margin-top:10px">
      <button class="btn ghost small" id="pwRestore">Restore purchases</button>
      <button class="btn ghost small" id="pwClose">Not now</button></div>
    <p class="hint" style="text-align:center;margin-top:10px">Free for 7 days, then renews automatically unless cancelled at least 24 hours before the end of the period. Payment is charged to your Apple ID. Cancel any time in Settings → Subscriptions; you keep everything until the trial ends.</p>
    <p class="hint" style="text-align:center;margin-top:6px"><a href="https://samvar.app/terms" target="_blank" rel="noopener" style="color:var(--accent)">Terms of Use</a> · <a href="https://samvar.app/privacy" target="_blank" rel="noopener" style="color:var(--accent)">Privacy Policy</a></p>`;
  document.body.appendChild(dlg); dlg.showModal();
  const close=()=>{ dlg.close(); dlg.remove(); };
  // Prices come from the App Store via RevenueCat so every country sees its own currency.
  window.SamvarNative?.prices?.().then(p=>{ if(!p||!dlg.isConnected) return;
    if(p.monthly) dlg.querySelector('[data-buy="monthly"]').textContent=`Start free trial · then ${p.monthly.price} / month`;
    if(p.yearly) dlg.querySelector('[data-buy="yearly"]').textContent=`Start free trial · then ${p.yearly.price} / year`;
  }).catch(()=>{});
  dlg.querySelectorAll("[data-buy]").forEach(b=>b.addEventListener("click",async ()=>{
    const native=window.SamvarNative;
    if(!native||!native.purchase){ alert("Subscriptions are available in the App Store version of Samvar."); return; }
    b.disabled=true;
    try{ const res=await native.purchase(b.dataset.buy); if(res&&res.active){ DB.settings.pro={active:true,expires:res.expires||0,trial:!!res.trial,source:"appstore"}; saveDB(); close(); renderAll(); } }
    catch(e){ alert("Purchase didn't complete."); }
    b.disabled=false;
  }));
  dlg.querySelector("#pwRestore").addEventListener("click",async ()=>{
    const native=window.SamvarNative;
    if(!native||!native.restore){ alert("Restore is available in the App Store version of Samvar."); return; }
    try{ const res=await native.restore(); if(res&&res.active){ DB.settings.pro={active:true,expires:res.expires||0,trial:!!res.trial,source:"appstore"}; saveDB(); close(); renderAll(); } else alert("No active subscription found for this Apple ID."); }
    catch(e){ alert("Couldn't restore right now."); }
  });
  dlg.querySelector("#pwClose").addEventListener("click",close);
}
async function claudeCall(system, userText, maxTokens){
  const r=await fetch("https://api.anthropic.com/v1/messages",{
    method:"POST",
    headers:{"content-type":"application/json","x-api-key":getApiKey(),
      "anthropic-version":"2023-06-01","anthropic-dangerous-direct-browser-access":"true"},
    body:JSON.stringify({model:"claude-haiku-4-5",max_tokens:maxTokens||2500,system,
      messages:[{role:"user",content:userText}]})
  });
  if(!r.ok){ const e=await r.text().catch(()=>""); throw new Error("API "+r.status+(e?": "+e.slice(0,160):"")); }
  const data=await r.json();
  return (data.content||[]).map(c=>c.text||"").join("");
}
const PARSE_SYSTEM=`You extract social interactions from a person's spoken diary note so they can be scored in a connection-tracking app.
Return ONLY a JSON array, no prose. One object per distinct interaction (a note may contain several, or one interaction with several people).
Each object:
{"people":[names matched EXACTLY from the known-people list],
 "new_people":[names mentioned but NOT in the known list],
 "depth":1|2,  // 1=quick catch-up (a message, a short call, light banter, logistics); 2=quality time (a proper conversation or time spent together — a meal, a walk, an evening, real topics discussed)
 "channel":"inperson"|"call"|"message",  // video calls count as "call"
 "date":"YYYY-MM-DD",  // resolve 'yesterday', 'last night', 'this morning', weekday names, relative to today's date given
 "place":"place mentioned in the note (restaurant, area, town) or empty string",
 "summary":"<12 words capturing the interaction",
 "facts":[{"person":"Name","fact":"short durable fact worth remembering before next contacting them","kind":"family"|"likes"|"plans"|"work"|"date"|"other","followUp":"YYYY-MM-DD or empty"}]}
"followUp" is the date, if any, when it would be natural to ask how something went (interview, move, operation, trip, first day at school, race) — resolve relative phrases against today's date and add a day or two. Empty when there is no upcoming moment.
Facts are long-term memory, so be SELECTIVE: only durable things worth knowing months from now — birthdays and anniversaries, partner and children's names, pets' names, a job change, a house move, a health matter, a major life event. Do NOT record passing details, preferences, opinions, plans for next week or what was discussed (the "summary" field already captures the topic). Most interactions yield 0 facts; rarely more than 1. Write each fact so it stands alone ("daughter Iris, started secondary school Sept 2026"). Use the known person's name in "person" even when the note says "she"/"his wife" — attribute to whoever the interaction is with.
ALWAYS capture birthdays, anniversaries and other recurring personal dates as kind "date", converting relative mentions into the actual calendar date using today's date: "it was her birthday yesterday" on 19 August → {"fact":"birthday 18 August","kind":"date"}. A birthday is never trivia.
The note is usually dictated speech-to-text, so names are often mis-transcribed. If a name is phonetically or visually close to someone on the known-people list ("Sara"/"Serra"→Sarah, "Tomm"→Tom, "Jaymes"→James), treat it as that known person and return the known spelling in "people". Only put a name in "new_people" if the note-writer actually interacted with that person AND they are clearly not on the known list. People merely mentioned (a friend's partner, child, colleague) are NOT new_people — they belong in facts.
Judge depth by substance, not length. Group chat/likes count as "message". If genuinely no interaction is described, return [].`;
/* ---------- places & geocoding (OpenStreetMap Nominatim, no key, 1 req/sec, cached) ---------- */
let geoQueue=Promise.resolve();
function nominatim(url){
  const run=()=>new Promise(res=>setTimeout(res,1100))
    .then(()=>fetch(url,{headers:{"Accept":"application/json"}}))
    .then(r=>r&&r.ok?r.json():null).catch(()=>null);
  const p=geoQueue.then(run); geoQueue=p.catch(()=>{}); return p;
}
function townFromAddr(a){ const lines=String(a||"").split(/\n|,\s*/).map(x=>x.trim()).filter(Boolean); if(!lines.length) return "";
  const t=lines.find((l,i)=>i>0 && !/\d/.test(l)) || lines.find(l=>!/\d/.test(l)) || ""; const country=lines.length>2?lines[lines.length-1]:""; return [t, country&&!/\d/.test(country)&&country!==t?country:""].filter(Boolean).join(", "); }
function addrLine(a){ return String(a||"").split(/\n+/).map(x=>x.trim()).filter(Boolean).join(", "); }
function addrHtml(a){ return String(a||"").split(/\n+/).map(x=>esc(x.trim())).filter(Boolean).join("<br>"); }
function shortPlace(dn){ return String(dn||"").split(",").map(s=>s.trim()).slice(0,2).join(", "); }
async function geocode(addr){
  addr=addrLine(addr); const key=addr.toLowerCase(); if(!key) return null;
  if(key in DB.geo && DB.geo[key]!==null) return DB.geo[key]; // cache hits only; failures are retried
  const look=async q=>{ const j=await nominatim("https://nominatim.openstreetmap.org/search?format=json&limit=1&q="+encodeURIComponent(q));
    return (j&&j[0])?{lat:+j[0].lat,lon:+j[0].lon,label:shortPlace(j[0].display_name)}:null; };
  let hit=await look(addr);
  // Not found: let Samvar AI tidy the address (expand abbreviations, infer a missing country) and try once more.
  if(!hit && entitled() && !getApiKey()){
    try{
      const hints=DB.people.map(p=>addrLine(p.addr)).filter(a=>a&&a.toLowerCase()!==key).slice(0,6);
      const r=await samvarAI("/v1/address",{address:addr, hints, locale:navigator.language||""});
      if(r&&r.address&&r.confidence!=="low"&&r.address.trim().toLowerCase()!==key){ hit=await look(r.address); if(hit) hit.fixed=r.address; }
    }catch(e){ /* offline or no plan: plain lookup result stands */ }
  }
  DB.geo[key]=hit; saveDB(); return hit;
}
async function reverseGeo(lat,lon){
  const j=await nominatim(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lon}&zoom=16`);
  if(!j) return "";
  const a=j.address||{};
  return a.suburb||a.village||a.neighbourhood||a.town||a.city_district||a.city||String(j.display_name||"").split(",")[0]||"";
}
function getPosition(){ return new Promise(res=>{ if(!navigator.geolocation) return res(null);
  navigator.geolocation.getCurrentPosition(p=>res({lat:p.coords.latitude,lon:p.coords.longitude}),()=>res(null),{timeout:6000,maximumAge:300000}); }); }
function havKm(a,b){ const R=6371,t=x=>x*Math.PI/180;
  const h=Math.sin(t(b.lat-a.lat)/2)**2+Math.cos(t(a.lat))*Math.cos(t(b.lat))*Math.sin(t(b.lon-a.lon)/2)**2;
  return 2*R*Math.asin(Math.sqrt(h)); }
function isToday(ts){ return new Date(ts).toDateString()===new Date().toDateString(); }
function localDate(ts){ return new Date(ts).toLocaleDateString("en-CA"); } // YYYY-MM-DD in local time

function lev(a,b){
  const m=a.length,n=b.length; if(!m) return n; if(!n) return m;
  let prev=Array.from({length:n+1},(_,j)=>j);
  for(let i=1;i<=m;i++){ const cur=[i];
    for(let j=1;j<=n;j++) cur[j]=Math.min(prev[j]+1,cur[j-1]+1,prev[j-1]+(a[i-1]===b[j-1]?0:1));
    prev=cur; }
  return prev[n];
}
function fuzzyFind(raw){
  const n=String(raw).toLowerCase(); let best=null,bd=9,tie=false;
  for(const p of DB.people){
    const cands=[p.name.toLowerCase(),nameTokens(p.name)[0],...(p.aliases||[]).map(a=>a.toLowerCase())];
    for(const c of cands){ if(!c) continue;
      const d=lev(n,c), lim=c.length<=4?1:2;
      if(d>lim) continue;
      if(d<bd){ bd=d; best=p; tie=false; }
      else if(d===bd && best && p.id!==best.id) tie=true;
    }
  }
  return tie?null:best; // ambiguous between two different people → don't guess
}
async function aiParse(text){
  const people=DB.people.map(p=>p.name+((p.aliases||[]).length?` (aka ${p.aliases.join(", ")})`:"")).join("; ")||"(none yet)";
  const today=new Date();
  let arr;
  if(getApiKey()){
    const out=await claudeCall(PARSE_SYSTEM,
      `Today is ${today.toLocaleDateString("en-GB",{weekday:"long",year:"numeric",month:"long",day:"numeric"})}.\nKnown people: ${people}\n\nNote:\n${text}`);
    const m=out.match(/\[[\s\S]*\]/); if(!m) throw new Error("Unexpected reply");
    arr=JSON.parse(m[0]);
  } else {
    arr=await samvarAI("/v1/parse",{note:text, people, today:today.toLocaleDateString("en-GB",{weekday:"long",year:"numeric",month:"long",day:"numeric"})});
  }
  if(!Array.isArray(arr)) throw new Error("Unexpected reply");
  return arr.map(o=>{
    const personIds=[], pendingNames=[];
    for(const n of (o.people||[])){
      const p=DB.people.find(x=>x.name.toLowerCase()===String(n).toLowerCase()
        || nameTokens(x.name)[0]===String(n).toLowerCase()
        || (x.aliases||[]).some(a=>a.toLowerCase()===String(n).toLowerCase()));
      const hit=p||fuzzyFind(n);
      if(hit && !personIds.includes(hit.id)) personIds.push(hit.id); else if(!hit) pendingNames.push(String(n));
    }
    for(const n of (o.new_people||[])){
      const hit=fuzzyFind(n);
      if(hit && !personIds.includes(hit.id)) personIds.push(hit.id);
      else if(!hit && !pendingNames.includes(String(n))) pendingNames.push(String(n));
    }
    let ts=Date.now();
    if(o.date && /^\d{4}-\d{2}-\d{2}$/.test(o.date)){ const t=new Date(o.date+"T12:00").getTime(); if(t && t<=Date.now()+DAY) ts=t; }
    const facts=(o.facts||[]).map(f=>({person:String(f.person||"").slice(0,60),
      fact:String(f.fact||"").slice(0,200),
      kind:KIND_EMOJI[f.kind]?f.kind:"other"})).filter(f=>f.person&&f.fact);
    return {id:uid(), ai:true, note:o.summary||text.slice(0,120), personIds, pendingNames, facts,
      place:String(o.place||"").slice(0,80),
      depth:Math.min(2,Math.max(1,+o.depth||1)),
      channel:o.channel==="video"?"call":(CHANNELS[o.channel]?o.channel:"inperson"), ts};
  });
}

/* ---------- charts (dataviz spec: thin marks, 2px line, hover layer) ---------- */
const tooltip=document.getElementById("tooltip");
let tipTimer=null;
function showTip(html,x,y){ tooltip.innerHTML=html; tooltip.style.display="block"; clearTimeout(tipTimer); tipTimer=setTimeout(hideTip,2500);
  const r=tooltip.getBoundingClientRect();
  tooltip.style.left=Math.min(innerWidth-r.width-8,Math.max(8,x-r.width/2))+"px";
  tooltip.style.top=(y-r.height-14)+"px"; }
function hideTip(){ tooltip.style.display="none"; clearTimeout(tipTimer); }
window.addEventListener("scroll",hideTip,{passive:true});
document.addEventListener("pointerdown",ev=>{ if(!ev.target.closest(".ringseg")) hideTip(); },true);

function sparkline(el, series){
  if(!series.length){ el.innerHTML=""; return; }
  const W=220,H=80,P=6;
  const T=targetScore(), vs=series.map(d=>d.v), min=0, max=Math.max(...vs, T?T*1.15:10, 10);
  const one=series.length===1;
  const x=i=>one?W-P:P+(W-2*P)*i/(series.length-1);
  const y=v=>H-P-(H-2*P)*((v-min)/((max-min)||1));
  const pts=series.map((d,i)=>`${x(i)},${y(d.v)}`).join(" ");
  const last=series[series.length-1];
  // bands: below 60% of target (needs work) · approaching · at or above target
  const bands=T?`<rect x="${P}" y="${y(max)}" width="${W-2*P}" height="${Math.max(0,y(T)-y(max))}" fill="var(--good)" opacity=".13"/>
    <rect x="${P}" y="${y(T)}" width="${W-2*P}" height="${Math.max(0,y(0.6*T)-y(T))}" fill="var(--warn)" opacity=".12"/>
    <rect x="${P}" y="${y(0.6*T)}" width="${W-2*P}" height="${Math.max(0,y(0)-y(0.6*T))}" fill="var(--critical)" opacity=".08"/>
    <line x1="${P}" y1="${y(T)}" x2="${W-P}" y2="${y(T)}" stroke="var(--good)" stroke-width="1" stroke-dasharray="3 3" opacity=".7"/>
    <text x="${P+2}" y="${Math.max(9,y(T)-3)}" font-size="9" fill="var(--good)">target ${T}</text>`:"";
  el.innerHTML=`<svg viewBox="0 0 ${W} ${H}" width="100%" style="touch-action:pan-y;pointer-events:none">
    ${bands}
    <line x1="${P}" y1="${H-P}" x2="${W-P}" y2="${H-P}" stroke="var(--baseline)" stroke-width="1"/>
    ${one?"":`<polyline points="${pts}" fill="none" stroke="var(--accent)" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`}
    <circle cx="${x(series.length-1)}" cy="${y(last.v)}" r="3.5" fill="var(--accent)" stroke="var(--tint-lav)" stroke-width="2"/>
    <text x="${W-P}" y="10" text-anchor="end" font-size="10" fill="var(--muted)">${one?"week 1":series.length+" wks"}</text>
  </svg>`;
}

function depthMixBar(el, legendEl){
  const s=windowStats(Date.now(),30);
  const counts=[0,0];
  s.xs.forEach(x=>counts[Math.min(2,x.depth)-1]++);
  const total=counts.reduce((a,b)=>a+b,0);
  if(!total){ el.innerHTML=`<div class="empty" style="padding:10px">No interactions logged in the last 30 days yet.</div>`; legendEl.innerHTML=""; return; }
  const colors=["var(--d2)","var(--d3)"];
  const W=600,H=34;
  let acc=0, segs="";
  const segData=[];
  counts.forEach((c,i)=>{
    if(!c) return;
    const w=(W*c/total);
    segData.push({x:acc,w,i,c});
    acc+=w;
  });
  segs=segData.map((sd,j)=>{
    const pct=Math.round(100*sd.c/total);
    const lab=(sd.w>60)?`<text x="${sd.x+sd.w/2}" y="${H/2+4}" text-anchor="middle" font-size="12" font-weight="700" fill="${sd.i>=1?'#fff':'var(--ink)'}">${pct}%</text>`:"";
    // 2px surface gap between segments via stroke
    return `<g class="dseg" data-i="${sd.i}" data-c="${sd.c}" data-p="${pct}">
      <rect x="${sd.x}" y="4" width="${sd.w}" height="${H-8}" rx="4" fill="${colors[sd.i]}" stroke="var(--surface)" stroke-width="2"/>${lab}</g>`;
  }).join("");
  el.innerHTML=`<svg viewBox="0 0 ${W} ${H}" width="100%">${segs}</svg>`;
  legendEl.innerHTML=DEPTHS.map((d,i)=>`<span><i style="background:${colors[i]}"></i>${d.label}</span>`).join("");
  el.querySelectorAll(".dseg").forEach(g=>{
    g.addEventListener("pointerenter",ev=>{
      const i=+g.dataset.i;
      showTip(`<b>${DEPTHS[i].label}</b> · ${g.dataset.c} interaction${g.dataset.c>1?"s":""} (${g.dataset.p}%)`, ev.clientX, ev.clientY);
    });
    g.addEventListener("pointerleave",hideTip);
  });
}

/* ---------- circle rings (fitness-style) ---------- */
function ringStats(){
  const now=Date.now();
  return ["inner","invest","warm"].map((k,i)=>{
    const t=TIERS[k], ppl=DB.people.filter(p=>p.tier===k);
    const inRhythm=ppl.filter(p=>{ const l=lastContact(p,now); return l && (now-l)/DAY<=t.cadence; }).length;
    return {k, label:t.label, n:ppl.length, inRhythm, pct: ppl.length? inRhythm/ppl.length : 0,
      color:`var(--ring${i+1})`};
  });
}
function renderRings(){
  const stats=ringStats();
  const S=140,C=S/2, w=13, radii=[26,42,58]; // inner circle innermost, keep-warm outermost
  let svg=`<svg viewBox="0 0 ${S} ${S}" width="${S}" height="${S}">`;
  stats.forEach((s,i)=>{
    const r=radii[i], circ=2*Math.PI*r;
    const filled=Math.max(0.001,s.pct)*circ;
    svg+=`<circle cx="${C}" cy="${C}" r="${r}" fill="none" stroke="var(--grid)" stroke-width="${w}"/>`;
    if(s.n) svg+=`<g class="ringseg" data-i="${i}"><circle cx="${C}" cy="${C}" r="${r}" fill="none" stroke="${s.color}" stroke-width="${w}"
      stroke-linecap="round" stroke-dasharray="${filled} ${circ}" transform="rotate(-90 ${C} ${C})"/></g>`;
  });
  svg+=`</svg>`;
  document.getElementById("ringsViz").innerHTML=svg;
  document.getElementById("ringsLegend").innerHTML=stats.map(s=>
    `<span style="display:inline-flex;align-items:center;gap:7px">
      <i style="width:10px;height:10px;border-radius:50%;background:${s.color};display:inline-block"></i>
      <span><b style="color:var(--ink)">${s.label}</b> — ${s.n? `${s.inRhythm} of ${s.n} in rhythm (${Math.round(s.pct*100)}%)` : "no one filed yet"}</span></span>`).join("");
  document.querySelectorAll("#ringsViz .ringseg").forEach(g=>{
    g.addEventListener("pointerenter",ev=>{ const s=stats[+g.dataset.i];
      showTip(`<b>${s.label}</b> · ${s.inRhythm}/${s.n} contacted within ${TIERS[s.k].cadence} days`,ev.clientX,ev.clientY); });
    g.addEventListener("pointerleave",hideTip);
  });
}

/* ---------- edit a saved interaction ---------- */
function editInteraction(id){
  const x=DB.interactions.find(i=>i.id===id); if(!x) return;
  const dlg=document.createElement("dialog");
  const chips=()=>x.personIds.map(pid=>{const p=DB.people.find(q=>q.id===pid);
    return `<span class="chip">${esc(p?.name||"?")}<button data-erm="${pid}">✕</button></span>`;}).join("");
  dlg.innerHTML=`<h2 style="font-size:17px;margin-bottom:8px">Edit interaction</h2>
    ${x.note?`<p class="hint" style="margin:0 0 8px">“${esc(x.note.slice(0,120))}”</p>`:""}
    <div class="fld"><label>Who</label><div class="chips" id="echips">${chips()}
      <span class="chip" style="background:transparent"><input type="text" id="eadd" placeholder="+ add name" style="border:none;background:none;width:90px;padding:2px;font-size:14px"></span></div></div>
    <div class="fld"><label>Type</label><div class="seg" data-eset="depth">
      ${DEPTHS.map(v=>`<button data-v="${v.n}" class="${x.depth===v.n?"on":""}">${v.label}</button>`).join("")}</div></div>
    <div class="fld"><label>Channel</label><div class="seg" data-eset="channel">
      ${Object.entries(CHANNELS).map(([k,v])=>`<button data-v="${k}" class="${x.channel===k?"on":""}">${v.label}</button>`).join("")}</div></div>
    <div class="fld"><label>Where</label><div style="display:flex;gap:8px">
      <input type="text" id="ewhere" value="${esc(x.place||"")}" placeholder="place (optional)">
      <button class="btn ghost small" id="egps">📍</button></div></div>
    <div class="fld"><label>When</label><input type="date" id="edate" value="${localDate(x.ts)}"></div>
    <div class="fld"><label>Photo</label><div style="display:flex;gap:8px;align-items:center">
      <div id="ephoto" class="avatar" ${x.photo?`data-photo="${esc(x.photo)}"`:""} style="border-radius:10px;width:56px;height:56px;${x.photo?"":"display:none"}"></div>
      <button class="btn ghost small" id="ephotoBtn">${x.photo?"Change photo":"📷 Add photo"}</button>
      <button class="btn ghost small" id="ephotoRm" style="${x.photo?"":"display:none"}">Remove</button></div></div>
    <div style="display:flex;gap:8px">
      <button class="btn small" id="esave">Save changes</button>
      <button class="btn ghost small" id="ecancel">Cancel</button></div>`;
  document.body.appendChild(dlg); dlg.showModal();
  const draft={personIds:[...x.personIds],depth:x.depth,channel:x.channel,ts:x.ts,place:x.place||"",loc:x.loc,photo:x.photo};
  hydratePhotos(dlg);
  dlg.querySelector("#ephotoBtn").addEventListener("click",async ()=>{ const ref=await choosePhoto(); if(!ref) return;
    if(draft.photo&&draft.photo!==x.photo) removePhoto(draft.photo);
    draft.photo=ref; const ph=dlg.querySelector("#ephoto"); ph.dataset.photo=ref; ph.style.display=""; hydratePhotos(dlg); dlg.querySelector("#ephotoRm").style.display=""; });
  dlg.querySelector("#ephotoRm").addEventListener("click",()=>{ if(draft.photo&&draft.photo!==x.photo) removePhoto(draft.photo); draft.photo=undefined; dlg.querySelector("#ephoto").style.display="none"; dlg.querySelector("#ephotoRm").style.display="none"; dlg.querySelector("#ephotoBtn").textContent="📷 Add photo"; });
  dlg.querySelector("#ewhere").addEventListener("input",e=>{ draft.place=e.target.value; });
  dlg.querySelector("#egps").addEventListener("click",async ()=>{
    const b=dlg.querySelector("#egps"); b.textContent="…";
    const pos=await getPosition();
    if(pos){ const pl=await reverseGeo(pos.lat,pos.lon); draft.place=pl; draft.loc=pos; dlg.querySelector("#ewhere").value=pl; }
    b.textContent="📍";
  });
  dlg.querySelectorAll(".seg[data-eset]").forEach(seg=>seg.querySelectorAll("button").forEach(b=>b.addEventListener("click",()=>{
    draft[seg.dataset.eset]=seg.dataset.eset==="depth"?+b.dataset.v:b.dataset.v;
    seg.querySelectorAll("button").forEach(q=>q.classList.toggle("on",q===b));
  })));
  const rebindRm=()=>dlg.querySelectorAll("[data-erm]").forEach(b=>b.onclick=()=>{
    draft.personIds=draft.personIds.filter(pid=>pid!==b.dataset.erm);
    b.parentElement.remove();
  });
  rebindRm();
  dlg.querySelector("#eadd").addEventListener("keydown",e=>{
    if(e.key!=="Enter") return;
    const name=e.target.value.trim(); if(!name) return;
    let p=DB.people.find(q=>q.name.toLowerCase()===name.toLowerCase())||fuzzyFind(name);
    const attach=pp=>{ if(!draft.personIds.includes(pp.id)) draft.personIds.push(pp.id);
      e.target.value="";
      e.target.parentElement.insertAdjacentHTML("beforebegin",`<span class="chip">${esc(pp.name)}<button data-erm="${pp.id}">✕</button></span>`);
      rebindRm(); };
    if(p) attach(p);
    else askTier(name, tier=>{ const np={id:uid(),name,tier,aliases:[],added:Date.now()}; DB.people.push(np); saveDB(); attach(np); });
  });
  dlg.querySelector("#edate").addEventListener("change",e=>{ draft.ts=new Date(e.target.value+"T12:00").getTime(); });
  dlg.querySelector("#esave").addEventListener("click",()=>{
    if(!draft.personIds.length){ alert("Keep at least one person on it."); return; }
    if(x.photo&&x.photo!==draft.photo) removePhoto(x.photo);
    Object.assign(x,draft); saveDB(); dlg.close(); dlg.remove(); renderAll();
  });
  dlg.querySelector("#ecancel").addEventListener("click",()=>{ if(draft.photo&&draft.photo!==x.photo) removePhoto(draft.photo); dlg.close(); dlg.remove(); });
}

/* ---------- weekly goal & streak ---------- */
function weekGoal(){ return DB.settings.weekGoal||3; } // meaningful (substantive) conversations per week
function weekStart(ts){ const d=new Date(ts); const dow=(d.getDay()+6)%7; d.setHours(0,0,0,0); return d.getTime()-dow*DAY; }
function meaningfulCount(ws){ return DB.interactions.filter(x=>x.ts>=ws && x.ts<ws+7*DAY && x.depth>=2).length; }
function streakData(){
  const G=weekGoal(), nowWs=weekStart(Date.now());
  const cur=meaningfulCount(nowWs);
  let past=0, ws=nowWs-7*DAY;
  while(meaningfulCount(ws)>=G && past<520){ past++; ws-=7*DAY; }
  return {cur, done:cur>=G, streak:past+(cur>=G?1:0)};
}
// Daily reach-out streak: consecutive days with at least one conversation logged (today or yesterday keeps it alive).
// One "rest day" per 7-day run is forgiven automatically, so a holiday weekend doesn't wipe a good month.
function dayKeyOf(ts){ const d=new Date(ts); return d.getFullYear()+"-"+(d.getMonth()+1)+"-"+d.getDate(); }
function dailyStreak(){
  const days=new Set(DB.interactions.map(x=>dayKeyOf(x.ts)));
  const today=new Date(); today.setHours(0,0,0,0);
  let d=today.getTime(); const loggedToday=days.has(dayKeyOf(d));
  if(!loggedToday) d-=DAY;
  if(!days.has(dayKeyOf(d))) return {streak:0, loggedToday, freezes:0};
  let n=0, freezes=0, misses=0;
  while(n<3650){
    if(days.has(dayKeyOf(d))){ n++; if(n%7===0) freezes=Math.min(3,freezes+1); d-=DAY; continue; }
    if(freezes>0 && misses<1){ freezes--; misses++; d-=DAY; continue; } // rest day covered
    break;
  }
  return {streak:n, loggedToday, freezes};
}

/* ---------- birthdays ---------- */
const MONTHS={jan:0,feb:1,mar:2,apr:3,may:4,jun:5,jul:6,aug:7,sep:8,oct:9,nov:10,dec:11};
function birthdayOf(p){
  for(const f of (p.facts||[])){
    if(f.kind!=="date" || !/birthday/i.test(f.f)) continue;
    let m=f.f.match(/(\d{1,2})(?:st|nd|rd|th)?(?:\s+of)?\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*/i);
    if(m) return {day:+m[1], mon:MONTHS[m[2].slice(0,3).toLowerCase()]};
    m=f.f.match(/(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+(\d{1,2})(?:st|nd|rd|th)?/i);
    if(m) return {day:+m[2], mon:MONTHS[m[1].slice(0,3).toLowerCase()]};
  }
  return null;
}
function upcomingBirthdays(withinDays){
  const now=new Date(); const today=new Date(now.getFullYear(),now.getMonth(),now.getDate());
  const out=[];
  for(const p of DB.people){
    if(p.tier==="notnow") continue;
    const b=birthdayOf(p); if(!b) continue;
    let next=new Date(now.getFullYear(),b.mon,b.day);
    if(next<today) next=new Date(now.getFullYear()+1,b.mon,b.day);
    const days=Math.round((next-today)/DAY);
    if(days<=withinDays) out.push({p,next,days,b});
  }
  return out.sort((a,b)=>a.days-b.days);
}
function allBirthdays(){
  return DB.people.map(p=>({p,b:birthdayOf(p)})).filter(x=>x.b && x.p.tier!=="notnow");
}
function exportICS(){
  const list=allBirthdays();
  if(!list.length){ alert("No birthdays stored yet — mention them in your notes (\"Tom's birthday is 3 March\") or add a 🎂 fact on a person's profile."); return; }
  const now=new Date(), pad=n=>String(n).padStart(2,"0");
  let ics="BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Samvar//Birthdays//EN\r\nCALSCALE:GREGORIAN\r\n";
  for(const {p,b} of list){
    let next=new Date(now.getFullYear(),b.mon,b.day);
    if(next<new Date(now.getFullYear(),now.getMonth(),now.getDate())) next=new Date(now.getFullYear()+1,b.mon,b.day);
    const d=`${next.getFullYear()}${pad(b.mon+1)}${pad(b.day)}`;
    const name=p.name.replace(/[,;\\]/g," ");
    ics+=`BEGIN:VEVENT\r\nUID:samvar-bday-${p.id}@samvar\r\nDTSTART;VALUE=DATE:${d}\r\nRRULE:FREQ=YEARLY\r\nSUMMARY:🎂 ${name}'s birthday\r\nDESCRIPTION:From Samvar — reach out!\r\nBEGIN:VALARM\r\nTRIGGER:PT9H\r\nACTION:DISPLAY\r\nDESCRIPTION:🎂 ${name}'s birthday today\r\nEND:VALARM\r\nEND:VEVENT\r\n`;
  }
  ics+="END:VCALENDAR\r\n";
  saveFile("samvar-birthdays.ics", ics, "text/calendar");
}
// Native: share sheet with a real file (WKWebView has no download support). Web: ordinary download link.
function saveFile(name, text, mime){
  const n=window.SamvarNative;
  if(n && n.shareFile){ n.shareFile(name, text).catch(e=>{ if(!/cancel/i.test(String(e&&e.message))) alert("Couldn't export "+name+"."); }); return; }
  const a=document.createElement("a"); a.href=URL.createObjectURL(new Blob([text],{type:mime}));
  a.download=name; a.click();
}

/* ---------- one-tap contact actions ---------- */
function telDigits(t){ return String(t||"").replace(/[^\d+]/g,""); }
// One-tap ways to reach someone. External https links open the app via target=_blank (Capacitor hands them to iOS).
const WA_ICON=`<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" style="vertical-align:middle"><path fill="#25D366" d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413Z"/></svg>`;
function phoneList(p){ // [{label, number}] main first
  const out=[]; const t=telDigits(p.tel); if(t) out.push({label:p.telIsMobile===false?"Phone":"Mobile", number:t});
  for(const x of (p.tels||[])){ const d=telDigits(x.number); if(d && !out.some(o=>o.number===d)) out.push({label:x.label||"Other", number:d}); }
  return out;
}
function contactLinks(p){
  const t=telDigits(p.tel), out=[], many=phoneList(p).length>1;
  if(t) out.push({k:"call", label:"📞", title:"Call", href:many?"#":`tel:${t}`, pick:many?"call":""});
  if(t) out.push({k:"text", label:"💬", title:"Text", href:many?"#":`sms:${t}`, pick:many?"text":""});
  if(p.email) out.push({k:"email", label:"✉️", title:"Email", href:`mailto:${p.email}`});
  if(t && p.telIsMobile!==false){ const d=t.replace(/^\+/,"").replace(/^0/, ""); out.push({k:"wa", label:WA_ICON, title:"WhatsApp", href:`https://wa.me/${t.startsWith("+")?t.slice(1):d}`, ext:true}); }
  return out;
}
function contactBtns(p){
  const links=contactLinks(p); if(!links.length) return "";
  return links.map((l,i)=>`<a class="btn ${i?"ghost ":""}small" href="${l.href}" title="${esc(l.title||"")}" aria-label="${esc(l.title||"")}"${l.pick?` data-pick="${l.pick}" data-pid="${p.id}"`:""}${l.ext?' target="_blank" rel="noopener"':""}>${l.label}</a>`).join("");
}

/* ---------- rendering ---------- */
function initials(name){ return name.split(/\s+/).slice(0,2).map(w=>w[0]||"").join("").toUpperCase(); }
const AV_COLORS=["#cfe0f7","#f9ddc9","#d5eedd","#f3d9e5","#e6e0f7","#f7ecc8"];
function avColor(name){ let h=0; for(const c of String(name)) h=(h*31+c.charCodeAt(0))>>>0; return AV_COLORS[h%AV_COLORS.length]; }
function av(name, photo){ return `<div class="avatar"${photo?` data-photo="${esc(photo)}"`:""} style="background:${avColor(name)}">${esc(initials(name))}</div>`; }
/* ---------- photos: files on the phone (native) or small data URLs (web) ---------- */
const photoCache={};
function photoSrcSync(ref){ return !ref?null:ref.startsWith("data:")?ref:(photoCache[ref]||null); }
async function photoSrc(ref){
  if(!ref) return null; if(ref.startsWith("data:")) return ref;
  if(photoCache[ref]) return photoCache[ref];
  const n=window.SamvarNative; if(!n||!n.photoUrl) return null;
  try{ const u=await n.photoUrl(ref); if(u) photoCache[ref]=u; return u; }catch(e){ return null; }
}
// More than one number: ask which before calling or texting.
document.addEventListener("click",ev=>{
  const a=ev.target.closest("a[data-pick]"); if(!a) return;
  ev.preventDefault(); ev.stopPropagation();
  const p=DB.people.find(x=>x.id===a.dataset.pid); if(!p) return;
  const kind=a.dataset.pick, nums=phoneList(p);
  const dlg=document.createElement("dialog");
  dlg.innerHTML=`<h2 style="font-size:17px;margin-bottom:10px">${kind==="call"?"Call":"Text"} ${esc(capName(p))} on…</h2>
    ${nums.map(n=>`<button class="btn secondary" data-num="${esc(n.number)}" style="width:100%;margin-bottom:8px;text-align:left">${esc(n.label)} · ${esc(n.number)}</button>`).join("")}
    <button class="btn ghost small" id="numCancel">Cancel</button>`;
  document.body.appendChild(dlg); dlg.showModal();
  dlg.querySelectorAll("[data-num]").forEach(b=>b.addEventListener("click",()=>{ dlg.close(); dlg.remove(); window.location.href=(kind==="call"?"tel:":"sms:")+b.dataset.num; }));
  dlg.querySelector("#numCancel").addEventListener("click",()=>{ dlg.close(); dlg.remove(); });
},true);
function showPhotoFull(src){
  // A modal <dialog> so it sits above any open profile/edit sheet (they live on the top layer too).
  const v=document.createElement("dialog"); v.className="photoview";
  v.innerHTML=`<img src="${src}" alt=""><div class="photoview-hint">Tap to close</div>`;
  v.addEventListener("click",()=>{ v.close(); v.remove(); }); document.body.appendChild(v); v.showModal();
}
document.addEventListener("click",ev=>{
  const el=ev.target.closest(".avatar[data-photo]"); if(!el) return;
  const src=photoSrcSync(el.dataset.photo); if(!src) return;
  ev.stopPropagation(); ev.preventDefault(); showPhotoFull(src);
},true);
function hydratePhotos(root){
  (root||document).querySelectorAll("[data-photo]").forEach(async el=>{
    const src=await photoSrc(el.dataset.photo); if(!src||!el.isConnected) return;
    el.style.backgroundImage=`url("${src}")`; el.style.backgroundSize="cover"; el.style.backgroundPosition="center"; el.textContent="";
  });
}
// Downscale an image (data URL) on a canvas; used on the web and for contact photos.
function shrinkImage(dataUrl, max){
  return new Promise(res=>{ const img=new Image(); img.onload=()=>{
    const k=Math.min(1, max/Math.max(img.width,img.height)); const c=document.createElement("canvas");
    c.width=Math.round(img.width*k); c.height=Math.round(img.height*k);
    c.getContext("2d").drawImage(img,0,0,c.width,c.height); res(c.toDataURL("image/jpeg",0.72)); };
    img.onerror=()=>res(null); img.src=dataUrl; });
}
// Store a base64 JPEG and return the reference to keep in the DB.
async function storePhoto(base64){
  const n=window.SamvarNative;
  if(n&&n.savePhoto){ const ref=await n.savePhoto(base64, uid()+uid()); if(ref) photoCache[ref]=null; return ref; }
  return shrinkImage("data:image/jpeg;base64,"+base64.replace(/^data:[^,]*,/,""), 256);
}
async function removePhoto(ref){ if(!ref||ref.startsWith("data:")) return; window.SamvarNative?.deletePhoto?.(ref); delete photoCache[ref]; }
// Ask for a photo: native gets a Camera / Library choice, the web gets a file picker. Resolves to a DB reference or null.
function choosePhoto(opts={}){
  const n=window.SamvarNative;
  if(n&&n.pickPhoto){
    return new Promise(res=>{
      const dlg=document.createElement("dialog");
      dlg.innerHTML=`<h2 style="font-size:17px;margin-bottom:10px">${opts.allowRemove?"Change photo":"Add a photo"}</h2>
        <div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn small" data-src="camera">📷 Take photo</button>
        <button class="btn secondary small" data-src="photos">🖼 Choose from library</button>
        ${opts.allowRemove?`<button class="btn ghost small" data-src="remove" style="color:var(--critical)">Remove photo</button>`:""}
        <button class="btn ghost small" data-src="">Cancel</button></div>`;
      document.body.appendChild(dlg); dlg.showModal();
      dlg.querySelectorAll("[data-src]").forEach(b=>b.addEventListener("click",async ()=>{
        dlg.close(); dlg.remove(); if(!b.dataset.src) return res(null); if(b.dataset.src==="remove") return res("");
        const b64=await n.pickPhoto(b.dataset.src); res(b64?await storePhoto(b64):null); }));
    });
  }
  return new Promise(res=>{ const inp=document.createElement("input"); inp.type="file"; inp.accept="image/*";
    inp.onchange=async ()=>{ const f=inp.files[0]; if(!f) return res(null);
      const r=new FileReader(); r.onload=async ()=>res(await shrinkImage(r.result,256)); r.readAsDataURL(f); };
    inp.click(); });
}
const KIND_EMOJI={family:"👨‍👩‍👧",likes:"❤️",plans:"📅",work:"💼",date:"🎂",other:"📝"};
function fmtAgo(ts){
  if(!ts) return "never";
  const d=Math.floor((Date.now()-ts)/DAY);
  if(d===0) return "today"; if(d===1) return "yesterday";
  if(d<14) return d+" days ago"; if(d<70) return Math.round(d/7)+" weeks ago";
  return Math.round(d/30)+" months ago";
}

function renderOnboard(){
  const el=document.getElementById("onboard");
  const np=DB.people.filter(p=>p.tier!=="notnow").length, nl=DB.interactions.length;
  const steps=[
    {done:np>=FREE_PEOPLE, text:`Add ${FREE_PEOPLE} people, from besties to the resties`, sub:`${Math.min(np,FREE_PEOPLE)} of ${FREE_PEOPLE}`, go:"contacts"},
    {done:nl>=FREE_LOGS, text:`Log your first ${FREE_LOGS} conversations — just say what happened`, sub:`${Math.min(nl,FREE_LOGS)} of ${FREE_LOGS}`, go:"log"},
    {done:!!DB.settings.nudgeSet, text:"Choose when Samvar nudges you", go:"settings"}
  ];
  if(steps.every(s=>s.done)){ el.innerHTML=""; return; }
  el.innerHTML=`<div class="card t-sky">
    <div class="lbl" style="font-size:12px;color:var(--ink-2);font-weight:600;text-transform:uppercase;letter-spacing:.05em">Getting started</div>
    ${steps.map(s=>`<div class="why" style="margin-top:10px;display:flex;gap:10px;align-items:center;font-size:14px">
      <span>${s.done?"✅":"◯"}</span>
      <span style="flex:1;${s.done?"text-decoration:line-through;color:var(--muted)":""}">${s.text}${s.sub&&!s.done?` <span class="badge" style="margin-left:4px">${s.sub}</span>`:""}</span>
      ${s.done?"":`<button class="btn small" data-go="${s.go}">Go</button>`}</div>`).join("")}
  </div>`;
  el.querySelectorAll("[data-go]").forEach(b=>b.addEventListener("click",()=>{ if(b.dataset.go==="contacts"){ switchPage("people"); const c=document.getElementById("pickContacts"); if(c&&c.style.display!=="none") c.click(); } else switchPage(b.dataset.go); }));
}
let showAllSugg=false;
function renderHome(){
  const now=Date.now();
  renderOnboard();
  // birthday radar
  const bd=upcomingBirthdays(14);
  document.getElementById("bdayStrip").innerHTML=bd.length?`<div class="card" style="background:var(--tint-rose);border-color:transparent">
    ${bd.map(x=>`<div class="why" data-bpid="${x.p.id}" style="cursor:pointer">🎂 <b>${esc(x.p.name)}</b> — ${x.days===0?"<b>today!</b>":x.days===1?"<b>tomorrow</b>":x.next.toLocaleDateString("en-GB",{weekday:"long",day:"numeric",month:"short"})+` (in ${x.days} days)`}${x.days<=3?" — get in first":""}</div>`).join("")}
  </div>`:"";
  document.querySelectorAll("[data-bpid]").forEach(el=>el.addEventListener("click",()=>personSheet(el.dataset.bpid)));
  const score=connectionScore(now), prev=connectionScore(now-7*DAY);
  document.getElementById("scoreVal").textContent=DB.interactions.length?score:"–";
  const dEl=document.getElementById("scoreDelta");
  if(DB.interactions.length){
    const diff=score-prev;
    dEl.innerHTML=diff===0?`<span class="sub">flat vs last week</span>`:
      diff>0?`<span class="delta-up">▲ ${diff} vs last week</span>`:`<span class="delta-dn">▼ ${-diff} vs last week</span>`;
  } else dEl.innerHTML=`<span class="sub">log your first interaction</span>`;
  const st=dailyStreak(), stEl=document.getElementById("streakLine");
  if(stEl) stEl.innerHTML=st.streak?`🔥 <b>${st.streak}-day</b> streak${st.loggedToday?"":" — log something today to keep it"}${st.freezes?` · ${st.freezes} rest day${st.freezes===1?"":"s"} banked`:""}`
    :(DB.interactions.length?`Log a conversation today to start a streak.`:"");
  sparkline(document.getElementById("sparkWrap"), DB.interactions.length?weeklySeries(12):[]);
  renderRings();

  renderReflection();
  // other nudges (the pick already lives in the "This week" card): top 3 by urgency, expandable to all
  const att=document.getElementById("homeAttention"), more=document.getElementById("suggMore");
  const pick=todaysPick(nudges());
  const list=nudges().filter(n=>!pick||n.p!==pick.p||n.kind!=="overdue");
  const shown=showAllSugg?list:list.slice(0,3);
  document.getElementById("attHead").style.display=list.length?"":"none";
  att.innerHTML=shown.map(nudgeCard).join("");
  bindNudgeButtons(att);
  more.innerHTML=list.length>3?`<button class="btn ghost small" id="suggToggle" style="margin:0 0 12px">${showAllSugg?"Show fewer":`See all ${list.length}`}</button>`:"";
  more.querySelector("#suggToggle")?.addEventListener("click",()=>{ showAllSugg=!showAllSugg; renderHome(); });

  const rec=document.getElementById("homeRecent");
  const xs=[...DB.interactions].sort((a,b)=>b.ts-a.ts).slice(0,6);
  rec.innerHTML=xs.length?xs.map(x=>{
    const names=x.personIds.map(id=>DB.people.find(p=>p.id===id)?.name||"(removed)").join(", ");
    return `<div class="person" data-edit="${x.id}" style="cursor:pointer">${x.photo?`<div class="avatar" data-photo="${esc(x.photo)}" style="border-radius:10px"></div>`:av(names)}
      <div><div class="nm">${esc(names||"(no one tagged)")}</div>
      <div class="meta">${x.ai?`<span class="badge" style="font-size:10px;padding:1px 6px;margin-right:4px">✨ Claude</span>`:""}${DEPTHS[x.depth-1].label} · ${CHANNELS[x.channel].label} · ${fmtAgo(x.ts)}${x.place?` · 📍 ${esc(x.place)}`:""}</div>
      ${x.note?`<div class="meta" style="color:var(--ink);margin-top:2px">${esc(x.note.slice(0,110))}${x.note.length>110?"…":""}</div>`:""}
      ${(x.facts||[]).length?`<div class="meta" style="margin-top:2px">💡 ${x.facts.slice(0,2).map(f=>esc(f.fact)).join(" · ")}</div>`:""}</div>
      <div class="spacer"></div><span class="badge">+${Math.round(interactionPoints(x))} smiles</span><button class="xdel" data-x="${x.id}">✕</button></div>`;
  }).join(""):`<div class="demo"><div class="person" style="cursor:default"><div class="avatar" style="background:var(--accent-soft)">SO</div><div><div class="nm">Sam Ortiz</div><div class="meta">Quality time · In person · yesterday</div><div class="meta" style="color:var(--ink)">Long lunch, talked about his move to Bristol</div><div class="meta">💡 daughter Iris starting school</div></div><div class="spacer"></div><span class="badge">+50 smiles</span></div>
    <p class="hint" style="margin:8px 0 0">Your conversations will look like this. Log the first one from the Log tab — just say what happened.</p></div>`;
  rec.querySelectorAll("[data-edit]").forEach(row=>row.addEventListener("click",()=>editInteraction(row.dataset.edit)));
  rec.querySelectorAll("[data-x]").forEach(b=>b.addEventListener("click",ev=>{ ev.stopPropagation();
    if(confirm("Delete this interaction? Scores recalculate immediately.")){
      const x=DB.interactions.find(i=>i.id===b.dataset.x); removePhoto(x?.photo);
      DB.interactions=DB.interactions.filter(i=>i.id!==b.dataset.x); saveDB(); renderAll();
    }
  }));
}

// Reminders start in the LAST THIRD of the circle's rhythm (Close monthly → from day 20, Friendly quarterly → from day 60),
// except Inner, where they only start once two full weeks have passed. Never-contacted people are eligible straight away.
function reminderWindow(p){ const t=TIERS[p.tier]; return t&&t.cadence?(t.remind||t.cadence):0; }
function eligibleForReminder(p, now){
  const w=reminderWindow(p); if(!w) return null;
  if(p.snoozeUntil && p.snoozeUntil>now) return null;
  const last=lastContact(p,now);
  if(!last) return {last:null, days:p.added?(now-p.added)/DAY:0, frac:1, never:true};
  const days=(now-last)/DAY, frac=days/w;
  const startAt=p.tier==="inner"?1:2/3;
  return frac>=startAt ? {last, days, frac, never:false} : null;
}
function suggestions(){
  const now=Date.now(), out=[];
  for(const p of DB.people){
    const e=eligibleForReminder(p,now); if(!e) continue;
    const t=TIERS[p.tier];
    // overdue = past the window; "in the last third" people are listed too, ranked by how close they are
    out.push({p, last:e.last, days:Math.round(e.days), never:e.never, urgency:(e.never?0.9:e.frac)*t.weight});
  }
  return out.sort((a,b)=>b.urgency-a.urgency);
}
/* ---------- nudge engine: overdue + expansion nudges ---------- */
function dismissed(key){ const d=DB.settings.dismissed||{}; return !!d[key] && d[key]>Date.now(); }
function dismiss(key,days){ (DB.settings.dismissed=DB.settings.dismissed||{})[key]=Date.now()+days*DAY; saveDB(); }
function nudges(){
  const now=Date.now(), out=[];
  for(const u of suggestions()) out.push({kind:"overdue", key:"overdue:"+u.p.id, p:u.p, last:u.last, urgency:u.urgency});
  const core=DB.people.filter(p=>p.tier==="inner"||p.tier==="invest");
  const history=p=>DB.interactions.filter(x=>x.personIds.includes(p.id)).sort((a,b)=>b.ts-a.ts);
  const deepen=core.find(p=>{ const xs=history(p).slice(0,3); return xs.length===3 && xs.every(x=>x.depth<2); });
  if(deepen) out.push({kind:"deepen", key:"deepen:"+deepen.id, p:deepen, urgency:0.7,
    why:`Your last three chats with ${esc(capName(deepen))} were light. Make the next one count — ask about something that matters to them.`});
  for(const p of DB.people){
    const n=history(p).filter(x=>now-x.ts<=60*DAY).length;
    if(p.tier==="warm" && n>=3) out.push({kind:"promote", key:"promote:"+p.id, p, to:"invest", urgency:0.6,
      why:`You've seen ${esc(capName(p))} ${n} times in three months — more than a Friendly rhythm. Move to Close?`});
    else if(p.tier==="invest" && n>=6) out.push({kind:"promote", key:"promote:"+p.id, p, to:"inner", urgency:0.6,
      why:`${esc(capName(p))} is in your life almost weekly. Move to Inner?`});
  }
  const {pairs}=coData(), adj={};
  for(const k of pairs.keys()){ const [a,b]=k.split("|"); (adj[a]=adj[a]||new Set()).add(b); (adj[b]=adj[b]||new Set()).add(a); }
  outer: for(let i=0;i<core.length;i++) for(let j=i+1;j<core.length;j++){
    const a=core[i], b=core[j]; if(pairs.has(pairKey(a.id,b.id))) continue;
    const via=[...(adj[a.id]||[])].find(c=>adj[b.id]?.has(c)); if(!via) continue;
    const c=DB.people.find(x=>x.id===via); if(!c) continue;
    out.push({kind:"introduce", key:"intro:"+pairKey(a.id,b.id), p:a, q:b, urgency:0.5,
      why:`${esc(capName(a))} and ${esc(capName(b))} both know ${esc(capName(c))}, but you've never had them in the same room.`});
    break outer;
  }
  // follow-ups: "Iris started school this week — ask how it went"
  for(const p of DB.people){ if(p.tier==="notnow") continue;
    for(const f of (p.facts||[])){ if(!f.followUp) continue; const age=(now-f.followUp)/DAY;
      if(age>=0 && age<=10 && !DB.interactions.some(x=>x.personIds.includes(p.id)&&x.ts>=f.followUp))
        out.push({kind:"followup", key:"fu:"+p.id+":"+f.followUp, p, urgency:1.1, fact:f,
          why:`${esc(f.f)} — that was ${age<1?"today":age<2?"yesterday":Math.round(age)+" days ago"}. A good moment to ask how it went.`}); }
  }
  return out.filter(n=>!dismissed(n.key)).sort((a,b)=>b.urgency-a.urgency);
}
const KIND_LABEL={deepen:"Go deeper",promote:"Closer than you think",introduce:"Introduce",followup:"Ask how it went"};
// The one person most likely to slip past their circle's rhythm next: soonest to cross the threshold,
// or, if everyone is already past it, the most overdue. Ignores people snoozed or dismissed today.
function todaysPick(nudgeList){
  const now=Date.now(); let best=null;
  for(const p of DB.people){
    if(dismissed("pick:"+p.id)) continue;
    const e=eligibleForReminder(p,now); if(!e) continue;
    const t=TIERS[p.tier], w=reminderWindow(p), left=e.never?0:w-e.days;
    // Order: past the window first, then never-contacted, then closest to the window; Close/Friendly before Inner.
    const rank=(left<=0&&!e.never?0:e.never?1000:2000)+(p.tier==="inner"?500:0)+Math.max(0,left);
    if(!best||rank<best.rank) best={p,last:e.last,left,t,rank,never:e.never,overdue:left<=0&&!e.never};
  }
  return best?{kind:"pick",p:best.p,last:best.last,left:best.left,t:best.t,overdue:best.overdue,never:best.never}:null;
}
function pickBlock(n){
  const p=n.p, h=healthOfP(p,Date.now()), days=Math.max(1,Math.round(n.left));
  const why=n.never?`You haven't logged a conversation with them yet — a first message is the easiest one to send.`
    :n.overdue?`Already <b>${fmtAgo(n.last)}</b> since you spoke — past the ${n.t.rhythm} rhythm for your ${n.t.label} circle.`
    :`Last contact <b>${fmtAgo(n.last)}</b>. In about <b>${days} day${days===1?"":"s"}</b> they slip out of your ${n.t.rhythm} rhythm — a small message now keeps it easy.`;
  const facts=(p.facts||[]).length?`<div class="why">💡 ${p.facts.slice(-2).map(f=>esc(f.f)).join(" · ")}</div>`:"";
  return `<div class="sugg" data-pid="${p.id}" data-key="pick:${p.id}" data-kind="pick" style="margin-top:10px;padding-top:10px;border-top:1px solid rgba(0,0,0,.08)">
    <div style="display:flex;align-items:center;gap:10px">${av(p.name,p.photo)}
      <div><div class="nm" style="font-weight:700">${esc(p.name)}</div>
      <span class="status" style="color:${h.color}"><i style="background:${h.color}"></i>${h.label}</span></div>
      <div class="spacer"></div><span class="badge">${n.t.label}</span></div>
    <div class="why">${why}</div>${facts}
    <div class="btngrid">${contactBtns(p)}<button class="btn ${contactLinks(p).length?"ghost ":""}small" data-act="opener">✨ Opener</button>
      <button class="btn ghost small" data-act="log">✓ Log it</button><button class="btn ghost small" data-act="dismiss" data-days="1">Skip today</button></div>
  </div>`;
}
function nudgeCard(n){
  const p=n.p, t=TIERS[p.tier], h=healthOfP(p,Date.now());
  const col=n.kind==="overdue"?h.color:"var(--accent)", lab=n.kind==="overdue"?h.label:KIND_LABEL[n.kind];
  const head=n.kind==="introduce"
    ?`<div style="display:flex;align-items:center;gap:10px">${av(p.name)}${av(n.q.name)}
        <div><div class="nm" style="font-weight:700">${esc(capName(p))} &amp; ${esc(capName(n.q))}</div>
        <span class="status" style="color:${col}"><i style="background:${col}"></i>${lab}</span></div></div>`
    :`<div style="display:flex;align-items:center;gap:10px">${av(p.name)}
        <div><div class="nm" style="font-weight:700">${esc(p.name)}</div>
        <span class="status" style="color:${col}"><i style="background:${col}"></i>${lab}</span></div>
        <div class="spacer"></div><span class="badge">${t.label}</span></div>`;
  const why=n.kind==="overdue"
    ?`Last contact <b>${n.last?fmtAgo(n.last):"never logged"}</b> — your rhythm for this circle is every ${t.cadence} days.`
    :n.why;
  const facts=(["overdue","deepen"].includes(n.kind) && (p.facts||[]).length)
    ?`<div class="why">💡 ${p.facts.slice(-2).map(f=>esc(f.f)).join(" · ")}</div>`:"";
  let row;
  if(n.kind==="promote") row=`<button class="btn small" data-act="promote" data-to="${n.to}">Move to ${TIERS[n.to].label}</button>
      <button class="btn ghost small" data-act="dismiss" data-days="60">Keep as is</button>`;
  else if(n.kind==="introduce") row=`<button class="btn small" data-act="opener">✨ Suggest it to ${esc(capName(p))}</button>
      <button class="btn ghost small" data-act="dismiss" data-days="30">Not now</button>`;
  else row=`${contactBtns(p)}<button class="btn ${contactLinks(p).length?"ghost ":""}small" data-act="opener">✨ Opener</button>
      <button class="btn ghost small" data-act="log">✓ Log it</button>
      <button class="btn ghost small" data-act="${n.kind==="overdue"?"snooze":"dismiss"}" data-days="14">${n.kind==="overdue"?"Snooze":"Not now"}</button>`;
  return `<div class="sugg" data-pid="${p.id}" data-key="${n.key}" data-kind="${n.kind}"${n.q?` data-qid="${n.q.id}"`:""}${n.fact?` data-fu="${esc(n.fact.f)}"`:""}>
    ${head}<div class="why">${why}</div>${facts}<div class="btngrid">${row}</div></div>`;
}
function bindNudgeButtons(root){
  root.querySelectorAll(".sugg").forEach(card=>{
    const p=DB.people.find(x=>x.id===card.dataset.pid); if(!p) return;
    const q=card.dataset.qid?DB.people.find(x=>x.id===card.dataset.qid):null;
    card.querySelectorAll("button[data-act]").forEach(b=>b.addEventListener("click",()=>{
      const act=b.dataset.act;
      if(act==="log"){ switchPage("log");
        const ta=document.getElementById("logText"); ta.value=`With ${p.name} — `; ta.focus(); }
      if(act==="snooze"){ p.snoozeUntil=Date.now()+7*DAY; saveDB(); renderAll(); }
      if(act==="dismiss"){ dismiss(card.dataset.key,+b.dataset.days||14); renderAll(); }
      if(act==="promote"&&TIERS[b.dataset.to]){ p.tier=b.dataset.to; saveDB(); renderAll(); }
      if(act==="opener"){ if(!entitled()){ paywallSheet("Openers are part of Samvar — start your free trial."); return; } openerSheet(p,{q, deepen:card.dataset.kind==="deepen", followUp:card.dataset.fu||""}); }
    }));
  });
}

/* ---------- drafted openers ---------- */
const OPENER_SYSTEM=`You write short, warm, natural opening messages someone can send to a friend they want to stay close to.
Return ONLY a JSON array of 3 strings. Each is at most 25 words, British English, casual, and sounds like a real text from a friend — no "hope this finds you well", no sign-offs, no hashtags, emojis only if natural.
Use the supplied facts to be specific and caring; never invent facts. Vary the three: one picks up on a fact, one proposes a concrete plan, one is light and easy to reply to.
If "Where they are" context is supplied (weather, a local event, a headline about their town), you may weave ONE of those details into ONE of the messages when it feels natural and friendly; never grim news, politics or crime.`;
async function aiOpeners(p,opts){
  const xs=DB.interactions.filter(x=>x.personIds.includes(p.id)).sort((a,b)=>b.ts-a.ts).slice(0,3);
  const intent=opts.q?`Intent: suggest that the three of us (me, ${p.name} and ${opts.q.name}) get together soon.`
    :opts.deepen?"Intent: go beyond logistics — ask about something that genuinely matters to them."
    :opts.followUp?`Intent: ask how this went — "${opts.followUp}".`:"";
  const brief={name:p.name, tier:TIERS[p.tier].label,
    last:xs[0]?fmtAgo(xs[0].ts)+" — "+(xs[0].note||DEPTHS[xs[0].depth-1].label):"never logged",
    recent:xs.slice(1).map(x=>`${fmtAgo(x.ts)}: ${x.note||DEPTHS[x.depth-1].label}`).join("; ")||"none",
    facts:(p.facts||[]).map(f=>f.f).join("; ")||"nothing specific", intent, town:townFromAddr(p.addr)||undefined,
    work:[p.role,p.company].filter(Boolean).join(" at ")||undefined};
  let arr;
  if(getApiKey()){
    const out=await claudeCall(OPENER_SYSTEM,
      `Friend: ${brief.name} (${brief.tier}).${brief.work?` Work: ${brief.work}.`:""}\nLast contact: ${brief.last}.\nRecent: ${brief.recent}.\nThings I know about them: ${brief.facts}.\n${brief.intent}`, 600);
    const m=out.match(/\[[\s\S]*\]/); if(!m) throw new Error("Unexpected reply");
    arr=JSON.parse(m[0]);
  } else arr=await samvarAI("/v1/openers",brief);
  if(!Array.isArray(arr)) throw new Error("Unexpected reply");
  return arr.map(s=>String(s).trim()).filter(Boolean).slice(0,3);
}
function ruleOpeners(p,opts){
  const n=capName(p), out=[];
  if(opts.q) out.push(`Hey ${n}, I've been meaning to get you and ${capName(opts.q)} in the same room — fancy a drink one evening soon?`);
  const f=[...(p.facts||[])].reverse().find(x=>x.kind!=="date");
  if(f){ const t=f.f.replace(/^(his|her|their)\s+/i,"").replace(/\.$/,"");
    out.push(f.kind==="plans"?`Hey ${n} — how's the ${t} going?`
      :f.kind==="work"?`Hey ${n}, how's work? Last I heard: ${t}.`
      :`Hey ${n}, was thinking about you — ${t}. How's that going?`); }
  out.push(`Hey ${n}, been too long! How are things? Free for a coffee or a call next week?`);
  out.push(`Hey ${n} — random one, but you popped into my head today. How's life?`);
  return out.slice(0,3);
}
function sendMessage(p,text){
  const t=telDigits(p.tel);
  if(t){ const sep=/iPhone|iPad|Macintosh/.test(navigator.userAgent)?"&":"?"; location.href=`sms:${t}${sep}body=${encodeURIComponent(text)}`; return; }
  if(navigator.share){ navigator.share({text}).catch(()=>{}); return; }
  navigator.clipboard?.writeText(text);
  alert(`Copied — no phone number saved for ${capName(p)}, so paste it wherever you two chat.`);
}
function logMessageSent(p,text){
  DB.interactions.push({id:uid(),ts:Date.now(),personIds:[p.id],depth:1,channel:"message",note:text.slice(0,120),place:""});
  delete p.snoozeUntil; saveDB(); renderAll();
}
async function openerSheet(p,opts={}){
  const dlg=document.createElement("dialog");
  let sent=0;
  const render=(lines,src)=>{
    const t=telDigits(p.tel);
    dlg.innerHTML=`<h2 style="font-size:17px;margin-bottom:4px">Message ${esc(capName(p))}</h2>
      <p class="hint" style="margin:0 0 10px">${src==="ai"?`<span class="badge">Claude</span> drafted from what you know about ${esc(capName(p))} — edit freely.`
        :`Simple starters. Add an API key under You for ones that use what you know about ${esc(capName(p))}.`}</p>
      ${lines.map((l,i)=>`<div class="card" style="padding:12px;margin-bottom:8px">
        <textarea data-op="${i}" style="min-height:88px;resize:none">${esc(l)}</textarea>
        <div style="display:flex;gap:6px;margin-top:8px;flex-wrap:wrap">
          <button class="btn small" data-send="${i}">${t?"Send":"Share"}</button>
          ${t&&t.startsWith("+")?`<button class="btn ghost small" data-wa="${i}">WhatsApp</button>`:""}
          <button class="btn ghost small" data-copy="${i}">Copy</button></div></div>`).join("")}
      <div style="display:flex;gap:8px;margin-top:4px;flex-wrap:wrap">
        <button class="btn ghost small" id="opLogged">✓ I sent it — log it</button>
        <button class="btn ghost small" id="opClose">Close</button></div>`;
    const txt=i=>dlg.querySelector(`[data-op="${i}"]`).value.trim();
    dlg.querySelectorAll("[data-send]").forEach(b=>b.addEventListener("click",()=>{ sent=+b.dataset.send; sendMessage(p,txt(sent)); }));
    dlg.querySelectorAll("[data-wa]").forEach(b=>b.addEventListener("click",()=>{ sent=+b.dataset.wa;
      window.open(`https://wa.me/${t.slice(1)}?text=${encodeURIComponent(txt(sent))}`,"_blank","noopener"); }));
    dlg.querySelectorAll("[data-copy]").forEach(b=>b.addEventListener("click",async()=>{ sent=+b.dataset.copy;
      try{ await navigator.clipboard.writeText(txt(sent)); b.textContent="Copied ✓"; }catch(e){ b.textContent="Select & copy"; } }));
    dlg.querySelector("#opLogged").addEventListener("click",()=>{ logMessageSent(p,txt(sent)); dlg.close(); dlg.remove(); });
    dlg.querySelector("#opClose").addEventListener("click",()=>{ dlg.close(); dlg.remove(); });
  };
  dlg.innerHTML=`<h2 style="font-size:17px">Message ${esc(capName(p))}</h2><p class="hint">Thinking about what to say…</p>`;
  document.body.appendChild(dlg); dlg.showModal();
  try{ render(await aiOpeners(p,opts),"ai"); return; }
  catch(e){ if(e instanceof QuotaError){ dlg.close(); dlg.remove(); if(!isPro()) paywallSheet("Your trial or subscription has ended — renew to keep the openers."); else alert("Samvar AI couldn’t verify your subscription just now. Try again in a few minutes."); return; } }
  render(ruleOpeners(p,opts),"rule");
}

/* ---------- weekly reflection (shown Sunday & Monday) ---------- */
function renderReflection(){
  const el=document.getElementById("reflect");
  const ws=weekStart(Date.now());
  const xs=DB.interactions.filter(x=>x.ts>=ws && x.ts<ws+7*DAY);
  const quality=xs.filter(x=>x.depth>=2);
  const named=ids=>[...new Set(ids)].map(id=>DB.people.find(p=>p.id===id)).filter(Boolean);
  const qNames=named(quality.flatMap(x=>x.personIds)).slice(0,2).map(p=>capName(p));
  const dow=new Date().getDay(), early=dow>=1&&dow<=3;
  let line;
  if(!DB.people.length) line="Add a few people and Samvar will start noticing who you'd love to hear from.";
  else if(!xs.length) line=early?"Fresh week. One message today is all it takes to get it moving.":"A quiet week so far — that's fine. One small message changes it.";
  const pick=todaysPick(nudges());
  if(line){} else if(quality.length) line=`Quality time with ${qNames.join(" and ")} this week 💛 Lovely.${pick?" Keep it rolling:":""}`;
  else line=`${xs.length} catch-up${xs.length===1?"":"s"} so far this week — nice work.${pick?" Next up:":""}`;
  el.innerHTML=`<div class="card t-mint" style="padding-bottom:12px">
    <div class="lbl" style="font-size:12px;color:var(--ink-2);font-weight:600;text-transform:uppercase;letter-spacing:.05em">This week</div>
    <div style="font-size:15px;margin-top:6px;line-height:1.5">${line}</div>
    ${pick?pickBlock(pick):(DB.people.length?`<div class="why" style="margin-top:8px">Everyone's in rhythm right now — enjoy it. Samvar will nudge you when someone drifts.</div>`:"")}
  </div>`;
  bindNudgeButtons(el);
}

/* ---------- Contacts sync: people linked to a card refresh from it on every foreground ---------- */
let syncingContacts=false;
async function syncContacts(){
  const n=window.SamvarNative; if(!n||!n.allContacts||syncingContacts) return;
  const linked=DB.people.filter(p=>p.contactId); if(!linked.length) return;
  syncingContacts=true;
  try{
    const list=await n.allContacts(); if(!list) return;
    const byId=Object.fromEntries(list.map(c=>[c.contactId,c]));
    let changed=false; const gone=[];
    for(const p of linked){
      const c=byId[p.contactId];
      if(!c){ gone.push(p); continue; }
      const upd={};
      if(c.name && c.name!==p.name) upd.name=c.name;
      if(c.tel!==p.tel){ upd.tel=c.tel; upd.telIsMobile=c.telIsMobile; }
      if(JSON.stringify(c.tels||null)!==JSON.stringify(p.tels||null)) upd.tels=c.tels;
      if(c.email!==p.email) upd.email=c.email;
      if(c.company!==p.company) upd.company=c.company;
      if(c.role!==p.role) upd.role=c.role;
      if(JSON.stringify(c.urls||null)!==JSON.stringify(p.urls||null)) upd.urls=c.urls;
      if(c.addr!==p.addr){ upd.addr=c.addr; upd.loc=undefined; }
      if(Object.keys(upd).length){ Object.assign(p,upd); changed=true; }
      if(c.birthday && !birthdayOf(p)){ p.facts=p.facts||[]; p.facts.push({f:"birthday "+c.birthday,kind:"date",ts:Date.now()}); changed=true; }
      if(!p.photo){ try{ const b64=await n.contactPhoto(c.contactId); if(b64){ p.photo=await storePhoto(b64); changed=true; } }catch(e){} }
    }
    if(changed){ saveDB(); renderAll(); }
    for(const p of gone){ if(!dismissed("gone:"+p.id)) await askAboutDeletedContact(p); }
  }catch(e){ console.warn("syncContacts",e); }
  finally{ syncingContacts=false; }
}
// Their card vanished from Contacts. Keep = move to Not now (out of rings, score and nudges; history stays). Delete = remove everything.
function askAboutDeletedContact(p){
  return new Promise(res=>{
    const dlg=document.createElement("dialog");
    dlg.innerHTML=`<h2 style="font-size:17px;margin-bottom:6px">${esc(p.name)} was deleted from Contacts</h2>
      <p class="hint" style="margin:0 0 12px">Delete their history in Samvar too? Keeping it moves them to “Not now”, so they no longer count in your circles, but their conversations and notes stay on their profile.</p>
      <div style="display:flex;gap:8px"><button class="btn small" id="gKeep">Keep history</button><button class="btn danger small" id="gDel">Delete everything</button></div>`;
    document.body.appendChild(dlg); dlg.showModal();
    const done=()=>{ dlg.close(); dlg.remove(); saveDB(); renderAll(); res(); };
    dlg.querySelector("#gKeep").addEventListener("click",()=>{ p.tier="notnow"; p.contactId=undefined; dismiss("gone:"+p.id,3650); done(); });
    dlg.querySelector("#gDel").addEventListener("click",()=>{
      removePhoto(p.photo); DB.interactions.forEach(x=>{ if(x.personIds.includes(p.id)) removePhoto(x.photo); });
      DB.interactions=DB.interactions.filter(x=>!x.personIds.includes(p.id)); DB.people=DB.people.filter(x=>x.id!==p.id); done(); });
  });
}

/* ---------- calendar: "you had lunch with Kate — log it?" ---------- */
let calEvents=null; // fetched once per foreground
async function refreshCalendar(){
  const n=window.SamvarNative; if(!n||!n.calendarEvents||!DB.people.length){ calEvents=[]; return; }
  try{ calEvents=await n.calendarEvents(Date.now()-4*DAY, Date.now()); }catch(e){ calEvents=[]; }
  renderCalendarSuggestions();
}
function calendarMatches(){
  if(!calEvents) return [];
  const out=[];
  for(const ev of calEvents){
    if(ev.isAllDay || dismissed("cal:"+ev.id)) continue;
    const hay=(ev.title+" "+(ev.attendees||[]).join(" ")).toLowerCase();
    const people=DB.people.filter(p=>p.tier!=="notnow" && nameTokens(p.name).some(tok=>tok.length>=3 && new RegExp("\\b"+tok.replace(/[.*+?^${}()|[\]\\]/g,"\\$&")+"\\b").test(hay)));
    if(!people.length) continue;
    const day=new Date(ev.start).toDateString();
    const logged=people.every(p=>DB.interactions.some(x=>x.personIds.includes(p.id)&&new Date(x.ts).toDateString()===day));
    if(logged) continue;
    out.push({ev, people});
  }
  return out.slice(0,3);
}
function renderCalendarSuggestions(){
  const el=document.getElementById("calSugg"); if(!el) return;
  const ms=calendarMatches();
  el.innerHTML=ms.length?`<div class="sect">From your calendar</div>`+ms.map(({ev,people},i)=>{
    const when=new Date(ev.start).toLocaleDateString("en-GB",{weekday:"short",day:"numeric",month:"short"});
    const mins=Math.round((ev.end-ev.start)/60000);
    return `<div class="card" data-cal="${i}"><div class="nm" style="font-weight:700">${esc(ev.title)}</div>
      <div class="meta">${when}${mins>0?` · ${mins>=60?Math.round(mins/60)+" h":mins+" min"}`:""} · with ${people.map(p=>esc(capName(p))).join(", ")}</div>
      <div class="row" style="margin-top:8px"><button class="btn small" data-callog="${i}">✓ Log it</button><button class="btn ghost small" data-calskip="${i}">Skip</button></div></div>`;
  }).join(""):"";
  el.querySelectorAll("[data-callog]").forEach(b=>b.addEventListener("click",()=>{
    const {ev,people}=ms[+b.dataset.callog]; const mins=(ev.end-ev.start)/60000;
    drafts.push({id:uid(), note:ev.title, personIds:people.map(p=>p.id), pendingNames:[], place:ev.location||"", depth:mins>=60?2:1, channel:"inperson", ts:ev.start, cal:ev.id});
    dismiss("cal:"+ev.id, 30); switchPage("log"); renderDrafts(); renderCalendarSuggestions();
    document.getElementById("drafts").scrollIntoView({behavior:"smooth"});
  }));
  el.querySelectorAll("[data-calskip]").forEach(b=>b.addEventListener("click",()=>{ dismiss("cal:"+ms[+b.dataset.calskip].ev.id, 30); renderCalendarSuggestions(); }));
}

/* ---------- nudge notification text & schedule (used by the native shell) ---------- */
const NUDGE_DAYS={daily:[0,1,2,3,4,5,6],weekdays:[1,2,3,4,5],"3x":[1,3,5],weekly:[1],off:[]};
function nudgeText(){
  // Morning: one person, by name, and why. Falls back to birthdays / a warm line.
  const pick=todaysPick(nudges());
  for(const b of upcomingBirthdays(1)) if(b.days===0) return {title:`🎂 ${capName(b.p)}'s birthday today`, body:"A message now will make their day.", pid:b.p.id};
  const fu=nudges().find(n=>n.kind==="followup"); if(fu) return {title:`Ask ${capName(fu.p)} how it went`, body:fu.fact.f, pid:fu.p.id};
  if(pick){ const p=pick.p, t=pick.t;
    const body=pick.never?`You haven't logged a conversation with ${capName(p)} yet. A first hello is the easiest message to send.`:pick.overdue?`It's been ${fmtAgo(pick.last)} — past your ${t.rhythm} rhythm. One message today keeps it easy.`
      :`${Math.max(1,Math.round(pick.left))} day${Math.round(pick.left)===1?"":"s"} before they slip out of your ${t.rhythm} rhythm. A small message now keeps it easy.`;
    return {title:`${capName(p)} is next`, body, pid:p.id}; }
  const b=upcomingBirthdays(3)[0]; if(b) return {title:`🎂 ${capName(b.p)}'s birthday ${b.days===1?"tomorrow":"in "+b.days+" days"}`, body:"Get in first.", pid:b.p.id};
  return {title:"Samvar", body:"Everyone's in rhythm — a good day to surprise someone with a message."};
}
function checkinText(){
  const st=dailyStreak();
  return {title:"Who did you talk to today?", body:st.streak?`Your streak is ${st.streak} day${st.streak===1?"":"s"}. Tap a face to keep it alive.`:"Tap a face and Samvar logs it — takes two seconds."};
}
function digestText(){
  const now=Date.now(), ws=weekStart(now);
  const xs=DB.interactions.filter(x=>x.ts>=ws && x.ts<now), people=new Set(xs.flatMap(x=>x.personIds)).size;
  const score=connectionScore(now), prev=connectionScore(now-7*DAY), diff=score-prev;
  const next=todaysPick(nudges());
  const body=`${xs.length} conversation${xs.length===1?"":"s"} with ${people} ${people===1?"person":"people"} · score ${score} (${diff>=0?"▲":"▼"}${Math.abs(diff)})${next?` · next week: ${capName(next.p)} is drifting`:""}.`;
  return {title:"Your week in friendships", body};
}
function nextTimesAt(hhmm, days, count){
  const [hh,mm]=String(hhmm||"09:00").split(":").map(Number);
  const out=[], d=new Date(); d.setHours(hh,mm,0,0);
  if(d.getTime()<=Date.now()) d.setDate(d.getDate()+1);
  while(out.length<count && out.length<60){ if(days.includes(d.getDay())) out.push(d.getTime()); d.setDate(d.getDate()+1); }
  return out;
}
function nextNudgeTimes(count){
  const days=NUDGE_DAYS[DB.settings.nudgeFreq||"daily"]||[]; if(!days.length) return [];
  return nextTimesAt(DB.settings.nudgeTime||"09:00", days, count);
}
// Everything the native shell should schedule for the next fortnight.
function plannedNotifications(){
  const out=[]; const m=nudgeText();
  nextNudgeTimes(14).forEach((at,i)=>out.push({id:1000+i, title:m.title, body:m.body, at, extra:{kind:"morning", pid:m.pid||""}}));
  if(DB.settings.checkin!==false){ const c=checkinText();
    nextTimesAt(DB.settings.checkinTime||"20:00",[0,1,2,3,4,5,6],14).forEach((at,i)=>out.push({id:2000+i, title:c.title, body:c.body, at, extra:{kind:"checkin"}})); }
  if(DB.settings.digest!==false){ const g=digestText();
    nextTimesAt("18:00",[0],2).forEach((at,i)=>out.push({id:3000+i, title:g.title, body:g.body, at, extra:{kind:"digest"}})); }
  return out;
}
// Tap on a notification: morning → Today (the pick is at the top); check-in → the tap-a-face sheet; digest → Today.
function handleNotificationTap(extra){
  switchPage("home");
  if(extra && extra.kind==="checkin") setTimeout(checkinSheet,300);
}
// Evening check-in: tap the faces you spoke to today; each becomes a quick catch-up.
function checkinSheet(){
  const ppl=DB.people.filter(p=>p.tier!=="notnow"); if(!ppl.length){ switchPage("people"); return; }
  const today=dayKeyOf(Date.now());
  const done=new Set(DB.interactions.filter(x=>dayKeyOf(x.ts)===today).flatMap(x=>x.personIds));
  const pick=new Set();
  const dlg=document.createElement("dialog");
  dlg.innerHTML=`<h2 style="font-size:17px;margin-bottom:4px">Who did you talk to today?</h2>
    <p class="hint" style="margin:0 0 10px">Tap the faces. Each one is logged as a quick catch-up — you can add detail later.</p>
    <div class="facegrid">${ppl.sort((a,b)=>(done.has(b.id)?1:0)-(done.has(a.id)?1:0)||a.name.localeCompare(b.name)).map(p=>`<button class="face${done.has(p.id)?" done":""}" data-pid="${p.id}" ${done.has(p.id)?"disabled":""}>${av(p.name,p.photo)}<span>${esc(capName(p))}</span></button>`).join("")}</div>
    <div class="seg" id="ciChan" style="margin-top:10px"><button data-v="message" class="on">Message</button><button data-v="call">Call</button><button data-v="inperson">In person</button></div>
    <div style="display:flex;gap:8px;margin-top:12px"><button class="btn" id="ciSave" disabled style="flex:1">Log 0</button><button class="btn ghost small" id="ciClose">Nobody today</button></div>`;
  document.body.appendChild(dlg); dlg.showModal(); hydratePhotos(dlg);
  let chan="message";
  dlg.querySelectorAll("#ciChan button").forEach(b=>b.addEventListener("click",()=>{ chan=b.dataset.v; dlg.querySelectorAll("#ciChan button").forEach(x=>x.classList.toggle("on",x===b)); }));
  dlg.querySelectorAll(".face:not(.done)").forEach(b=>b.addEventListener("click",ev=>{ ev.stopPropagation(); const id=b.dataset.pid; if(pick.has(id)) pick.delete(id); else pick.add(id); b.classList.toggle("on",pick.has(id));
    const sv=dlg.querySelector("#ciSave"); sv.disabled=!pick.size; sv.textContent=`Log ${pick.size}`; }));
  dlg.querySelector("#ciSave").addEventListener("click",()=>{
    for(const id of pick){ DB.interactions.push({id:uid(),ts:Date.now(),personIds:[id],depth:1,channel:chan,note:"",place:""}); const p=DB.people.find(x=>x.id===id); if(p) delete p.snoozeUntil; }
    saveDB(); dlg.close(); dlg.remove(); renderAll(); window.SamvarNative?.haptic("success"); window.SamvarNative?.scheduleNudges();
  });
  dlg.querySelector("#ciClose").addEventListener("click",()=>{ dlg.close(); dlg.remove(); });
}
function renderInsights(){
  const s=windowStats(Date.now(),30);
  document.getElementById("depthVal").textContent=s.n?Math.round(100*s.deepShare)+"%":"–";
  depthMixBar(document.getElementById("depthBar"), document.getElementById("depthLegend"));
}
function renderSettingsUI(){
  const p=DB.settings.pro||{}, pro=isPro();
  const until=p.expires?new Date(p.expires).toLocaleDateString("en-GB",{day:"numeric",month:"short"}):"";
  document.getElementById("proCard").innerHTML=pro
    ?`<h2 style="font-size:17px">Samvar Pro ✓</h2><p class="hint">${p.trial?`Free trial${until?` — renews on ${until}`:""}.`:`Subscribed${until?` — renews ${until}`:""}.`} Manage or cancel in Settings → Subscriptions.</p>`
    :devMode()?`<h2 style="font-size:17px">Samvar Pro</h2><p class="hint">Developer mode — everything unlocked on this device.</p>`
    :`<h2 style="font-size:17px">Samvar Pro</h2><p class="hint">Everything in Samvar, free for 7 days, then a monthly or yearly subscription at your local App Store price. Cancel any time.</p>
      <button class="btn small" id="proBtn" style="margin-top:10px">Start free trial</button>`;
  document.getElementById("proBtn")?.addEventListener("click",()=>paywallSheet(""));
  const ai=DB.settings.aiPlan, aiEl=document.getElementById("aiStatus");
  if(aiEl){ aiEl.textContent=!ai?"Samvar AI: not contacted yet.":ai.plan==="pro"?`Samvar AI: connected as Pro (checked ${fmtAgo(ai.checked)}).`:ai.plan==="free"?`Samvar AI: connected — free allowance (checked ${fmtAgo(ai.checked)}).`:`Samvar AI: server could not verify your subscription (checked ${fmtAgo(ai.checked)}). Tap to re-check.`;
    aiEl.onclick=async ()=>{ aiEl.textContent="Samvar AI: checking…"; try{ const r=await fetch(API_BASE+"/v1/me",{headers:{"authorization":"Bearer "+deviceId()}}); const j=await r.json(); DB.settings.aiPlan={plan:j.plan,checked:Date.now()}; saveDB(); }catch(e){ DB.settings.aiPlan={plan:"unreachable",checked:Date.now()}; saveDB(); } renderSettingsUI(); }; }
  document.getElementById("devCard").style.display=devMode()?"block":"none";
  document.querySelectorAll("#nudgeSeg button").forEach(b=>b.classList.toggle("on",b.dataset.nf===(DB.settings.nudgeFreq||"daily")));
  document.getElementById("nudgeTime").value=DB.settings.nudgeTime||"09:00";
  const ci=document.getElementById("checkinOn"); if(ci){ ci.checked=DB.settings.checkin!==false; document.getElementById("checkinTime").value=DB.settings.checkinTime||"20:00"; document.getElementById("digestOn").checked=DB.settings.digest!==false; }
  const st=dailyStreak(), pr=document.getElementById("progressStreak"); if(pr) pr.innerHTML=st.streak?`🔥 ${st.streak}-day streak${st.freezes?` · ${st.freezes} rest day${st.freezes===1?"":"s"} banked`:""}`:"No streak yet — log a conversation today to start one.";
  const mr=document.getElementById("monthReview"); if(mr){ const now=Date.now(), from=now-30*DAY, xs=DB.interactions.filter(x=>x.ts>from), ppl=new Set(xs.flatMap(x=>x.personIds)).size, q=xs.filter(x=>x.depth>=2).length;
    const quiet=DB.people.filter(p=>p.tier!=="notnow"&&TIERS[p.tier]?.cadence).map(p=>({p,l:lastContact(p,now)})).filter(x=>!x.l||now-x.l>45*DAY).sort((a,b)=>(a.l||0)-(b.l||0))[0];
    mr.innerHTML=xs.length?`<b>${xs.length}</b> conversation${xs.length===1?"":"s"} with <b>${ppl}</b> ${ppl===1?"person":"people"} · <b>${q}</b> quality time${quiet?` · you haven't spoken to <b>${esc(capName(quiet.p))}</b> in ${quiet.l?fmtAgo(quiet.l):"a while"}`:""}.`:"Your first month's review appears once you've logged a few conversations."; }
}
function renderTriage(){}
// Small ring: how much of this person's rhythm is left before they slip (full = just spoke, empty = overdue).
function rhythmRing(p, size=28){
  const t=TIERS[p.tier]; if(!t||!t.cadence) return "";
  const last=lastContact(p,Date.now()); const h=healthOfP(p,Date.now());
  const frac=last?Math.max(0,Math.min(1,1-((Date.now()-last)/DAY)/t.cadence)):0;
  const r=(size-4)/2, c=2*Math.PI*r;
  return `<svg class="rring" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" aria-hidden="true"><circle cx="${size/2}" cy="${size/2}" r="${r}" fill="none" stroke="var(--grid)" stroke-width="3.5"/>
    <circle cx="${size/2}" cy="${size/2}" r="${r}" fill="none" stroke="${h.color}" stroke-width="3.5" stroke-linecap="round" stroke-dasharray="${(frac*c).toFixed(1)} ${c.toFixed(1)}" transform="rotate(-90 ${size/2} ${size/2})"/></svg>`;
}
function renderPeople(){
  const el=document.getElementById("peopleList");
  let html="";
  const row=(p,k)=>{ const h=healthOfP(p,Date.now()), last=lastContact(p,Date.now());
    return `<div class="person" data-pid="${p.id}">
        ${av(p.name,p.photo)}
        <div><div class="nm">${esc(p.name)}</div><div class="meta">last: ${fmtAgo(last)}</div></div>
        <div class="spacer"></div>
        ${k!=="notnow"?`<span class="status" style="color:${h.color};display:inline-flex;align-items:center;gap:8px">${rhythmRing(p)}${h.label}</span>`:""}
      </div>`; };
  for(const k of ["inner","invest","warm"]){
    const ppl=DB.people.filter(p=>p.tier===k).sort((a,b)=>a.name.localeCompare(b.name));
    if(!ppl.length) continue;
    html+=`<div class="sect">${TIERS[k].label} · ${ppl.length}</div><div class="card">${ppl.map(p=>row(p,k)).join("")}</div>`;
  }
  const arch=DB.people.filter(p=>p.tier==="notnow").sort((a,b)=>a.name.localeCompare(b.name));
  if(arch.length) html+=`<details style="margin-top:14px"><summary class="sect" style="cursor:pointer;margin:0 0 8px">Archived · ${arch.length}</summary><div class="card">${arch.map(p=>row(p,"notnow")).join("")}</div></details>`;
  el.innerHTML=html||`<div class="card demo">
      <div class="lbl" style="font-size:12px;color:var(--ink-2);font-weight:600;text-transform:uppercase;letter-spacing:.05em;margin-bottom:8px">Your people will look like this</div>
      ${[["Sam Ortiz","Inner","excellent","var(--good)"],["Priya Nair","Close","slipping","var(--warn)"],["Tom Walsh","Friendly","reconnect now","var(--critical)"]].map(([n,c,st,col])=>`<div class="person" style="cursor:default"><div class="avatar" style="background:var(--accent-soft)">${n.split(" ").map(w=>w[0]).join("")}</div><div><div class="nm">${n}</div><div class="meta">${c} · last: 2 weeks ago</div></div><div class="spacer"></div><span class="status" style="color:${col}"><i style="background:${col}"></i>${st}</span></div>`).join("")}
      <p class="hint" style="margin-top:10px">Add ${FREE_PEOPLE} people, from besties to the resties. Add from Contacts brings their photo, number and birthday.</p>
      <button class="btn" id="emptyAddContacts" style="margin-top:8px">📇 Add from Contacts</button></div>`;
  el.querySelector("#emptyAddContacts")?.addEventListener("click",()=>{ const b=document.getElementById("pickContacts"); if(b&&b.style.display!=="none") b.click(); else document.getElementById("newPersonName").focus(); });
  el.querySelectorAll(".person[data-pid]").forEach(row=>row.addEventListener("click",()=>personSheet(row.dataset.pid)));
}
function personSheet(pid){
  const p=DB.people.find(x=>x.id===pid); if(!p) return;
  const xs=DB.interactions.filter(x=>x.personIds.includes(pid)).sort((a,b)=>b.ts-a.ts);
  const dlg=document.createElement("dialog");
  const sec=(title,body)=>`<div class="psec"><div class="sect" style="margin:0 0 8px">${title}</div>${body}</div>`;
  dlg.innerHTML=`<div style="display:flex;align-items:center;gap:12px;margin-bottom:4px">
      <div class="avwrap"><div style="transform:scale(1.5);transform-origin:left center">${av(p.name,p.photo)}</div>
        <button class="avedit" id="pphoto" title="${p.photo?"Change photo":"Add photo"}" aria-label="Edit photo">✎</button></div>
      <div style="min-width:0;flex:1"><h2 style="font-size:18px;margin:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(p.name)}</h2>
        <div class="meta" style="display:flex;align-items:center;gap:6px">${rhythmRing(p,22)}${TIERS[p.tier]?.label||""}${p.contactId?" · from Contacts":""}</div>
        ${(p.company||p.role)?`<div class="meta">💼 ${esc([p.role,p.company].filter(Boolean).join(" at "))}</div>`:""}
        ${(p.urls||[]).length?`<div class="meta">${p.urls.slice(0,3).map(u=>`<a href="${esc(u)}" target="_blank" rel="noopener" style="color:var(--accent)">${esc(u.replace(/^https?:\/\/(www\.)?/,"").split("/")[0])}</a>`).join(" · ")}</div>`:""}</div>
      <button class="btn small" id="dlgCloseTop" style="flex:none;background:var(--good)">Done</button></div>
    ${sec("Circle",`<div class="seg" style="margin:0">${Object.entries(TIERS).map(([k,t])=>`<button data-tier="${k}" class="${p.tier===k?"on":""}">${t.label}</button>`).join("")}</div>`)}
    ${sec("Reach them",`<button class="btn" id="pOpener" style="margin-bottom:10px">✨ Suggest a message</button>
      ${contactBtns(p)?`<div class="btngrid reachrow">${contactBtns(p)}</div>`:`<div class="hint" style="margin:0">No number yet — add ${esc(capName(p))} from Contacts to get one-tap Call, Text and WhatsApp buttons.</div>`}
      ${p.contactId?`<div class="hint" style="margin-top:8px">Linked to Contacts — numbers, email, address, photo and birthday refresh automatically.</div>`:""}`)}
    ${sec("Address / area",`<div style="display:flex;gap:8px;align-items:flex-start">
      <textarea id="paddr" rows="${Math.min(5,Math.max(2,String(p.addr||"").split("\n").length))}" placeholder="Street\nTown\nPostcode" style="min-height:0;resize:none;line-height:1.4">${esc(p.addr||"")}</textarea>
      <button class="btn small" id="paddrSave">Save</button></div>
      <div class="hint" id="paddrStatus">${p.loc?"📍 on the map":(p.addr?"not mapped yet — run “Put contacts on the map” in the You tab":"powers place search and “near me”")}</div>`)}
    ${sec("Worth remembering",`<div id="factList">${(p.facts&&p.facts.length)?[...p.facts].reverse().map((f,i)=>
      `<div class="factline"><span class="fk">${KIND_EMOJI[f.kind]||"📝"}</span><span>${esc(f.f)}</span><button data-fdel="${p.facts.length-1-i}">✕</button></div>`).join("")
      :`<div class="empty" style="padding:8px">Nothing yet — mention things in your notes (family, birthdays, big events) and Claude files them here.</div>`}</div>
    <div style="display:flex;gap:8px;margin-top:8px">
      <input type="text" id="factAdd" placeholder="Add something to remember…">
      <button class="btn small" id="factAddBtn">Add</button></div>`)}
    ${sec("History",xs.length?xs.slice(0,20).map(x=>`<div class="person" data-xedit="${x.id}" style="cursor:pointer">${x.photo?`<div class="avatar" data-photo="${esc(x.photo)}" style="border-radius:10px"></div>`:""}<div><div class="nm" style="font-size:14px">${x.ai?`<span class="badge" style="font-size:10px;padding:1px 6px;margin-right:4px">✨ Claude</span>`:""}${DEPTHS[x.depth-1].label} · ${CHANNELS[x.channel].label} · ${fmtAgo(x.ts)}${x.place?` · 📍 ${esc(x.place)}`:""}</div>
      ${x.note?`<div class="meta" style="color:var(--ink)">${esc(x.note.slice(0,110))}${x.note.length>110?"…":""}</div>`:""}
      ${(x.facts||[]).length?`<div class="meta">💡 ${x.facts.slice(0,2).map(f=>esc(f.fact)).join(" · ")}</div>`:""}</div>
      <div class="spacer"></div><button class="xdel" data-xdel="${x.id}">✕</button></div>`).join("")
      :`<div class="empty">No interactions logged yet.</div>`)}
    <button class="btn" id="dlgClose" style="width:100%;margin-top:14px;padding:14px;font-size:17px;background:var(--good)">Done</button>
    <div style="text-align:center;margin-top:10px"><button class="btn ghost small" id="dlgDel" style="color:var(--critical);font-size:12px;padding:4px 8px">Remove person</button></div>`;
  document.body.appendChild(dlg); dlg.showModal(); hydratePhotos(dlg);
  dlg.querySelector("#pphoto").addEventListener("click",async ev=>{ ev.stopPropagation();
    const ref=await choosePhoto({allowRemove:!!p.photo}); if(ref===null) return;
    await removePhoto(p.photo); p.photo=ref||undefined; saveDB(); dlg.close(); dlg.remove(); renderAll(); personSheet(pid); });
  dlg.querySelectorAll("[data-tier]").forEach(b=>b.addEventListener("click",()=>{ p.tier=b.dataset.tier; saveDB(); dlg.close(); dlg.remove(); renderAll(); }));
  dlg.querySelectorAll("[data-fdel]").forEach(b=>b.addEventListener("click",()=>{
    p.facts.splice(+b.dataset.fdel,1); saveDB(); dlg.close(); dlg.remove(); personSheet(pid);
  }));
  dlg.querySelector("#dlgCloseTop").addEventListener("click",()=>{ dlg.close(); dlg.remove(); });
  dlg.querySelector("#pOpener").addEventListener("click",()=>{ if(!entitled()){ paywallSheet("Suggested messages are part of Samvar — start your free trial."); return; } openerSheet(p,{}); });
  dlg.querySelector("#paddrSave").addEventListener("click",async ()=>{
    const v=dlg.querySelector("#paddr").value.split(/\n|,\s*/).map(x=>x.trim()).filter(Boolean).join("\n");
    const st=dlg.querySelector("#paddrStatus");
    if(v===(p.addr||"")){ st.textContent="No change."; return; }
    p.addr=v||undefined; p.loc=undefined; saveDB();
    if(v){ st.textContent="Saved — looking it up on the map…";
      const loc=await geocode(v);
      if(loc){ p.loc={lat:loc.lat,lon:loc.lon}; saveDB(); st.textContent="📍 Saved and mapped ("+esc(loc.label)+")."; }
      else st.textContent="Saved, but couldn't find it on the map — try adding a town or postcode.";
    } else st.textContent="Address removed.";
    renderAll();
  });
  dlg.querySelector("#factAddBtn").addEventListener("click",()=>{
    const v=dlg.querySelector("#factAdd").value.trim(); if(!v) return;
    p.facts=p.facts||[]; p.facts.push({f:v,kind:"other",ts:Date.now()});
    saveDB(); dlg.close(); dlg.remove(); personSheet(pid);
  });
  dlg.querySelectorAll("[data-xedit]").forEach(row=>row.addEventListener("click",()=>{
    dlg.close(); dlg.remove(); editInteraction(row.dataset.xedit);
  }));
  dlg.querySelectorAll("[data-xdel]").forEach(b=>b.addEventListener("click",ev=>{ ev.stopPropagation();
    if(confirm("Delete this interaction? Scores recalculate immediately.")){
      const x=DB.interactions.find(i=>i.id===b.dataset.xdel); removePhoto(x?.photo);
      DB.interactions=DB.interactions.filter(i=>i.id!==b.dataset.xdel);
      saveDB(); renderAll(); dlg.close(); dlg.remove(); personSheet(pid);
    }
  }));
  dlg.querySelector("#dlgClose").addEventListener("click",()=>{ dlg.close(); dlg.remove(); });
  dlg.querySelector("#dlgDel").addEventListener("click",()=>{ if(confirm(`Remove ${p.name}? Their logged interactions stay but untagged.`)){ removePhoto(p.photo); DB.people=DB.people.filter(x=>x.id!==pid); saveDB(); dlg.close(); dlg.remove(); renderAll(); }});
}
function askTier(name, cb){
  if(!entitled()){ paywallSheet("Start your free trial to add people."); return; }
  const dlg=document.createElement("dialog");
  dlg.innerHTML=`<h2 style="font-size:17px">Which circle is ${esc(name)} in?</h2>
    <div class="seg" style="margin-top:12px">${Object.entries(TIERS).filter(([k])=>k!=="notnow").map(([k,t])=>`<button data-tier="${k}">${t.label}</button>`).join("")}</div>
    <p class="hint">Inner ≈5, weekly · Close ≈15, monthly · Friendly ≈50, quarterly.</p>`;
  document.body.appendChild(dlg); dlg.showModal();
  dlg.querySelectorAll("button").forEach(b=>b.addEventListener("click",()=>{ dlg.close(); dlg.remove(); cb(b.dataset.tier); }));
}

/* ---------- log drafts ---------- */
let drafts=[];
function renderDrafts(){
  const el=document.getElementById("drafts");
  el.innerHTML=drafts.map((d,di)=>{
    const chips=d.personIds.map(id=>{const p=DB.people.find(x=>x.id===id);
      return `<span class="chip">${esc(p?.name||"?")}<button data-di="${di}" data-rm="${id}">✕</button></span>`;}).join("")
      +(d.pendingNames||[]).map(n=>`<span class="chip" data-pend="${esc(n)}" data-di="${di}" style="background:var(--warn);color:#0b0b0b;cursor:pointer">${esc(n)} — tap to file</span>`).join("");
    return `<div class="card" data-di="${di}">
      <p class="hint" style="margin:0 0 8px">${d.ai?`<span class="badge" style="margin-right:6px">Claude</span>`:""}“${esc(d.note.slice(0,140))}${d.note.length>140?"…":""}”</p>
      <div class="fld"><label>Who</label><div class="chips">${chips}
        <span class="chip" style="background:transparent"><input type="text" data-addperson="${di}" placeholder="+ add name" style="border:none;background:none;width:90px;padding:2px;font-size:14px"></span></div></div>
      <div class="fld"><label>Type</label><div class="seg" data-set="depth" data-di="${di}">
        ${DEPTHS.map(v=>`<button data-v="${v.n}" class="${d.depth===v.n?"on":""}">${v.label}</button>`).join("")}</div></div>
      <div class="fld"><label>Channel</label><div class="seg" data-set="channel" data-di="${di}">
        ${Object.entries(CHANNELS).map(([k,v])=>`<button data-v="${k}" class="${d.channel===k?"on":""}">${v.label}</button>`).join("")}</div></div>
      ${(d.facts&&d.facts.length)?`<div class="fld"><label>Will remember</label>${d.facts.map((f,fi)=>
        `<div class="factline"><span class="fk">${KIND_EMOJI[f.kind]}</span><span><b>${esc(f.person)}</b> — ${esc(f.fact)}</span><button data-di="${di}" data-frm="${fi}">✕</button></div>`).join("")}</div>`:""}
      <div class="fld"><label>Where</label><div style="display:flex;gap:8px">
        <input type="text" data-where="${di}" value="${esc(d.place||"")}" placeholder="place (optional)">
        <button class="btn ghost small" data-gps="${di}" title="Use my location">📍</button></div></div>
      <div class="fld"><label>When</label><input type="date" data-date="${di}" value="${localDate(d.ts)}"></div>
      <div class="fld"><label>Photo</label><div style="display:flex;gap:8px;align-items:center">
        ${d.photo?`<div class="avatar" data-photo="${esc(d.photo)}" style="border-radius:10px;width:56px;height:56px"></div>`:""}
        <button class="btn ghost small" data-photo-add="${di}">${d.photo?"Change photo":"📷 Add photo"}</button>
        ${d.photo?`<button class="btn ghost small" data-photo-rm="${di}">Remove</button>`:""}</div></div>
      <div style="display:flex;gap:8px">
        <button class="btn" data-save="${di}">Save · +${Math.round(interactionPoints(d))} smiles${d.personIds.length>1?" each":""}</button>
        <button class="btn ghost small" data-discard="${di}">Discard</button></div>
    </div>`;
  }).join("");
  hydratePhotos(el);
  el.querySelectorAll("[data-photo-add]").forEach(b=>b.addEventListener("click",async ()=>{ const d=drafts[+b.dataset.photoAdd]; const ref=await choosePhoto(); if(!ref) return; removePhoto(d.photo); d.photo=ref; renderDrafts(); }));
  el.querySelectorAll("[data-photo-rm]").forEach(b=>b.addEventListener("click",()=>{ const d=drafts[+b.dataset.photoRm]; removePhoto(d.photo); d.photo=undefined; renderDrafts(); }));
  // bindings
  el.querySelectorAll(".seg[data-set]").forEach(seg=>{
    seg.querySelectorAll("button").forEach(b=>b.addEventListener("click",()=>{
      const d=drafts[+seg.dataset.di];
      d[seg.dataset.set]=seg.dataset.set==="depth"?+b.dataset.v:b.dataset.v;
      renderDrafts();
    }));
  });
  el.querySelectorAll("[data-rm]").forEach(b=>b.addEventListener("click",()=>{
    const d=drafts[+b.dataset.di]; d.personIds=d.personIds.filter(id=>id!==b.dataset.rm); renderDrafts();
  }));
  el.querySelectorAll("[data-frm]").forEach(b=>b.addEventListener("click",()=>{
    const d=drafts[+b.dataset.di]; d.facts.splice(+b.dataset.frm,1); renderDrafts();
  }));
  el.querySelectorAll("[data-pend]").forEach(ch=>ch.addEventListener("click",()=>{
    const d=drafts[+ch.dataset.di]; const name=ch.dataset.pend;
    askTier(name, tier=>{
      const p={id:uid(),name,tier,aliases:[],added:Date.now()};
      DB.people.push(p); d.personIds.push(p.id);
      d.pendingNames=d.pendingNames.filter(n=>n!==name);
      saveDB(); renderDrafts();
    });
  }));
  el.querySelectorAll("[data-addperson]").forEach(inp=>inp.addEventListener("keydown",e=>{
    if(e.key!=="Enter") return;
    const name=inp.value.trim(); if(!name) return;
    const d=drafts[+inp.dataset.addperson];
    let p=DB.people.find(x=>x.name.toLowerCase()===name.toLowerCase());
    if(p){ d.personIds.push(p.id); renderDrafts(); }
    else askTier(name, tier=>{ p={id:uid(),name,tier,aliases:[],added:Date.now()}; DB.people.push(p); d.personIds.push(p.id); saveDB(); renderDrafts(); });
  }));
  el.querySelectorAll("[data-date]").forEach(inp=>inp.addEventListener("change",()=>{
    drafts[+inp.dataset.date].ts=new Date(inp.value+"T12:00").getTime();
  }));
  el.querySelectorAll("[data-where]").forEach(inp=>inp.addEventListener("input",()=>{
    drafts[+inp.dataset.where].place=inp.value;
  }));
  el.querySelectorAll("[data-gps]").forEach(b=>b.addEventListener("click",async ()=>{
    b.textContent="…";
    const pos=await getPosition();
    if(pos){ const pl=await reverseGeo(pos.lat,pos.lon);
      const d=drafts[+b.dataset.gps]; d.place=pl; d.loc=pos;
      const inp=el.querySelector(`[data-where="${b.dataset.gps}"]`); if(inp) inp.value=pl; }
    b.textContent="📍";
  }));
  el.querySelectorAll("[data-save]").forEach(b=>b.addEventListener("click",()=>{
    const d=drafts[+b.dataset.save];
    if((d.pendingNames||[]).length){ alert("Tap the highlighted name(s) to file them into a circle first."); return; }
    if(!d.personIds.length){ alert("Tag at least one person (type a name and press return)."); return; }
    DB.interactions.push({id:uid(),ts:d.ts,personIds:d.personIds,depth:d.depth,channel:d.channel,note:d.note,place:d.place||"",loc:d.loc,photo:d.photo,
      ai:!!d.ai, facts:(d.facts||[]).map(f=>({person:f.person,fact:f.fact,kind:f.kind,followUp:f.followUp||""}))});
    // attach remembered facts to their people (fuzzy names; fall back to the tagged person)
    for(const f of (d.facts||[])){
      let p=DB.people.find(x=>x.name.toLowerCase()===f.person.toLowerCase()
        || nameTokens(x.name)[0]===f.person.toLowerCase()
        || (x.aliases||[]).some(a=>a.toLowerCase()===f.person.toLowerCase()));
      if(!p) p=fuzzyFind(f.person);
      if(!p && d.personIds.length===1) p=DB.people.find(x=>x.id===d.personIds[0]);
      if(p){ p.facts=p.facts||[];
        if(!p.facts.some(x=>x.f.toLowerCase()===f.fact.toLowerCase())) p.facts.push({f:f.fact,kind:f.kind,ts:d.ts,followUp:f.followUp?Date.parse(f.followUp)||undefined:undefined}); }
    }
    // clear snoozes for these people
    d.personIds.forEach(id=>{const p=DB.people.find(x=>x.id===id); if(p) delete p.snoozeUntil;});
    drafts.splice(+b.dataset.save,1);
    saveDB(); renderDrafts(); renderAll();
    window.SamvarNative?.haptic("success"); window.SamvarNative?.scheduleNudges();
    if(!drafts.length){ document.getElementById("logText").value=""; switchPage("home"); }
  }));
  el.querySelectorAll("[data-discard]").forEach(b=>b.addEventListener("click",()=>{ removePhoto(drafts[+b.dataset.discard]?.photo); drafts.splice(+b.dataset.discard,1); renderDrafts(); }));
}
document.getElementById("parseBtn").addEventListener("click",async ()=>{
  const text=document.getElementById("logText").value.trim();
  if(!text) return;
  if(!entitled()){ paywallSheet("Start your free trial to log conversations."); return; }
  const btn=document.getElementById("parseBtn");
  btn.textContent="Understanding…"; btn.disabled=true;
  const notice=document.getElementById("aiNotice"); notice.style.display="none";
  try{ drafts=await aiParse(text); if(!drafts.length){ alert("Couldn't find an interaction in that note — try describing who you spoke to."); } }
  catch(e){ drafts=parseNote(text);
    if(e instanceof QuotaError && !isPro() && gateReached()) paywallSheet("Your trial or subscription has ended — this note was filed with the simple rules instead.");
    else if(e instanceof QuotaError && !isPro()){ notice.textContent="Your free AI allowance is used up — this note was filed with the simple rules. Start the free trial for unlimited."; notice.style.display="block"; }
    else if(e instanceof QuotaError){ notice.textContent="Samvar AI couldn’t verify your subscription just now, so this note was filed with the simple rules. It usually clears itself within a few minutes."; notice.style.display="block"; }
    else { const offline=/Failed to fetch|NetworkError|Load failed/.test(e.message);
      notice.textContent=offline?"Samvar AI is unreachable right now, so this note was filed with the simple rules — check the details below.":"Couldn't reach Samvar AI ("+e.message.slice(0,80)+") — filed with the simple rules instead.";
      notice.style.display="block"; } }
  finally{ btn.textContent="Review & score"; btn.disabled=false; }
  renderDrafts();
  document.getElementById("drafts").scrollIntoView({behavior:"smooth"});
  // GPS autofill: what the note says beats where you are; GPS only applies to entries dated today
  if(drafts.some(d=>!d.place && isToday(d.ts))){
    const pos=await getPosition();
    if(pos){ const pl=await reverseGeo(pos.lat,pos.lon);
      if(pl){ let changed=false;
        drafts.forEach(d=>{ if(!d.place && isToday(d.ts)){ d.place=pl; d.loc=pos; changed=true; } });
        if(changed) renderDrafts(); } }
  }
});
/* goal, nudge preferences, people sub-views */
document.querySelectorAll("#nudgeSeg button").forEach(b=>b.addEventListener("click",()=>{ DB.settings.nudgeFreq=b.dataset.nf; DB.settings.nudgeSet=true; saveDB(); renderAll(); window.SamvarNative?.scheduleNudges({ask:true}); }));
document.getElementById("nudgeTime").addEventListener("change",e=>{ DB.settings.nudgeTime=e.target.value; DB.settings.nudgeSet=true; saveDB(); renderAll(); window.SamvarNative?.scheduleNudges({ask:true}); });
/* called by native.js once the Capacitor bridge is up */
function initNativeUI(){
  const n=window.SamvarNative; if(!n) return;
  document.getElementById("nudgeStatus").textContent="Nudges arrive as notifications at the time you choose.";
  const b=document.getElementById("pickContacts"); b.style.display="inline-flex"; b.textContent="📇 Add from Contacts";
  b.onclick=()=>{ if(!entitled()){ paywallSheet("Start your free trial to add people."); return; } contactsSheet(); };
  document.getElementById("contactsHint").textContent="Add from Contacts shows your address book so you can flag people straight into a circle. Only the people you flag are saved, and only on this phone.";
}
// Whole-address-book picker: flag each person into a circle, then add them all at once (with photo, number, address, birthday).
async function contactsSheet(){
  const n=window.SamvarNative;
  const list=await n.allContacts();
  if(!list){ alert("Samvar needs access to your contacts for this. You can allow it in Settings → Samvar → Contacts."); return; }
  const have=new Set(DB.people.map(p=>p.name.toLowerCase()));
  const pick={}; // contactId → tier
  const dlg=document.createElement("dialog");
  dlg.innerHTML=`<h2 style="font-size:17px;margin-bottom:6px">Flag people into circles</h2>
    <p class="hint" style="margin:0 0 8px">Tap a circle next to each person you want in Samvar. Everyone else is ignored.</p>
    <input type="search" id="cSearch" placeholder="Search ${list.length} contacts…" style="margin-bottom:8px">
    <div id="cList" style="max-height:52vh;overflow:auto;margin:0 -4px"></div>
    <div style="display:flex;gap:8px;margin-top:10px;align-items:center">
      <button class="btn small" id="cAdd" disabled>Add 0 people</button>
      <button class="btn ghost small" id="cCancel">Cancel</button><span class="hint" id="cProg"></span></div>`;
  document.body.appendChild(dlg); dlg.showModal(); setTimeout(()=>dlg.querySelector("#cSearch").blur(),0);
  const tiers=["inner","invest","warm"];
  // Render the whole address book, 150 rows at a time as the list is scrolled (thousands of contacts stay smooth).
  const listEl=dlg.querySelector("#cList"); let rows=[], shown=0;
  const rowHtml=c=>{
    const inApp=have.has(c.name.toLowerCase());
    return `<div style="padding:8px 4px;border-bottom:1px solid var(--ring)"><div style="display:flex;align-items:center;gap:10px">${av(c.name)}<div style="min-width:0;flex:1"><div class="nm" style="font-size:15px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(c.name)}</div>
      <div class="meta" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${inApp?"already in Samvar":[c.tel,c.birthday?"🎂 "+c.birthday:""].filter(Boolean).join(" · ")||"&nbsp;"}</div></div></div>
      ${inApp?"":`<div class="seg" style="margin:6px 0 0 50px;flex-wrap:nowrap">${tiers.map(t=>`<button data-cid="${esc(c.contactId)}" data-t="${t}" class="${pick[c.contactId]===t?"on":""}" style="flex:1;padding:7px 4px;font-size:13px">${TIERS[t].label}</button>`).join("")}</div>`}</div>`;
  };
  const bind=root=>root.querySelectorAll("[data-cid]").forEach(bt=>{ if(bt.dataset.bound) return; bt.dataset.bound="1"; bt.addEventListener("click",()=>{
    const id=bt.dataset.cid; if(pick[id]===bt.dataset.t) delete pick[id]; else pick[id]=bt.dataset.t;
    bt.parentElement.querySelectorAll("button").forEach(x=>x.classList.toggle("on",pick[id]===x.dataset.t));
    const k=Object.keys(pick).length; const add=dlg.querySelector("#cAdd"); add.disabled=!k; add.textContent=`Add ${k} ${k===1?"person":"people"}`;
  }); });
  const more=()=>{ if(shown>=rows.length) return; const frag=document.createElement("div"); frag.innerHTML=rows.slice(shown,shown+150).map(rowHtml).join(""); shown+=150;
    const sentinel=listEl.querySelector("#cMore"); if(sentinel) sentinel.remove();
    while(frag.firstChild) listEl.appendChild(frag.firstChild);
    if(shown<rows.length) listEl.insertAdjacentHTML("beforeend",`<div id="cMore" class="hint" style="text-align:center;padding:10px">${rows.length-shown} more… (scroll)</div>`);
    bind(listEl); };
  const render=()=>{
    const q=dlg.querySelector("#cSearch").value.trim().toLowerCase();
    rows=list.filter(c=>!q||c.name.toLowerCase().includes(q)); shown=0; listEl.innerHTML=rows.length?"":`<div class="empty">No matches.</div>`; more();
  };
  listEl.addEventListener("scroll",()=>{ if(listEl.scrollTop+listEl.clientHeight>=listEl.scrollHeight-200) more(); });
  render();
  dlg.querySelector("#cSearch").addEventListener("input",render);
  dlg.querySelector("#cCancel").addEventListener("click",()=>{ dlg.close(); dlg.remove(); });
  dlg.querySelector("#cAdd").addEventListener("click",async ()=>{
    const ids=Object.keys(pick); const prog=dlg.querySelector("#cProg"); dlg.querySelector("#cAdd").disabled=true;
    const added=[];
    for(let i=0;i<ids.length;i++){
      const c=list.find(x=>x.contactId===ids[i]); if(!c) continue;
      prog.textContent=`Adding ${i+1} of ${ids.length}…`;
      const facts=c.birthday?[{f:"birthday "+c.birthday,kind:"date",ts:Date.now()}]:[];
      let photo; try{ const b64=await n.contactPhoto(c.contactId); if(b64) photo=await storePhoto(b64); }catch(e){}
      const p={id:uid(),name:c.name,tier:pick[c.contactId],aliases:[],added:Date.now(),contactId:c.contactId,tel:c.tel,tels:c.tels,telIsMobile:c.telIsMobile,addr:c.addr,email:c.email,company:c.company,role:c.role,urls:c.urls,facts,photo};
      DB.people.push(p); added.push(p);
    }
    saveDB(); renderAll(); n.haptic("success"); dlg.close(); dlg.remove();
    // Map their addresses in the background (one lookup per second; AI tidies any that fail).
    (async ()=>{ for(const p of added){ if(!p.addr||p.loc) continue; const loc=await geocode(p.addr); if(loc){ p.loc={lat:loc.lat,lon:loc.lon}; saveDB(); } } renderAll(); })();
  });
}
document.getElementById("checkinOn")?.addEventListener("change",e=>{ DB.settings.checkin=e.target.checked; saveDB(); window.SamvarNative?.scheduleNudges({ask:true}); });
document.getElementById("checkinTime")?.addEventListener("change",e=>{ DB.settings.checkinTime=e.target.value; saveDB(); window.SamvarNative?.scheduleNudges(); });
document.getElementById("digestOn")?.addEventListener("change",e=>{ DB.settings.digest=e.target.checked; saveDB(); window.SamvarNative?.scheduleNudges(); });
document.getElementById("checkinNow")?.addEventListener("click",checkinSheet);
document.getElementById("nudgePreview").addEventListener("click",()=>{
  const n=nudgeText(), next=nextNudgeTimes(1)[0];
  document.getElementById("nudgePreviewOut").innerHTML=`<b>${esc(n.title)}</b> — ${esc(n.body)}<br>${next?`Next one ${new Date(next).toLocaleString("en-GB",{weekday:"short",hour:"2-digit",minute:"2-digit"})}.`:"Nudges are off."}`;
});
let peopleView="list";
function showPeopleView(v){
  peopleView=v;
  document.querySelectorAll("#peopleSeg button").forEach(b=>b.classList.toggle("on",b.dataset.pv===v));
  ["list","places"].forEach(k=>{ document.getElementById("pv-"+k).style.display=k===v?"block":"none"; });
  window.scrollTo(0,0);
  if(v==="places") setTimeout(renderMap,80);
}
document.querySelectorAll("#peopleSeg button").forEach(b=>b.addEventListener("click",()=>showPeopleView(b.dataset.pv)));
/* hidden developer mode: tap the Samvar wordmark five times */
let brandTaps=0, brandTapAt=0;
document.querySelector("header.app h1").addEventListener("click",()=>{
  const now=Date.now(); brandTaps=(now-brandTapAt<1500)?brandTaps+1:1; brandTapAt=now;
  if(brandTaps>=5){ brandTaps=0; try{ localStorage.setItem("samvar-dev",devMode()?"0":"1"); }catch(e){}
    alert(devMode()?"Developer mode on — direct API key card shown under You.":"Developer mode off."); renderAll(); }
});
/* API key save + live test (developer mode only) */
document.getElementById("apiKey").value=getApiKey();
// Dev mode only: realistic sample data for screenshots and demos.
document.getElementById("demoBtn")?.addEventListener("click",()=>{
  if(!confirm("Replace everything on this device with demo data?")) return;
  const D=DAY, now=Date.now(), P=[];
  const mk=(name,tier,addr,facts,extra)=>{ const p=Object.assign({id:uid(),name,tier,aliases:[],added:now-80*D,addr,facts:(facts||[]).map(f=>({f:f[0],kind:f[1],ts:now-30*D})),tel:"+44 7700 900"+String(100+P.length),telIsMobile:true},extra||{}); P.push(p); return p; };
  const kate=mk("Kate Bell","inner","14 Clifton Road\nBristol\nBS8 1AB\nUnited Kingdom",[["birthday 22 June","date"],["daughter Iris starting secondary school in September","family"],["moving to Bristol in March","other"]],{company:"BBC",role:"Producer"});
  const sam=mk("Sam Ortiz","inner","Clapham\nLondon\nSW4",[["birthday 3 March","date"],["training for the Brighton half marathon","other"],["partner Lena","family"]]);
  const priya=mk("Priya Nair","inner","Didsbury\nManchester",[["birthday 11 November","date"],["new job at a design studio","work"]],{company:"Studio North",role:"Designer"});
  const tom=mk("Tom Walsh","invest","Leith\nEdinburgh",[["son Rory just turned two","family"],["renovating the kitchen","other"]]);
  const amara=mk("Amara Okafor","invest","Brooklyn\nNew York\nUSA",[["birthday 9 April","date"],["just got a puppy called Biscuit","family"]]);
  const jonas=mk("Jonas Weber","invest","Kreuzberg\nBerlin\nGermany",[["starting a PhD in October","work"]]);
  const mei=mk("Mei Tanaka","invest","Shoreditch\nLondon",[["birthday 28 September","date"],["planning a trip to Kyoto","other"]]);
  const dave=mk("Dave Hughes","warm","Cardiff",[["coaches his daughter's football team","family"]]);
  const rosa=mk("Rosa Alvarez","warm","Seville\nSpain",[["opened a bakery","work"]]);
  const ben=mk("Ben Carter","warm","Bath",[["birthday 15 January","date"]]);
  const lucy=mk("Lucy Grant","warm","Oxford",[]);
  const raj=mk("Raj Patel","warm","Leicester",[["running the London marathon in April","other"]]);
  const X=[]; const log=(p,daysAgo,depth,channel,note,facts,ai)=>X.push({id:uid(),ts:now-daysAgo*D,personIds:[p.id],depth,channel,note,place:"",ai:!!ai,facts:(facts||[]).map(f=>({person:p.name,fact:f,kind:"other"}))});
  log(kate,1,2,"inperson","Long lunch in Clifton, talked properly about the move and Iris's new school",["daughter Iris starting secondary school in September"],true);
  log(kate,9,1,"message","Quick catch-up about weekend plans",[],true); log(kate,16,2,"call","Hour on the phone about her new role",[],true);
  log(sam,3,1,"message","Checked in after his long run",[],true); log(sam,10,2,"inperson","Dinner at his place, met Lena",["partner Lena"],true); log(sam,24,1,"call","Short call about the marathon plan",[],false);
  log(priya,5,2,"call","Proper catch-up about the design studio job",["new job at a design studio"],true); log(priya,20,1,"message","Sent her the podcast",[],false);
  log(tom,17,2,"inperson","Weekend in Edinburgh, saw the new kitchen",[],true); log(tom,50,1,"message","Birthday message for Rory",[],false);
  log(amara,12,1,"message","Puppy photos",[],true); log(amara,40,2,"call","Long video call about her move",[],true);
  log(jonas,33,1,"message","Congratulated him on the PhD place",[],true);
  log(mei,26,2,"inperson","Coffee in Shoreditch, Kyoto plans",["planning a trip to Kyoto"],true);
  log(dave,45,1,"message","Football chat",[],false); log(rosa,70,2,"inperson","Visited the bakery in Seville",["opened a bakery"],true);
  log(ben,58,1,"message","Happy birthday text",[],false); log(raj,35,1,"call","Marathon training chat",[],false);
  DB.people=P; DB.interactions=X; DB.settings=Object.assign(DB.settings,{welcomed:true,nudgeSet:true,pro:{active:true,source:"appstore",trial:true,expires:now+5*D}});
  saveDB(); renderAll(); switchPage("home");
});
document.getElementById("apiSave").addEventListener("click",async ()=>{
  const k=document.getElementById("apiKey").value.trim();
  const st=document.getElementById("apiStatus");
  setApiKey(k);
  if(!k){ st.textContent="Key removed — back to simple rules."; return; }
  st.textContent="Testing key…";
  try{ await claudeCall("Reply with the word OK only.","ping",8);
    st.textContent="✓ Connected — Claude will now read your notes."; }
  catch(e){ st.textContent="✗ That key didn't work ("+e.message.slice(0,80)+")."; }
});

/* ---------- people / candidates ---------- */
document.getElementById("newPersonBtn").addEventListener("click",()=>{
  const inp=document.getElementById("newPersonName"); const name=inp.value.trim(); if(!name) return;
  askTier(name, tier=>{ DB.people.push({id:uid(),name,tier,aliases:[],added:Date.now()}); inp.value=""; saveDB(); renderAll(); });
});
function addCandidates(items){
  const existing=new Set(DB.people.map(p=>p.name.toLowerCase()));
  const pending=new Set(DB.candidates.map(c=>c.name.toLowerCase()));
  let added=0;
  for(const raw of items){
    const it=typeof raw==="string"?{name:raw.trim()}:{name:String(raw.name||"").trim(),addr:raw.addr?String(raw.addr).trim():undefined,tel:raw.tel?String(raw.tel).trim():undefined};
    if(it.name && !existing.has(it.name.toLowerCase()) && !pending.has(it.name.toLowerCase())){
      DB.candidates.push(it); pending.add(it.name.toLowerCase()); added++; }
  }
  saveDB(); renderAll(); return added;
}
document.getElementById("icsBtn").addEventListener("click",exportICS);
document.getElementById("geoAllBtn").addEventListener("click",async ()=>{
  const all=[...DB.people,...DB.candidates];
  const withAddr=all.filter(x=>x.addr);
  const todo=withAddr.filter(x=>!x.loc);
  const prog=document.getElementById("geoProg");
  if(!withAddr.length){ prog.textContent="No one has an address yet — add one on a person's profile."; return; }
  if(!todo.length){ prog.textContent=`✓ All ${withAddr.length} address${withAddr.length===1?" is":"es are"} already mapped — nothing to do.`; return; }
  const btn=document.getElementById("geoAllBtn"); btn.disabled=true;
  let done=0, found=0; const failed=[];
  for(const x of todo){
    prog.textContent=`Mapping ${done+1} of ${todo.length}… (${found} placed)`;
    const loc=await geocode(x.addr);
    if(loc){ x.loc={lat:loc.lat,lon:loc.lon}; found++; } else failed.push(x.name);
    done++; saveDB();
  }
  prog.textContent=`Done — ${found} of ${todo.length} placed.`+
    (failed.length?` Couldn't find: ${failed.slice(0,4).join(", ")}${failed.length>4?"…":""} — try adding a town or postcode to their address, then run this again.`:"");
  btn.disabled=false; renderAll();
});
/* native contact picker where the browser supports it */
if(navigator.contacts && navigator.contacts.select){
  const b=document.getElementById("pickContacts"); b.style.display="inline-flex";
  b.addEventListener("click",async ()=>{
    try{
      let props=["name"];
      try{ const sup=await navigator.contacts.getProperties();
        if(sup.includes("address")) props.push("address");
        if(sup.includes("tel")) props.push("tel"); }catch(e){}
      const cs=await navigator.contacts.select(props,{multiple:true});
      const items=cs.map(c=>{ const name=Array.isArray(c.name)?c.name[0]:c.name;
        let addr;
        const rawA=c.address||c.addresses; // spec name + defensive alias
        const a=Array.isArray(rawA)?rawA[0]:rawA;
        if(typeof a==="string") addr=a.trim()||undefined;
        else if(a && typeof a==="object"){
          addr=[ (Array.isArray(a.addressLine)?a.addressLine.join(" "):a.addressLine),
                 a.city||a.locality, a.region, a.postalCode||a.postcode ]
               .filter(Boolean).join(" ").replace(/\s+/g," ").trim()||undefined;
          if(!addr && typeof a.toJSON==="function"){ try{ const j=a.toJSON(); addr=[j.city,j.postalCode].filter(Boolean).join(" ")||undefined; }catch(e){} }
        }
        const tel=Array.isArray(c.tel)?c.tel[0]:c.tel;
        return name?{name,addr,tel}:null; }).filter(Boolean);
      const added=addCandidates(items);
      if(added){
        const withAddr=items.filter(i=>i.addr).length;
        if(props.includes("address") && !withAddr)
          alert(added+" added to triage — but Safari's contact picker didn't hand over any addresses (Apple's experimental picker usually only shares names). You can add an address on each person's profile.");
        else if(!props.includes("address"))
          alert(added+" added to triage. This browser's picker doesn't share addresses at all — add them on each person's profile.");
        else alert(added+" added to “To file” ("+withAddr+" with addresses).");
        switchPage("people");
      }
    }catch(e){ /* user cancelled */ }
  });
} else {
  document.getElementById("contactsHint").innerHTML=
    "This browser can’t open your Contacts app directly. Easiest route: in the iPhone <b>Contacts</b> app go to <b>Lists</b>, touch and hold <b>All Contacts</b>, tap <b>Export</b>, send the file to yourself, then use “Import contacts file” here. Or paste a list of names below.";
}

/* ---------- backup ---------- */
document.getElementById("exportBtn").addEventListener("click",()=>{
  saveFile(`samvar-backup-${new Date().toISOString().slice(0,10)}.json`, JSON.stringify(DB,null,1), "application/json");
});
document.getElementById("importFile").addEventListener("change",e=>{
  const f=e.target.files[0]; if(!f) return;
  f.text().then(txt=>{ try{ const d=JSON.parse(txt);
    if(!d.people||!d.interactions) throw 0;
    DB=migrate(d); saveDB(); renderAll(); alert("Backup imported."); }catch{ alert("That file doesn’t look like a Samvar backup."); } });
});
document.getElementById("wipeBtn").addEventListener("click",()=>{
  if(confirm("Erase everything? This cannot be undone (export a backup first)."))
  { DB=migrate({people:[],interactions:[],candidates:[],scoreHistory:[]}); saveDB(); renderAll(); }
});

/* ---------- network: co-presence graph, groups, bridges, places ---------- */
function pairKey(a,b){ return a<b?a+"|"+b:b+"|"+a; }
function coData(){
  const pairs=new Map(), pplSet=new Set();
  for(const x of DB.interactions){
    const ids=(x.personIds||[]).filter(id=>DB.people.some(p=>p.id===id));
    if(ids.length<2) continue;
    ids.forEach(id=>pplSet.add(id));
    for(let i=0;i<ids.length;i++) for(let j=i+1;j<ids.length;j++){
      const k=pairKey(ids[i],ids[j]);
      const e=pairs.get(k)||{count:0,last:0,first:Infinity};
      e.count++; e.last=Math.max(e.last,x.ts); e.first=Math.min(e.first,x.ts);
      pairs.set(k,e);
    }
  }
  return {pairs, nodes:[...pplSet]};
}
function findGroups(nodes,pairs){
  // dense-set detection: someone joins only if linked to most of the set,
  // so one person can genuinely belong to two groups without merging them
  const adj=new Map();
  for(const k of pairs.keys()){ const [a,b]=k.split("|");
    if(!adj.has(a)) adj.set(a,new Set()); if(!adj.has(b)) adj.set(b,new Set());
    adj.get(a).add(b); adj.get(b).add(a); }
  const edges=[...pairs.entries()].sort((x,y)=>y[1].count-x[1].count);
  const groups=[];
  for(const [k] of edges){
    const [a,b]=k.split("|");
    if(groups.some(g=>g.has(a)&&g.has(b))) continue;
    const g=new Set([a,b]);
    let grew=true;
    while(grew){ grew=false;
      for(const n of nodes){ if(g.has(n)) continue;
        const links=[...g].filter(m=>adj.get(n)&&adj.get(n).has(m)).length;
        if(links>=Math.max(1,Math.ceil(g.size*0.6))){ g.add(n); grew=true; } } }
    if(!groups.some(o=>[...g].every(m=>o.has(m)))){
      for(let i=groups.length-1;i>=0;i--) if([...groups[i]].every(m=>g.has(m))) groups.splice(i,1);
      groups.push(g);
    }
  }
  return groups;
}
function layoutGraph(nodes,pairs,W,H){
  const pos={};
  nodes.forEach((id,i)=>{ const a=2*Math.PI*i/nodes.length;
    pos[id]={x:W/2+Math.cos(a)*W*0.33, y:H/2+Math.sin(a)*H*0.33}; });
  for(let it=0;it<150;it++){
    for(let i=0;i<nodes.length;i++) for(let j=i+1;j<nodes.length;j++){
      const pa=pos[nodes[i]],pb=pos[nodes[j]];
      let dx=pb.x-pa.x,dy=pb.y-pa.y; const d2=dx*dx+dy*dy||1; const f=1400/d2;
      pa.x-=dx*f/40; pa.y-=dy*f/40; pb.x+=dx*f/40; pb.y+=dy*f/40; }
    for(const [k,e] of pairs){ const [a,b]=k.split("|"); const pa=pos[a],pb=pos[b];
      const f=0.003*Math.min(4,e.count);
      const dx=pb.x-pa.x,dy=pb.y-pa.y;
      pa.x+=dx*f; pa.y+=dy*f; pb.x-=dx*f; pb.y-=dy*f; }
    for(const id of nodes){ const p=pos[id]; p.x=Math.max(30,Math.min(W-30,p.x)); p.y=Math.max(24,Math.min(H-26,p.y)); }
  }
  return pos;
}
function capName(p){ const n=nameTokens(p.name)[0]||""; return n.charAt(0).toUpperCase()+n.slice(1); }
function groupMeetCount(g){
  return DB.interactions.filter(x=>{
    const ids=(x.personIds||[]).filter(id=>g.has(id)); return ids.length>=2; }).length;
}
function renderNetwork(){
  const gEl=document.getElementById("netGraph"); if(!gEl) return;
  const {pairs,nodes}=coData();
  if(nodes.length<2){
    gEl.innerHTML=`<div class="empty">Your constellation appears once you log interactions with more than one person tagged — dinners, group calls, family lunches.</div>`;
    document.getElementById("netGroups").innerHTML=`<div class="card empty">Groups build themselves from who you see together.</div>`;
    document.getElementById("netBridges").innerHTML=`<div class="card empty">Bridges — people who belong to more than one of your groups — appear here.</div>`;
  } else {
    const W=360,H=290, pos=layoutGraph(nodes,pairs,W,H);
    const pplById=id=>DB.people.find(p=>p.id===id);
    let svg=`<svg viewBox="0 0 ${W} ${H}" width="100%">`;
    for(const [k,e] of pairs){ const [a,b]=k.split("|");
      svg+=`<line x1="${pos[a].x}" y1="${pos[a].y}" x2="${pos[b].x}" y2="${pos[b].y}"
        stroke="var(--baseline)" stroke-width="${(1+1.6*Math.log2(e.count+1)).toFixed(1)}" stroke-linecap="round" opacity="0.8"/>`; }
    for(const id of nodes){ const p=pplById(id); if(!p) continue;
      const h=healthOfP(p,Date.now());
      svg+=`<g class="netnode" data-pid="${id}" style="cursor:pointer">
        <circle cx="${pos[id].x}" cy="${pos[id].y}" r="11" fill="${h.color}" stroke="var(--surface)" stroke-width="2"/>
        <text x="${pos[id].x}" y="${pos[id].y+23}" text-anchor="middle" font-size="10" font-weight="600" fill="var(--ink-2)">${esc(nameTokens(p.name)[0][0].toUpperCase()+nameTokens(p.name)[0].slice(1))}</text></g>`; }
    svg+=`</svg>`;
    gEl.innerHTML=svg;
    gEl.querySelectorAll(".netnode").forEach(n=>n.addEventListener("click",()=>personSheet(n.dataset.pid)));

    // groups (a real group has met together at least twice)
    const groups=findGroups(nodes,pairs).filter(g=>groupMeetCount(g)>=2);
    const now=Date.now();
    document.getElementById("netGroups").innerHTML=groups.length?groups.map((g,gi)=>{
      const members=[...g].map(id=>DB.people.find(p=>p.id===id)).filter(Boolean)
        .sort((a,b)=>personBalance(b,now)-personBalance(a,now));
      const title=members.length>2?`${capName(members[0])} & ${capName(members[1])} + ${members.length-2} more`
        :members.map(capName).join(" & ");
      const meets=groupMeetCount(g);
      const groupLast=Math.max(...[...pairs.entries()].filter(([k])=>{const[a,b]=k.split("|");return g.has(a)&&g.has(b);}).map(([,e])=>e.last));
      const flags=members.map(m=>{
        const mine=[...pairs.entries()].filter(([k])=>{const[a,b]=k.split("|");return (a===m.id&&g.has(b))||(b===m.id&&g.has(a));});
        if(!mine.length) return "";
        const first=Math.min(...mine.map(([,e])=>e.first)), last=Math.max(...mine.map(([,e])=>e.last));
        if((now-first)/DAY<=30 && meets>2) return `<div class="why">✨ ${esc(capName(m))} is newly around this group</div>`;
        if((now-last)/DAY>60 && (now-groupLast)/DAY<30) return `<div class="why">🍂 ${esc(capName(m))} has stopped showing up</div>`;
        return "";
      }).filter(Boolean).join("");
      return `<div class="card"><div class="nm" style="font-weight:800">${esc(title)}’s circle</div>
        <div class="meta" style="margin:2px 0 8px">together ${meets} time${meets===1?"":"s"} · last ${fmtAgo(groupLast)}</div>
        <div class="chips">${members.map(m=>{const h=healthOfP(m,now);
          return `<span class="chip"><i style="width:8px;height:8px;border-radius:50%;background:${h.color};display:inline-block"></i>${esc(capName(m))}</span>`;}).join("")}</div>
        ${flags}</div>`;
    }).join(""):`<div class="card empty">No recurring groups detected yet.</div>`;

    // bridges & orphans
    const memberOf={};
    groups.forEach((g,i)=>[...g].forEach(id=>{ (memberOf[id]=memberOf[id]||[]).push(i); }));
    const bridges=Object.entries(memberOf).filter(([,gs])=>gs.length>=2);
    const orphans=DB.people.filter(p=>p.tier!=="notnow"&&!nodes.includes(p.id));
    document.getElementById("netBridges").innerHTML=
      (bridges.length?`<div class="card">${bridges.map(([id,gs])=>{
        const p=DB.people.find(q=>q.id===id); if(!p) return "";
        return `<div class="why">🌉 <b>${esc(p.name)}</b> bridges ${gs.length} of your groups — they connect worlds that otherwise wouldn’t meet.</div>`;}).join("")}</div>`
      :`<div class="card empty">No bridges yet — a bridge is someone who belongs to two of your groups.</div>`)
      +(orphans.length?`<p class="hint">Not yet linked to anyone: ${orphans.slice(0,8).map(p=>esc(capName(p))).join(", ")}${orphans.length>8?` +${orphans.length-8}`:""}.</p>`:"");
  }

  // place clusters & venues
  const clusters={};
  const townOf=a=>{ const lines=String(a).split(/\n|,\s*/).map(x=>x.trim()).filter(Boolean);
    const t=lines.find((l,i)=>i>0 && !/\d/.test(l)) || lines.find(l=>!/\d/.test(l)) || lines[0] || a;
    return t.replace(/\b[A-Z]{1,2}\d[A-Z\d]?(\s*\d[A-Z]{2})?\b/gi,"").trim()||t; };
  for(const p of DB.people){ if(!p.addr||p.tier==="notnow") continue;
    const label=townOf(p.addr);
    (clusters[label.toLowerCase()]=clusters[label.toLowerCase()]||{label,ppl:[]}).ppl.push(p); }
  const cEl=document.getElementById("placeClusters");
  const cRows=Object.values(clusters).filter(c=>c.ppl.length>=1).sort((a,b)=>b.ppl.length-a.ppl.length).slice(0,8);
  cEl.innerHTML=cRows.length?`<div class="card">${cRows.map(c=>{
    const overdue=c.ppl.filter(p=>{const t=TIERS[p.tier];const l=lastContact(p,Date.now());
      return t.cadence&&(!l||(Date.now()-l)/DAY>t.cadence);}).length;
    return `<div class="why">📍 <b>${esc(c.label)}</b> — ${c.ppl.length} ${c.ppl.length===1?"person":"people"}${overdue?`, <b>${overdue} overdue</b>`:""}</div>`;}).join("")}</div>`:"";
  const venues={};
  for(const x of DB.interactions){ if(x.place) venues[x.place]=(venues[x.place]||0)+1; }
  const vRows=Object.entries(venues).sort((a,b)=>b[1]-a[1]).slice(0,6);
  document.getElementById("venueList").innerHTML=vRows.length?
    `<div class="lbl" style="font-size:12px;color:var(--ink-2);font-weight:600;text-transform:uppercase;letter-spacing:.05em">Where you actually see people</div>
     ${vRows.map(([pl,n])=>`<div class="why" style="margin-top:6px">${esc(pl)} · ×${n}</div>`).join("")}`
    :`<div class="empty" style="padding:8px">Places you log interactions at will collect here.</div>`;
}
function renderPlaceResults(list,withDist){
  const el=document.getElementById("placeResults");
  el.innerHTML=list.length?list.slice(0,10).map(r=>{
    const l=lastContact(r.p,Date.now());
    return `<div class="person" data-pid="${r.p.id}">${av(r.p.name)}
      <div><div class="nm">${esc(r.p.name)}</div>
      <div class="meta">${r.p.addr?`📍 ${esc(addrLine(r.p.addr))} · `:""}last: ${fmtAgo(l)}${withDist&&r.km!=null?` · ${r.km<1?"<1":Math.round(r.km)} km away`:""}</div></div></div>`;
  }).join(""):`<div class="empty" style="padding:10px">No one found there.</div>`;
  el.querySelectorAll(".person").forEach(row=>row.addEventListener("click",()=>personSheet(row.dataset.pid)));
}
document.getElementById("placeQ").addEventListener("input",e=>{
  const q=e.target.value.trim().toLowerCase();
  if(!q){ document.getElementById("placeResults").innerHTML=""; return; }
  const list=DB.people.filter(p=>p.tier!=="notnow"&&p.addr&&addrLine(p.addr).toLowerCase().includes(q))
    .map(p=>({p})).sort((a,b)=>(lastContact(a.p,Date.now())||0)-(lastContact(b.p,Date.now())||0));
  renderPlaceResults(list,false);
});
document.getElementById("nearMeBtn").addEventListener("click",async ()=>{
  const btn=document.getElementById("nearMeBtn"); btn.textContent="…";
  const pos=await getPosition(); btn.textContent="Near me";
  if(!pos){ alert("Couldn't get your location — check Safari's location permission."); return; }
  const list=DB.people.filter(p=>p.tier!=="notnow"&&p.loc)
    .map(p=>({p,km:havKm(pos,p.loc)})).filter(r=>r.km<=40).sort((a,b)=>a.km-b.km);
  if(!list.length){ document.getElementById("placeResults").innerHTML=`<div class="empty" style="padding:10px">No mapped contacts within 40 km — run “Put contacts on the map” in the You tab first.</div>`; return; }
  renderPlaceResults(list,true);
});

/* ---------- pin map (Leaflet + OpenStreetMap) ---------- */
let kmap=null, kmarkers=[];
function renderMap(){
  const el=document.getElementById("mapView"), hint=document.getElementById("mapHint");
  const pts=DB.people.filter(p=>p.loc&&p.tier!=="notnow");
  if(typeof L==="undefined"){ hint.textContent="Map couldn't load — check your connection and reopen this tab."; return; }
  if(!pts.length){ el.style.display="none"; if(kmap){ kmap.remove(); kmap=null; }
    hint.textContent="Pins appear here once contacts have a mapped address — add one on a person's profile, or run “Put contacts on the map” in the You tab."; return; }
  el.style.display="block";
  hint.textContent="Tap a pin for details — colour shows relationship health.";
  if(!kmap){
    kmap=L.map(el,{scrollWheelZoom:false});
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png",
      {attribution:"© OpenStreetMap contributors",maxZoom:19}).addTo(kmap);
  }
  kmarkers.forEach(m=>m.remove()); kmarkers=[];
  const now=Date.now();
  const colorMap={good:"#0ca30c",warn:"#fab219",serious:"#ec835a",critical:"#d03b3b",new:"#2a78d6"};
  for(const p of pts){
    const h=healthOfP(p,now);
    const m=L.circleMarker([p.loc.lat,p.loc.lon],
      {radius:9,color:"#ffffff",weight:2,fillColor:colorMap[h.k],fillOpacity:0.95}).addTo(kmap);
    m.bindPopup(`<b>${esc(p.name)}</b><br>${h.label} · last ${fmtAgo(lastContact(p,now))}${p.addr?`<br>📍 ${addrHtml(p.addr)}`:""}`);
    kmarkers.push(m);
  }
  kmap.fitBounds(L.latLngBounds(pts.map(p=>[p.loc.lat,p.loc.lon])).pad(0.3),{maxZoom:13});
  setTimeout(()=>kmap.invalidateSize(),80);
  const xb=document.getElementById("mapExpand"); xb.style.display="";
  xb.onclick=()=>toggleMapFull();
}
// Full-screen map: the map element is moved into a modal <dialog> (top layer, unaffected by card layout) and back.
let mapFull=false;
function toggleMapFull(){
  const wrap=document.getElementById("mapWrap"), el=document.getElementById("mapView"), xb=document.getElementById("mapExpand");
  const refit=()=>setTimeout(()=>{ if(!kmap) return; kmap.invalidateSize();
    const pts=DB.people.filter(p=>p.loc&&p.tier!=="notnow"); if(pts.length) kmap.fitBounds(L.latLngBounds(pts.map(p=>[p.loc.lat,p.loc.lon])).pad(0.2),{maxZoom:14}); },80);
  if(!mapFull){
    const dlg=document.createElement("dialog"); dlg.className="mapdlg"; dlg.id="mapDlg";
    dlg.innerHTML=`<button class="mapx" id="mapClose" title="Close map" aria-label="Close map">✕</button>`;
    document.body.appendChild(dlg); dlg.insertBefore(el, dlg.firstChild); el.style.height="100%"; dlg.showModal(); mapFull=true;
    dlg.querySelector("#mapClose").addEventListener("click",toggleMapFull);
    dlg.addEventListener("cancel",ev=>{ ev.preventDefault(); toggleMapFull(); });
    refit();
  } else {
    const dlg=document.getElementById("mapDlg"); wrap.insertBefore(el, xb); el.style.height="280px"; dlg.close(); dlg.remove(); mapFull=false; refit();
  }
}

/* ---------- theme ---------- */
const TH_KEY="samvar-theme";
function getTheme(){ try{ return localStorage.getItem(TH_KEY)||localStorage.getItem("kith-theme")||"light"; }catch(e){ return window.__memTheme||"light"; } }
function setTheme(t){ try{ localStorage.setItem(TH_KEY,t); }catch(e){ window.__memTheme=t; } applyTheme(); }
const darkMQ=window.matchMedia("(prefers-color-scheme: dark)");
function applyTheme(){
  const pref=getTheme();
  const resolved=pref==="auto"?(darkMQ.matches?"dark":"light"):pref;
  document.documentElement.dataset.theme=resolved;
  document.querySelectorAll("#themeSeg button").forEach(b=>b.classList.toggle("on",b.dataset.th===pref));
}
darkMQ.addEventListener?.("change",()=>{ if(getTheme()==="auto") applyTheme(); });
document.querySelectorAll("#themeSeg button").forEach(b=>b.addEventListener("click",()=>setTheme(b.dataset.th)));
applyTheme();

/* ---------- navigation ---------- */
function switchPage(p){
  hideTip();
  document.querySelectorAll(".page").forEach(el=>el.classList.toggle("on",el.id==="page-"+p));
  document.querySelectorAll("nav.tabs button").forEach(b=>b.classList.toggle("on",b.dataset.p===p));
  window.scrollTo(0,0);
  renderAll();
  if(p==="people" && peopleView==="places") setTimeout(renderMap,80);
}
document.querySelectorAll("nav.tabs button").forEach(b=>b.addEventListener("click",()=>switchPage(b.dataset.p)));
function renderAll(){ renderHome(); renderTriage(); renderPeople(); renderNetwork(); renderInsights(); renderSettingsUI(); renderCalendarSuggestions(); hydratePhotos(); scheduleWidgetSync(); }
/* ---------- home-screen widget + Siri (native shell) ---------- */
function widgetSnapshot(){
  const pick=todaysPick(nudges()), st=dailyStreak();
  const why=!pick?"Everyone's in rhythm — enjoy it":pick.never?"No conversation logged yet — say hello":pick.overdue?`${fmtAgo(pick.last)} since you spoke — past your ${pick.t.rhythm} rhythm`
    :`${Math.max(1,Math.round(pick.left))} day${Math.round(pick.left)===1?"":"s"} before they slip out of your ${pick.t.rhythm} rhythm`;
  return {name:pick?pick.p.name:null, initials:pick?initials(pick.p.name):null, why, streak:st.streak, score:connectionScore(Date.now()), target:targetScore(), updated:Date.now()};
}
let widgetTimer=null;
function scheduleWidgetSync(){ if(!window.SamvarNative?.syncWidget) return; clearTimeout(widgetTimer); widgetTimer=setTimeout(()=>window.SamvarNative.syncWidget(widgetSnapshot()),600); }
// A conversation logged through Siri ("log that I called Kate"): match the name, file a quick catch-up.
function applyPendingIntent(it){
  const name=String(it.person||"").trim(); if(!name) return;
  const p=DB.people.find(x=>x.name.toLowerCase()===name.toLowerCase())||fuzzyFind(name);
  const chan=it.kind==="inperson"?"inperson":it.kind==="message"?"message":"call";
  if(p){ DB.interactions.push({id:uid(),ts:+it.ts||Date.now(),personIds:[p.id],depth:1,channel:chan,note:"",place:"",via:"siri"}); delete p.snoozeUntil; saveDB(); renderAll(); }
  else { switchPage("log"); const ta=document.getElementById("logText"); ta.value=`${chan==="call"?"Call":chan==="message"?"Message":"Catch-up"} with ${name} — `; ta.focus(); }
}
switchPage("home");

/* ---------- first-run welcome ---------- */
const CIRCLE_GUIDE=[
  {k:"inner", n:"≈5", who:"the people you'd drop everything for", rhythm:"every week", remind:"two weeks"},
  {k:"invest", n:"≈15", who:"good friends you want to keep building", rhythm:"every month", remind:"about three weeks"},
  {k:"warm", n:"≈50", who:"people you'd hate to lose touch with", rhythm:"every quarter", remind:"about two months"}
];
function circlesHtml(){
  return CIRCLE_GUIDE.map(c=>`<div class="factline" style="font-size:14px;align-items:center"><span class="fk"><i style="display:inline-block;width:12px;height:12px;border-radius:50%;background:var(--ring${CIRCLE_GUIDE.indexOf(c)+1})"></i></span>
    <span><b>${TIERS[c.k].label}</b> · ${c.n} people · ${c.who}. Aim to talk <b>${c.rhythm}</b>; reminders start once it's been ${c.remind}.</span></div>`).join("");
}
function circlesInfoSheet(){
  const dlg=document.createElement("dialog");
  dlg.innerHTML=`<h2 style="font-size:18px;margin-bottom:4px">Your circles</h2>
    <p class="hint" style="margin:0 0 10px">Three circles, three rhythms. Fill them from Contacts and Samvar keeps the rhythm for you.</p>
    ${circlesHtml()}
    <p class="hint" style="margin-top:10px"><b>When reminders start:</b> in the last third of the rhythm — Close from about day 20 of the month, Friendly from about month two of the quarter — except Inner, where they only start once two full weeks have passed. Anyone you've never logged a conversation with can come up straight away. Every conversation you log counts the same, whoever reached out.</p>
    <div style="display:flex;gap:8px;margin-top:12px"><button class="btn small" id="ciDone">Got it</button><button class="btn ghost small" id="ciReplay">Replay the intro</button></div>`;
  document.body.appendChild(dlg); dlg.showModal();
  dlg.querySelector("#ciDone").addEventListener("click",()=>{ dlg.close(); dlg.remove(); });
  dlg.querySelector("#ciReplay").addEventListener("click",()=>{ dlg.close(); dlg.remove(); showIntro(true); });
}
document.getElementById("infoBtn")?.addEventListener("click",circlesInfoSheet);

// First-open walkthrough: circles → logging → suggested messages → start.
function showIntro(force){
  if(!force && (DB.settings.welcomed || DB.people.length || DB.interactions.length)) return;
  const steps=[
    {title:"Build your friendships like your fitness", body:`<p class="hint" style="margin:0 0 10px;font-size:14px">Most of us don’t lose friends on purpose — we just go quiet. Samvar keeps a rhythm going with the people who matter.</p>
      <p class="hint" style="margin:0 0 6px"><b>Step 1 — put your people in circles.</b> Tap <b>People → Add from Contacts</b> and flag each person into a circle:</p>${circlesHtml()}`},
    {title:"Just say what happened", body:`<p class="hint" style="margin:0 0 10px;font-size:14px">After you see someone, open <b>Log</b> and dictate or type a line. Samvar works out who, how, and what's worth remembering.</p>
      <div class="card" style="padding:10px 12px;margin-bottom:8px"><p class="hint" style="margin:0;font-style:italic">“Long lunch with Kate, she's moving to Bristol in March and Iris starts school in September.”</p></div>
      <div class="card" style="padding:10px 12px"><div class="meta"><span class="badge" style="font-size:10px;padding:1px 6px;margin-right:4px">✨ Claude</span>Quality time · In person · today</div>
        <div class="meta" style="color:var(--ink);margin-top:4px">Long lunch, talked about her move to Bristol</div>
        <div class="factline" style="font-size:13px;margin-top:6px"><span class="fk">🏠</span><span>Kate — moving to Bristol in March</span></div>
        <div class="factline" style="font-size:13px"><span class="fk">👨‍👩‍👧</span><span>Kate — daughter Iris starts school in September</span></div>
        <div class="factline" style="font-size:13px"><span class="fk">📅</span><span>Follow-up: ask how the move went</span></div></div>`},
    {title:"The first line, written for you", body:`<p class="hint" style="margin:0 0 10px;font-size:14px">When it's time to reach out, tap <b>✨ Suggest a message</b>. Samvar drafts three openers using everything it knows:</p>
      <div class="factline" style="font-size:14px"><span class="fk">🗂</span><span>Your past conversations and the facts filed from them.</span></div>
      <div class="factline" style="font-size:14px"><span class="fk">💼</span><span>Where they work, if it's in their contact card.</span></div>
      <div class="factline" style="font-size:14px"><span class="fk">📍</span><span>Their <b>address</b> — so it can mention the weather or something happening in their town this week. That's why addresses matter.</span></div>
      <div class="card" style="padding:10px 12px;margin-top:8px"><p class="hint" style="margin:0;font-style:italic">“How's the Bristol move going — drowning in boxes yet? Hope you're surviving the heat down there this week!”</p></div>`},
    {title:"Ready?", body:`<p class="hint" style="margin:0 0 10px;font-size:14px">Every morning Samvar names one person to reach out to, with the buttons to do it. Log it and your streak grows.</p>
      <p class="hint" style="margin:0 0 10px">Free to start — add ${FREE_PEOPLE} people and log ${FREE_LOGS} conversations, then a 7-day free trial. Your data stays on your phone; notes are sent to Samvar AI only to be understood, and never stored.</p>`}
  ];
  let i=0; const dlg=document.createElement("dialog");
  const render=()=>{ const st=steps[i], last=i===steps.length-1;
    dlg.innerHTML=`<div class="hint" style="margin-bottom:6px">${steps.map((_,j)=>`<span style="display:inline-block;width:8px;height:8px;border-radius:50%;margin-right:5px;background:${j===i?"var(--accent)":"var(--ring)"}"></span>`).join("")}</div>
      <h2 style="font-size:20px;letter-spacing:-.02em;margin-bottom:8px">${st.title}</h2>${st.body}
      <div style="display:flex;gap:8px;margin-top:14px">${last?`<button class="btn" id="wGo" style="flex:1">Add my people</button>`:`<button class="btn" id="wNext" style="flex:1">Next</button>`}${i?`<button class="btn ghost small" id="wBack">Back</button>`:`<button class="btn ghost small" id="wSkip">Skip</button>`}</div>
      ${last?`<button class="btn ghost small" id="wImport" style="width:100%;margin-top:8px">I have a backup file</button>`:""}`;
    const done=()=>{ DB.settings.welcomed=true; saveDB(); dlg.close(); dlg.remove(); };
    dlg.querySelector("#wNext")?.addEventListener("click",()=>{ i++; render(); });
    dlg.querySelector("#wBack")?.addEventListener("click",()=>{ i--; render(); });
    dlg.querySelector("#wSkip")?.addEventListener("click",done);
    dlg.querySelector("#wGo")?.addEventListener("click",()=>{ done(); switchPage("people");
      const c=document.getElementById("pickContacts"); if(c&&c.style.display!=="none") c.click(); else document.getElementById("newPersonName").focus(); });
    dlg.querySelector("#wImport")?.addEventListener("click",()=>{ done(); document.getElementById("importFile").click(); });
  };
  document.body.appendChild(dlg); render(); dlg.showModal();
}
showIntro(false);
