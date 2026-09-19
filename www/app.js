"use strict";
/* =====================================================================
   Samvar (formerly Kith) — keep your people close
   All data local on the device.
===================================================================== */

/* ---------- storage (with in-memory fallback for preview mode) ---------- */
const KEY="samvar-data-v1", LEGACY_KEY="kith-data-v1";
let memStore=null;
function migrate(db){
  db.candidates=(db.candidates||[]).map(c=>typeof c==="string"?{name:c}:c);
  db.geo=db.geo||{};
  (db.interactions||[]).forEach(x=>{ if(x.depth>3) x.depth=3; }); // old "Deep" folds into Substantive
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
  inner:{label:"Inner circle", cadence:7,  halflife:14, weight:1.2},   // ~weekly
  invest:{label:"Invest",      cadence:21, halflife:30, weight:1.5},   // every 2-4 weeks
  warm:{label:"Keep warm",     cadence:60, halflife:75, weight:0.7},   // every 1-3 months
  notnow:{label:"Not now",     cadence:0,  halflife:0,  weight:0}
};
const CHANNELS={inperson:{label:"In person",base:10},video:{label:"Video",base:6},call:{label:"Call",base:5},message:{label:"Message",base:2}};
const DEPTHS=[
  {n:1,label:"Logistical",mult:1},
  {n:2,label:"Friendly",mult:2.5},
  {n:3,label:"Substantive",mult:5}
];
const INITS={me:{label:"I did",mult:1.5},mutual:{label:"Planned",mult:1.2},them:{label:"They did",mult:1.0}};
const DAY=86400000;
const uid=()=>Math.random().toString(36).slice(2,10);
const esc=s=>String(s).replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));

