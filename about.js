// The about page's live numbers, from the same map server as the app.
(function(){
  "use strict";
  const API=/^(localhost|127\.0\.0\.1)$/.test(location.hostname)?"http://localhost:8787":"https://api.motopotholereporter.au";
  const $=id=>document.getElementById(id),n=x=>(+x||0).toLocaleString("en-AU");
  // The server sends councils by their core name ("melton"); title-case it for display.
  const nice=k=>String(k).replace(/\b\w/g,c=>c.toUpperCase());
  fetch(API+"/api/stats").then(r=>r.ok?r.json():null).then(s=>{
    if(!s)return;
    $("aTotal").textContent=n(s.total);$("aFixed").textContent=n(s.fixed);
    if(s.week)$("aWeek").textContent=n(s.week)+" this week";
    const w=Array.isArray(s.worst)?s.worst:[],ol=$("aWorst");
    w.forEach(([k,c])=>{const li=document.createElement("li"),nm=document.createElement("span"),b=document.createElement("b");
      nm.textContent=nice(k);b.textContent=n(c);li.append(nm,b);ol.append(li)});
    if(s.vicroads){$("aVr").hidden=false;$("aVrN").textContent=n(s.vicroads)}
    $("worstBox").hidden=!w.length&&!s.vicroads;
  }).catch(()=>{});
})();
