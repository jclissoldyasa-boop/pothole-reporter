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
  const DEFAULT={me:{name:"",phone:"",email:"",share:true},councils:{},unshare:[],stats:null,suburbCouncil:{},queue:[],history:[]};

  let S=(function(){try{const v=JSON.parse(localStorage.getItem(LS));if(v&&v.me)return{...DEFAULT,...v,me:{...DEFAULT.me,...v.me}}}catch(e){}return JSON.parse(JSON.stringify(DEFAULT))})();
  // Older versions kept one council email (it was always Melton's).
  if(S.me.councilEmail){if(!S.councils[MELTON])S.councils[MELTON]=S.me.councilEmail;delete S.me.councilEmail}
  function save(){try{localStorage.setItem(LS,JSON.stringify(S))}catch(e){}}
  // Early versions came with the developer's name and phone filled in, and saved them on every phone. Clear them once.
  if(!S.meReset){let h=5381;for(const c of S.me.name+"|"+S.me.phone)h=((h*33)^c.charCodeAt(0))>>>0;if(h===2492536473){S.me.name="";S.me.phone=""}S.meReset=true}

  // Councils we know how to reach. Others are found on the road and you add their email once.
  const KNOWN={
    "City of Melton":{phone:"03 9747 7200",form:"https://www.melton.vic.gov.au/Online-Forms/General-enquiry-form"},
    "Shire of Moorabool":{email:"info@moorabool.vic.gov.au",phone:"03 5366 7100",form:"https://moorabool.vic.gov.au/Building-and-planning/Roads-and-transport/Report-a-road-maintenance-issue"}
  };
  const councilEmail=c=>(S.councils[c]||(KNOWN[c]&&KNOWN[c].email)||"").trim();

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
    if(council===MELTON){
      if(VR_FULL.includes(r))return{auth:"vicroads",why:"On Melton's list of VicRoads roads"};
      if(VR_PART[r])return{auth:"check",why:VR_PART[r]+". Check the map, then pick one"};
    }
    if(council)return{auth:"council",why:"Local road in the "+council};
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
      live={lat:p.coords.latitude,lng:p.coords.longitude,acc:p.coords.accuracy,heading:p.coords.heading,speed:p.coords.speed||0,t:Date.now()};
      recent.push(live);recent=recent.filter(f=>Date.now()-f.t<20000);
    },()=>{},{enableHighAccuracy:true,maximumAge:0});
  }
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
  const forCouncil=c=>S.queue.filter(q=>q.auth==="council"&&(q.council||"")===c);
  const councilsInQueue=()=>[...new Set(S.queue.filter(q=>q.auth==="council").map(q=>q.council||""))];
  function openEmail(who,council){
    const items=who==="council"?forCouncil(council):S.queue.filter(q=>q.auth===who);
    if(!items.length)return;
    if(who==="council"&&!council){msg("Open Details on those reports and fill in Council.","err");return}
    const to=who==="council"?councilEmail(council):TO;
    if(!to){focusCouncil(council);msg("Add an email for the "+council+" first.","err");return}
    const {subject,body}=compose(items);
    const label=who==="council"?council:"VicRoads";
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
    S.history.unshift({at:new Date().toISOString(),count:items.length,to:pending.label,subject:pending.subject});
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
  const authLabel=q=>q.auth==="vicroads"?"VicRoads":q.auth==="council"?(q.council?q.council.replace(/^(City|Shire|Rural City|Borough) of /,""):"Council"):"Check";
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
      const del=document.createElement("button");del.className="mini danger";del.type="button";del.textContent="Delete";
      del.setAttribute("aria-label","Delete pothole "+(i+1));
      del.onclick=()=>removeReports([q.id]);
      head.append(num,meta,ed,del);
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
      b.textContent=!c?n+" council "+(n===1?"report needs":"reports need")+" a council name":"Email "+n+" to "+c+(councilEmail(c)?"":" (add email first)");
      b.onclick=()=>openEmail("council",c);box.appendChild(b);
    });
    $("clearBtn").hidden=$("swipeHint").hidden=!S.queue.length;if(!S.queue.length)$("clearConfirm").hidden=true;
    $("lookupBtn").hidden=!S.queue.some(q=>q.lookup==="failed"||q.lookup==="offline"||(q.lookup==="done"&&needsArea(q)));
  }
  function renderCouncils(){
    const list=$("councilList");list.innerHTML="";
    const names=[...new Set([...Object.keys(KNOWN),...Object.keys(S.councils),...S.queue.map(q=>q.council).filter(Boolean)])].sort();
    names.forEach(c=>{
      const id="ce_"+c.replace(/\W+/g,"_"),k=KNOWN[c]||{};
      const lab=document.createElement("label");lab.htmlFor=id;lab.textContent=c;
      const inp=document.createElement("input");inp.id=id;inp.type="email";inp.dataset.council=c;
      inp.placeholder=k.email||"Their reporting email";inp.value=S.councils[c]||"";
      inp.oninput=()=>{const v=inp.value.trim();if(v)S.councils[c]=v;else delete S.councils[c];save();updateButtons()};
      const h=document.createElement("p");h.className="hint";
      if(k.email)h.append("Built in: "+k.email+". ");
      if(k.phone)h.append("Phone "+k.phone+". ");
      const a=document.createElement("a");a.target="_blank";a.rel="noopener";
      if(k.form){a.href=k.form;a.textContent="Online form"}else{a.href="https://www.google.com/search?q="+encodeURIComponent(c+" report pothole email");a.textContent="Find their email"}
      h.append(a);list.append(lab,inp,h);
    });
  }
  function focusCouncil(c){renderCouncils();$("meBox").open=true;const el=[...$("councilList").querySelectorAll("input")].find(x=>x.dataset.council===c);if(el)el.focus()}
  function renderHistory(){
    const ul=$("history");ul.innerHTML="";
    $("clearHistoryBtn").hidden=!S.history.length;
    if(!S.history.length){ul.innerHTML='<li><p class="empty">Nothing sent yet.</p></li>';return}
    S.history.forEach(h=>{
      const li=document.createElement("li");
      const s=document.createElement("div");s.textContent=h.subject;
      const d=document.createElement("div");d.className="sub";
      d.textContent=new Date(h.at).toLocaleString("en-AU",{dateStyle:"medium",timeStyle:"short"})+", "+h.count+(h.count===1?" pothole":" potholes")+" to "+h.to;
      li.append(s,d);ul.appendChild(li);
    });
  }
  function toast(t,undo){
    const el=$("toast");el.textContent=t;el.classList.toggle("act",!!undo);
    if(undo){const b=document.createElement("button");b.type="button";b.textContent="Undo";b.onclick=()=>{undo();el.classList.remove("show","act")};el.append(" ",b)}
    el.classList.add("show");clearTimeout(toast._t);toast._t=setTimeout(()=>el.classList.remove("show","act"),undo?6000:2400);
  }

  // ---------- delete and clear ----------
  function removeReports(ids){
    const gone=S.queue.map((q,i)=>[i,q]).filter(([,q])=>ids.includes(q.id));
    if(!gone.length)return;
    const after=Date.now()+7000;
    gone.forEach(([,q])=>{q.deleted=true;if(q.mapId)S.unshare.push({id:q.mapId,key:q.mapKey,ref:q.id,after})});
    S.queue=S.queue.filter(q=>!ids.includes(q.id));save();renderQueue();renderCouncils();
    setTimeout(flushUnshare,7500);
    toast(gone.length===1?"Report deleted":gone.length+" reports deleted",()=>{
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
  $("clearBtn").onclick=()=>{$("clearText").textContent="Delete all "+S.queue.length+(S.queue.length===1?" report?":" reports?");$("clearConfirm").hidden=false};
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
      const r=await fetch(API+"/api/potholes",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({lat:+q.lat,lng:+q.lng})});
      if(r.status===400){q.shareFail=3;return}
      if(!r.ok)throw new Error("http "+r.status);
      const d=await r.json();q.mapId=d.id;q.mapKey=d.key;setStats(d);
      if(q.deleted){S.unshare.push({id:d.id,key:d.key,ref:q.id,after:0});flushUnshare()}
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
          const r=await fetch(API+"/api/potholes/"+encodeURIComponent(u.id),{method:"DELETE",headers:{"X-Delete-Key":u.key}});
          if(r.ok||r.status===401||r.status===404){S.unshare=S.unshare.filter(x=>x!==u);if(r.ok)setStats(await r.json())}
        }catch(e){break}
      }
      save();
    }finally{flushing=false}
  }
  $("shareMap").checked=S.me.share!==false;
  $("shareMap").onchange=()=>{S.me.share=$("shareMap").checked;save();if(S.me.share){S.queue.forEach(q=>{q.shareFail=0});shareMissing()}};

  // ---------- global counter ----------
  function setStats(d){if(d&&typeof d.total==="number"){S.stats={total:d.total,week:d.week||0};save();renderStats()}}
  function renderStats(){
    const s=S.stats;$("gcTotal").textContent=s?s.total.toLocaleString("en-AU"):"–";
    $("gcWeek").textContent=s&&s.week?s.week.toLocaleString("en-AU")+" this week":"";
  }
  async function fetchStats(){try{const r=await fetch(API+"/api/stats");if(r.ok)setStats(await r.json())}catch(e){}}

  // ---------- riders' map: viewing ----------
  let mapObj=null,mapLayer=null,mapDays=30,mapFitted=false,leafletP=null;
  function loadLeaflet(){
    if(leafletP)return leafletP;
    const base="https://cdnjs.cloudflare.com/ajax/libs/";
    const css=h=>{const l=document.createElement("link");l.rel="stylesheet";l.href=base+h;document.head.appendChild(l)};
    const js=h=>new Promise((ok,no)=>{const e=document.createElement("script");e.src=base+h;e.onload=ok;e.onerror=no;document.head.appendChild(e)});
    css("leaflet/1.9.4/leaflet.css");css("leaflet.markercluster/1.5.3/MarkerCluster.css");css("leaflet.markercluster/1.5.3/MarkerCluster.Default.css");
    leafletP=js("leaflet/1.9.4/leaflet.js").then(()=>js("leaflet.markercluster/1.5.3/leaflet.markercluster.js"));
    leafletP.catch(()=>{leafletP=null});
    return leafletP;
  }
  const agoText=n=>n===0?"Logged today":n===1?"Logged yesterday":"Logged "+n+" days ago";
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
      d.points.forEach(([lat,lng,ago])=>{
        mapLayer.addLayer(L.circleMarker([lat,lng],{radius:8,weight:2,color:"#141516",fillColor:ago<7?"#ff6b1a":ago<31?"#f5c518":"#9aa0a6",fillOpacity:.95}).bindPopup(agoText(ago)));
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

  renderQueue();renderCouncils();renderHistory();renderStats();save();
  fetchStats();shareMissing();flushUnshare();
  if(S.queue.some(q=>q.lookup==="failed"||q.lookup==="offline"||needsArea(q)))lookupMissing();

  if("serviceWorker" in navigator&&location.protocol==="https:")navigator.serviceWorker.register("sw.js").catch(()=>{});
})();
