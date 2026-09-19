/* Samvar native bridge — runs only inside the Capacitor iOS shell.
   On the web window.Capacitor is undefined and this file does nothing. */
(function(){
  const Cap=window.Capacitor;
  if(!Cap || !Cap.isNativePlatform || !Cap.isNativePlatform()) return;
  const reg=n=>{ try{ return Cap.registerPlugin(n); }catch(e){ return null; } };
  const LocalNotifications=reg("LocalNotifications"), Contacts=reg("Contacts"), Purchases=reg("Purchases"),
        Haptics=reg("Haptics"), Share=reg("Share"), App=reg("App"), StatusBar=reg("StatusBar");

  const RC_IOS_KEY="appl_REPLACE_WITH_REVENUECAT_PUBLIC_IOS_KEY";
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
        const times=nextNudgeTimes(14), t=nudgeText();
        if(!times.length) return;
        await LocalNotifications.schedule({notifications:times.map((at,i)=>({
          id:1000+i, title:t.title, body:t.body, schedule:{at:new Date(at)}, sound:"default"}))});
      }catch(e){ console.warn("scheduleNudges",e); }
    },
    async pickContact(){
      if(!Contacts) return null;
      const r=await Contacts.pickContact({projection:{name:true,phones:true,postalAddresses:true}});
      const c=r && r.contact; if(!c) return null;
      const name=c.name && (c.name.display || [c.name.given,c.name.family].filter(Boolean).join(" "));
      const tel=c.phones && c.phones[0] && c.phones[0].number;
      const a=c.postalAddresses && c.postalAddresses[0];
      const addr=a ? [a.street,a.city,a.postcode].filter(Boolean).join(" ") : undefined;
      return name ? {name, tel:tel||undefined, addr:addr||undefined} : null;
    },
    async purchase(plan){
      await rc();
      const off=await Purchases.getOfferings(); const cur=off && off.current;
      if(!cur) throw new Error("no offering");
      const want=plan==="yearly"?"ANNUAL":"MONTHLY";
      const pkg=(cur.availablePackages||[]).find(p=>p.packageType===want) || cur.availablePackages[0];
      return entitlement(await Purchases.purchasePackage({aPackage:pkg}));
    },
    async restore(){ await rc(); return entitlement(await Purchases.restorePurchases()); },
    async refreshEntitlement(){ await rc(); return entitlement(await Purchases.getCustomerInfo()); },
    async haptic(kind){
      if(!Haptics) return;
      try{ if(kind==="success") await Haptics.notification({type:"SUCCESS"}); else await Haptics.impact({style:kind==="heavy"?"HEAVY":"LIGHT"}); }catch(e){}
    },
    async share(text){ if(Share) await Share.share({text}); }
  };

  if(StatusBar && StatusBar.setStyle) StatusBar.setStyle({style:document.documentElement.dataset.theme==="dark"?"DARK":"LIGHT"}).catch(()=>{});
  // Re-render and re-schedule on every foreground so notification text reflects today's nudges.
  if(App && App.addListener) App.addListener("appStateChange",s=>{ if(s.isActive){ renderAll(); window.SamvarNative.scheduleNudges(); } });
  if(LocalNotifications && LocalNotifications.addListener) LocalNotifications.addListener("localNotificationActionPerformed",()=>switchPage("home"));

  window.SamvarNative.refreshEntitlement().then(e=>{
    if(e.active) DB.settings.pro={active:true,expires:e.expires,trial:e.trial,source:"appstore"};
    else if(DB.settings.pro && DB.settings.pro.source==="appstore") DB.settings.pro.active=false;
    saveDB(); renderAll();
  }).catch(()=>{});
  window.SamvarNative.scheduleNudges();
  initNativeUI();
})();