/* ---------- scoring engine ---------- */
const GROUP_DISC=[1,.74,.59,.49,.43,.38];
function groupDiscount(n){ if(n<=0) return 1; return n<=6? GROUP_DISC[n-1] : Math.max(.30, .38-.02*(n-6)); }
function interactionPoints(x){
  const base=(CHANNELS[x.channel]?.base||3) * (DEPTHS[x.depth-1]?.mult||2) * (INITS[x.initiator]?.mult||1);
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
    return {k:"critical",label:"no contact yet",color:"var(--critical)"};
  }
  const r=((asOf-l)/DAY)/(t.cadence||60);
  if(r<=0.9) return {k:"good",label:"healthy",color:"var(--good)"};      // inner: quiet until ~day 6
  if(r<=1.8) return {k:"warn",label:"fading",color:"var(--warn)"};
  if(r<=3)   return {k:"serious",label:"at risk",color:"var(--serious)"};
  return {k:"critical",label:"cold",color:"var(--critical)"};
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
  const initMe=xs.filter(x=>x.initiator==="me").length;
  const deepShare = n? xs.filter(x=>x.depth>=3).length/n : 0;
  return {n, initRatio: n? initMe/n : 0, deepShare, xs};
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
  const raw = 100*(0.50*coverage + 0.20*s.deepShare + 0.15*s.initRatio + 0.15*volume);
  return Math.round(raw);
}
function weeklySeries(weeks){
  const now=Date.now(), out=[];
  for(let i=weeks-1;i>=0;i--) out.push({t:now-i*7*DAY, v:connectionScore(now-i*7*DAY)});
  return out;
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
  {re:/\b(deep|meaningful|heart[- ]to[- ]heart|opened up|emotional|vulnerab|really connected|profound|proper|substantive|long (chat|talk|call)|good (long )?(chat|talk|conversation)|advice|talked (about|through)|discussed|career|worri|problem)\b/i, d:3},
  {re:/\b(catch[- ]?up|caught up|social|friendly|drinks|coffee|banter|chat|lunch|dinner|walk)\b/i, d:2},
  {re:/\b(logistic|quick|admin|schedul|transactional|arrang|confirm|brief)\b/i, d:1}
];
const INIT_ME=/\b(i (called|rang|phoned|messaged|texted|emailed|invited|organised|organized|arranged|reached out|suggested|set (it )?up)|my (idea|suggestion|invite)|i initiated)\b/i;
const INIT_THEM=/\b((s?he|they) (called|rang|phoned|messaged|texted|emailed|invited|organised|organized|arranged|reached out|suggested|set (it )?up)|called me|rang me|texted me|messaged me|invited me|reached out to me|(his|her|their) (idea|suggestion|invite))\b/i;
const CHAN_CUES=[
  {re:/\b(dinner|lunch|coffee|drinks|in person|met (up|with)|walk|breakfast|pub|party|came (over|round)|visit)\b/i, c:"inperson"},
  {re:/\b(facetime|zoom|video ?call|teams|meet)\b/i, c:"video"},
  {re:/\b(called|rang|phoned|phone call|spoke on the phone|call with)\b/i, c:"call"},
  {re:/\b(text|whatsapp|message|emailed|email|dm|voice note)\b/i, c:"message"}
];
function parseSegment(seg){
  let depth=2, channel="inperson", initiator="mutual";
  for(const c of DEPTH_CUES){ if(c.re.test(seg)){ depth=c.d; break; } }
  for(const c of CHAN_CUES){ if(c.re.test(seg)){ channel=c.c; break; } }
  if(INIT_ME.test(seg)) initiator="me"; else if(INIT_THEM.test(seg)) initiator="them";
  let ts=Date.now();
  if(/\b(yesterday|last night)\b/i.test(seg)) ts-=DAY;
  return {depth, channel, initiator, ts};
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
function entitled(){ return isPro() || devMode(); }
class QuotaError extends Error{}
async function samvarAI(path, payload){
  const r=await fetch(API_BASE+path,{method:"POST",
    headers:{"content-type":"application/json","authorization":"Bearer "+deviceId()},
    body:JSON.stringify(payload)});
  const plan=r.headers.get("x-samvar-plan");
  if(plan){ DB.settings.pro=Object.assign(DB.settings.pro||{},{active:plan==="pro",checked:Date.now()}); saveDB(); }
  if(r.status===402) throw new QuotaError("quota");
  if(!r.ok){ const e=await r.text().catch(()=>""); throw new Error("Samvar AI "+r.status+(e?": "+e.slice(0,120):"")); }
  return r.json();
}
function paywallSheet(reason){
  const dlg=document.createElement("dialog");
  dlg.innerHTML=`<div style="text-align:center;font-size:34px;padding-top:4px">🌱</div>
    <h2 style="font-size:22px;text-align:center;letter-spacing:-.02em">Try Samvar free for 7 days</h2>
    ${reason?`<p class="hint" style="text-align:center;margin:4px 0 12px;font-size:14px">${esc(reason)}</p>`:""}
    <div class="factline" style="font-size:14px"><span class="fk">✨</span><span><b>Claude reads your notes</b> — several people in one ramble, relative dates, facts worth remembering.</span></div>
    <div class="factline" style="font-size:14px"><span class="fk">💬</span><span><b>Openers written for you</b> from what you actually know about each person.</span></div>
    <div class="factline" style="font-size:14px"><span class="fk">☀️</span><span><b>Daily nudges</b>, birthday radar and streaks.</span></div>
    <div class="factline" style="font-size:14px"><span class="fk">∞</span><span><b>Unlimited</b> people, notes and openers. Everything stays on your phone.</span></div>
    <button class="btn" data-buy="monthly" style="margin-top:14px">Start free trial · monthly</button>
    <button class="btn secondary" data-buy="yearly" style="margin-top:8px">Start free trial · yearly</button>
    <div style="display:flex;gap:8px;margin-top:10px">
      <button class="btn ghost small" id="pwRestore">Restore purchases</button>
      <button class="btn ghost small" id="pwClose">Not now</button></div>
    <p class="hint" style="text-align:center;margin-top:10px">Free for 7 days, then renews automatically unless cancelled. Cancel any time in Settings → Subscriptions; you keep everything until the trial ends.</p>`;
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
 "initiator":"me"|"them"|"mutual",  // from the note-writer's perspective; "mutual" for planned/recurring/unclear
 "depth":1|2|3,  // 1=logistical (admin, scheduling, transactions); 2=friendly (light catch-up, banter, pleasant social contact); 3=substantive (real topics discussed properly — advice, plans, worries, emotions, meaning)
 "channel":"inperson"|"video"|"call"|"message",
 "date":"YYYY-MM-DD",  // resolve 'yesterday', 'last night', 'this morning', weekday names, relative to today's date given
 "place":"place mentioned in the note (restaurant, area, town) or empty string",
 "summary":"<12 words capturing the interaction",
 "facts":[{"person":"Name","fact":"short durable fact worth remembering before next contacting them","kind":"family"|"likes"|"plans"|"work"|"date"|"other"}]}
Facts are the CRM layer and the most valuable output — be GENEROUS. If the note contains ANY personal detail about someone (family members and their names, partner, pets, likes and dislikes, plans, trips, upcoming events, job or house moves, things they're worried about or celebrating, things to ask about next time), you MUST capture it: aim for 1–3 facts per interaction. Write each fact so it stands alone ("daughter Iris starting secondary school in September"). Use the known person's name in "person" even when the note says "she"/"his wife" — attribute to whoever the interaction is with. Only return an empty array when the note is purely logistical with zero personal content.
ALWAYS capture birthdays, anniversaries and other recurring personal dates as kind "date", converting relative mentions into the actual calendar date using today's date: "it was her birthday yesterday" on 19 August → {"fact":"birthday 18 August","kind":"date"}. A birthday is never trivia.
The note is usually dictated speech-to-text, so names are often mis-transcribed. If a name is phonetically or visually close to someone on the known-people list ("Sara"/"Serra"→Sarah, "Tomm"→Tom, "Jaymes"→James), treat it as that known person and return the known spelling in "people". Only put a name in "new_people" if it clearly is not a known person.
Judge depth by substance, not length. Group chat/likes count as "message". If genuinely no interaction is described, return [].`;
/* ---------- places & geocoding (OpenStreetMap Nominatim, no key, 1 req/sec, cached) ---------- */
let geoQueue=Promise.resolve();
function nominatim(url){
  const run=()=>new Promise(res=>setTimeout(res,1100))
    .then(()=>fetch(url,{headers:{"Accept":"application/json"}}))
    .then(r=>r&&r.ok?r.json():null).catch(()=>null);
  const p=geoQueue.then(run); geoQueue=p.catch(()=>{}); return p;
}
function shortPlace(dn){ return String(dn||"").split(",").map(s=>s.trim()).slice(0,2).join(", "); }
async function geocode(addr){
  const key=addr.trim().toLowerCase(); if(!key) return null;
  if(key in DB.geo && DB.geo[key]!==null) return DB.geo[key]; // cache hits only; failures are retried
  const j=await nominatim("https://nominatim.openstreetmap.org/search?format=json&limit=1&q="+encodeURIComponent(addr));
  const hit=(j&&j[0])?{lat:+j[0].lat,lon:+j[0].lon,label:shortPlace(j[0].display_name)}:null;
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
      initiator:INITS[o.initiator]?o.initiator:"mutual",
      depth:Math.min(3,Math.max(1,+o.depth||2)),
      channel:CHANNELS[o.channel]?o.channel:"inperson", ts};
  });
}

/* ---------- charts (dataviz spec: thin marks, 2px line, hover layer) ---------- */
const tooltip=document.getElementById("tooltip");
function showTip(html,x,y){ tooltip.innerHTML=html; tooltip.style.display="block";
  const r=tooltip.getBoundingClientRect();
  tooltip.style.left=Math.min(innerWidth-r.width-8,Math.max(8,x-r.width/2))+"px";
  tooltip.style.top=(y-r.height-14)+"px"; }
function hideTip(){ tooltip.style.display="none"; }

function sparkline(el, series){
  if(!series.length){ el.innerHTML=""; return; }
  const W=220,H=56,P=6;
  const vs=series.map(d=>d.v), min=Math.min(...vs,0), max=Math.max(...vs,10);
  const x=i=>P+(W-2*P)*i/(series.length-1||1);
  const y=v=>H-P-(H-2*P)*((v-min)/((max-min)||1));
  const pts=series.map((d,i)=>`${x(i)},${y(d.v)}`).join(" ");
  const last=series[series.length-1];
  el.innerHTML=`<svg viewBox="0 0 ${W} ${H}" width="100%" style="touch-action:none">
    <line x1="${P}" y1="${H-P}" x2="${W-P}" y2="${H-P}" stroke="var(--baseline)" stroke-width="1"/>
    <polyline points="${pts}" fill="none" stroke="var(--accent)" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>
    <circle cx="${x(series.length-1)}" cy="${y(last.v)}" r="3.5" fill="var(--accent)" stroke="var(--tint-lav)" stroke-width="2"/>
    <text x="${W-P}" y="10" text-anchor="end" font-size="10" fill="var(--muted)">12 wks</text>
  </svg>`;
  const svg=el.querySelector("svg");
  const handle=ev=>{
    const t=ev.touches?ev.touches[0]:ev;
    const rect=svg.getBoundingClientRect();
    const i=Math.max(0,Math.min(series.length-1,Math.round((t.clientX-rect.left)/rect.width*(series.length-1))));
    const d=series[i];
    showTip(`<b>${d.v}</b> · ${new Date(d.t).toLocaleDateString(undefined,{day:"numeric",month:"short"})}`, t.clientX, rect.top);
  };
  svg.addEventListener("pointermove",handle);
  svg.addEventListener("touchmove",handle,{passive:true});
  svg.addEventListener("pointerleave",hideTip);
  svg.addEventListener("touchend",hideTip);
}

function depthMixBar(el, legendEl){
  const s=windowStats(Date.now(),30);
  const counts=[0,0,0];
  s.xs.forEach(x=>counts[Math.min(3,x.depth)-1]++);
  const total=counts.reduce((a,b)=>a+b,0);
  if(!total){ el.innerHTML=`<div class="empty" style="padding:10px">No interactions logged in the last 30 days yet.</div>`; legendEl.innerHTML=""; return; }
  const colors=["var(--d1)","var(--d2)","var(--d3)"];
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
    <div class="fld"><label>Who initiated</label><div class="seg" data-eset="initiator">
      ${Object.entries(INITS).map(([k,v])=>`<button data-v="${k}" class="${x.initiator===k?"on":""}">${v.label}</button>`).join("")}</div></div>
    <div class="fld"><label>Richness</label><div class="seg" data-eset="depth">
      ${DEPTHS.map(v=>`<button data-v="${v.n}" class="${x.depth===v.n?"on":""}">${v.label}</button>`).join("")}</div></div>
    <div class="fld"><label>Channel</label><div class="seg" data-eset="channel">
      ${Object.entries(CHANNELS).map(([k,v])=>`<button data-v="${k}" class="${x.channel===k?"on":""}">${v.label}</button>`).join("")}</div></div>
    <div class="fld"><label>Where</label><div style="display:flex;gap:8px">
      <input type="text" id="ewhere" value="${esc(x.place||"")}" placeholder="place (optional)">
      <button class="btn ghost small" id="egps">📍</button></div></div>
    <div class="fld"><label>When</label><input type="date" id="edate" value="${localDate(x.ts)}"></div>
    <div style="display:flex;gap:8px">
      <button class="btn small" id="esave">Save changes</button>
      <button class="btn ghost small" id="ecancel">Cancel</button></div>`;
  document.body.appendChild(dlg); dlg.showModal();
  const draft={personIds:[...x.personIds],initiator:x.initiator,depth:x.depth,channel:x.channel,ts:x.ts,place:x.place||"",loc:x.loc};
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
    Object.assign(x,draft); saveDB(); dlg.close(); dlg.remove(); renderAll();
  });
  dlg.querySelector("#ecancel").addEventListener("click",()=>{ dlg.close(); dlg.remove(); });
}

