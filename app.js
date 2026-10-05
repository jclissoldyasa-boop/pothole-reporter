(function(){
  "use strict";
  const TO="enquiries@roads.vic.gov.au";
  const DIRS=[["N","Northbound"],["NE","North-east"],["E","Eastbound"],["SE","South-east"],["S","Southbound"],["SW","South-west"],["W","Westbound"],["NW","North-west"]];
  const POS=["Left lane","Right lane","Middle lane","Shoulder","All lanes"];
  const SIZE=["Small","Medium","Large / deep"];
  const $=id=>document.getElementById(id);
  const LS="pothole_reporter_v1";
  const DEFAULT={me:{name:"",phone:"",email:"",councilEmail:""},queue:[],history:[]};

  let S=(function(){try{const v=JSON.parse(localStorage.getItem(LS));if(v&&v.me)return{...DEFAULT,...v,me:{...DEFAULT.me,...v.me}}}catch(e){}return JSON.parse(JSON.stringify(DEFAULT))})();
  function save(){try{localStorage.setItem(LS,JSON.stringify(S))}catch(e){}}

  // ---------- who manages the road ----------
  // Source: Melton City Council "Arterial Roads" page — roads in the City of Melton controlled by VicRoads.
  const MELTON_SUBURBS=["aintree","bonnie brook","brookfield","burnside","burnside heights","caroline springs","cobblebank","deanside","diggers rest","exford","eynesbury","fieldstone","fraser rise","grangefields","harkness","hillside","kurunjang","melton","melton south","melton west","mount cottrell","parwan","plumpton","ravenhall","rockbank","strathtulloh","taylors hill","thornhill park","toolern vale","truganina","weir views","kororoit"];
  const VR_FULL=["diggers rest coimadai road","vineyard road","gap road","hopkins road","federation drive","gisborne melton road","western freeway","calder freeway","melton highway"];
  const VR_PART={"coburns road":"VicRoads only between the Western Freeway and High Street","high street":"VicRoads only between the Melton Highway and Coburns Road","christies road":"VicRoads only between Caroline Springs station and Ballarat Road"};
  function norm(r){return(r||"").toLowerCase().replace(/[-–—'.]/g," ").replace(/\brd\b/g,"road").replace(/\bst\b/g,"street").replace(/\bhwy\b/g,"highway").replace(/\bfwy\b/g,"freeway").replace(/\bdr\b/g,"drive").replace(/\s+/g," ").trim()}
  function classify(q){
    const r=norm(q.road),sub=norm(q.suburb);
    if(!r)return{auth:"check",why:"Road name not found yet"};
    if(/service road/.test(r))return{auth:"council",why:"Service roads beside main roads are council's"};
    if(/\b(freeway|highway)\b/.test(r))return{auth:"vicroads",why:"Freeways and highways are VicRoads"};
    if(MELTON_SUBURBS.includes(sub)){
      if(VR_FULL.includes(r))return{auth:"vicroads",why:"On Melton's list of VicRoads roads"};
      if(VR_PART[r])return{auth:"check",why:VR_PART[r]+". Check the map, then pick one"};
      return{auth:"council",why:"Local road in the City of Melton"};
    }
    return{auth:"check",why:(q.suburb?q.suburb+" is":"This spot is")+" outside the City of Melton list. Check the map, then pick one"};
  }
  function applyClass(q){if(q.authSet)return;const c=classify(q);q.auth=c.auth;q.why=c.why}

  // ---------- road lookup (OpenStreetMap Nominatim, max 1 request a second) ----------
  let lastLookup=0;
  const wait=ms=>new Promise(r=>setTimeout(r,ms));
  async function lookup(q){
    if(!navigator.onLine){q.lookup="offline";applyClass(q);return false}
    const gap=1100-(Date.now()-lastLookup);if(gap>0)await wait(gap);
    lastLookup=Date.now();
    try{
      const url="https://nominatim.openstreetmap.org/reverse?format=jsonv2&addressdetails=1&zoom=17&lat="+q.lat+"&lon="+q.lng;
      const r=await fetch(url,{headers:{"Accept-Language":"en-AU"}});
      if(!r.ok)throw new Error("http "+r.status);
      const d=await r.json();const a=d.address||{};
      const road=a.road||a.pedestrian||a.residential||"";
      if(!road){q.lookup="none";applyClass(q);return false}
      if(!q.roadSet)q.road=road;
      q.suburb=a.suburb||a.town||a.village||a.city_district||a.hamlet||a.city||"";
      q.postcode=a.postcode||"";
      q.lookup="done";applyClass(q);return true;
    }catch(e){q.lookup="failed";applyClass(q);return false}
  }
  async function lookupMissing(){
    const todo=S.queue.filter(q=>q.lookup!=="done"&&q.lookup!=="none");
    if(!todo.length)return;
    $("lookupBtn").disabled=true;$("lookupBtn").textContent="Looking up…";
    for(const q of todo){q.lookup="pending";renderQueue();await lookup(q);save();renderQueue()}
    $("lookupBtn").disabled=false;$("lookupBtn").textContent="Look up road names";
  }
  $("lookupBtn").onclick=lookupMissing;
  window.addEventListener("online",lookupMissing);

  // ---------- details ----------
  [["myName","name"],["myPhone","phone"],["myEmail","email"],["councilEmail","councilEmail"]].forEach(([el,k])=>{
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
    S.queue.push(item);save();renderQueue();
    if(navigator.vibrate)try{navigator.vibrate([60,40,60])}catch(e){}
    setStatus("Logged. Looking up the road…");
    lookup(item).then(()=>{
      save();renderQueue();
      const label=(item.road||"Pothole")+(item.suburb?", "+item.suburb:"");
      const who=item.auth==="vicroads"?"VicRoads":item.auth==="council"?"council":"needs a check";
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
      items.map((q,i)=>itemText(q,items.length>1?i+1:0)).join("\n\n"),"","Each map link opens the exact location.","","Thanks,",
      [S.me.name,S.me.phone,S.me.email].filter(Boolean).join("\n")].join("\n");
    return{subject,body};
  }
  let pending=null;
  function openEmail(who){
    const items=S.queue.filter(q=>q.auth===who);
    if(!items.length)return;
    const to=who==="council"?S.me.councilEmail:TO;
    if(!to){$("meBox").open=true;$("councilEmail").focus();msg("Add your council's email first.","err");return}
    const {subject,body}=compose(items);
    pending={who,ids:items.map(q=>q.id),subject};
    location.href="mailto:"+to+"?subject="+encodeURIComponent(subject)+"&body="+encodeURIComponent(body);
    $("confirmText").textContent="Did the email to "+(who==="council"?"council":"VicRoads")+" send?";
    $("confirm").hidden=false;msg("");
  }
  $("sendBtn").onclick=()=>openEmail("vicroads");
  $("sendCouncilBtn").onclick=()=>openEmail("council");
  $("confirmYes").onclick=()=>{
    if(!pending)return;
    const items=S.queue.filter(q=>pending.ids.includes(q.id));
    S.queue=S.queue.filter(q=>!pending.ids.includes(q.id));
    S.history.unshift({at:new Date().toISOString(),count:items.length,to:pending.who==="council"?"council":"VicRoads",subject:pending.subject});
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
  const authLabel=a=>a==="vicroads"?"VicRoads":a==="council"?"Council":"Check";
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
      const badge=document.createElement("span");badge.className="auth "+q.auth;badge.textContent=authLabel(q.auth);
      const sub=document.createElement("div");sub.className="sub";
      const t=new Date(q.time);
      sub.append(t.toLocaleString("en-AU",{weekday:"short",hour:"numeric",minute:"2-digit"})+(q.dir?", "+dirName(q.dir).toLowerCase():"")+(q.acc!=null?", ±"+q.acc+" m":"")+" · ");
      const a=document.createElement("a");a.href=maps(q);a.target="_blank";a.rel="noopener";a.textContent="map";sub.append(a);
      const why=document.createElement("div");why.className="why"+(q.auth==="check"?" warn":"");why.textContent=q.why||"";
      meta.append(st,badge,sub,why);
      const ed=document.createElement("button");ed.className="mini";ed.type="button";ed.textContent="Details";
      const del=document.createElement("button");del.className="mini";del.type="button";del.textContent="Remove";
      del.setAttribute("aria-label","Remove pothole "+(i+1));
      del.onclick=()=>{S.queue=S.queue.filter(x=>x.id!==q.id);save();renderQueue()};
      head.append(num,meta,ed,del);
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
      [["road","Road","e.g. Western Fwy"],["near","Near","e.g. Coburns Rd"]].forEach(([k,l,ph])=>{
        const w=document.createElement("div");const lab=document.createElement("label");lab.textContent=l;
        const inp=document.createElement("input");inp.value=q[k];inp.placeholder=ph;inp.setAttribute("aria-label",l+" for pothole "+(i+1));
        inp.oninput=()=>{q[k]=inp.value;if(k==="road"){q.roadSet=true;q.authSet=false;applyClass(q)}save();
          st.textContent=title();badge.className="auth "+q.auth;badge.textContent=authLabel(q.auth);why.textContent=q.why||"";why.className="why"+(q.auth==="check"?" warn":"");updateButtons()};
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
    $("sendCouncilBtn").hidden=!co.length;
    $("sendCouncilBtn").textContent=S.me.councilEmail?"Email "+co.length+" to council":"Email "+co.length+" to council (add email first)";
    $("lookupBtn").hidden=!S.queue.some(q=>q.lookup==="failed"||q.lookup==="offline");
  }
  function renderHistory(){
    const ul=$("history");ul.innerHTML="";
    if(!S.history.length){ul.innerHTML='<li><p class="empty">Nothing sent yet.</p></li>';return}
    S.history.forEach(h=>{
      const li=document.createElement("li");
      const s=document.createElement("div");s.textContent=h.subject;
      const d=document.createElement("div");d.className="sub";
      d.textContent=new Date(h.at).toLocaleString("en-AU",{dateStyle:"medium",timeStyle:"short"})+", "+h.count+(h.count===1?" pothole":" potholes")+" to "+h.to;
      li.append(s,d);ul.appendChild(li);
    });
  }
  function toast(t){const el=$("toast");el.textContent=t;el.classList.add("show");clearTimeout(toast._t);toast._t=setTimeout(()=>el.classList.remove("show"),2400)}

  S.queue.forEach(q=>{if(q.lookup==="pending")q.lookup="failed"});
  renderQueue();renderHistory();save();
  if(S.queue.some(q=>q.lookup==="failed"||q.lookup==="offline"))lookupMissing();

  if("serviceWorker" in navigator&&location.protocol==="https:")navigator.serviceWorker.register("sw.js").catch(()=>{});
})();
