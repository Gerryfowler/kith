/* Samvar native bridge — runs only inside the Capacitor iOS shell.
   On the web window.Capacitor is undefined and this file does nothing. */
(function(){
  const Cap=window.Capacitor;
  if(!Cap || !Cap.isNativePlatform || !Cap.isNativePlatform()) return;
  // No bundler: window.Capacitor is the injected native bridge, which exposes native plugins on
  // Capacitor.Plugins and has no registerPlugin. Fall back to registerPlugin only if a runtime provides it.
  const reg=n=>{ try{ if(Cap.Plugins&&Cap.Plugins[n]) return Cap.Plugins[n]; return Cap.registerPlugin?Cap.registerPlugin(n):null; }catch(e){ return null; } };
  const LocalNotifications=reg("LocalNotifications"), Contacts=reg("Contacts"), Purchases=reg("Purchases"),
        Haptics=reg("Haptics"), Share=reg("Share"), App=reg("App"), StatusBar=reg("StatusBar"), Filesystem=reg("Filesystem"), Camera=reg("Camera"), Calendar=reg("CapacitorCalendar");

  function opts_askedCalendar(){ try{ return !!(DB.settings.welcomed && DB.people.length); }catch(e){ return false; } }
  const RC_IOS_KEY="appl_HRQlVTfaAsgwxnwRfnwRfEFtsaJ";
  let rcReady=false;
  async function rc(){
    if(rcReady || !Purchases) return;
    await Purchases.configure({apiKey:RC_IOS_KEY, appUserID:deviceId()});
    rcReady=true;
  }
  function entitlement(res){
    const info=res && res.customerInfo ? res.customerInfo : res;
    const pro=info && info.entitlements && info.entitlements.active && info.entitlements.active.pro;
    if(!pro) return {active:false};
    const expires=pro.expirationDateMillis||(pro.expirationDate?Date.parse(pro.expirationDate):0);
    return {active:true, expires, trial:String(pro.periodType).toUpperCase()==="TRIAL"};
  }

  window.SamvarNative={
    async scheduleNudges(opts={}){
      if(!LocalNotifications) return;
      try{
        let perm=await LocalNotifications.checkPermissions();
        if(perm.display!=="granted" && opts.ask) perm=await LocalNotifications.requestPermissions();
        const pending=await LocalNotifications.getPending();
        if(pending.notifications.length) await LocalNotifications.cancel({notifications:pending.notifications.map(n=>({id:n.id}))});
        if(perm.display!=="granted") return;
        const planned=plannedNotifications(); if(!planned.length) return;
        await LocalNotifications.schedule({notifications:planned.map(n=>({
          id:n.id, title:n.title, body:n.body, schedule:{at:new Date(n.at)}, sound:"default", extra:n.extra}))});
      }catch(e){ console.warn("scheduleNudges",e); }
    },
    // Whole address book (name, phone, address, email, birthday) for the in-app "flag into a circle" list.
    // Photos are fetched per person on demand (contactPhoto) so the list loads fast.
    async allContacts(){
      if(!Contacts) return null;
      let perm=await Contacts.checkPermissions();
      if(perm.contacts!=="granted") perm=await Contacts.requestPermissions();
      if(perm.contacts!=="granted") return null;
      const r=await Contacts.getContacts({projection:{name:true,phones:true,postalAddresses:true,emails:true,birthday:true}});
      const MONTHS=["January","February","March","April","May","June","July","August","September","October","November","December"];
      return (r.contacts||[]).map(c=>{
        const name=c.name && (c.name.display || [c.name.given,c.name.family].filter(Boolean).join(" "));
        if(!name) return null;
        // Keep every number with its label; the main one (tel) is the mobile, which is what Text and WhatsApp need.
        const isMobile=ph=>/mobile|iphone|cell/i.test(String(ph.type||"")+" "+String(ph.label||""));
        const phones=(c.phones||[]).filter(ph=>ph.number).map(ph=>({label:String(ph.label||ph.type||"other").replace(/^_\$!<|>!\$_$/g,""), number:ph.number.trim(), mobile:isMobile(ph)}));
        const main=phones.find(ph=>ph.mobile)||phones[0];
        const tel=main && main.number;
        const tels=phones.length>1?phones.filter(ph=>ph!==main).map(ph=>({label:ph.label,number:ph.number})):undefined;
        const a=c.postalAddresses && c.postalAddresses[0];
        // Letter layout: one part per line (street may itself span lines).
        const addr=a ? [a.street,a.city,a.region,a.postcode,a.country].map(x=>String(x||"").trim()).filter(Boolean).join("\n") : undefined;
        const email=c.emails && c.emails[0] && c.emails[0].address;
        const b=c.birthday;
        const birthday=(b && b.day && b.month) ? `${b.day} ${MONTHS[b.month-1]}` : undefined;
        return {contactId:c.contactId, name, tel:tel||undefined, tels, telIsMobile:!!(main&&main.mobile), addr, email:email||undefined, birthday};
      }).filter(Boolean).sort((x,y)=>x.name.localeCompare(y.name));
    },
    async contactPhoto(contactId){
      if(!Contacts) return null;
      try{ const r=await Contacts.getContact({contactId, projection:{image:true}});
        const b64=r && r.contact && r.contact.image && r.contact.image.base64String; return b64||null; }catch(e){ return null; }
    },
    // Photos live as JPEG files in the app's data directory; the DB only stores the relative path.
    async savePhoto(base64, key){
      if(!Filesystem) return null;
      const path=`photos/${key}.jpg`;
      await Filesystem.writeFile({path, data:base64.replace(/^data:[^,]*,/,""), directory:"DATA", recursive:true});
      return path;
    },
    async deletePhoto(path){ if(Filesystem&&path) try{ await Filesystem.deleteFile({path, directory:"DATA"}); }catch(e){} },
    _photoUrls:{},
    async photoUrl(path){
      if(!Filesystem||!path) return null;
      if(this._photoUrls[path]) return this._photoUrls[path];
      const r=await Filesystem.getUri({path, directory:"DATA"});
      const url=Cap.convertFileSrc(r.uri); this._photoUrls[path]=url; return url;
    },
    // Read-only calendar access; events in [from,to] as {id,title,start,end,isAllDay,location,attendees:[names]}.
    async calendarEvents(from, to){
      if(!Calendar) return [];
      let perm=await Calendar.checkPermission({scope:"readCalendar"});
      if(perm.result!=="granted"){ if(!opts_askedCalendar()){ return []; } perm=await Calendar.requestPermission({scope:"readCalendar"}); }
      if(perm.result!=="granted") return [];
      const r=await Calendar.listEventsInRange({from, to});
      return (r.result||[]).map(e=>({id:e.id, title:e.title||"", start:e.startDate, end:e.endDate, isAllDay:!!e.isAllDay, location:e.location||"",
        attendees:(e.attendees||[]).map(a=>a.name||"").filter(Boolean)}));
    },
    // source: "photos" | "camera". Returns base64 JPEG downscaled to 640px, or null if cancelled.
    async pickPhoto(source){
      if(!Camera) return null;
      try{ const r=await Camera.getPhoto({resultType:"base64", source:source==="camera"?"CAMERA":"PHOTOS", quality:70, width:640, height:640, correctOrientation:true});
        return r && r.base64String ? r.base64String : null; }
      catch(e){ const m=String(e&&e.message||e); if(!/cancel/i.test(m)) alert("Couldn't get a photo: "+m); return null; }
    },
    async purchase(plan){
      await rc();
      const off=await Purchases.getOfferings(); const cur=off && off.current;
      if(!cur) throw new Error("no offering");
      const want=plan==="yearly"?"ANNUAL":"MONTHLY";
      const pkg=(cur.availablePackages||[]).find(p=>p.packageType===want) || cur.availablePackages[0];
      return entitlement(await Purchases.purchasePackage({aPackage:pkg}));
    },
    // Localized App Store prices for the paywall: {monthly:{price,trial}, yearly:{price,trial}} or null.
    async prices(){
      if(!Purchases) return null;
      if(window.SamvarNative._prices) return window.SamvarNative._prices;
      await rc();
      const off=await Purchases.getOfferings(); const cur=off && off.current; if(!cur) return null;
      const pick=t=>{ const p=(cur.availablePackages||[]).find(x=>x.packageType===t); if(!p||!p.product) return null;
        const ip=p.product.introPrice, trial=ip && ip.price===0 ? `${ip.periodNumberOfUnits} ${String(ip.periodUnit||"").toLowerCase()}${ip.periodNumberOfUnits>1?"s":""}` : "";
        return {price:p.product.priceString, trial}; };
      const out={monthly:pick("MONTHLY"), yearly:pick("ANNUAL")};
      if(out.monthly||out.yearly) window.SamvarNative._prices=out; // only cache once StoreKit has returned products
      return out;
    },
    async restore(){ await rc(); return entitlement(await Purchases.restorePurchases()); },
    async refreshEntitlement(){ await rc(); return entitlement(await Purchases.getCustomerInfo()); },
    async haptic(kind){
      if(!Haptics) return;
      try{ if(kind==="success") await Haptics.notification({type:"SUCCESS"}); else await Haptics.impact({style:kind==="heavy"?"HEAVY":"LIGHT"}); }catch(e){}
    },
    async share(text){ if(Share) await Share.share({text}); },
    // WKWebView ignores <a download>; write to the cache dir and hand the file to the share sheet instead.
    async shareFile(name, text){
      if(!Filesystem||!Share) throw new Error("no filesystem");
      const r=await Filesystem.writeFile({path:name, data:text, directory:"CACHE", encoding:"utf8"});
      await Share.share({title:name, url:r.uri});
    }
  };

  if(StatusBar && StatusBar.setStyle) StatusBar.setStyle({style:document.documentElement.dataset.theme==="dark"?"DARK":"LIGHT"}).catch(()=>{});
  // Re-render and re-schedule on every foreground so notification text reflects today's nudges.
  if(App && App.addListener) App.addListener("appStateChange",s=>{ if(s.isActive){ renderAll(); window.SamvarNative.scheduleNudges(); refreshCalendar(); syncContacts(); } });
  if(LocalNotifications && LocalNotifications.addListener) LocalNotifications.addListener("localNotificationActionPerformed",ev=>handleNotificationTap(ev&&ev.notification&&ev.notification.extra));

  window.SamvarNative.refreshEntitlement().then(e=>{
    if(e.active) DB.settings.pro={active:true,expires:e.expires,trial:e.trial,source:"appstore"};
    else if(DB.settings.pro && DB.settings.pro.source==="appstore") DB.settings.pro.active=false;
    saveDB(); renderAll();
  }).catch(()=>{});
  window.SamvarNative.scheduleNudges();
  initNativeUI();
  refreshCalendar();
  setTimeout(syncContacts, 1500);
})();
