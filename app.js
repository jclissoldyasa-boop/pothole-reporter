(function(){
  "use strict";
  const TO="enquiries@roads.vic.gov.au";
  const DIRS=[["N","Northbound"],["NE","North-east"],["E","Eastbound"],["SE","South-east"],["S","Southbound"],["SW","South-west"],["W","Westbound"],["NW","North-west"]];
  const POS=["Left wheel track","Centre of lane","Right wheel track","Shoulder","Across the lane"];
  const SIZE=["Small","Medium","Large / deep","Deep enough to drop a bike"];
  // Shared riders' map. Local copies of the app talk to `wrangler dev`.
  const API=/^(localhost|127\.0\.0\.1)$/.test(location.hostname)?"http://localhost:8787":"https://pothole-reporter.drivemate-app.workers.dev";
  const $=id=>document.getElementById(id);
  const LS="pothole_reporter_v1";
  const MELTON="City of Melton";
  const DEFAULT={me:{name:"",phone:"",email:"",share:true},councils:{},unshare:[],votes:{},stats:null,suburbCouncil:{},queue:[],history:[]};

  let S=(function(){try{const v=JSON.parse(localStorage.getItem(LS));if(v&&v.me)return{...DEFAULT,...v,me:{...DEFAULT.me,...v.me}}}catch(e){}return JSON.parse(JSON.stringify(DEFAULT))})();
  // Older versions kept one council email (it was always Melton's).
  if(S.me.councilEmail){if(!S.councils[MELTON])S.councils[MELTON]=S.me.councilEmail;delete S.me.councilEmail}
  function save(){try{localStorage.setItem(LS,JSON.stringify(S))}catch(e){}}
  // Early versions came with the developer's name and phone filled in, and saved them on every phone. Clear them once.
  if(!S.meReset){let h=5381;for(const c of S.me.name+"|"+S.me.phone)h=((h*33)^c.charCodeAt(0))>>>0;if(h===2492536473){S.me.name="";S.me.phone=""}S.meReset=true}

  // Every Victorian council (councils.js). OpenStreetMap says "Shire of Moorabool", the council says
  // "Moorabool Shire Council", so both are matched on the core name ("moorabool").
  function coreName(n){return(n||"").toLowerCase().replace(/[-']/g," ").replace(/\b(city|shire|rural|borough|council|of|the)\b/g," ").replace(/\s+/g," ").trim()}
  const VIC={};(window.VIC_COUNCILS||[]).forEach(([name,phone,email,web])=>{VIC[coreName(name)]={name,phone,email,web}});
  const councilInfo=c=>VIC[coreName(c)]||null;
  const councilName=c=>{const i=councilInfo(c);return i?i.name:c};
  const shortCouncil=c=>councilName(c).replace(/ (Rural City|City|Shire|Borough) Council$/,"");
  // Your own email for a council (or VicRoads, key "vicroads") wins over the built-in one.
  const councilEmail=c=>(S.councils[coreName(c)]||(councilInfo(c)||{}).email||"").trim();
  const vicroadsEmail=()=>(S.councils.vicroads||TO).trim();
  // Saved emails used to be keyed by OpenStreetMap's name.
  {const old=S.councils;S.councils={};Object.keys(old).forEach(k=>{if(old[k])S.councils[k==="vicroads"?k:coreName(k)]=old[k]})}

  // ---------- who manages the road ----------
  // Source: Melton City Council "Arterial Roads" page — roads in the City of Melton controlled by VicRoads.
  const MELTON_SUBURBS=["aintree","bonnie brook","brookfield","burnside","burnside heights","caroline springs","cobblebank","deanside","diggers rest","exford","eynesbury","fieldstone","fraser rise","grangefields","harkness","hillside","kurunjang","melton","melton south","melton west","mount cottrell","parwan","plumpton","ravenhall","rockbank","strathtulloh","taylors hill","thornhill park","toolern vale","truganina","weir views","kororoit"];
  const VR_FULL=["diggers rest coimadai road","vineyard road","gap road","hopkins road","federation drive","gisborne melton road","western freeway","calder freeway","melton highway"];
  const VR_PART={"coburns road":"VicRoads only between the Western Freeway and High Street","high street":"VicRoads only between the Melton Highway and Coburns Road","christies road":"VicRoads only between Caroline Springs station and Ballarat Road"};
  // Towns in the Shire of Moorabool, used when the council boundary lookup can't be reached.
  const MOORABOOL_SUBURBS=["bacchus marsh","maddingley","darley","ballan","myrniong","gordon","coimadai","merrimu","long forest","hopetoun park","greendale","blackwood","mount egerton","wallace","bungaree","dunnstown","millbrook","rowsley","balliang"];
  function norm(r){return(r||"").toLowerCase().replace(/[-–—'.]/g," ").replace(/\brd\b/g,"road").replace(/\bst\b/g,"street").replace(/\bhwy\b/g,"highway").replace(/\bfwy\b/g,"freeway").replace(/\bdr\b/g,"drive").replace(/\s+/g," ").trim()}
  // Victorian M, A, B and C route numbers are arterial roads, which VicRoads looks after.
  const arterialRef=ref=>((ref||"").split(/[;,]/).map(x=>x.trim().toUpperCase()).find(x=>/^[MABC]\d+$/.test(x))||"");
  function guessCouncil(q){
    if(q.council)return q.council;
    const sub=norm(q.place);if(!sub)return "";
    if(S.suburbCouncil[sub])return S.suburbCouncil[sub];
    return MELTON_SUBURBS.includes(sub)?MELTON:MOORABOOL_SUBURBS.includes(sub)?"Shire of Moorabool":"";
  }
  function classify(q){
    const r=norm(q.road),council=guessCouncil(q),ref=arterialRef(q.ref);
    if(!r)return{auth:"check",why:"Road name not found yet"};
    if(q.state&&q.state!=="Victoria")return{auth:"check",why:"Outside Victoria. Check who manages this road, then pick one"};
    if(/service road/.test(r))return council?{auth:"council",why:"Service roads beside main roads are council's"}:{auth:"check",why:"Service road, but the council wasn't found. Add it under Details"};
    if(/\b(freeway|highway)\b/.test(r))return{auth:"vicroads",why:"Freeways and highways are VicRoads"};
    if(ref)return{auth:"vicroads",why:"Route "+ref+" is a VicRoads arterial road"};
    if(coreName(council)==="melton"){
      if(VR_FULL.includes(r))return{auth:"vicroads",why:"On Melton's list of VicRoads roads"};
      if(VR_PART[r])return{auth:"check",why:VR_PART[r]+". Check the map, then pick one"};
    }
    if(council)return{auth:"council",why:"Local road, "+councilName(council)};
    return{auth:"check",why:"Couldn't tell which council this is. Pick VicRoads, or add the council under Details"};
  }
  function applyClass(q){if(!q.council){const c=guessCouncil(q);if(c)q.council=c}if(q.authSet)return;const c=classify(q);q.auth=c.auth;q.why=c.why}

  // ---------- road lookup (OpenStreetMap Nominatim, max 1 request a second) ----------
  let lastLookup=0;
  const wait=ms=>new Promise(r=>setTimeout(r,ms));
  // Council boundary and nearby roads' route numbers (OpenStreetMap via Overpass).
  async function areaLookup(q){
    const ql="[out:json][timeout:10];is_in("+q.lat+","+q.lng+")->.a;rel(pivot.a)[boundary=administrative][admin_level=6];out tags;way(around:30,"+q.lat+","+q.lng+")[highway][name];out tags;";
    // The public server is often busy for a moment, so try twice.
    for(let tries=0;tries<2;tries++){
      if(tries)await wait(1500);
      const ctl=new AbortController(),t=setTimeout(()=>ctl.abort(),8000);
      try{
        const r=await fetch("https://overpass-api.de/api/interpreter",{method:"POST",body:"data="+encodeURIComponent(ql),headers:{"Content-Type":"application/x-www-form-urlencoded"},signal:ctl.signal});
        if(!r.ok)throw new Error("http "+r.status);
        const els=(await r.json()).elements||[];
        const area=els.find(e=>e.type==="relation"&&e.tags&&e.tags.name);
        return{council:area?area.tags.name:"",ways:els.filter(e=>e.type==="way"&&e.tags).map(e=>e.tags)};
      }catch(e){}finally{clearTimeout(t)}
    }
    return null;
  }
  // A report gets a few tries at the council lookup across app opens before we stop asking.
  const needsArea=q=>!q.areaDone&&(q.areaTries||0)<4;
  function useArea(q,area){
    if(!area){q.areaTries=(q.areaTries||0)+1;return}
    q.areaDone=true;
    if(area.council&&!q.councilSet){q.council=area.council;const sub=norm(q.place);if(sub)S.suburbCouncil[sub]=area.council}
    const r=norm(q.road);
    const withRef=area.ways.find(w=>w.highway!=="service"&&r&&norm(w.name)===r&&arterialRef(w.ref));
    q.ref=withRef?withRef.ref:"";
  }
  async function lookup(q){
    if(!navigator.onLine){q.lookup="offline";applyClass(q);return false}
    const areaP=areaLookup(q);
    const gap=1100-(Date.now()-lastLookup);if(gap>0)await wait(gap);
    lastLookup=Date.now();
    try{
      const url="https://nominatim.openstreetmap.org/reverse?format=jsonv2&addressdetails=1&zoom=17&lat="+q.lat+"&lon="+q.lng;
      const r=await fetch(url,{headers:{"Accept-Language":"en-AU"}});
      if(!r.ok)throw new Error("http "+r.status);
      const d=await r.json();const a=d.address||{};
      const road=a.road||a.pedestrian||a.residential||"";
      q.state=a.state||"";
      q.place=a.suburb||a.town||a.village||a.hamlet||"";
      q.suburb=q.place||a.city_district||a.city||"";
      q.postcode=a.postcode||"";
      if(road&&!q.roadSet)q.road=road;
      useArea(q,await areaP);
      if(!road){q.lookup="none";applyClass(q);return false}
      q.lookup="done";applyClass(q);return true;
    }catch(e){useArea(q,await areaP);q.lookup="failed";applyClass(q);return false}
  }
  async function lookupMissing(){
    const todo=S.queue.filter(q=>(q.lookup!=="done"&&q.lookup!=="none")||needsArea(q));
    if(!todo.length)return;
    $("lookupBtn").disabled=true;$("lookupBtn").textContent="Looking up…";
    for(const q of todo){q.lookup="pending";renderQueue();await lookup(q);save();renderQueue()}
    renderCouncils();
    $("lookupBtn").disabled=false;$("lookupBtn").textContent="Retry lookups";
  }
  $("lookupBtn").onclick=lookupMissing;
  window.addEventListener("online",()=>{lookupMissing();shareMissing();flushUnshare()});

  // ---------- details ----------
  [["myName","name"],["myPhone","phone"],["myEmail","email"]].forEach(([el,k])=>{
    $(el).value=S.me[k]||"";
    $(el).addEventListener("input",()=>{S.me[k]=$(el).value.trim();save();updateButtons()});
  });

  // ---------- geo helpers ----------
  const rad=Math.PI/180;
  function dist(a,b){const dφ=(b.lat-a.lat)*rad,dλ=(b.lng-a.lng)*rad;const h=Math.sin(dφ/2)**2+Math.cos(a.lat*rad)*Math.cos(b.lat*rad)*Math.sin(dλ/2)**2;return 12742000*Math.asin(Math.sqrt(h))}
  function bearing(a,b){const φ1=a.lat*rad,φ2=b.lat*rad,Δλ=(b.lng-a.lng)*rad;return(Math.atan2(Math.sin(Δλ)*Math.cos(φ2),Math.cos(φ1)*Math.sin(φ2)-Math.sin(φ1)*Math.cos(φ2)*Math.cos(Δλ))/rad+360)%360}
  const toCode=b=>DIRS[Math.round(b/45)%8][0];
  const dirName=c=>(DIRS.find(d=>d[0]===c)||["",""])[1];
  const maps=q=>"https://maps.google.com/?q="+q.lat+","+q.lng;
  function setStatus(t,cls){$("status").textContent=t;$("status").className="status"+(cls?" "+cls:"")}

  // Keep GPS warm after the first tap so later taps are instant and carry a heading.
  let live=null,recent=[],warmWatch=null;
  function startWarm(){
    if(warmWatch!==null||!("geolocation" in navigator))return;
    warmWatch=navigator.geolocation.watchPosition(p=>{
      live={lat:p.coords.latitude,lng:p.coords.longitude,acc:p.coords.accuracy,heading:p.coords.heading,speed:p.coords.speed||0,spd:p.coords.speed,t:Date.now()};
      recent.push(live);recent=recent.filter(f=>Date.now()-f.t<20000);
      showSpeed();checkAhead();
    },()=>{},{enableHighAccuracy:true,maximumAge:0});
    $("speedo").disabled=true;
  }

  // ---------- GPS speedometer ----------
  // An estimate from the same GPS that logs potholes. The phone's own speed reading is used when it gives one,
  // otherwise it's worked out from the last few seconds of fixes. Dashes when there's no recent fix.
  function gpsSpeed(){
    if(!live||Date.now()-live.t>5000)return null;
    if(live.spd!=null&&!isNaN(live.spd))return live.spd*3.6;
    const o=recent.find(f=>live.t-f.t>=2000&&live.t-f.t<=8000);
    if(!o||live.acc>30||o.acc>30)return null;
    return dist(o,live)/((live.t-o.t)/1000)*3.6;
  }
  function showSpeed(){
    const v=gpsSpeed();
    $("speedN").textContent=v==null?"--":String(v<3?0:Math.round(v));
    $("speedo").classList.toggle("stale",v==null);
  }
  setInterval(showSpeed,2000);
  // Starts straight away if location is already allowed. Otherwise a tap on the speedo (or the first pothole) starts it,
  // so nobody gets a location prompt just for opening the page.
  $("speedo").onclick=()=>{startWarm();$("speedNote").textContent="Estimated GPS speed. Always go by your bike's speedo."};
  if(navigator.permissions&&navigator.permissions.query)navigator.permissions.query({name:"geolocation"}).then(p=>{
    if(p.state==="granted")startWarm();else $("speedNote").textContent="Tap to show GPS speed (needs location). Estimate only, always go by your bike's speedo.";
  }).catch(()=>{});
  function headingFrom(fix){
    if(fix.heading!=null&&!isNaN(fix.heading)&&fix.speed>1)return fix.heading;
    const older=recent.filter(f=>fix.t-f.t>2000&&fix.t-f.t<15000);
    for(const o of older){if(dist(o,fix)>20)return bearing(o,fix)}
    return null;
  }

  // ---------- the one tap ----------
  let busy=false;
  $("markBtn").addEventListener("click",()=>{
    if(busy)return;
    if(!("geolocation" in navigator)){setStatus("This browser can't share location.","err");return}
    const tappedAt=Date.now();
    if(live&&tappedAt-live.t<4000){logFix(live,tappedAt);return}
    busy=true;const btn=$("markBtn");btn.setAttribute("aria-busy","true");
    setStatus("Getting your location…");
    navigator.geolocation.getCurrentPosition(p=>{
      busy=false;btn.removeAttribute("aria-busy");
      const f={lat:p.coords.latitude,lng:p.coords.longitude,acc:p.coords.accuracy,heading:p.coords.heading,speed:p.coords.speed||0,t:Date.now()};
      logFix(f,tappedAt);startWarm();
    },e=>{
      busy=false;btn.removeAttribute("aria-busy");
      setStatus(e.code===1?"Location is blocked. Allow location for this site in your browser settings, then tap again.":"Couldn't get a GPS fix. Try again in the open.","err");
    },{enableHighAccuracy:true,maximumAge:3000,timeout:15000});
  });

  function logFix(f,tappedAt){
    const b=headingFrom(f);
    const item={id:Date.now().toString(36)+Math.random().toString(36).slice(2,5),lat:f.lat.toFixed(6),lng:f.lng.toFixed(6),acc:Math.round(f.acc),
      bearing:b==null?null:Math.round(b),dir:b==null?"":toCode(b),time:new Date(tappedAt).toISOString(),
      road:"",suburb:"",postcode:"",near:"",pos:"",size:"",auth:"check",why:"Looking up road…",lookup:"pending"};
    S.queue.push(item);save();renderQueue();shareOne(item);
    if(navigator.vibrate)try{navigator.vibrate([60,40,60])}catch(e){}
    setStatus("Logged. Looking up the road…");
    lookup(item).then(()=>{
      save();renderQueue();renderCouncils();
      const label=(item.road||"Pothole")+(item.suburb?", "+item.suburb:"");
      const who=item.auth==="vicroads"?"VicRoads":item.auth==="council"?(item.council||"council"):"needs a check";
      if(item.lookup==="offline")setStatus("Logged. No signal, so the road will be looked up when you're back online.","good");
      else setStatus("Logged: "+label+" ("+who+").",item.auth==="check"?"err":"good");
    });
  }

  // ---------- email ----------
  function itemText(q,n){
    const t=new Date(q.time),L=[];
    L.push((n?n+". ":"")+(q.road?q.road+(q.near?" near "+q.near:"")+(q.suburb?", "+q.suburb+(q.postcode?" "+q.postcode:""):""):"Pothole at GPS location below"));
    if(q.dir)L.push("   Travel direction: "+dirName(q.dir)+(q.bearing!=null?" (bearing "+q.bearing+"°)":""));
    if(q.pos)L.push("   Position: "+q.pos);
    if(q.size)L.push("   Size: "+q.size);
    L.push("   GPS: "+q.lat+", "+q.lng+(q.acc!=null?" (within about "+q.acc+" m)":""));
    L.push("   Map: "+maps(q));
    L.push("   Seen: "+t.toLocaleString("en-AU",{dateStyle:"medium",timeStyle:"short"}));
    return L.join("\n");
  }
  function compose(items){
    const subs=[...new Set(items.map(q=>q.suburb).filter(Boolean))];
    const subject=items.length===1
      ?"Pothole hazard"+(items[0].road?" – "+items[0].road:"")+(items[0].suburb?", "+items[0].suburb:"")
      :"Pothole hazards – "+items.length+" locations"+(subs.length===1?" – "+subs[0]:"");
    const body=["Hi,","",items.length===1?"I'd like to report a pothole hazard:":"I'd like to report the following pothole hazards:","",
      "Potholes like these are a serious danger to motorcyclists, so I'd appreciate them being looked at quickly.","",
      items.map((q,i)=>itemText(q,items.length>1?i+1:0)).join("\n\n"),"","Each map link opens the exact location.","","Thanks,",
      [S.me.name,S.me.phone,S.me.email].filter(Boolean).join("\n")].join("\n");
    return{subject,body};
  }
  let pending=null;
  const forCouncil=c=>S.queue.filter(q=>q.auth==="council"&&coreName(q.council)===coreName(c));
  // One entry per council, however its name was spelt on each report.
  const councilsInQueue=()=>{const m=new Map();S.queue.filter(q=>q.auth==="council").forEach(q=>{const k=coreName(q.council);if(!m.has(k))m.set(k,q.council||"")});return[...m.values()]};
  function openEmail(who,council){
    const items=who==="council"?forCouncil(council):S.queue.filter(q=>q.auth===who);
    if(!items.length)return;
    if(who==="council"&&!council){msg("Open Details on those reports and fill in Council.","err");return}
    const to=who==="council"?councilEmail(council):vicroadsEmail();
    if(!to){
      focusCouncil(council);
      msg(councilInfo(council)?councilName(council)+" takes reports on its website, not by email. Use their website, or add an email under Council contacts.":"Add an email for "+council+" under Council contacts first.","err");
      return;
    }
    const {subject,body}=compose(items);
    const label=who==="council"?councilName(council):"VicRoads";
    pending={who,label,ids:items.map(q=>q.id),subject};
    location.href="mailto:"+to+"?subject="+encodeURIComponent(subject)+"&body="+encodeURIComponent(body);
    $("confirmText").textContent="Did the email to "+label+" send?";
    $("confirm").hidden=false;msg("");
  }
  $("sendBtn").onclick=()=>openEmail("vicroads");
  $("confirmYes").onclick=()=>{
    if(!pending)return;
    const items=S.queue.filter(q=>pending.ids.includes(q.id));
    items.forEach(shareOne);
    S.queue=S.queue.filter(q=>!pending.ids.includes(q.id));
    S.history.unshift({at:new Date().toISOString(),count:items.length,to:pending.label,subject:pending.subject,items});
    S.history=S.history.slice(0,50);
    save();$("confirm").hidden=true;
    toast(items.length===1?"Marked as sent":"Marked "+items.length+" as sent");
    pending=null;renderQueue();renderHistory();
  };
  $("confirmNo").onclick=()=>{pending=null;$("confirm").hidden=true};
  function msg(t,cls){$("sendMsg").textContent=t;$("sendMsg").className="sendmsg"+(cls?" "+cls:"")}

  // ---------- rendering ----------
  function chipRow(q,key,vals,labelFn){
    const w=document.createElement("div");w.className="chips";
    vals.forEach(v=>{
      const val=Array.isArray(v)?v[0]:v;
      const b=document.createElement("button");b.type="button";b.className="chip";
      b.textContent=labelFn?labelFn(v):val;b.setAttribute("aria-pressed",q[key]===val);
      b.onclick=()=>{q[key]=q[key]===val?"":val;if(key==="dir")q.bearing=q[key]?DIRS.findIndex(d=>d[0]===val)*45:null;save();renderQueue(q.id)};
      w.appendChild(b);
    });
    return w;
  }
  const authLabel=q=>q.auth==="vicroads"?"VicRoads":q.auth==="council"?(q.council?shortCouncil(q.council):"Council"):"Check";
  function renderQueue(openId){
    const ol=$("queue");ol.innerHTML="";
    if(!S.queue.length){const li=document.createElement("li");li.innerHTML='<p class="empty">Nothing waiting. Tap the sign when you pass a pothole.</p>';ol.appendChild(li)}
    S.queue.forEach((q,i)=>{
      const li=document.createElement("li");
      const head=document.createElement("div");head.className="qhead";
      const num=document.createElement("div");num.className="qnum";num.innerHTML="<b>"+(i+1)+"</b>";
      const meta=document.createElement("div");meta.className="qmeta";
      const title=()=>q.road?(q.road+(q.near?" near "+q.near:"")+(q.suburb?", "+q.suburb:"")):(q.lookup==="pending"?"Looking up road…":q.lookup==="offline"?"Waiting for signal":"Road not found");
      const st=document.createElement("strong");st.textContent=title();
      const badge=document.createElement("span");badge.className="auth "+q.auth;badge.textContent=authLabel(q);
      const sub=document.createElement("div");sub.className="sub";
      const t=new Date(q.time);
      sub.append(t.toLocaleString("en-AU",{weekday:"short",hour:"numeric",minute:"2-digit"})+(q.dir?", "+dirName(q.dir).toLowerCase():"")+(q.acc!=null?", ±"+q.acc+" m":"")+" · ");
      const a=document.createElement("a");a.href=maps(q);a.target="_blank";a.rel="noopener";a.textContent="map";sub.append(a);
      const why=document.createElement("div");why.className="why"+(q.auth==="check"?" warn":"");why.textContent=q.why||"";
      meta.append(st,badge,sub,why);
      const ed=document.createElement("button");ed.className="mini";ed.type="button";ed.textContent="Details";
      const fx=document.createElement("button");fx.className="mini ok";fx.type="button";fx.textContent="Fixed";
      fx.setAttribute("aria-label","Pothole "+(i+1)+" has been fixed");fx.title="Takes it off the map but keeps it in the counts";
      fx.onclick=()=>markFixed(q);
      const del=document.createElement("button");del.className="mini danger";del.type="button";del.textContent="Delete";
      del.setAttribute("aria-label","Delete pothole "+(i+1)+", also from the riders' map and counts");del.title="Also removes it from the riders' map and counts";
      del.onclick=()=>removeReports([q.id]);
      const btns=document.createElement("div");btns.className="qbtns";btns.append(ed,fx,del);
      head.append(num,meta,btns);
      swipeToDelete(li,head,q.id);
      const box=document.createElement("div");box.className="qedit";box.hidden=!(openId===q.id||q.auth==="check");
      ed.setAttribute("aria-expanded",!box.hidden);
      ed.onclick=()=>{box.hidden=!box.hidden;ed.setAttribute("aria-expanded",!box.hidden)};
      const l0=document.createElement("label");l0.textContent="Send to";
      const aw=document.createElement("div");aw.className="chips";
      [["vicroads","VicRoads"],["council","Council"]].forEach(([v,l])=>{
        const b=document.createElement("button");b.type="button";b.className="chip";b.textContent=l;b.setAttribute("aria-pressed",q.auth===v);
        b.onclick=()=>{q.auth=v;q.authSet=true;q.why="You chose this";save();renderQueue(q.id)};aw.appendChild(b);
      });
      const r=document.createElement("div");r.className="row";
      [["road","Road","e.g. Western Fwy"],["near","Near","e.g. Coburns Rd"],["council","Council","e.g. Shire of Moorabool"]].forEach(([k,l,ph])=>{
        const w=document.createElement("div");if(k==="council")w.className="span2";const lab=document.createElement("label");lab.textContent=l;
        const inp=document.createElement("input");inp.value=q[k]||"";inp.placeholder=ph;inp.setAttribute("aria-label",l+" for pothole "+(i+1));
        if(k==="council")inp.onchange=renderCouncils;
        inp.oninput=()=>{q[k]=k==="council"?inp.value.trim():inp.value;if(k==="road"){q.roadSet=true;q.authSet=false;applyClass(q)}if(k==="council"){q.councilSet=!!q.council;applyClass(q)}save();
          st.textContent=title();badge.className="auth "+q.auth;badge.textContent=authLabel(q);why.textContent=q.why||"";why.className="why"+(q.auth==="check"?" warn":"");updateButtons()};
        w.append(lab,inp);r.appendChild(w);
      });
      const l1=document.createElement("label");l1.textContent="Direction";
      const l2=document.createElement("label");l2.textContent="Position";
      const l3=document.createElement("label");l3.textContent="Size";
      box.append(l0,aw,r,l1,chipRow(q,"dir",DIRS,d=>d[0]),l2,chipRow(q,"pos",POS),l3,chipRow(q,"size",SIZE));
      li.append(head,box);ol.appendChild(li);
    });
    updateButtons();
  }
  function updateButtons(){
    const vr=S.queue.filter(q=>q.auth==="vicroads"),co=S.queue.filter(q=>q.auth==="council"),ck=S.queue.filter(q=>q.auth==="check");
    $("qCount").textContent=S.queue.length?S.queue.length+" logged"+(ck.length?", "+ck.length+" to check":""):"";
    $("sendBtn").disabled=!vr.length;
    $("sendBtn").textContent=vr.length?"Email "+vr.length+" to VicRoads":"Nothing for VicRoads yet";
    const box=$("councilBtns");box.innerHTML="";
    councilsInQueue().forEach(c=>{
      const n=forCouncil(c).length,b=document.createElement("button");b.type="button";b.className="btn";
      b.textContent=!c?n+" council "+(n===1?"report needs":"reports need")+" a council name":"Email "+n+" to "+councilName(c)+(councilEmail(c)?"":councilInfo(c)?" (website only)":" (add email first)");
      b.onclick=()=>openEmail("council",c);box.appendChild(b);
    });
    syncCouncils();
    $("clearBtn").hidden=$("swipeHint").hidden=!S.queue.length;if(!S.queue.length)$("clearConfirm").hidden=true;
    $("lookupBtn").hidden=!S.queue.some(q=>q.lookup==="failed"||q.lookup==="offline"||(q.lookup==="done"&&needsArea(q)));
  }
  // ---------- council contacts ----------
  let editing=null;
  function renderCouncils(){
    const list=$("councilList");list.innerHTML="";
    const term=$("councilSearch").value.trim().toLowerCase();
    const inQ=new Set(S.queue.filter(q=>q.council).map(q=>coreName(q.council)));
    // Every Victorian council, plus any others met on the road or given an email.
    const all=new Map(Object.entries(VIC).map(([k,i])=>[k,i.name]));
    S.queue.forEach(q=>{const k=coreName(q.council);if(k&&!all.has(k))all.set(k,q.council)});
    Object.keys(S.councils).forEach(k=>{if(k!=="vicroads"&&!all.has(k))all.set(k,k.replace(/\b\w/g,x=>x.toUpperCase()))});
    let keys=[...all.keys()].sort((a,b)=>(inQ.has(b)-inQ.has(a))||all.get(a).localeCompare(all.get(b)));
    keys.unshift("vicroads");
    if(term)keys=keys.filter(k=>(k==="vicroads"?"vicroads main roads freeways":all.get(k)).toLowerCase().includes(term));
    keys.forEach(k=>{
      const vr=k==="vicroads",info=vr?{name:"VicRoads (main roads and freeways)",phone:"13 11 70",email:TO,web:"www.vicroads.vic.gov.au"}:VIC[k]||{name:all.get(k)};
      const mine=S.councils[k],email=vr?vicroadsEmail():(mine||info.email||"");
      const li=document.createElement("li");li.dataset.key=k;
      const top=document.createElement("div");top.className="crow";
      const nm=document.createElement("strong");nm.textContent=info.name;
      if(inQ.has(k)){const t=document.createElement("span");t.className="tag";t.textContent="On your list";nm.append(" ",t)}
      const ch=document.createElement("button");ch.type="button";ch.className="mini";ch.textContent=editing===k?"Close":"Change email";
      ch.onclick=()=>{editing=editing===k?null:k;renderCouncils();if(editing===k){const el=list.querySelector('li[data-key="'+CSS.escape(k)+'"] input');if(el)el.focus()}};
      top.append(nm,ch);
      const em=document.createElement("div");em.className="cemail";
      if(email){em.textContent=email;if(mine){const t=document.createElement("span");t.className="tag mine";t.textContent="Your email";em.append(" ",t)}}
      else{em.textContent=info.web?"No email. Reports go through their website.":"No email yet. Add one to send reports here.";em.classList.add("none")}
      const links=document.createElement("div");links.className="clinks";
      if(info.phone){const a=document.createElement("a");a.href="tel:"+info.phone.replace(/[^\d+]/g,"");a.textContent=info.phone;links.append(a)}
      if(info.web){const a=document.createElement("a");a.href="https://"+info.web;a.target="_blank";a.rel="noopener";a.textContent="Website";links.append(a)}
      else{const a=document.createElement("a");a.href="https://www.google.com/search?q="+encodeURIComponent(info.name+" report road hazard email");a.target="_blank";a.rel="noopener";a.textContent="Find their email";links.append(a)}
      li.append(top,em,links);
      if(editing===k){
        const box=document.createElement("div");box.className="cedit";
        const inp=document.createElement("input");inp.type="email";inp.value=mine||"";inp.placeholder=(vr?TO:info.email)||"Their reporting email";
        inp.setAttribute("aria-label","Email for "+info.name);
        const sv=document.createElement("button");sv.type="button";sv.className="mini";sv.textContent="Save";
        const save1=()=>{const v=inp.value.trim();if(v&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)){inp.setCustomValidity("Check the email address");inp.reportValidity();return}
          if(v)S.councils[k]=v;else delete S.councils[k];editing=null;save();renderCouncils();updateButtons();toast(v?"Email saved":"Using the standard email")};
        sv.onclick=save1;inp.onkeydown=e=>{if(e.key==="Enter")save1()};inp.oninput=()=>inp.setCustomValidity("");
        box.append(inp,sv);
        if(mine&&(vr||info.email)){const rs=document.createElement("button");rs.type="button";rs.className="mini";rs.textContent="Use standard";rs.onclick=()=>{delete S.councils[k];editing=null;save();renderCouncils();updateButtons();toast("Using the standard email")};box.append(rs)}
        li.append(box);
      }
      list.append(li);
    });
    $("councilCount").textContent=keys.length?"":"No council matches that search.";
  }
  $("councilSearch").addEventListener("input",renderCouncils);
  function focusCouncil(c){
    const k=coreName(c);$("councilBox").open=true;$("councilSearch").value="";editing=k;renderCouncils();
    const li=$("councilList").querySelector('li[data-key="'+CSS.escape(k)+'"]');
    if(li){li.scrollIntoView({block:"center"});const el=li.querySelector("input");if(el)el.focus()}
  }
  function renderHistory(){
    const ul=$("history");ul.innerHTML="";
    $("clearHistoryBtn").hidden=!S.history.length;
    if(!S.history.length){ul.innerHTML='<li><p class="empty">Nothing sent yet.</p></li>';return}
    S.history.forEach(h=>{
      const li=document.createElement("li");
      const s=document.createElement("div");s.textContent=h.subject;
      const d=document.createElement("div");d.className="sub";
      d.textContent=new Date(h.at).toLocaleString("en-AU",{dateStyle:"medium",timeStyle:"short"})+", "+h.count+(h.count===1?" pothole":" potholes")+(h.to?" to "+h.to:", fixed before it was sent");
      li.append(s,d);
      (h.items||[]).forEach(q=>{
        const row=document.createElement("div");row.className="hitem";
        const t=document.createElement("span");t.textContent=(q.road||"Pothole")+(q.suburb?", "+q.suburb:"");
        row.append(t);
        if(q.fixed){const f=document.createElement("span");f.className="tag ok";f.textContent="\u201cFixed\u201d";row.append(f)}
        else{const b=document.createElement("button");b.type="button";b.className="mini ok";b.textContent="Mark fixed";b.onclick=()=>markFixed(q,h);row.append(b)}
        li.append(row);
      });
      ul.appendChild(li);
    });
  }
  function toast(t,undo){
    const el=$("toast");el.textContent=t;el.classList.toggle("act",!!undo);
    if(undo){const b=document.createElement("button");b.type="button";b.textContent="Undo";b.onclick=()=>{undo();el.classList.remove("show","act")};el.append(" ",b)}
    el.classList.add("show");clearTimeout(toast._t);toast._t=setTimeout(()=>el.classList.remove("show","act"),undo?6000:2400);
  }

  // ---------- delete and clear ----------
  // The rider who logged it says it's fixed: off the map straight away, but it stays in the counts.
  function markFixed(q,entry){
    const after=Date.now()+7000,inQueue=!entry,idx=S.queue.indexOf(q);
    q.fixed=true;
    if(q.mapId)S.unshare.push({op:"fixed",id:q.mapId,key:q.mapKey,ref:q.id,after});
    if(inQueue){
      S.queue=S.queue.filter(x=>x!==q);
      entry={at:new Date().toISOString(),count:1,to:"",subject:(q.road||"Pothole")+(q.suburb?", "+q.suburb:""),items:[q]};
      S.history.unshift(entry);S.history=S.history.slice(0,50);
    }
    save();renderQueue();renderHistory();renderCouncils();setTimeout(flushUnshare,7500);
    toast("Marked \u201cfixed\u201d. Off the map, still in the counts.",()=>{
      q.fixed=false;S.unshare=S.unshare.filter(u=>!(u.op==="fixed"&&u.ref===q.id));
      if(inQueue){S.history=S.history.filter(h=>h!==entry);S.queue.splice(Math.max(0,Math.min(idx,S.queue.length)),0,q)}
      save();renderQueue();renderHistory();renderCouncils();
    });
  }
  // Tell the map server which council's area each pothole is in (core name), and whether it's a VicRoads road.
  // Worst offenders counts everything in the area; VicRoads roads also get their own total.
  function councilKey(q){return VIC[coreName(q.council)]?coreName(q.council):""}
  // The direction of travel goes along too, so older reports pick it up for pothole-ahead warnings.
  const syncKey=q=>councilKey(q)+"|"+(q.auth==="vicroads"?"vicroads":"")+"|"+(q.bearing==null?"":q.bearing);
  async function syncCouncils(){
    if(!navigator.onLine)return;
    const all=[...S.queue,...S.history.flatMap(h=>h.items||[])];
    for(const q of all){
      if(!q.mapId||q.deleted||q.councilSyncing||q.lookup==="pending")continue;
      const want=syncKey(q);if((q.councilSent||"")===want)continue;
      q.councilSyncing=true;
      try{
        const r=await fetch(API+"/api/potholes/"+encodeURIComponent(q.mapId)+"/council",{method:"POST",headers:{"Content-Type":"application/json","X-Delete-Key":q.mapKey},body:JSON.stringify({council:councilKey(q),vicroads:q.auth==="vicroads",heading:q.bearing==null?null:+q.bearing})});
        if(r.ok){q.councilSent=want;setStats(await r.json())}else if(r.status===403||r.status===400)q.councilSent=want;
      }catch(e){}
      finally{delete q.councilSyncing;save()}
    }
  }
  function removeReports(ids){
    const gone=S.queue.map((q,i)=>[i,q]).filter(([,q])=>ids.includes(q.id));
    if(!gone.length)return;
    const after=Date.now()+7000;
    gone.forEach(([,q])=>{q.deleted=true;if(q.mapId)S.unshare.push({id:q.mapId,key:q.mapKey,ref:q.id,after})});
    S.queue=S.queue.filter(q=>!ids.includes(q.id));save();renderQueue();renderCouncils();
    setTimeout(flushUnshare,7500);
    toast((gone.length===1?"Deleted":gone.length+" deleted")+", and off the riders' map and counts.",()=>{
      gone.forEach(([i,q])=>{q.deleted=false;if(!S.queue.some(x=>x.id===q.id))S.queue.splice(Math.min(i,S.queue.length),0,q)});
      S.unshare=S.unshare.filter(u=>!gone.some(([,q])=>q.id===u.ref));
      save();renderQueue();renderCouncils();
    });
  }
  // Swipe a report left to delete it.
  function swipeToDelete(li,handle,id){
    let x0=null,y0=0,dx=0,dragging=false;
    handle.addEventListener("pointerdown",e=>{if(e.pointerType==="mouse"||e.target.closest("button,a,input"))return;x0=e.clientX;y0=e.clientY;dx=0;dragging=false});
    handle.addEventListener("pointermove",e=>{
      if(x0===null)return;
      const mx=e.clientX-x0,my=e.clientY-y0;
      if(!dragging){if(Math.abs(my)>12){x0=null;return}if(mx<-12){dragging=true;li.classList.add("swiping");try{handle.setPointerCapture(e.pointerId)}catch(_){}}else return}
      dx=Math.min(0,mx);li.style.transform="translateX("+dx+"px)";li.style.opacity=String(Math.max(.3,1+dx/300));
    });
    const end=()=>{
      if(x0===null)return;x0=null;if(!dragging)return;
      li.classList.remove("swiping");
      if(dx<-Math.min(120,li.offsetWidth*.35)){li.style.transform="translateX(-110%)";li.style.opacity="0";setTimeout(()=>removeReports([id]),180)}
      else{li.style.transform="";li.style.opacity=""}
    };
    handle.addEventListener("pointerup",end);handle.addEventListener("pointercancel",end);
  }
  $("clearBtn").onclick=()=>{$("clearText").textContent="Delete all "+S.queue.length+(S.queue.length===1?" report?":" reports?")+" They'll also come off the riders' map and out of the counts. Been fixed? Use Fixed on each one instead so they still count.";$("clearConfirm").hidden=false};
  $("clearNo").onclick=()=>{$("clearConfirm").hidden=true};
  $("clearYes").onclick=()=>{$("clearConfirm").hidden=true;removeReports(S.queue.map(q=>q.id))};
  $("clearHistoryBtn").onclick=()=>{
    const old=S.history;S.history=[];save();renderHistory();
    toast("Sent list cleared",()=>{S.history=old.concat(S.history).slice(0,50);save();renderHistory()});
  };

  S.queue.forEach(q=>{if(q.lookup==="pending")q.lookup="failed";delete q.sharing});
  // ---------- riders' map: sharing ----------
  // Only the spot goes up. The server keeps the day, and hands back a key so this phone can take it down again.
  async function shareOne(q){
    if(!S.me.share||q.mapId||q.sharing||(q.shareFail||0)>=3||!navigator.onLine)return;
    q.sharing=true;
    try{
      const r=await fetch(API+"/api/potholes",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({lat:+q.lat,lng:+q.lng,heading:q.bearing==null?null:+q.bearing})});
      if(r.status===400){q.shareFail=3;return}
      if(!r.ok)throw new Error("http "+r.status);
      const d=await r.json();q.mapId=d.id;q.mapKey=d.key;setStats(d);
      if(q.deleted){S.unshare.push({id:d.id,key:d.key,ref:q.id,after:0});flushUnshare()}
      else if(q.fixed){S.unshare.push({op:"fixed",id:d.id,key:d.key,ref:q.id,after:0});flushUnshare()}
      setTimeout(syncCouncils,0);
      if(mapObj&&$("mapBox").open)loadPoints();
    }catch(e){q.shareFail=(q.shareFail||0)+1}
    finally{delete q.sharing;save()}
  }
  function shareMissing(){S.queue.forEach(shareOne)}
  let flushing=false;
  async function flushUnshare(){
    if(flushing||!navigator.onLine)return;flushing=true;
    try{
      for(const u of S.unshare.filter(u=>Date.now()>=u.after)){
        try{
          const r=u.op==="fixed"
            ?await fetch(API+"/api/potholes/"+encodeURIComponent(u.id)+"/fixed",{method:"POST",headers:{"X-Delete-Key":u.key}})
            :await fetch(API+"/api/potholes/"+encodeURIComponent(u.id),{method:"DELETE",headers:{"X-Delete-Key":u.key}});
          if(r.ok||r.status===401||r.status===403||r.status===404){S.unshare=S.unshare.filter(x=>x!==u);if(r.ok)setStats(await r.json())}
        }catch(e){break}
      }
      save();
    }finally{flushing=false}
  }
  $("shareMap").checked=S.me.share!==false;
  $("shareMap").onchange=()=>{S.me.share=$("shareMap").checked;save();if(S.me.share){S.queue.forEach(q=>{q.shareFail=0});shareMissing()}};

  // ---------- global counter ----------
  function setStats(d){
    if(!d||typeof d.total!=="number")return;
    const worst=(Array.isArray(d.worst)?d.worst:[]).filter(w=>Array.isArray(w)&&VIC[w[0]]).map(w=>[w[0],Math.max(0,Math.floor(+w[1])||0)]).slice(0,3);
    S.stats={total:d.total,week:d.week||0,fixed:d.fixed||0,vicroads:Math.max(0,Math.floor(+d.vicroads)||0),worst};save();renderStats();
  }
  function renderStats(){
    const s=S.stats,n=x=>(+x||0).toLocaleString("en-AU");
    $("gcTotal").textContent=s?n(s.total):"\u2013";$("gcWeek").textContent=s&&s.week?n(s.week)+" this week":"";
    $("gcFixed").textContent=s?n(s.fixed):"\u2013";
    const w=(s&&s.worst)||[],vr=(s&&s.vicroads)||0,ol=$("worstList");ol.innerHTML="";$("worst").hidden=!w.length&&!vr;
    $("worstVr").hidden=!vr;$("worstVrN").textContent=n(vr);
    w.forEach(([k,c])=>{const li=document.createElement("li");const nm=document.createElement("span");nm.textContent=shortCouncil(VIC[k].name);
      const b=document.createElement("b");b.textContent=n(c);li.append(nm,b);ol.append(li)});
  }
  async function fetchStats(){try{const r=await fetch(API+"/api/stats");if(r.ok)setStats(await r.json())}catch(e){}}

  // ---------- riders' map: viewing ----------
  let mapObj=null,mapLayer=null,mapDays=30,mapFitted=false,leafletP=null;
  function loadLeaflet(){
    if(leafletP)return leafletP;
    const base="https://cdnjs.cloudflare.com/ajax/libs/";
    // Pinned with integrity hashes, so a tampered copy on the CDN won't run.
    const css=(h,sri)=>{const l=document.createElement("link");l.rel="stylesheet";l.href=base+h;l.integrity=sri;l.crossOrigin="anonymous";document.head.appendChild(l)};
    const js=(h,sri)=>new Promise((ok,no)=>{const e=document.createElement("script");e.src=base+h;e.integrity=sri;e.crossOrigin="anonymous";e.onload=ok;e.onerror=no;document.head.appendChild(e)});
    css("leaflet/1.9.4/leaflet.css","sha384-sHL9NAb7lN7rfvG5lfHpm643Xkcjzp4jFvuavGOndn6pjVqS6ny56CAt3nsEVT4H");
    css("leaflet.markercluster/1.5.3/MarkerCluster.css","sha384-pmjIAcz2bAn0xukfxADbZIb3t8oRT9Sv0rvO+BR5Csr6Dhqq+nZs59P0pPKQJkEV");
    css("leaflet.markercluster/1.5.3/MarkerCluster.Default.css","sha384-wgw+aLYNQ7dlhK47ZPK7FRACiq7ROZwgFNg0m04avm4CaXS+Z9Y7nMu8yNjBKYC+");
    leafletP=js("leaflet/1.9.4/leaflet.js","sha384-cxOPjt7s7Iz04uaHJceBmS+qpjv2JkIHNVcuOrM+YHwZOmJGBXI00mdUXEq65HTH")
      .then(()=>js("leaflet.markercluster/1.5.3/leaflet.markercluster.js","sha384-eXVCORTRlv4FUUgS/xmOyr66XBVraen8ATNLMESp92FKXLAMiKkerixTiBvXriZr"));
    leafletP.catch(()=>{leafletP=null});
    return leafletP;
  }
  const agoText=n=>n===0?"Logged today":n===1?"Logged yesterday":"Logged "+n+" days ago";

  // ---------- riders' map: is it still there? ----------
  // "Gone" and "Fixed" (a patch job, said with a straight face) both count towards taking it off the map;
  // "Still there" counts against. The server decides, one vote per rider per pothole.
  let clearAt=3;
  const VOTES=[["gone","Gone","Properly fixed"],["fixed","\u201cFixed\u201d","Patched. Sort of."],["there","Still there","Watch out"]];
  const QUIPS={gone:"Gone. Another one bites the dust.",fixed:"\u201cFixed.\u201d We'll believe it when we ride it.",there:"Still there. Noted, eyes up."};
  function potholePopup(p,marker){
    const box=document.createElement("div");box.className="pop";
    const h=document.createElement("strong");h.textContent=agoText(p.ago);
    const tally=document.createElement("div");tally.className="pop-tally";
    const btns=document.createElement("div");btns.className="pop-btns";
    const note=document.createElement("div");note.className="pop-note";note.setAttribute("role","status");
    const draw=()=>{
      const bits=[];if(p.gone)bits.push(p.gone+" gone");if(p.fixed)bits.push(p.fixed+" \u201cfixed\u201d");if(p.there)bits.push(p.there+" still there");
      const need=clearAt-(p.gone+p.fixed-p.there);
      tally.textContent=(bits.length?"Riders say: "+bits.join(", ")+". ":"Ridden past it lately? ")+(need>0?need+" more \u201cgone\u201d and it's off the map.":"");
      btns.innerHTML="";
      VOTES.forEach(([k,label,sub])=>{
        const b=document.createElement("button");b.type="button";b.className="pop-btn "+k;b.setAttribute("aria-pressed",S.votes[p.id]===k);
        const t=document.createElement("b");t.textContent=label;const st=document.createElement("small");st.textContent=sub;b.append(t,st);
        b.disabled=!p.id;b.onclick=()=>vote(p,k,marker,draw,note);btns.append(b);
      });
    };
    draw();box.append(h,tally,btns,note);return box;
  }
  async function vote(p,kind,marker,draw,note){
    if(S.votes[p.id]===kind){note.textContent="You already said that one.";return}
    note.textContent="Sending…";
    try{
      const r=await fetch(API+"/api/potholes/"+encodeURIComponent(p.id)+"/flag",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({kind})});
      if(r.status===429){note.textContent="Easy, tiger. Too many votes for now, try later.";return}
      if(!r.ok)throw new Error("http "+r.status);
      const d=await r.json();setStats(d);
      S.votes[p.id]=kind;const ids=Object.keys(S.votes);if(ids.length>500)delete S.votes[ids[0]];save();
      const v=d.votes||{};p.gone=+v.gone||0;p.fixed=+v.fixed||0;p.there=+v.there||0;
      if(d.cleared){mapObj.closePopup();mapLayer.removeLayer(marker);toast(kind==="fixed"?"\u201cFixed\u201d and off the map. Ride it gently.":"Off the map. Nice one.");return}
      draw();note.textContent=QUIPS[kind];
    }catch(e){note.textContent="Couldn't send that. Check your signal."}
  }
  async function showMap(){
    $("mapCount").textContent="Loading…";
    try{await loadLeaflet()}catch(e){$("mapCount").textContent="The map needs signal";return}
    if(!mapObj){
      mapObj=L.map("map").setView([-37.68,144.55],10);
      L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png",{maxZoom:19,attribution:'&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'}).addTo(mapObj);
    }
    setTimeout(()=>mapObj.invalidateSize(),60);
    loadPoints();
  }
  async function loadPoints(){
    try{
      const r=await fetch(API+"/api/potholes?days="+mapDays);if(!r.ok)throw new Error("http "+r.status);
      const d=await r.json();setStats(d);
      if(mapLayer)mapObj.removeLayer(mapLayer);
      mapLayer=L.markerClusterGroup({maxClusterRadius:40,showCoverageOnHover:false});
      clearAt=Math.max(1,Math.floor(+d.clearAt)||3);
      // Only plain numbers and a checked id from the server reach the map; popups are built from DOM nodes, never HTML.
      const num=x=>Math.max(0,Math.floor(+x)||0);
      (Array.isArray(d.points)?d.points:[])
        .map(p=>({lat:+p[0],lng:+p[1],ago:num(p[2]),id:/^[A-Za-z0-9_-]{6,32}$/.test(p[3])?p[3]:"",gone:num(p[4]),fixed:num(p[5]),there:num(p[6])}))
        .filter(p=>Number.isFinite(p.lat)&&Number.isFinite(p.lng))
        .forEach(p=>{
          const m=L.circleMarker([p.lat,p.lng],{radius:8,weight:2,color:"#141516",fillColor:p.ago<7?"#ff6b1a":p.ago<31?"#f5c518":"#9aa0a6",fillOpacity:.95});
          m.bindPopup(()=>potholePopup(p,m),{minWidth:220});mapLayer.addLayer(m);
        });
      mapObj.addLayer(mapLayer);
      $("mapCount").textContent=d.points.length.toLocaleString("en-AU")+" shown";
      if(d.points.length&&!mapFitted){mapObj.fitBounds(mapLayer.getBounds(),{maxZoom:14,padding:[24,24]});mapFitted=true}
    }catch(e){$("mapCount").textContent="Couldn't load the map. Check your signal."}
  }
  $("mapBox").addEventListener("toggle",()=>{if($("mapBox").open)showMap()});
  $("mapRange").querySelectorAll("[data-days]").forEach(b=>b.onclick=()=>{
    mapDays=+b.dataset.days;$("mapRange").querySelectorAll("[data-days]").forEach(x=>x.setAttribute("aria-pressed",x===b));
    if(mapObj)loadPoints();
  });
  let meDot=null;
  $("mapMe").onclick=()=>{
    if(!mapObj||!("geolocation" in navigator))return;
    navigator.geolocation.getCurrentPosition(p=>{
      const ll=[p.coords.latitude,p.coords.longitude];mapObj.setView(ll,14);
      if(meDot)meDot.setLatLng(ll);else meDot=L.circleMarker(ll,{radius:7,weight:3,color:"#fff",fillColor:"#1d6fd8",fillOpacity:1}).addTo(mapObj).bindPopup("You are here");
    },()=>{$("mapCount").textContent="Location is blocked for this site."},{enableHighAccuracy:true,timeout:15000,maximumAge:60000});
  };


  // ---------- pothole-ahead warnings ----------
  // Keeps a copy of the riders' map on the phone (so it works with no signal) and checks every GPS fix for a pothole
  // in front of you: within 25° of your direction of travel and about 8 seconds away. Sound first (voice or beep),
  // plus a big banner. Once you've ridden past, a card asks whether it's still there, which feeds the map's votes.
  // The other side of the road: a pothole logged with a direction only warns riders going the same way (within 45°).
  // One with no direction only warns if it's almost on your line, and never asks "still there?", because a rider on
  // the other carriageway can't see it and would wrongly vote it gone.
  const AHEAD_LS="pothole_reporter_ahead",CONE=25,LEAD_S=8,MIN_KMH=15,SAME_WAY=45,NO_DIR_SIDE=8;
  let aheadPts=[];try{aheadPts=JSON.parse(localStorage.getItem(AHEAD_LS))||[]}catch(e){}
  const warned={};let target=null,passedTimer=null,audio=null;
  const wantWarn=()=>S.me.warn!==false,soundMode=()=>S.me.warnSound||"voice";
  async function fetchAhead(){
    if(!navigator.onLine)return;
    try{
      const r=await fetch(API+"/api/potholes?days=365");if(!r.ok)return;
      const d=await r.json();
      aheadPts=(Array.isArray(d.points)?d.points:[]).map(p=>[+p[0],+p[1],/^[A-Za-z0-9_-]{6,32}$/.test(p[3])?p[3]:"",p[7]==null||!Number.isFinite(+p[7])?null:+p[7]])
        .filter(p=>Number.isFinite(p[0])&&Number.isFinite(p[1])&&p[2]);
      try{localStorage.setItem(AHEAD_LS,JSON.stringify(aheadPts))}catch(e){}
    }catch(e){}
  }
  const angle=(a,b)=>{const d=Math.abs(a-b)%360;return d>180?360-d:d};
  function checkAhead(){
    if(!live)return;
    if(target){
      // Follow the one we warned about until it's behind us, then ask about it.
      const p={lat:target.lat,lng:target.lng},d=dist(live,p),hd=headingFrom(live);
      target.min=Math.min(target.min,d);
      if(hd!=null&&d<120&&angle(bearing(live,p),hd)>90&&target.min<60){if(target.ask)passedIt(target);target=null;hideAhead();return}
      if(d>target.min+150||Date.now()-target.t>40000){target=null;hideAhead();return}
      $("aheadDist").textContent=Math.max(10,Math.round(d/10)*10)+" m";
      return;
    }
    if(!wantWarn())return;
    const kmh=gpsSpeed(),hd=headingFrom(live);
    if(kmh==null||kmh<MIN_KMH||hd==null||live.acc>30)return;
    const reach=Math.max(80,kmh/3.6*LEAD_S),box=reach/111000*1.5;
    let best=null;
    for(const [lat,lng,id,ph] of aheadPts){
      if(Math.abs(lat-live.lat)>box||Math.abs(lng-live.lng)>box*1.4)continue;
      if(warned[id]&&Date.now()-warned[id]<10*60000)continue;
      if(ph!=null&&angle(ph,hd)>SAME_WAY)continue;
      const p={lat,lng},d=dist(live,p),off=angle(bearing(live,p),hd);
      if(d>reach||d<15||off>CONE)continue;
      // How far to the side of your line it is. No direction saved: only count it if it's right on your line.
      if(ph==null&&d*Math.sin(off*rad)>NO_DIR_SIDE)continue;
      if(!best||d<best.d)best={lat,lng,id,d,ask:ph!=null};
    }
    if(!best)return;
    warned[best.id]=Date.now();
    target={...best,min:best.d,t:Date.now()};
    warnNow(best.d);
  }
  function warnNow(d){
    const m=Math.max(10,Math.round(d/10)*10);
    $("aheadDist").textContent=m+" m";$("ahead").hidden=false;
    const mode=soundMode();
    if(mode==="voice"&&"speechSynthesis" in window){
      try{speechSynthesis.cancel();const u=new SpeechSynthesisUtterance("Pothole ahead. "+(Math.round(d/50)*50||50)+" metres");u.lang="en-AU";u.rate=1.1;speechSynthesis.speak(u)}catch(e){}
    }else if(mode!=="off")beep();
    if(navigator.vibrate)try{navigator.vibrate([200,100,200])}catch(e){}
  }
  function hideAhead(){$("ahead").hidden=true}
  // Browsers only allow sound after the first touch, so the audio is set up then.
  function unlockAudio(){
    if(audio)return;
    try{const A=window.AudioContext||window.webkitAudioContext;if(A){audio=new A();audio.resume()}}catch(e){}
    if("speechSynthesis" in window)try{speechSynthesis.speak(new SpeechSynthesisUtterance(""))}catch(e){}
    renderWarn();
  }
  document.addEventListener("pointerdown",unlockAudio,{passive:true});
  function beep(){
    if(!audio)return;
    const t=audio.currentTime;
    [0,.22].forEach(o=>{const g=audio.createGain(),v=audio.createOscillator();v.type="square";v.frequency.value=1100;
      g.gain.setValueAtTime(.0001,t+o);g.gain.exponentialRampToValueAtTime(.4,t+o+.02);g.gain.exponentialRampToValueAtTime(.0001,t+o+.16);
      v.connect(g).connect(audio.destination);v.start(t+o);v.stop(t+o+.18)});
  }
  function passedIt(p){
    clearTimeout(passedTimer);
    const box=$("passed");box.hidden=false;box.dataset.id=p.id;
    passedTimer=setTimeout(()=>{box.hidden=true},15000);
  }
  async function passVote(kind){
    const box=$("passed"),id=box.dataset.id;box.hidden=true;clearTimeout(passedTimer);
    if(!id||!kind)return;
    try{
      const r=await fetch(API+"/api/potholes/"+encodeURIComponent(id)+"/flag",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({kind})});
      if(!r.ok){toast(r.status===429?"Too many votes for now, try later.":"Couldn't send that. Check your signal.");return}
      const d=await r.json();setStats(d);
      S.votes[id]=kind;const ids=Object.keys(S.votes);if(ids.length>500)delete S.votes[ids[0]];save();
      if(d.cleared)aheadPts=aheadPts.filter(p=>p[2]!==id);
      toast(d.cleared?"Off the map. Nice one.":QUIPS[kind]);
    }catch(e){toast("Couldn't send that. Check your signal.")}
  }
  $("passThere").onclick=()=>passVote("there");
  $("passGone").onclick=()=>passVote("gone");
  $("passSkip").onclick=()=>passVote("");
  const SOUNDS=[["voice","Voice"],["beep","Beep"],["off","Silent"]];
  function renderWarn(){
    const on=wantWarn(),b=$("warnBtn");
    b.setAttribute("aria-pressed",on);b.classList.toggle("on",on);
    $("warnText").textContent=on?(soundMode()!=="off"&&!audio?"Pothole warnings (tap anywhere for sound)":"Pothole warnings on"):"Pothole warnings off";
    $("soundBtn").hidden=!on;
    $("soundText").textContent="Sound: "+SOUNDS.find(x=>x[0]===soundMode())[1];
  }
  $("warnBtn").onclick=()=>{S.me.warn=!wantWarn();save();renderWarn();if(wantWarn()){startWarm();fetchAhead()}else{target=null;hideAhead()}
    toast(wantWarn()?"You'll get a warning before reported potholes.":"Pothole warnings off.")};
  $("soundBtn").onclick=()=>{const i=SOUNDS.findIndex(x=>x[0]===soundMode());S.me.warnSound=SOUNDS[(i+1)%SOUNDS.length][0];save();renderWarn();
    if(soundMode()==="voice"&&"speechSynthesis" in window)try{speechSynthesis.speak(new SpeechSynthesisUtterance("Pothole ahead"))}catch(e){}
    else if(soundMode()==="beep")beep()};
  renderWarn();
  if(wantWarn())fetchAhead();
  setInterval(()=>{if(wantWarn()&&document.visibilityState==="visible")fetchAhead()},15*60000);

  // ---------- keep the screen on while the app is open ----------
  // Uses the Screen Wake Lock API. The phone drops the lock whenever the app goes to the background,
  // so it's asked for again each time the app comes back into view. On by default; the button turns it off.
  let wake=null;
  const wantAwake=()=>S.me.awake!==false;
  function renderAwake(){
    const b=$("awakeBtn");b.hidden=false;
    if(!("wakeLock" in navigator)){b.disabled=true;b.setAttribute("aria-pressed","false");$("awakeText").textContent="This phone can't keep the screen on";return}
    b.setAttribute("aria-pressed",wantAwake());b.classList.toggle("on",!!wake);
    $("awakeText").textContent=wantAwake()?(wake?"Screen stays on":"Screen stays on (tap anywhere to start)"):"Screen can sleep";
    b.title=wantAwake()?"Uses more battery. Tap to let the screen sleep.":"Tap to keep the screen on while riding";
  }
  async function applyAwake(){
    if(!("wakeLock" in navigator)){renderAwake();return}
    if(wantAwake()&&document.visibilityState==="visible"&&!wake){
      try{wake=await navigator.wakeLock.request("screen");wake.addEventListener("release",()=>{wake=null;renderAwake()})}catch(e){wake=null}
    }else if(!wantAwake()&&wake){try{await wake.release()}catch(e){}wake=null}
    renderAwake();
  }
  $("awakeBtn").onclick=()=>{S.me.awake=!wantAwake();save();applyAwake();toast(wantAwake()?"Screen will stay on while the app is open.":"Screen can sleep again.")};
  document.addEventListener("visibilitychange",applyAwake);
  // Some phones only allow it after a tap, so try again on the first touch.
  document.addEventListener("pointerdown",()=>{if(!wake)applyAwake()},{passive:true});
  applyAwake();

  // ---------- share with other riders ----------
  const SITE="https://jclissoldyasa-boop.github.io/pothole-reporter/";
  function shareText(){
    const t=S.stats&&S.stats.total;
    return "Sick of dodging potholes? Help keep riders upright. Log them in one tap and they're sent to whoever's meant to fix them, VicRoads or the council. Plus a live map of every hole riders have found"+(t?", "+t.toLocaleString("en-AU")+" and counting.":".");
  }
  function showQR(open){
    $("qrBox").hidden=!open;$("qrBtn").setAttribute("aria-expanded",open);$("qrBtn").textContent=open?"Hide":"More ways";
    if(open){
      const t=shareText(),both=t+" "+SITE,e=encodeURIComponent;
      $("shWhatsapp").href="https://wa.me/?text="+e(both);
      $("shFacebook").href="https://www.facebook.com/sharer/sharer.php?u="+e(SITE);
      $("shMessenger").href="fb-messenger://share/?link="+e(SITE);
      $("shSms").href="sms:?&body="+e(both);
      $("shEmail").href="mailto:?subject="+e("Motorcycle Pothole Reporter")+"&body="+e(both);
    }
  }
  $("qrBtn").onclick=()=>showQR($("qrBox").hidden);
  $("shareLink").onfocus=()=>$("shareLink").select();
  // Copy that can't hang: the clipboard API gets a second, then the old select-and-copy way.
  async function copyLink(){
    const text=shareText()+" "+SITE;
    try{
      if(!navigator.clipboard||!navigator.clipboard.writeText)throw new Error("no clipboard");
      await Promise.race([navigator.clipboard.writeText(text),new Promise((_,no)=>setTimeout(()=>no(new Error("timeout")),1000))]);
      toast("Link copied. Paste it to your riding mates.");return;
    }catch(e){}
    const el=$("shareLink");el.focus();el.select();
    let ok=false;try{ok=document.execCommand("copy")}catch(e){}
    toast(ok?"Link copied. Paste it to your riding mates.":matchMedia("(pointer: coarse)").matches?"Press and hold the link to copy it.":"Link selected. Press Ctrl+C to copy it.");
  }
  $("shCopy").onclick=copyLink;
  $("shareBtn").onclick=async()=>{
    // Phones (touch screens) open their own share menu. Computers, including Chromebooks, either refuse it
    // ("Permission denied") or open a system window that's easy to miss, so they get the share panel.
    // A phone that refuses gets the panel too.
    if(navigator.share&&matchMedia("(pointer: coarse)").matches){
      try{await navigator.share({title:"Motorcycle Pothole Reporter",text:shareText(),url:SITE});return}
      catch(e){if(e&&e.name==="AbortError")return}
    }
    showQR(true);$("qrBox").scrollIntoView({block:"nearest",behavior:"smooth"});
  };

  renderQueue();renderCouncils();renderHistory();renderStats();save();
  fetchStats();shareMissing();flushUnshare();
  if(S.queue.some(q=>q.lookup==="failed"||q.lookup==="offline"||needsArea(q)))lookupMissing();

  // ---------- one tap from the home screen ----------
  // The "Log a pothole" app shortcut (and any link ending ?report=1) logs one as soon as the app opens.
  // The ?report is wiped first, so a reload or going back doesn't log a second one.
  if(new URLSearchParams(location.search).has("report")){
    history.replaceState(null,"",location.pathname+location.hash);
    $("markBtn").click();
  }
  // Already running as the installed app: point straight at the press-and-hold step.
  if(matchMedia("(display-mode: standalone)").matches)$("guideDone").hidden=false;
  window.addEventListener("appinstalled",()=>{toast("Added. Press and hold the icon for the Log a pothole shortcut.")});

  if("serviceWorker" in navigator&&location.protocol==="https:")navigator.serviceWorker.register("sw.js").catch(()=>{});
})();