/* ---------- weekly goal & streak ---------- */
function weekGoal(){ return DB.settings.weekGoal||3; } // meaningful (substantive) conversations per week
function weekStart(ts){ const d=new Date(ts); const dow=(d.getDay()+6)%7; d.setHours(0,0,0,0); return d.getTime()-dow*DAY; }
function meaningfulCount(ws){ return DB.interactions.filter(x=>x.ts>=ws && x.ts<ws+7*DAY && x.depth>=3).length; }
function streakData(){
  const G=weekGoal(), nowWs=weekStart(Date.now());
  const cur=meaningfulCount(nowWs);
  let past=0, ws=nowWs-7*DAY;
  while(meaningfulCount(ws)>=G && past<520){ past++; ws-=7*DAY; }
  return {cur, done:cur>=G, streak:past+(cur>=G?1:0)};
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
function contactBtns(p, small){
  const t=telDigits(p.tel); if(!t) return "";
  const wa=t.startsWith("+")?`<a class="btn ghost small" href="https://wa.me/${t.slice(1)}" target="_blank" rel="noopener">🟢</a>`:"";
  return `<a class="btn small" href="tel:${t}">📞</a><a class="btn ghost small" href="sms:${t}">💬</a>${wa}`;
}

/* ---------- rendering ---------- */
function initials(name){ return name.split(/\s+/).slice(0,2).map(w=>w[0]||"").join("").toUpperCase(); }
const AV_COLORS=["#cfe0f7","#f9ddc9","#d5eedd","#f3d9e5","#e6e0f7","#f7ecc8"];
function avColor(name){ let h=0; for(const c of String(name)) h=(h*31+c.charCodeAt(0))>>>0; return AV_COLORS[h%AV_COLORS.length]; }
function av(name){ return `<div class="avatar" style="background:${avColor(name)}">${esc(initials(name))}</div>`; }
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
  const steps=[
    {done:DB.people.length>=3, text:"Add the 3–5 people who matter most", go:"people"},
    {done:DB.interactions.length>0, text:"Log one conversation — just describe it", go:"log"},
    {done:!!DB.settings.nudgeSet, text:"Choose when Samvar nudges you", go:"settings"}
  ];
  if(steps.every(s=>s.done)){ el.innerHTML=""; return; }
  el.innerHTML=`<div class="card t-sky">
    <div class="lbl" style="font-size:12px;color:var(--ink-2);font-weight:600;text-transform:uppercase;letter-spacing:.05em">Getting started</div>
    ${steps.map(s=>`<div class="why" style="margin-top:10px;display:flex;gap:10px;align-items:center;font-size:14px">
      <span>${s.done?"✅":"◯"}</span>
      <span style="flex:1;${s.done?"text-decoration:line-through;color:var(--muted)":""}">${s.text}</span>
      ${s.done?"":`<button class="btn small" data-go="${s.go}">Go</button>`}</div>`).join("")}
  </div>`;
  el.querySelectorAll("[data-go]").forEach(b=>b.addEventListener("click",()=>switchPage(b.dataset.go)));
}
let showAllSugg=false;
function renderHome(){
  const now=Date.now();
  renderOnboard();
  // weekly goal & streak
  const G=weekGoal(), g=streakData();
  const dots=Array.from({length:G},(_,i)=>`<i class="${i<g.cur?"on":""}">${i<g.cur?"✓":""}</i>`).join("");
  document.getElementById("goalCard").innerHTML=`
    <div class="lbl" style="font-size:12px;color:var(--ink-2);font-weight:600;text-transform:uppercase;letter-spacing:.05em">This week — meaningful conversations</div>
    <div class="goal-dots">${dots}</div>
    <div class="streak">${g.done
      ? `✓ Week closed! Streak: <b>${g.streak} week${g.streak===1?"":"s"}</b> 🔥`
      : `${g.cur} of ${G} — ${G-g.cur} more substantive conversation${G-g.cur===1?"":"s"} to keep the streak${g.streak?` (currently ${g.streak} 🔥)`:""}`}</div>`;
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
  sparkline(document.getElementById("sparkWrap"), DB.interactions.length?weeklySeries(12):[]);
  renderRings();

  renderReflection();
  // reach out today: top 3 nudges by urgency, expandable to all
  const att=document.getElementById("homeAttention"), more=document.getElementById("suggMore");
  const list=nudges();
  const shown=showAllSugg?list:list.slice(0,3);
  att.innerHTML=shown.length?shown.map(nudgeCard).join(""):
    `<div class="card empty">Everyone’s in rhythm — nice. Nudges appear here when someone has gone quiet longer than their circle’s rhythm.</div>`;
  bindNudgeButtons(att);
  more.innerHTML=list.length>3?`<button class="btn ghost small" id="suggToggle" style="margin:0 0 12px">${showAllSugg?"Show fewer":`See all ${list.length}`}</button>`:"";
  more.querySelector("#suggToggle")?.addEventListener("click",()=>{ showAllSugg=!showAllSugg; renderHome(); });

  const rec=document.getElementById("homeRecent");
  const xs=[...DB.interactions].sort((a,b)=>b.ts-a.ts).slice(0,6);
  rec.innerHTML=xs.length?xs.map(x=>{
    const names=x.personIds.map(id=>DB.people.find(p=>p.id===id)?.name||"(removed)").join(", ");
    return `<div class="person">${av(names)}
      <div><div class="nm">${esc(names||"(no one tagged)")}</div>
      <div class="meta">${DEPTHS[x.depth-1].label} · ${CHANNELS[x.channel].label} · ${INITS[x.initiator].label} · ${fmtAgo(x.ts)}${x.place?` · 📍 ${esc(x.place)}`:""}</div></div>
      <div class="spacer"></div><span class="badge">+${Math.round(interactionPoints(x))}</span><button class="xdel" data-edit="${x.id}">✎</button><button class="xdel" data-x="${x.id}">✕</button></div>`;
  }).join(""):`<div class="empty">Your logged interactions appear here.</div>`;
  rec.querySelectorAll("[data-edit]").forEach(b=>b.addEventListener("click",()=>editInteraction(b.dataset.edit)));
  rec.querySelectorAll("[data-x]").forEach(b=>b.addEventListener("click",()=>{
    if(confirm("Delete this interaction? Scores recalculate immediately.")){
      DB.interactions=DB.interactions.filter(i=>i.id!==b.dataset.x); saveDB(); renderAll();
    }
  }));
}

