// The about page's live numbers, from the same map server as the app.
(function(){
  "use strict";
  const API=/^(localhost|127\.0\.0\.1)$/.test(location.hostname)?"http://localhost:8787":"https://api.motopotholereporter.au";
  const $=id=>document.getElementById(id),n=x=>(+x||0).toLocaleString("en-AU");
  // Councils come as "vic:melton"; title-case the name, and add the state once the league spans more than one.
  const nice=k=>String(k).slice(String(k).indexOf(":")+1).replace(/\b\w/g,c=>c.toUpperCase());
  const ROADS={vic:"VicRoads roads"};
  const ORDER=["vic","nsw","qld","sa","wa","tas","act","nt"];
  fetch(API+"/api/stats").then(r=>r.ok?r.json():null).then(s=>{
    if(!s)return;
    $("aTotal").textContent=n(s.total);$("aFixed").textContent=n(s.fixed);
    if(s.week)$("aWeek").textContent=n(s.week)+" this week";
    const w=(Array.isArray(s.league)?s.league:[]).filter(x=>Array.isArray(x)&&/^[a-z]+:/.test(x[0])),ol=$("aWorst");
    const many=new Set(w.map(([k])=>k.split(":")[0])).size>1;
    w.forEach(([k,c])=>{const li=document.createElement("li"),nm=document.createElement("span"),b=document.createElement("b");
      nm.textContent=nice(k)+(many?" ("+k.split(":")[0].toUpperCase()+")":"");b.textContent=n(c);li.append(nm,b);ol.append(li)});
    const roads=s.roads&&typeof s.roads==="object"?s.roads:{},rs=ORDER.filter(st=>+roads[st]>0),box=$("aRoads");
    rs.forEach(st=>{const p=document.createElement("p"),b=document.createElement("b");p.className="vr-line";
      b.textContent=n(roads[st]);p.append(ROADS[st]||st.toUpperCase()+" main roads",b);box.append(p)});
    if(rs.length){const sm=document.createElement("small");sm.className="vr-note";
      sm.textContent=(rs.length===1&&rs[0]==="vic"?"Potholes on VicRoads roads statewide.":"Potholes on main roads, by state.")+" They also count in their council's area above.";box.append(sm)}
    box.hidden=!rs.length;
    $("worstBox").hidden=!w.length&&!rs.length;
  }).catch(()=>{});
})();