function suggestions(){
  const now=Date.now(), out=[];
  for(const p of DB.people){
    const t=TIERS[p.tier]; if(!t||!t.cadence) continue;
    if(p.snoozeUntil && p.snoozeUntil>now) continue;
    const last=lastContact(p,now);
    const days=last?(now-last)/DAY:(p.added?(now-p.added)/DAY:999); // new people get a grace period
    const overdue=days/t.cadence;
    if(overdue<1) continue;
    out.push({p, last, days:Math.round(days), urgency:overdue*t.weight});
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
  const yourTurn=core.find(p=>{ const xs=history(p); return xs.length>=2 && xs[0].initiator==="them" && xs[1].initiator==="them"; });
  if(yourTurn) out.push({kind:"yourturn", key:"yourturn:"+yourTurn.id, p:yourTurn, urgency:0.9,
    why:`${esc(capName(yourTurn))} reached out the last two times — your turn to initiate.`});
  const deepen=core.find(p=>{ const xs=history(p).slice(0,3); return xs.length===3 && xs.every(x=>x.depth<=2); });
  if(deepen) out.push({kind:"deepen", key:"deepen:"+deepen.id, p:deepen, urgency:0.7,
    why:`Your last three chats with ${esc(capName(deepen))} were light. Make the next one count — ask about something that matters to them.`});
  for(const p of DB.people){
    const n=history(p).filter(x=>now-x.ts<=60*DAY).length;
    if(p.tier==="warm" && n>=3) out.push({kind:"promote", key:"promote:"+p.id, p, to:"invest", urgency:0.6,
      why:`You've seen ${esc(capName(p))} ${n} times in two months — more than a Keep-warm rhythm. Move to Invest?`});
    else if(p.tier==="invest" && n>=6) out.push({kind:"promote", key:"promote:"+p.id, p, to:"inner", urgency:0.6,
      why:`${esc(capName(p))} is in your life almost weekly. Inner circle?`});
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
  return out.filter(n=>!dismissed(n.key)).sort((a,b)=>b.urgency-a.urgency);
}
const KIND_LABEL={yourturn:"Your turn",deepen:"Go deeper",promote:"Closer than you think",introduce:"Introduce"};
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
  const facts=(["overdue","yourturn","deepen"].includes(n.kind) && (p.facts||[]).length)
    ?`<div class="why">💡 ${p.facts.slice(-2).map(f=>esc(f.f)).join(" · ")}</div>`:"";
  let row;
  if(n.kind==="promote") row=`<button class="btn small" data-act="promote" data-to="${n.to}">Move to ${TIERS[n.to].label}</button>
      <button class="btn ghost small" data-act="dismiss" data-days="60">Keep as is</button>`;
  else if(n.kind==="introduce") row=`<button class="btn small" data-act="opener">✨ Suggest it to ${esc(capName(p))}</button>
      <button class="btn ghost small" data-act="dismiss" data-days="30">Not now</button>`;
  else row=`${contactBtns(p)}<button class="btn ${p.tel?"ghost ":""}small" data-act="opener">✨ Opener</button>
      <button class="btn ghost small" data-act="log">✓ Log it</button>
      <button class="btn ghost small" data-act="${n.kind==="overdue"?"snooze":"dismiss"}" data-days="14">${n.kind==="overdue"?"Snooze":"Not now"}</button>`;
  return `<div class="sugg" data-pid="${p.id}" data-key="${n.key}" data-kind="${n.kind}"${n.q?` data-qid="${n.q.id}"`:""}>
    ${head}<div class="why">${why}</div>${facts}<div class="row">${row}</div></div>`;
}
function bindNudgeButtons(root){
  root.querySelectorAll(".sugg").forEach(card=>{
    const p=DB.people.find(x=>x.id===card.dataset.pid); if(!p) return;
    const q=card.dataset.qid?DB.people.find(x=>x.id===card.dataset.qid):null;
    card.querySelectorAll("button[data-act]").forEach(b=>b.addEventListener("click",()=>{
      const act=b.dataset.act;
      if(act==="log"){ switchPage("log");
        const ta=document.getElementById("logText"); ta.value=`With ${p.name}, I reached out — `; ta.focus(); }
      if(act==="snooze"){ p.snoozeUntil=Date.now()+7*DAY; saveDB(); renderAll(); }
      if(act==="dismiss"){ dismiss(card.dataset.key,+b.dataset.days||14); renderAll(); }
      if(act==="promote"&&TIERS[b.dataset.to]){ p.tier=b.dataset.to; saveDB(); renderAll(); }
      if(act==="opener"){ if(!entitled()){ paywallSheet("Openers are part of Samvar — start your free trial."); return; } openerSheet(p,{q, deepen:card.dataset.kind==="deepen"}); }
    }));
  });
}

/* ---------- drafted openers ---------- */
const OPENER_SYSTEM=`You write short, warm, natural opening messages someone can send to a friend they want to stay close to.
Return ONLY a JSON array of 3 strings. Each is at most 25 words, British English, casual, and sounds like a real text from a friend — no "hope this finds you well", no sign-offs, no hashtags, emojis only if natural.
Use the supplied facts to be specific and caring; never invent facts. Vary the three: one picks up on a fact, one proposes a concrete plan, one is light and easy to reply to.`;
async function aiOpeners(p,opts){
  const xs=DB.interactions.filter(x=>x.personIds.includes(p.id)).sort((a,b)=>b.ts-a.ts).slice(0,3);
  const intent=opts.q?`Intent: suggest that the three of us (me, ${p.name} and ${opts.q.name}) get together soon.`
    :opts.deepen?"Intent: go beyond logistics — ask about something that genuinely matters to them.":"";
  const brief={name:p.name, tier:TIERS[p.tier].label,
    last:xs[0]?fmtAgo(xs[0].ts)+" — "+(xs[0].note||DEPTHS[xs[0].depth-1].label):"never logged",
    recent:xs.slice(1).map(x=>`${fmtAgo(x.ts)}: ${x.note||DEPTHS[x.depth-1].label}`).join("; ")||"none",
    facts:(p.facts||[]).map(f=>f.f).join("; ")||"nothing specific", intent};
  let arr;
  if(getApiKey()){
    const out=await claudeCall(OPENER_SYSTEM,
      `Friend: ${brief.name} (${brief.tier}).\nLast contact: ${brief.last}.\nRecent: ${brief.recent}.\nThings I know about them: ${brief.facts}.\n${brief.intent}`, 600);
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
  DB.interactions.push({id:uid(),ts:Date.now(),personIds:[p.id],initiator:"me",depth:2,channel:"message",note:text.slice(0,120),place:""});
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
  catch(e){ if(e instanceof QuotaError){ dlg.close(); dlg.remove(); paywallSheet("Your trial or subscription has ended — renew to keep the openers."); return; } }
  render(ruleOpeners(p,opts),"rule");
}

/* ---------- weekly reflection (shown Sunday & Monday) ---------- */
function renderReflection(){
  const el=document.getElementById("reflect"), dow=new Date().getDay();
  if(dow!==0 && dow!==1){ el.innerHTML=""; return; }
  const ws=dow===0?weekStart(Date.now()):weekStart(Date.now()-7*DAY), key="reflect:"+ws;
  const xs=DB.interactions.filter(x=>x.ts>=ws && x.ts<ws+7*DAY);
  if(dismissed(key) || !xs.length){ el.innerHTML=""; return; }
  const meaningful=xs.filter(x=>x.depth>=3).length, mine=xs.filter(x=>x.initiator==="me").length;
  const counts={}; xs.forEach(x=>x.personIds.forEach(id=>{ counts[id]=(counts[id]||0)+1; }));
  const topId=Object.keys(counts).sort((a,b)=>counts[b]-counts[a])[0], top=DB.people.find(p=>p.id===topId);
  const people=Object.keys(counts).length;
  el.innerHTML=`<div class="card t-mint">
    <div class="lbl" style="font-size:12px;color:var(--ink-2);font-weight:600;text-transform:uppercase;letter-spacing:.05em">${dow===0?"This week":"Last week"} in review</div>
    <div style="font-size:15px;margin-top:6px;line-height:1.5"><b>${xs.length}</b> conversation${xs.length===1?"":"s"} with <b>${people}</b> ${people===1?"person":"people"} · <b>${meaningful}</b> meaningful · you started <b>${mine}</b>${top?` · most time with <b>${esc(capName(top))}</b>`:""}</div>
    <div class="why" style="margin-top:6px">${meaningful>=weekGoal()?"Goal hit 🔥 ":""}${mine/xs.length<0.4?"Try initiating a couple more next week.":"Good balance of initiating."}</div>
    <button class="btn ghost small" id="reflectOk" style="margin-top:10px">Got it</button></div>`;
  el.querySelector("#reflectOk").addEventListener("click",()=>{ dismiss(key,8); renderAll(); });
}

/* ---------- nudge notification text & schedule (used by the native shell) ---------- */
const NUDGE_DAYS={daily:[0,1,2,3,4,5,6],weekdays:[1,2,3,4,5],"3x":[1,3,5],weekly:[1],off:[]};
function nudgeText(){
  const parts=[];
  for(const b of upcomingBirthdays(3)) parts.push(`🎂 ${capName(b.p)}'s birthday ${b.days===0?"today":b.days===1?"tomorrow":"in "+b.days+" days"}`);
  for(const n of nudges().slice(0,2)){
    if(n.kind==="overdue") parts.push(n.last?`${capName(n.p)} is ${healthOfP(n.p,Date.now()).label} — last ${fmtAgo(n.last)}`:`Still no contact with ${capName(n.p)}`);
    else if(n.kind==="yourturn") parts.push(`Your turn to reach out to ${capName(n.p)}`);
    else if(n.kind==="deepen") parts.push(`Go deeper with ${capName(n.p)} this time`);
    else if(n.kind==="introduce") parts.push(`Get ${capName(n.p)} and ${capName(n.q)} together`);
  }
  const g=streakData(), G=weekGoal();
  if(!parts.length) parts.push(g.done?`Week's goal done — streak ${g.streak} 🔥`:`${G-g.cur} meaningful conversation${G-g.cur===1?"":"s"} to go this week`);
  return {title:"Samvar", body:parts.slice(0,3).join(" · ")};
}
function nextNudgeTimes(count){
  const days=NUDGE_DAYS[DB.settings.nudgeFreq||"daily"]||[]; if(!days.length) return [];
  const [hh,mm]=(DB.settings.nudgeTime||"09:00").split(":").map(Number);
  const out=[], d=new Date(); d.setHours(hh,mm,0,0);
  if(d.getTime()<=Date.now()) d.setDate(d.getDate()+1);
  while(out.length<count){ if(days.includes(d.getDay())) out.push(d.getTime()); d.setDate(d.getDate()+1); }
  return out;
}
function renderInsights(){
  const s=windowStats(Date.now(),30);
  document.getElementById("initVal").textContent=s.n?Math.round(100*s.initRatio)+"%":"–";
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
  document.getElementById("devCard").style.display=devMode()?"block":"none";
  const G=weekGoal();
  document.querySelectorAll("#goalSeg button").forEach(b=>b.classList.toggle("on",+b.dataset.g===G));
  document.querySelectorAll("#nudgeSeg button").forEach(b=>b.classList.toggle("on",b.dataset.nf===(DB.settings.nudgeFreq||"daily")));
  document.getElementById("nudgeTime").value=DB.settings.nudgeTime||"09:00";
}
function renderTriage(){
  document.getElementById("triageWrap").style.display=DB.candidates.length?"block":"none";
  const tl=document.getElementById("triageList");
  tl.innerHTML=DB.candidates.length?DB.candidates.slice(0,8).map(c=>`
    <div class="card" data-cand="${esc(c.name)}" style="padding:12px 14px">
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:8px">
        ${av(c.name)}<div><div class="nm" style="font-weight:700">${esc(c.name)}</div>${c.addr?`<div class="meta">📍 ${esc(c.addr)}</div>`:""}</div></div>
      <div class="seg">
        ${Object.entries(TIERS).map(([k,t])=>`<button data-tier="${k}">${t.label}</button>`).join("")}
        <button data-tier="skip">✕ Skip</button>
      </div></div>`).join("")+(DB.candidates.length>8?`<p class="hint">${DB.candidates.length-8} more to file…</p>`:"")
    :"";
  tl.querySelectorAll("[data-cand]").forEach(card=>{
    const name=card.dataset.cand;
    card.querySelectorAll("button").forEach(b=>b.addEventListener("click",()=>{
      const cand=DB.candidates.find(c=>c.name===name);
      if(b.dataset.tier!=="skip" && !entitled()){ paywallSheet("Start your free trial to add people."); return; }
      DB.candidates=DB.candidates.filter(c=>c.name!==name);
      if(b.dataset.tier!=="skip") DB.people.push({id:uid(),name,tier:b.dataset.tier,aliases:[],added:Date.now(),addr:cand?.addr,loc:cand?.loc,tel:cand?.tel});
      saveDB(); renderAll();
    }));
  });
}
function renderPeople(){
  const el=document.getElementById("peopleList");
  const order=["inner","invest","warm","notnow"];
  let html="";
  for(const k of order){
    const ppl=DB.people.filter(p=>p.tier===k).sort((a,b)=>a.name.localeCompare(b.name));
    if(!ppl.length) continue;
    html+=`<div class="sect">${TIERS[k].label} · ${ppl.length}</div><div class="card">`;
    html+=ppl.map(p=>{
      const h=healthOfP(p,Date.now()), last=lastContact(p,Date.now());
      return `<div class="person" data-pid="${p.id}">
        ${av(p.name)}
        <div><div class="nm">${esc(p.name)}</div><div class="meta">last: ${fmtAgo(last)}</div></div>
        <div class="spacer"></div>
        ${k!=="notnow"?`<span class="status" style="color:${h.color}"><i style="background:${h.color}"></i>${h.label}</span>`:""}
      </div>`;
    }).join("");
    html+=`</div>`;
  }
  el.innerHTML=html||`<div class="card empty">Add the people who matter — start with your inner circle (≈5) and the people you want to invest in.</div>`;
  el.querySelectorAll(".person").forEach(row=>row.addEventListener("click",()=>personSheet(row.dataset.pid)));
}
function personSheet(pid){
  const p=DB.people.find(x=>x.id===pid); if(!p) return;
  const xs=DB.interactions.filter(x=>x.personIds.includes(pid)).sort((a,b)=>b.ts-a.ts);
  const dlg=document.createElement("dialog");
  dlg.innerHTML=`<h2 style="font-size:18px;margin-bottom:4px">${esc(p.name)}</h2>
    <div class="fld"><label>Circle</label><div class="seg">${Object.entries(TIERS).map(([k,t])=>`<button data-tier="${k}" class="${p.tier===k?"on":""}">${t.label}</button>`).join("")}</div></div>
    <div class="fld"><label>Phone</label><div style="display:flex;gap:8px;align-items:center">
      <input type="tel" id="ptel" value="${esc(p.tel||"")}" placeholder="+44 7…">
      <button class="btn small" id="ptelSave">Save</button></div>
      ${p.tel?`<div style="display:flex;gap:8px;margin-top:8px">${contactBtns(p)}</div>`:`<div class="hint">Add a number to get one-tap Call / Text buttons here and on suggestions.</div>`}</div>
    <div class="fld"><label>Address / area</label><div style="display:flex;gap:8px">
      <input type="text" id="paddr" value="${esc(p.addr||"")}" placeholder="e.g. Clapham SW4, or Zurich">
      <button class="btn small" id="paddrSave">Save</button></div>
      <div class="hint" id="paddrStatus">${p.loc?"📍 on the map":(p.addr?"not mapped yet — run “Put contacts on the map” in the You tab":"powers place search and “near me”")}</div></div>
    <div class="sect" style="margin-top:8px">Worth remembering</div>
    <div id="factList">${(p.facts&&p.facts.length)?[...p.facts].reverse().map((f,i)=>
      `<div class="factline"><span class="fk">${KIND_EMOJI[f.kind]||"📝"}</span><span>${esc(f.f)}</span><button data-fdel="${p.facts.length-1-i}">✕</button></div>`).join("")
      :`<div class="empty" style="padding:8px">Nothing yet — mention things in your notes (kids, plans, likes) and Claude files them here.</div>`}</div>
    <div style="display:flex;gap:8px;margin-top:8px">
      <input type="text" id="factAdd" placeholder="Add something to remember…">
      <button class="btn small" id="factAddBtn">Add</button></div>
    <div class="sect" style="margin-top:12px">History</div>
    ${xs.length?xs.slice(0,20).map(x=>`<div class="person"><div><div class="nm" style="font-size:14px">${DEPTHS[x.depth-1].label} · ${CHANNELS[x.channel].label}</div>
      <div class="meta">${INITS[x.initiator].label} · ${fmtAgo(x.ts)}${x.place?` · 📍 ${esc(x.place)}`:""}${x.note?` — ${esc(x.note.slice(0,90))}`:""}</div></div>
      <div class="spacer"></div><button class="xdel" data-xedit="${x.id}">✎</button><button class="xdel" data-xdel="${x.id}">✕</button></div>`).join("")
      :`<div class="empty">No interactions logged yet.</div>`}
    <div style="display:flex;gap:8px;margin-top:12px">
      <button class="btn small" id="dlgClose">Done</button>
      <button class="btn danger small" id="dlgDel">Remove person</button></div>`;
  document.body.appendChild(dlg); dlg.showModal();
  dlg.querySelectorAll("[data-tier]").forEach(b=>b.addEventListener("click",()=>{ p.tier=b.dataset.tier; saveDB(); dlg.close(); dlg.remove(); renderAll(); }));
  dlg.querySelectorAll("[data-fdel]").forEach(b=>b.addEventListener("click",()=>{
    p.facts.splice(+b.dataset.fdel,1); saveDB(); dlg.close(); dlg.remove(); personSheet(pid);
  }));
  dlg.querySelector("#ptelSave").addEventListener("click",()=>{
    p.tel=dlg.querySelector("#ptel").value.trim()||undefined;
    saveDB(); dlg.close(); dlg.remove(); personSheet(pid);
  });
  dlg.querySelector("#paddrSave").addEventListener("click",async ()=>{
    const v=dlg.querySelector("#paddr").value.trim();
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
  dlg.querySelectorAll("[data-xedit]").forEach(b=>b.addEventListener("click",()=>{
    dlg.close(); dlg.remove(); editInteraction(b.dataset.xedit);
  }));
  dlg.querySelectorAll("[data-xdel]").forEach(b=>b.addEventListener("click",()=>{
    if(confirm("Delete this interaction? Scores recalculate immediately.")){
      DB.interactions=DB.interactions.filter(i=>i.id!==b.dataset.xdel);
      saveDB(); renderAll(); dlg.close(); dlg.remove(); personSheet(pid);
    }
  }));
  dlg.querySelector("#dlgClose").addEventListener("click",()=>{ dlg.close(); dlg.remove(); });
  dlg.querySelector("#dlgDel").addEventListener("click",()=>{ if(confirm(`Remove ${p.name}? Their logged interactions stay but untagged.`)){ DB.people=DB.people.filter(x=>x.id!==pid); saveDB(); dlg.close(); dlg.remove(); renderAll(); }});
}
function askTier(name, cb){
  if(!entitled()){ paywallSheet("Start your free trial to add people."); return; }
  const dlg=document.createElement("dialog");
  dlg.innerHTML=`<h2 style="font-size:17px">Which circle is ${esc(name)} in?</h2>
    <div class="seg" style="margin-top:12px">${Object.entries(TIERS).map(([k,t])=>`<button data-tier="${k}">${t.label}</button>`).join("")}</div>
    <p class="hint">Inner ≈ your closest ~5 · Invest = actively building · Keep warm = don’t lose touch · Not now = tracked but no nudges.</p>`;
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
      <div class="fld"><label>Who initiated</label><div class="seg" data-set="initiator" data-di="${di}">
        ${Object.entries(INITS).map(([k,v])=>`<button data-v="${k}" class="${d.initiator===k?"on":""}">${v.label}</button>`).join("")}</div></div>
      <div class="fld"><label>Richness</label><div class="seg" data-set="depth" data-di="${di}">
        ${DEPTHS.map(v=>`<button data-v="${v.n}" class="${d.depth===v.n?"on":""}">${v.label}</button>`).join("")}</div></div>
      <div class="fld"><label>Channel</label><div class="seg" data-set="channel" data-di="${di}">
        ${Object.entries(CHANNELS).map(([k,v])=>`<button data-v="${k}" class="${d.channel===k?"on":""}">${v.label}</button>`).join("")}</div></div>
      ${(d.facts&&d.facts.length)?`<div class="fld"><label>Will remember</label>${d.facts.map((f,fi)=>
        `<div class="factline"><span class="fk">${KIND_EMOJI[f.kind]}</span><span><b>${esc(f.person)}</b> — ${esc(f.fact)}</span><button data-di="${di}" data-frm="${fi}">✕</button></div>`).join("")}</div>`:""}
      <div class="fld"><label>Where</label><div style="display:flex;gap:8px">
        <input type="text" data-where="${di}" value="${esc(d.place||"")}" placeholder="place (optional)">
        <button class="btn ghost small" data-gps="${di}" title="Use my location">📍</button></div></div>
      <div class="fld"><label>When</label><input type="date" data-date="${di}" value="${localDate(d.ts)}"></div>
      <div style="display:flex;gap:8px">
        <button class="btn" data-save="${di}">Save · +${Math.round(interactionPoints(d))} pts${d.personIds.length>1?" each":""}</button>
        <button class="btn ghost small" data-discard="${di}">Discard</button></div>
    </div>`;
  }).join("");
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
    DB.interactions.push({id:uid(),ts:d.ts,personIds:d.personIds,initiator:d.initiator,depth:d.depth,channel:d.channel,note:d.note,place:d.place||"",loc:d.loc});
    // attach remembered facts to their people (fuzzy names; fall back to the tagged person)
    for(const f of (d.facts||[])){
      let p=DB.people.find(x=>x.name.toLowerCase()===f.person.toLowerCase()
        || nameTokens(x.name)[0]===f.person.toLowerCase()
        || (x.aliases||[]).some(a=>a.toLowerCase()===f.person.toLowerCase()));
      if(!p) p=fuzzyFind(f.person);
      if(!p && d.personIds.length===1) p=DB.people.find(x=>x.id===d.personIds[0]);
      if(p){ p.facts=p.facts||[];
        if(!p.facts.some(x=>x.f.toLowerCase()===f.fact.toLowerCase())) p.facts.push({f:f.fact,kind:f.kind,ts:d.ts}); }
    }
    // clear snoozes for these people
    d.personIds.forEach(id=>{const p=DB.people.find(x=>x.id===id); if(p) delete p.snoozeUntil;});
    drafts.splice(+b.dataset.save,1);
    saveDB(); renderDrafts(); renderAll();
    window.SamvarNative?.haptic("success"); window.SamvarNative?.scheduleNudges();
    if(!drafts.length){ document.getElementById("logText").value=""; switchPage("home"); }
  }));
  el.querySelectorAll("[data-discard]").forEach(b=>b.addEventListener("click",()=>{ drafts.splice(+b.dataset.discard,1); renderDrafts(); }));
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
    if(e instanceof QuotaError) paywallSheet("Your trial or subscription has ended — this note was filed with the simple rules instead.");
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
document.querySelectorAll("#goalSeg button").forEach(b=>b.addEventListener("click",()=>{ DB.settings.weekGoal=+b.dataset.g; saveDB(); renderAll(); }));
document.querySelectorAll("#nudgeSeg button").forEach(b=>b.addEventListener("click",()=>{ DB.settings.nudgeFreq=b.dataset.nf; DB.settings.nudgeSet=true; saveDB(); renderAll(); window.SamvarNative?.scheduleNudges({ask:true}); }));
document.getElementById("nudgeTime").addEventListener("change",e=>{ DB.settings.nudgeTime=e.target.value; DB.settings.nudgeSet=true; saveDB(); renderAll(); window.SamvarNative?.scheduleNudges({ask:true}); });
/* called by native.js once the Capacitor bridge is up */
function initNativeUI(){
  const n=window.SamvarNative; if(!n) return;
  document.getElementById("nudgeStatus").textContent="Nudges arrive as notifications at the time you choose.";
  const b=document.getElementById("pickContacts"); b.style.display="inline-flex"; b.textContent="📇 Add from Contacts";
  b.onclick=async ()=>{
    if(!entitled()){ paywallSheet("Start your free trial to add people."); return; }
    try{ const c=await n.pickContact(); if(!c) return;
      if(DB.people.some(p=>p.name.toLowerCase()===c.name.toLowerCase())){ alert(c.name+" is already in your circles."); return; }
      askTier(c.name, tier=>{
        const facts=c.birthday?[{f:"birthday "+c.birthday,kind:"date",ts:Date.now()}]:[];
        DB.people.push({id:uid(),name:c.name,tier,aliases:[],added:Date.now(),tel:c.tel,addr:c.addr,email:c.email,facts}); saveDB(); renderAll(); n.haptic("success"); });
    }catch(e){ /* cancelled */ }
  };
  document.getElementById("contactsHint").textContent="Add from Contacts brings the name, number and address across — only for the people you pick.";
}
document.getElementById("nudgePreview").addEventListener("click",()=>{
  const n=nudgeText(), next=nextNudgeTimes(1)[0];
  document.getElementById("nudgePreviewOut").innerHTML=`<b>${esc(n.title)}</b> — ${esc(n.body)}<br>${next?`Next one ${new Date(next).toLocaleString("en-GB",{weekday:"short",hour:"2-digit",minute:"2-digit"})}.`:"Nudges are off."}`;
});
let peopleView="list";
function showPeopleView(v){
  peopleView=v;
  document.querySelectorAll("#peopleSeg button").forEach(b=>b.classList.toggle("on",b.dataset.pv===v));
  ["list","net","places"].forEach(k=>{ document.getElementById("pv-"+k).style.display=k===v?"block":"none"; });
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

/* ---------- live dictation (webkitSpeechRecognition where supported) ---------- */
const SR=window.SpeechRecognition||window.webkitSpeechRecognition;
if(SR){
  const btn=document.getElementById("liveMicBtn"); btn.style.display="block";
  let rec=null, on=false;
  btn.addEventListener("click",()=>{
    if(on){ rec.stop(); return; }
    rec=new SR(); rec.lang="en-GB"; rec.continuous=true; rec.interimResults=true;
    const ta=document.getElementById("logText"); const base=ta.value?ta.value+" ":"";
    rec.onresult=e=>{ let s=""; for(const r of e.results) s+=r[0].transcript; ta.value=base+s; };
    rec.onend=()=>{ on=false; btn.classList.remove("mic-live"); btn.textContent="🎙 Live"; };
    rec.onerror=()=>{ on=false; btn.classList.remove("mic-live"); btn.textContent="🎙 Live"; };
    rec.start(); on=true; btn.classList.add("mic-live"); btn.textContent="■ Stop";
  });
}

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
document.getElementById("candAdd").addEventListener("click",()=>{
  const ta=document.getElementById("candPaste");
  addCandidates(ta.value.split(/\n/)); ta.value="";
});
document.getElementById("vcfFile").addEventListener("change",e=>{
  const f=e.target.files[0]; if(!f) return;
  f.text().then(txt=>{
    const items=txt.split(/BEGIN:VCARD/i).slice(1).map(bk=>{
      const fn=(bk.match(/^FN[^:]*:(.+)$/m)||[])[1]; if(!fn) return null;
      const adrs=[...bk.matchAll(/^(?:item\d+\.)?ADR([^:]*):(.+)$/gm)];
      const adr=adrs.find(m=>/HOME/i.test(m[1]))||adrs[0];
      let addr;
      if(adr){ const fld=adr[2].split(";").map(s=>s.replace(/\\,/g,",").trim());
        addr=[fld[3],fld[5]].filter(Boolean).join(" ")||[fld[2],fld[4],fld[6]].filter(Boolean).join(", "); }
      const tels=[...bk.matchAll(/^(?:item\d+\.)?TEL([^:]*):(.+)$/gm)];
      const tel=(tels.find(m=>/CELL|MOBILE|IPHONE/i.test(m[1]))||tels[0])?.[2].trim();
      return {name:fn.trim(), addr:addr||undefined, tel:tel||undefined};
    }).filter(Boolean);
    const added=addCandidates(items);
    alert(`${added} contacts added to “To file”${items.some(i=>i.addr)?" (addresses included)":""}.`); switchPage("people");
  });
});
document.getElementById("vcfBtn2").addEventListener("click",()=>document.getElementById("vcfFile").click());
document.getElementById("icsBtn").addEventListener("click",exportICS);
document.getElementById("geoAllBtn").addEventListener("click",async ()=>{
  const all=[...DB.people,...DB.candidates];
  const withAddr=all.filter(x=>x.addr);
  const todo=withAddr.filter(x=>!x.loc);
  const prog=document.getElementById("geoProg");
  if(!withAddr.length){ prog.textContent="No one has an address yet — add one on a person's profile, or import a .vcf with addresses."; return; }
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
          alert(added+" added to triage — but Safari's contact picker didn't hand over any addresses (Apple's experimental picker usually only shares names). You can add an address on each person's profile, or import a .vcf file which carries full addresses.");
        else if(!props.includes("address"))
          alert(added+" added to triage. This browser's picker doesn't share addresses at all — add them on each person's profile, or import a .vcf file.");
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
  const {pairs,nodes}=coData();
  const gEl=document.getElementById("netGraph");
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
  const townOf=a=>a.replace(/\b[A-Z]{1,2}\d[A-Z\d]?(\s*\d[A-Z]{2})?\b/gi,"").replace(/[0-9].*$/,"").replace(/[,\s]+$/,"").trim()||a;
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
      <div class="meta">${r.p.addr?`📍 ${esc(r.p.addr)} · `:""}last: ${fmtAgo(l)}${withDist&&r.km!=null?` · ${r.km<1?"<1":Math.round(r.km)} km away`:""}</div></div></div>`;
  }).join(""):`<div class="empty" style="padding:10px">No one found there.</div>`;
  el.querySelectorAll(".person").forEach(row=>row.addEventListener("click",()=>personSheet(row.dataset.pid)));
}
document.getElementById("placeQ").addEventListener("input",e=>{
  const q=e.target.value.trim().toLowerCase();
  if(!q){ document.getElementById("placeResults").innerHTML=""; return; }
  const list=DB.people.filter(p=>p.tier!=="notnow"&&p.addr&&p.addr.toLowerCase().includes(q))
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
    m.bindPopup(`<b>${esc(p.name)}</b><br>${h.label} · last ${fmtAgo(lastContact(p,now))}${p.addr?`<br>📍 ${esc(p.addr)}`:""}`);
    kmarkers.push(m);
  }
  kmap.fitBounds(L.latLngBounds(pts.map(p=>[p.loc.lat,p.loc.lon])).pad(0.3),{maxZoom:13});
  setTimeout(()=>kmap.invalidateSize(),80);
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
  document.querySelectorAll(".page").forEach(el=>el.classList.toggle("on",el.id==="page-"+p));
  document.querySelectorAll("nav.tabs button").forEach(b=>b.classList.toggle("on",b.dataset.p===p));
  window.scrollTo(0,0);
  renderAll();
  if(p==="people" && peopleView==="places") setTimeout(renderMap,80);
}
document.querySelectorAll("nav.tabs button").forEach(b=>b.addEventListener("click",()=>switchPage(b.dataset.p)));
function renderAll(){ renderHome(); renderTriage(); renderPeople(); renderNetwork(); renderInsights(); renderSettingsUI(); }
switchPage("home");

/* ---------- first-run welcome ---------- */
function showWelcome(){
  if(DB.settings.welcomed || DB.people.length || DB.interactions.length) return;
  const dlg=document.createElement("dialog");
  dlg.innerHTML=`<div style="text-align:center;padding:6px 0 2px;font-size:40px">🌱</div>
    <h2 style="font-size:22px;text-align:center;letter-spacing:-.02em">Keep your people close</h2>
    <p class="hint" style="text-align:center;margin:4px 0 14px;font-size:14px">Most of us don’t lose friends on purpose — we just go quiet. Samvar makes sure you don’t.</p>
    <div class="factline" style="font-size:14px;margin-top:8px"><span class="fk">◎</span><span>Put the people who matter in <b>circles</b>, each with its own rhythm.</span></div>
    <div class="factline" style="font-size:14px"><span class="fk">🎙</span><span>After you see someone, <b>just say what happened</b>. Samvar remembers the details.</span></div>
    <div class="factline" style="font-size:14px"><span class="fk">☀️</span><span>Each morning, a few <b>nudges</b> on who to reach out to — with the first line drafted.</span></div>
    <p class="hint" style="text-align:center;margin:12px 0 10px">Everything stays on your phone. No account needed.</p>
    <button class="btn" id="wGo">Add my people</button>
    <button class="btn ghost small" id="wImport" style="width:100%;margin-top:8px">I have a backup file</button>`;
  document.body.appendChild(dlg); dlg.showModal();
  const done=()=>{ DB.settings.welcomed=true; saveDB(); dlg.close(); dlg.remove(); };
  dlg.querySelector("#wGo").addEventListener("click",()=>{ done(); switchPage("people");
    if(entitled()) document.getElementById("newPersonName").focus(); else paywallSheet("Everything is free for 7 days — no limits."); });
  dlg.querySelector("#wImport").addEventListener("click",()=>{ done(); document.getElementById("importFile").click(); });
}
showWelcome();
