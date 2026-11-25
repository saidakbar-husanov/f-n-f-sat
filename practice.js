// practice.js — Question Bank, Challenging Questions and Question Rush.
//
// • Filters (subject, difficulty, domain, topic/skill; plus answer status in the
//   Question Bank). Several picks in one group widen it (OR); groups narrow
//   each other (AND). Only subjects open to the student are offered.
// • Practice sessions live on the server: the set, its order, filters,
//   position, selections, review flags and graded answers survive a closed
//   browser or a dropped connection ("Continue practice").
// • The question navigator reuses the Full Mock look (Question X of Y pill,
//   numbered grid, legend) and its keyboard behaviour.
// • Saving is queued, merged and retried; the status chip always says whether
//   the latest change is saving, saved or needs a retry.

// ──────────────── subject access (what the interface offers) ────────────────
const ACC={data:null,at:0};
async function loadAccess(force){
  if(state.user?.role!=="student") return null;
  if(ACC.data&&!force&&Date.now()-ACC.at<15000) return ACC.data;
  try{ ACC.data=await api("access"); ACC.at=Date.now(); }catch{ /* keep the last known */ }
  return ACC.data;
}
function accSubjects(area){
  if(state.user?.role!=="student") return ["math","ebrw"];
  return ACC.data?.subjects?.[area]||["math","ebrw"];
}
const SUBJECT_LABEL={math:"Math",ebrw:"Reading & Writing"};
function lockedHTML(what){
  return `<div class="empty fade"><div class="ei">${svg("lock")}</div><h3>${esc(what)} isn't available</h3><p>Your administrator has switched this off for your account. Other sections stay available.</p><button class="btn btn-ghost" onclick="go('home')">${svg("back","ic-sm")} Dashboard</button></div>`;
}

// ──────────────── filters ────────────────
const BAND_LABEL={easy:"Easy",medium:"Medium",hard:"Hard"};
const STATUS_LABEL={incorrect:"Previously incorrect",unanswered:"Unanswered"};
function blankBankFilters(){ return {subjects:[],difficulties:[],domains:[],skills:[],status:[]}; }
function cleanFilters(f,opts){
  const out=blankBankFilters(); f=f||{};
  const subs=accSubjects(opts.area);
  out.subjects=(f.subjects||[]).filter(s=>subs.includes(s));
  out.difficulties=(f.difficulties||[]).filter(d=>BAND_LABEL[d]);
  const doms=filterDomains(out,subs);
  out.domains=(f.domains||[]).filter(d=>doms.includes(d));
  const skills=filterSkills(out,subs);
  out.skills=(f.skills||[]).filter(s=>skills.includes(s));
  out.status=opts.status?(f.status||[]).filter(s=>STATUS_LABEL[s]):[];
  return out;
}
function filterDomains(f,subs){ return (f.subjects.length?f.subjects:subs).flatMap(s=>SECTIONS[s]?.categories||[]); }
// Topics shown are the skills of the chosen domains (or of every offered domain).
function filterSkills(f,subs){ const doms=f.domains.length?f.domains:filterDomains(f,subs); return doms.flatMap(d=>SUBSECTIONS[d]||[]); }
function filterQuery(f){
  const q=new URLSearchParams();
  for(const k of ["subjects","difficulties","domains","skills","status"]) if(f[k]?.length) q.set(k,f[k].join(","));
  return q.toString();
}
function activeFilterCount(f){ return ["subjects","difficulties","domains","skills","status"].reduce((n,k)=>n+(f[k]?.length||0),0); }
function chipsHTML(f,setter){
  const chips=[];
  const add=(k,v,label)=>chips.push(`<button type="button" class="pf-chip" onclick="${setter}('${k}',${plJs(v)},false)" aria-label="Remove filter ${esc(label)}">${esc(label)} ${svg("x","ic-sm")}</button>`);
  f.subjects.forEach(v=>add("subjects",v,SUBJECT_LABEL[v]||v)); f.difficulties.forEach(v=>add("difficulties",v,BAND_LABEL[v]));
  f.domains.forEach(v=>add("domains",v,v)); f.skills.forEach(v=>add("skills",v,v)); (f.status||[]).forEach(v=>add("status",v,STATUS_LABEL[v]));
  return chips.length?`<div class="pf-chips" aria-label="Active filters">${chips.join("")}<button type="button" class="btn btn-ghost btn-xs" onclick="${setter}('*',null,false)">Clear all</button></div>`:`<p class="umeta pf-none">No filters — every permitted question is included.</p>`;
}
// One filter panel, shared by the Question Bank and Question Rush.
function filterPanelHTML(f,opts){
  const subs=accSubjects(opts.area);
  const box=(k,v,label,on)=>`<label class="pf-opt ${on?"on":""}"><input type="checkbox" ${on?"checked":""} onchange="${opts.setter}('${k}',${plJs(v)},this.checked)"/><span>${esc(label)}</span></label>`;
  const group=(title,inner,extra="")=>`<fieldset class="pf-group"><legend>${title}</legend><div class="pf-opts">${inner}</div>${extra}</fieldset>`;
  const doms=filterDomains(f,subs);
  const skillDoms=f.domains.length?f.domains:doms;
  return `<div class="pf-panel">
    ${subs.length>1?group("Subject",subs.map(s=>box("subjects",s,SUBJECT_LABEL[s],f.subjects.includes(s))).join("")):`<p class="umeta">Subject: <b>${esc(subs.map(s=>SUBJECT_LABEL[s]).join(", ")||"none available")}</b></p>`}
    ${group("Difficulty",Object.entries(BAND_LABEL).map(([k,l])=>box("difficulties",k,l,f.difficulties.includes(k))).join(""))}
    ${group("Domain",doms.map(d=>box("domains",d,d,f.domains.includes(d))).join(""))}
    <details class="pf-group pf-skills" ${f.skills.length?"open":""}><summary>Topic / skill ${f.skills.length?`<span class="pill pill-sec">${f.skills.length}</span>`:""}</summary>
      ${skillDoms.map(d=>`<div class="pf-skilldom"><b>${esc(d)}</b><div class="pf-opts">${(SUBSECTIONS[d]||[]).map(sk=>box("skills",sk,sk,f.skills.includes(sk))).join("")}</div></div>`).join("")}</details>
    ${opts.status?group("Your answers",Object.entries(STATUS_LABEL).map(([k,l])=>box("status",k,l,(f.status||[]).includes(k))).join(""),`<p class="umeta">Retrying a question records a new attempt; your original answer and score stay in your history.</p>`):""}
  </div>`;
}
function toggleFilter(f,k,v,on){
  if(k==="*"){ return blankBankFilters(); }
  const next={...f,[k]:[...(f[k]||[])]};
  if(on===false||(on===undefined&&next[k].includes(v))) next[k]=next[k].filter(x=>x!==v); else if(!next[k].includes(v)) next[k].push(v);
  return next;
}

// ──────────────── Question Bank: landing ────────────────
const QB={draft:null,results:null,resultsKey:"",sessions:null};
async function viewBank(){
  crumbs([{label:"Question Bank"}]);
  await loadAccess();
  if(state.user?.role==="student"&&!accSubjects("bank").length){ $c().innerHTML=lockedHTML("Question Bank practice"); return; }
  // Legacy domain links (?section=…&category=…) open the filtered results.
  if(state.section&&!state.bankStage){
    const bf=blankBankFilters(); bf.subjects=[state.section]; if(state.category) bf.domains=[state.category]; if(state.subcategory) bf.skills=[state.subcategory];
    go("bank",{bankStage:"results",bf,section:null,category:null,subcategory:null,__replace:true}); return;
  }
  if(state.bankStage==="results") return viewBankResults();
  QB.draft=cleanFilters(QB.draft||state.bf||blankBankFilters(),{area:"bank",status:true});
  $c().innerHTML=`<div class="page-head fade"><h1>Question Bank</h1><p>Choose what to practise. Pick several options in a group to widen it; each group narrows the others.</p></div>
    <div id="qbContinue"></div>
    <div class="panel fade"><h2>${svg("target","ic-sm")} Filters</h2><div id="qbFilters">${filterPanelHTML(QB.draft,{area:"bank",status:true,setter:"QB_set"})}</div>
      <div id="qbChips">${chipsHTML(QB.draft,"QB_set")}</div>
      <div class="pf-actions"><span class="umeta" id="qbCount">Counting…</span><button class="btn btn-primary" id="qbShow" onclick="QB_showResults()">${svg("arr","ic-sm")} Show questions</button></div></div>
    <div class="tile-grid tg-2 fade" id="secGrid"></div>`;
  renderContinue("bank","qbContinue");
  QB_count();
  const stats=await getStats();
  const grid=document.getElementById("secGrid"); if(!grid) return;
  grid.innerHTML=accSubjects("bank").map(k=>{ const s=SECTIONS[k]; const c=countFor(stats,k);
    return `<div class="tile"><span class="count">${c} item${c===1?"":"s"}</span><div class="badge-ic ${s.tone}">${svg(s.icon)}</div><h3>${s.label}</h3><p>${s.blurb}</p>
      <div class="qb-domlinks">${s.categories.map(cat=>`<button type="button" class="btn btn-ghost btn-xs" onclick="QB_quick('${k}',${plJs(cat)})">${esc(cat)} · ${countFor(stats,k,cat)}</button>`).join("")}</div>
      <button class="btn btn-ghost btn-sm" onclick="QB_quick('${k}',null)">All ${s.label} ${svg("arr","ic-sm")}</button></div>`;
  }).join("");
}
function QB_set(k,v,on){
  QB.draft=cleanFilters(toggleFilter(QB.draft,k,v,on),{area:"bank",status:true});
  document.getElementById("qbFilters").innerHTML=filterPanelHTML(QB.draft,{area:"bank",status:true,setter:"QB_set"});
  document.getElementById("qbChips").innerHTML=chipsHTML(QB.draft,"QB_set");
  QB_count();
}
let qbCountT=null, qbCountSeq=0;
function QB_count(){
  clearTimeout(qbCountT);
  qbCountT=setTimeout(async()=>{
    const seq=++qbCountSeq, el=document.getElementById("qbCount"); if(!el) return;
    el.textContent="Counting…";
    try{ const r=await api(`practice/pool?${filterQuery(QB.draft)}&pageSize=5`); if(seq!==qbCountSeq) return;
      el.textContent=`${r.count} matching question${r.count===1?"":"s"}`; const b=document.getElementById("qbShow"); if(b) b.disabled=!r.count; }
    catch(e){ if(seq===qbCountSeq) el.textContent=e.message; }
  },250);
}
function QB_showResults(){ go("bank",{bankStage:"results",bf:{...QB.draft}}); }
function QB_quick(section,domain){ const bf=blankBankFilters(); bf.subjects=[section]; if(domain) bf.domains=[domain]; QB.draft=bf; go("bank",{bankStage:"results",bf}); }

// ──────────────── Question Bank: filtered results ────────────────
async function viewBankResults(){
  const f=cleanFilters(state.bf||blankBankFilters(),{area:"bank",status:true});
  QB.draft=f;
  const page=Number(state.bfPage)||0;
  crumbs([{label:"Question Bank",onclick:"go('bank')"},{label:"Results"}]);
  const key=filterQuery(f)+"|"+page;
  const cached=QB.results&&QB.resultsKey===key&&Date.now()-QB.results.at<120000;
  if(!cached) loading();
  let r=cached?QB.results.data:null;
  if(!r){ try{ r=await api(`practice/pool?${filterQuery(f)}&page=${page}&pageSize=25`); QB.results={data:r,at:Date.now()}; QB.resultsKey=key; }catch(e){ $c().innerHTML=`<div class="empty"><p>${esc(e.message)}</p><button class="btn btn-ghost" onclick="go('bank')">Back</button></div>`; return; } }
  if(state.view!=="bank"||state.bankStage!=="results") return;
  const pages=Math.max(1,Math.ceil(r.count/r.pageSize));
  const rows=r.items.map((q,i)=>{ const [dl,dc]=DIFF[q.difficulty]||DIFF[3];
    return `<li><button type="button" class="qb-row" onclick="QB_open(${q.id})"><span class="qb-n">${page*r.pageSize+i+1}</span>
      <span class="qb-main"><span class="qb-prev">${esc(q.preview||"Question")}</span><span class="umeta">${esc(SUBJECT_LABEL[q.section]||q.section)} · ${esc(q.category)}${q.subcategory?` · ${esc(q.subcategory)}`:""}</span></span>
      <span class="pill ${dc}">${dl}</span><span class="qb-st ${q.status}">${q.status==="correct"?"Correct before":q.status==="incorrect"?"Incorrect before":"New"}</span></button></li>`; }).join("");
  $c().innerHTML=`<div class="page-head fade"><h1>Question Bank results</h1><p>${r.count} question${r.count===1?"":"s"} match. Open any question to start practising from it, or start the whole set.</p></div>
    <div class="panel fade"><div id="qbChips">${chipsHTML(f,"QBR_set")}</div>
      <details class="pf-edit"><summary>${svg("edit","ic-sm")} Change filters</summary>${filterPanelHTML(f,{area:"bank",status:true,setter:"QBR_set"})}</details>
      <div class="pf-actions"><label class="pf-opt"><input type="checkbox" id="qbShuffle"/> <span>Shuffle order</span></label>
      <button class="btn btn-primary" ${r.count?"":"disabled"} onclick="QB_startAll()">${svg("rush","ic-sm")} Practise all ${r.count}</button></div></div>
    ${r.count?`<ol class="qb-list fade">${rows}</ol>
      ${pages>1?`<div class="qb-pager"><button class="btn btn-ghost btn-sm" ${page<=0?"disabled":""} onclick="QBR_page(${page-1})">Previous page</button><span class="umeta">Page ${page+1} of ${pages}</span><button class="btn btn-ghost btn-sm" ${page+1>=pages?"disabled":""} onclick="QBR_page(${page+1})">Next page</button></div>`:""}`
    :`<div class="empty fade"><div class="ei">${svg("target")}</div><h3>No questions match</h3><p>Try removing a filter — for example a topic, a difficulty or “${esc(STATUS_LABEL.incorrect)}”.</p>${activeFilterCount(f)?`<button class="btn btn-ghost" onclick="QBR_set('*',null,false)">Clear all filters</button>`:""}</div>`}`;
}
// Filter edits on the results page replace the current history entry.
function QBR_set(k,v,on){ const bf=cleanFilters(toggleFilter(QB.draft,k,v,on),{area:"bank",status:true}); state.bf=bf; state.bfPage=0; replaceRoute(); viewBankResults(); }
function QBR_page(p){ rememberScroll(); state.bfPage=p; replaceRoute(); viewBankResults().then(()=>window.scrollTo(0,0)); }
function newClientKey(){ return (crypto.randomUUID?crypto.randomUUID():Date.now().toString(36)+Math.random().toString(36).slice(2)); }
async function QB_startAll(startQuestionId){
  const shuffle=!!document.getElementById("qbShuffle")?.checked&&!startQuestionId;
  try{
    const s=await api("practice/sessions",{method:"POST",body:JSON.stringify({kind:"bank",filters:state.bf||QB.draft,shuffle,startQuestionId:startQuestionId||null,clientKey:newClientKey()})});
    QB.sessions=null; openSession(s);
  }catch(e){ toast(e.message); }
}
function QB_open(id){ QB_startAll(id); }

// ──────────────── Continue practice ────────────────
async function renderContinue(kind,elId){
  let rows=[]; try{ rows=await api(`practice/sessions?kind=${kind}`); }catch{ return; }
  const el=document.getElementById(elId); if(!el||!rows.length) return;
  el.innerHTML=`<div class="panel fade pc-panel"><h2>${svg("play","ic-sm")} Continue practice</h2>${rows.map(s=>`<div class="pc-row"><div><b>${esc(s.label)}</b>
      <div class="umeta">Question ${s.position+1} of ${s.total} · ${s.answered} answered · saved ${esc(plWhen(s.updatedAt))}${s.locked?` · ${s.locked} no longer available`:""}</div></div>
      <div class="pc-acts"><button class="btn btn-primary btn-sm" onclick="resumeSession(${s.id})">${svg("play","ic-sm")} Continue</button><button class="btn btn-ghost btn-xs" onclick="discardSession(${s.id},'${kind}','${elId}')">Discard</button></div></div>`).join("")}</div>`;
}
function resumeSession(id){ go("practice",{sid:id,q:null,practiceSet:null}); }
async function discardSession(id,kind,elId){
  if(!confirm("Discard this unfinished session? Answers you already checked stay in your history.")) return;
  try{ await api(`practice/sessions/${id}/abandon`,{method:"POST"}); }catch(e){ toast(e.message); return; }
  const el=document.getElementById(elId); if(el) el.innerHTML=""; renderContinue(kind,elId);
}

// ──────────────── Challenging Questions ────────────────
async function viewChallenge(){
  crumbs([{label:"Challenging Questions"}]);
  await loadAccess();
  if(state.user?.role==="student"&&!accSubjects("challenge").length){ $c().innerHTML=lockedHTML("Challenging Questions"); return; }
  $c().innerHTML=`<div class="page-head fade"><h1>Challenging Questions</h1><p>Named sets of harder questions. Each set is practised like the Question Bank — move freely between questions, check answers when you're ready, and continue later on any device.</p></div><div id="chContinue"></div><div id="chList"><div class="spin"></div></div>`;
  renderContinue("challenge","chContinue");
  const sets=await ciLoadSets(true);
  const el=document.getElementById("chList"); if(!el) return;
  const live=sets.filter(s=>s.questionCount>0);
  if(!live.length){ el.innerHTML=`<div class="empty fade"><div class="ei">${svg("trophy")}</div><p>No challenging sets yet. Check back soon.</p></div>`; return; }
  el.innerHTML=["math","ebrw"].map(sec=>{
    const list=live.filter(s=>s.section===sec); if(!list.length) return "";
    const S=SECTIONS[sec];
    return `<section class="ch-group fade"><h2 class="ch-h">${esc(CI_SECTION_LABEL[sec])}</h2><div class="tile-grid tg-2">
      ${list.map(s=>`<div class="tile ch-tile"><span class="count">${s.questionCount} question${s.questionCount===1?"":"s"}</span>
        <div class="badge-ic ${S.tone}">${svg("trophy")}</div><h3>${esc(s.title)}</h3>${s.description?`<p>${esc(s.description)}</p>`:""}
        <button class="btn btn-primary btn-sm" onclick="startChallengeSet(${s.id})">${svg("rush","ic-sm")} Start practice</button></div>`).join("")}
    </div></section>`;
  }).join("");
}
async function startChallengeSet(setId){
  try{
    const usage=await api("usage"); const ch=usage.limits?.challengeDaily;
    if(ch&&ch.limit!==null&&ch.remaining<=0){ toast(`Daily Challenging Questions limit (${ch.limit}) reached. It resets ${new Date(ch.resetsAt).toLocaleString()}.`); return; }
  }catch{}
  try{ const s=await api("practice/sessions",{method:"POST",body:JSON.stringify({kind:"challenge",setId,clientKey:newClientKey()})}); openSession(s); }
  catch(e){ toast(e.message); }
}

// ──────────────── practice engine ────────────────
// P: { server, sid, kind, label, items:[{id,section,locked,selected,submitted,correct,flagged}], idx,
//      cache: Map(id → question), mode, returnView, nav, sid2 (calculator session) }
let P=null;
const practiceReturnLabel=v=>v==="tasks"?"My Tasks":v==="challenge"?"Challenging Questions":v==="bank"?"Question Bank":"Review";
function newPracticeSid(){ return Date.now().toString(36)+Math.random().toString(36).slice(2,7); }
function openSession(s){
  P=sessionToP(s);
  go("practice",{sid:s.id,q:s.position,practiceSet:null});
}
function sessionToP(s){
  return {server:true,sid:s.id,kind:s.kind,label:s.label,filters:s.filters,items:s.items,idx:s.position||0,cache:new Map(),
    mode:s.kind==="challenge"?"challenge":"bank",returnView:s.kind==="challenge"?"challenge":"bank",calcSid:"ps"+s.id,status:s.status};
}
async function viewPractice(){
  const custom=Array.isArray(state.practiceSet);
  if(custom) return viewLocalPractice();
  const sid=Number(state.sid);
  if(!sid){ go("bank",{__replace:true}); return; }
  if(!P||P.sid!==sid){
    loading();
    let s; try{ s=await api(`practice/sessions/${sid}`); }catch(e){ $c().innerHTML=`<div class="empty fade"><div class="ei">${svg("lock")}</div><h3>This practice session can't be opened</h3><p>${esc(e.message)}</p><button class="btn btn-ghost" onclick="go('bank')">Question Bank</button></div>`; return; }
    if(state.view!=="practice"||Number(state.sid)!==sid) return;
    P=sessionToP(s);
    PQ_restoreLocal(P);
  }
  if(state.q!=null&&Number.isInteger(Number(state.q))) P.idx=Math.min(Math.max(0,Number(state.q)),P.items.length-1);
  if(P.status&&P.status!=="active"){ finishPractice(true); return; }
  renderQuestion();
}
// Tasks and review queues: the list already in memory, kept in this tab.
function viewLocalPractice(){
  const list=state.practiceSet;
  const saved=readActiveQuiz();
  if(saved?.kind==="practice2"&&saved.P?.label===state.practiceLabel&&saved.P?.items?.length===list.length){
    P={...saved.P,cache:new Map(list.map(q=>[q.id,q])),server:false};
  } else {
    P={server:false,sid:null,kind:"local",label:state.practiceLabel,mode:state.practiceMode||"review",returnView:state.practiceReturn||"review",calcSid:newPracticeSid(),
      items:list.map(q=>({id:q.id,section:q.section,locked:false,selected:null,submitted:false,correct:null,flagged:false})),idx:0,cache:new Map(list.map(q=>[q.id,q])),results:{}};
  }
  if(!P.items.length){ $c().innerHTML=`<div class="empty fade"><p>No questions in this set.</p><button class="btn btn-ghost" onclick="go('${P.returnView}')">Back</button></div>`; return; }
  renderQuestion();
}
function savePracticeProgress(){
  if(!P||P.server||state.view!=="practice") return;
  const {items,idx,mode,returnView,label,calcSid,results}=P;
  writeActiveQuiz({kind:"practice2",ctx:practiceCtx(),P:{items,idx,mode,returnView,label,calcSid,results,list:[...P.cache.values()]}});
}
window.addEventListener("pagehide",()=>{ savePracticeProgress(); PQ_flush(true); });
function dfPracticeCtx(){ return P?.calcSid||""; }

// Fetch the current question (and the next two) when not cached.
async function ensureQuestions(ids){
  const need=ids.filter(id=>id&&!P.cache.has(id)&&!P.items.find(i=>i.id===id)?.locked);
  if(!need.length||!P.server) return;
  const sid=P.sid;
  const r=await api(`practice/sessions/${sid}/questions?ids=${need.join(",")}`);
  if(!P||P.sid!==sid) return;
  for(const q of r.questions){ P.cache.set(q.id,q); if(q.result){ const it=P.items.find(i=>i.id===q.id); if(it){ it.result=q.result; } } }
  for(const id of r.locked){ const it=P.items.find(i=>i.id===id); if(it) it.locked=true; }
}
function itemAt(i){ return P.items[i]; }

function renderQuestion(){
  const it=itemAt(P.idx); if(!it) return;
  if(P.server){ state.q=P.idx; replaceRoute(); }
  const crumbsList=P.server?[{label:practiceReturnLabel(P.returnView),onclick:`go('${P.returnView}')`},{label:P.label}]:[{label:practiceReturnLabel(P.returnView),onclick:`go('${P.returnView}')`},{label:P.label}];
  crumbs(crumbsList);
  const q=P.cache.get(it.id);
  if(!q&&!it.locked){
    $c().innerHTML=practiceFrameHTML(`<div class="q-card" style="margin-top:1rem"><div class="spin"></div></div>`);
    const want=P.idx;
    ensureQuestions([it.id,itemAt(P.idx+1)?.id,itemAt(P.idx+2)?.id]).then(()=>{ if(P&&P.idx===want&&state.view==="practice") renderQuestion(); })
      .catch(e=>{ if(P&&P.idx===want&&state.view==="practice") $c().innerHTML=practiceFrameHTML(`<div class="q-card" style="margin-top:1rem"><p>${esc(e.message||"Could not load this question.")}</p><button class="btn btn-ghost btn-sm" onclick="renderQuestion()">Try again</button></div>`); });
    return;
  }
  if(it.locked){
    $c().innerHTML=practiceFrameHTML(`<div class="q-card" style="margin-top:1rem"><div class="empty" style="padding:1.2rem"><div class="ei">${svg("lock")}</div><h3>Not available</h3><p>This question's subject is switched off for your account, so it isn't shown. You can skip it.</p></div></div>`);
    wirePracticeKeys(); return;
  }
  const result=it.result||(P.results&&P.results[it.id])||null;
  const [dl,dc]=DIFF[q.difficulty]||DIFF[3];
  const qSection=SECTIONS[q.section]||{label:q.section};
  let answerArea;
  if(q.type==="spr"){
    answerArea=`<input class="spr-input" id="sprIn" placeholder="Type your answer" aria-label="Your answer" oninput="PQ_select(this.value,true)" onkeydown="if(event.key==='Enter'&&this.value.trim())checkAnswer()"/>
      <p class="mathhint" style="margin-top:.45rem">Type fractions as <b>3/4</b> and decimals as <b>0.75</b> — either form is accepted.</p>`;
  } else {
    answerArea=`<div class="choices" role="radiogroup" aria-label="Answer choices">`+["A","B","C","D"].map(l=>q.choices&&q.choices[l]!=null?
      `<button type="button" class="choice" role="radio" aria-checked="false" data-l="${l}" onclick="pickChoice('${l}')"><span class="ltr">${l}</span><span class="ct">${mathText(q.choices[l])}${questionMediaHTML(q.choiceImages?.[l],`Answer choice ${l}`,"choice")}</span></button>`:"").join("")+`</div>`;
  }
  const reportSrc=P.mode==="challenge"?"challenge":String(P.mode).startsWith("task:")?"task":P.mode==="review"?"review":"bank";
  $c().innerHTML=practiceFrameHTML(`<div class="q-card" style="margin-top:1rem">
      <div class="q-topline" style="margin-bottom:.8rem">
        <span class="pill pill-sec">${esc(qSection.label)}</span><span class="pill ${dc}">${dl}</span>
        <span class="pill pill-muted">${esc(q.category)}</span>${q.subcategory?`<span class="pill pill-muted">${esc(q.subcategory)}</span>`:""}
        <span style="flex:1"></span>
        <button type="button" class="bb-mark ${it.flagged?"on":""}" id="pqFlag" onclick="PQ_flag()" aria-pressed="${!!it.flagged}">${typeof ftIcon==="function"?ftIcon("bookmark"):svg("save","ic-sm")} <span>${it.flagged?"Marked for review":"Mark for review"}</span></button>
        ${q.section==="math"?`<button class="btn btn-ghost btn-sm" id="practiceCalcBtn" onclick="toggleDesmosFloat()">${svg("calc","ic-sm")} Calculator</button>`:""}
      </div>
      ${q.passage?`<div class="q-passage">${mathText(q.passage)}</div>`:""}
      ${questionMediaHTML(q.questionImage,"Question graphic")}
      <div class="q-prompt">${mathText(q.prompt)}</div>
      <div id="answerArea">${answerArea}</div>
      <div id="explainArea"></div>
      <div class="q-actions">
        <span class="feedback-tag" id="fbTag"></span>
        <button class="btn btn-ghost btn-sm" id="saveQBtn" onclick="toggleSavedQuestion(${q.id})">${svg("save","ic-sm")} Save for review</button>${plReportButtonHTML(q.id,reportSrc)}<span class="spacer"></span>
        <button class="btn btn-primary" id="checkBtn" onclick="checkAnswer()" disabled>Check answer</button>
      </div>
    </div>`);
  if(result) paintPracticeResult(q,result);
  else if(it.selected!=null&&it.selected!==""){
    if(q.type==="spr"){ const inp=document.getElementById("sprIn"); inp.value=it.selected; document.getElementById("checkBtn").disabled=!String(it.selected).trim(); }
    else markChoice(it.selected);
  }
  if(desmosFloatEl&&DF.ctx!==dfContext()) desmosDestroy();
  if(desmosFloatEl&&DF.open&&q.section!=="math") desmosHide();
  dfAfterRender();
  wirePracticeKeys();
  savePracticeProgress();
  // Warm the next questions so moving on is instant.
  if(P.server) ensureQuestions([itemAt(P.idx+1)?.id,itemAt(P.idx+2)?.id]).catch(()=>{});
}
// Question frame: the shared progress bar, save status and the navigator bar.
function practiceFrameHTML(inner){
  const total=P.items.length, done=P.items.filter(i=>i.submitted||i.result||(P.results&&P.results[i.id])).length;
  const pct=Math.round(done/total*100), last=P.idx+1>=total;
  return `<div class="q-shell fade pq">
    <div class="q-topline"><b class="pq-label">${esc(P.label)}</b><span style="flex:1"></span>${P.server?`<span class="pq-save" id="pqSave" role="status" aria-live="polite">${pqSaveText()}</span>`:""}</div>
    <div class="q-progress" title="${done} of ${total} answered"><i style="width:${pct}%"></i></div>
    ${inner}
    <nav class="pq-bar" aria-label="Question navigation">
      <button type="button" class="bb-btn" id="pqPrev" onclick="PQ_go(${P.idx-1})" ${P.idx<=0?"disabled":""}>Previous</button>
      <button type="button" class="bb-qpill" id="pqPill" onclick="PQ_toggleNav()" aria-expanded="${!!P.nav}" aria-controls="pqPop">Question ${P.idx+1} of ${total} ${typeof ftIcon==="function"?ftIcon("chev"):""}</button>
      ${last?`<button type="button" class="bb-btn primary" onclick="PQ_finish()">Finish</button>`:`<button type="button" class="bb-btn primary" id="pqNext" onclick="PQ_go(${P.idx+1})">Next</button>`}
    </nav>
    ${P.nav?pqPopHTML():""}
  </div>`;
}
function pqPopHTML(){
  const answered=P.items.filter(i=>i.submitted||i.result||(P.results&&P.results[i.id])).length;
  return `<div class="bb-pop pq-pop" id="pqPop" role="dialog" aria-label="Question navigator"><div class="bb-pop-head"><b>${esc(P.label)}</b><span class="umeta">${answered} of ${P.items.length} answered</span>
    <button type="button" class="btn btn-ghost btn-xs" onclick="PQ_toggleNav()" aria-label="Close">${svg("x","ic-sm")}</button></div>
    <div class="bb-grid">${P.items.map((x,i)=>{ const ans=!!(x.submitted||x.result||(P.results&&P.results[x.id])), cur=i===P.idx, sel=!ans&&x.selected!=null&&x.selected!=="";
      return `<button type="button" class="bb-cell ${ans?"ans":""} ${x.flagged?"flag":""} ${cur?"cur":""} ${x.locked?"locked":""} ${sel?"picked":""}" onclick="PQ_jump(${i})" aria-label="Question ${i+1}${ans?", answered":sel?", answer chosen, not checked":", unanswered"}${x.flagged?", marked for review":""}${x.locked?", not available":""}${cur?", current":""}" ${cur?'aria-current="true"':""}>
        ${cur?`<i class="bb-pin"></i>`:""}${i+1}${x.flagged?`<span class="bb-flagdot">${typeof ftIcon==="function"?ftIcon("bookmark"):""}</span>`:""}</button>`; }).join("")}</div>
    <div class="bb-legend"><span><i class="lg cur"></i>Current</span><span><i class="lg un"></i>Unanswered</span><span><i class="lg ans"></i>Answered</span><span><i class="lg flag"></i>For Review</span></div></div>`;
}
function PQ_toggleNav(){ P.nav=!P.nav; const old=document.getElementById("pqPop"); if(old) old.remove(); if(P.nav){ document.querySelector(".pq")?.insertAdjacentHTML("beforeend",pqPopHTML()); document.querySelector("#pqPop .bb-cell.cur")?.focus(); } document.getElementById("pqPill")?.setAttribute("aria-expanded",String(!!P.nav)); }
function PQ_jump(i){ P.nav=false; PQ_go(i); setTimeout(()=>document.getElementById("pqPill")?.focus(),0); }
function PQ_go(i){
  if(!P||i<0||i>=P.items.length) return;
  P.idx=i; P.nav=false;
  if(P.server) PQ_queue({position:i});
  renderQuestion(); document.querySelector(".pq")?.scrollIntoView({block:"start"});
  window.scrollTo(0,0);
}
// Escape closes the navigator, as in the Full Mock runner.
function wirePracticeKeys(){}
document.addEventListener("keydown",e=>{
  if(state.view!=="practice"||!P) return;
  if(e.key==="Escape"&&P.nav){ e.preventDefault(); PQ_toggleNav(); document.getElementById("pqPill")?.focus(); }
  const c=e.target.closest?.("#answerArea .choice");
  if(c&&(e.key==="ArrowDown"||e.key==="ArrowRight"||e.key==="ArrowUp"||e.key==="ArrowLeft")&&!e.altKey){
    const all=[...document.querySelectorAll("#answerArea .choice:not([disabled])")]; const i=all.indexOf(c);
    const n=all[(i+(e.key==="ArrowDown"||e.key==="ArrowRight"?1:all.length-1))%all.length]; if(n){ e.preventDefault(); n.focus(); }
  }
});

function markChoice(l){
  document.querySelectorAll("#answerArea .choice").forEach(c=>{ const on=c.dataset.l===l; c.classList.toggle("sel",on); c.setAttribute("aria-checked",String(on)); });
  const b=document.getElementById("checkBtn"); if(b) b.disabled=!l;
}
function pickChoice(l){
  const it=itemAt(P.idx); if(!it||it.submitted||it.result||(P.results&&P.results[it.id])) return;
  markChoice(l); PQ_select(l,false);
}
function PQ_select(value,typed){
  const it=itemAt(P.idx); if(!it) return;
  it.selected=value;
  if(typed){ const b=document.getElementById("checkBtn"); if(b) b.disabled=!String(value).trim(); }
  if(P.server) PQ_queue({selection:{questionId:it.id,value:String(value)}},typed?600:0);
  else savePracticeProgress();
}
function PQ_flag(){
  const it=itemAt(P.idx); if(!it) return;
  it.flagged=!it.flagged;
  const b=document.getElementById("pqFlag"); if(b){ b.classList.toggle("on",it.flagged); b.setAttribute("aria-pressed",String(it.flagged)); b.querySelector("span").textContent=it.flagged?"Marked for review":"Mark for review"; }
  if(P.server) PQ_queue({flag:{questionId:it.id,on:it.flagged}}); else savePracticeProgress();
}

// ── save queue: merged, ordered, retried, mirrored to this device ──
const PQ={pending:null,inflight:false,state:"saved",retryT:null,delayT:null,backoff:0,seq:0};
function pqSeq(){ PQ.seq=Math.max(PQ.seq+1,Date.now()); return PQ.seq; }
function pqLocalKey(sid){ return `fnf_pq_${state.user?.key||"anon"}_${sid}`; }
function PQ_queue(op,delay=0){
  if(!P?.server) return;
  const p=PQ.pending||(PQ.pending={sid:P.sid,position:null,selections:{},flags:{}});
  if(p.sid!==P.sid){ PQ_flush(); return PQ_queue(op,delay); }
  if(op.position!=null) p.position=op.position;
  if(op.selection) p.selections[op.selection.questionId]={...op.selection,seq:pqSeq()};
  if(op.flag) p.flags[op.flag.questionId]=op.flag;
  try{ localStorage.setItem(pqLocalKey(p.sid),JSON.stringify(p)); }catch{}
  setPqState("saving");
  clearTimeout(PQ.delayT);
  PQ.delayT=setTimeout(()=>PQ_flush(),delay||250);
}
async function PQ_flush(beacon){
  if(PQ.inflight||!PQ.pending) return;
  const p=PQ.pending; PQ.pending=null;
  const body={position:p.position??undefined,selections:Object.values(p.selections),flags:Object.values(p.flags)};
  if(beacon){
    // Leaving the page: hand the last change to the browser to deliver.
    try{ fetch(`/api/practice/sessions/${p.sid}`,{method:"PATCH",keepalive:true,headers:{"content-type":"application/json",authorization:"Bearer "+localStorage.getItem(LS.token)},body:JSON.stringify(body)}); }catch{}
    PQ.pending=p; return;
  }
  PQ.inflight=true;
  try{
    await api(`practice/sessions/${p.sid}`,{method:"PATCH",body:JSON.stringify(body)});
    PQ.backoff=0;
    if(!PQ.pending) { try{ localStorage.removeItem(pqLocalKey(p.sid)); }catch{} setPqState("saved"); }
  }catch(e){
    // Put it back (newer changes win) and retry with backoff.
    const n=PQ.pending; PQ.pending=p;
    if(n&&n.sid===p.sid){ if(n.position!=null) p.position=n.position; Object.assign(p.selections,n.selections); Object.assign(p.flags,n.flags); }
    if(e.status===409||e.status===404){ PQ.pending=null; setPqState("saved"); PQ.inflight=false; return; }
    PQ.backoff=Math.min(30000,(PQ.backoff||1000)*2);
    setPqState("retry");
    clearTimeout(PQ.retryT); PQ.retryT=setTimeout(()=>PQ_flush(),PQ.backoff);
  }
  PQ.inflight=false;
  if(PQ.pending) PQ_flush();
}
function PQ_retryNow(){ clearTimeout(PQ.retryT); PQ.backoff=0; PQ_flush(); }
window.addEventListener("online",()=>{ if(PQ.pending) PQ_retryNow(); });
// Changes this device made but could not send (closed tab, lost connection)
// are re-applied to the restored session and sent again.
function PQ_restoreLocal(p){
  let saved=null; try{ saved=JSON.parse(localStorage.getItem(pqLocalKey(p.sid))||"null"); }catch{}
  if(!saved) return;
  for(const s of Object.values(saved.selections||{})){ const it=p.items.find(i=>i.id===Number(s.questionId)); if(it&&!it.submitted) it.selected=s.value; }
  for(const f of Object.values(saved.flags||{})){ const it=p.items.find(i=>i.id===Number(f.questionId)); if(it) it.flagged=!!f.on; }
  PQ.pending={...saved,sid:p.sid}; setTimeout(()=>PQ_flush(),50);
}
function pqSaveText(){
  return PQ.state==="saving"?`<span class="dot"></span>Saving…`:PQ.state==="retry"?`<span class="dot bad"></span>Not saved yet · <button type="button" class="linkish" onclick="PQ_retryNow()">Retry</button>`:`${svg("check","ic-sm")} Saved`;
}
function setPqState(s){ PQ.state=s; const el=document.getElementById("pqSave"); if(el){ el.innerHTML=pqSaveText(); el.className="pq-save "+s; } }

// ── checking an answer ──
// Students never receive the answer key before answering: the server grades
// the attempt (once per question per session) and returns the key with it.
async function checkAnswer(){
  if(!P||P.checking) return;
  const it=itemAt(P.idx); const q=P.cache.get(it?.id); if(!it||!q) return;
  if(it.submitted||it.result||(P.results&&P.results[it.id])) return;
  const selected=q.type==="spr"?String(document.getElementById("sprIn")?.value||"").trim():it.selected;
  if(!selected) return;
  const btn=document.getElementById("checkBtn"), label=btn.innerHTML;
  const lock=on=>{ const inp=document.getElementById("sprIn"); if(inp) inp.disabled=on; document.querySelectorAll("#answerArea .choice").forEach(c=>c.disabled=on); };
  P.checking=true; btn.disabled=true; btn.textContent="Checking…"; lock(true);
  let res=null, err=null;
  try{
    if(P.server){
      if(PQ.pending) PQ_flush();
      const r=await api(`practice/sessions/${P.sid}/answer`,{method:"POST",body:JSON.stringify({questionId:it.id,selected})});
      res={selected:r.selected,correct:r.correct,answer:r.answer,acceptableAnswers:r.acceptableAnswers,explanation:r.explanation};
    } else {
      const g=await gradeAnswer(q,selected,P.mode);
      res={selected,...g};
    }
  }catch(e){ err=e; }
  P.checking=false;
  if(state.view!=="practice"||!P||itemAt(P.idx)!==it){ if(res) storeResult(it,res); return; }
  if(!res){
    if(err?.data?.locked){ it.locked=true; renderQuestion(); return; }
    toast(err?.message||"Could not check your answer. Try again.");
    lock(false); btn.innerHTML=label; btn.disabled=false;
    if(P.server&&!err?.status) setPqState("retry");
    return;
  }
  storeResult(it,res);
  paintPracticeResult(q,res);
  const pop=document.getElementById("pqPop"); if(pop){ pop.remove(); document.querySelector(".pq")?.insertAdjacentHTML("beforeend",pqPopHTML()); }
  const bar=document.querySelector(".q-progress i"); if(bar){ const done=P.items.filter(i=>i.submitted||i.result||(P.results&&P.results[i.id])).length; bar.style.width=Math.round(done/P.items.length*100)+"%"; }
  savePracticeProgress();
}
function storeResult(it,res){
  it.submitted=true; it.correct=!!res.correct; it.selected=res.selected; it.result=res;
  if(!P.server){ P.results=P.results||{}; P.results[it.id]=res; }
}
function paintPracticeResult(q,result){
  const {selected,correct}=result;
  const answer=result.answer??q.answer, explanation=result.explanation??q.explanation;
  if(q.type==="spr"){
    const inp=document.getElementById("sprIn"); if(inp){ inp.value=selected; inp.disabled=true; inp.style.borderColor=correct?"var(--mint)":"var(--red)"; }
  } else {
    document.querySelectorAll("#answerArea .choice").forEach(c=>{
      c.disabled=true;
      if(c.dataset.l===answer) c.classList.add("right");
      else if(c.dataset.l===selected) c.classList.add("wrong");
      c.classList.remove("sel");
    });
  }
  const tag=document.getElementById("fbTag");
  if(tag){ tag.className="feedback-tag "+(correct?"ok":"no"); tag.innerHTML=(correct?svg("check","ic-sm")+"Correct":svg("x","ic-sm")+"Not quite"); }
  const ex=document.getElementById("explainArea");
  if(ex) ex.innerHTML=`<div class="explain ${correct?"":"bad"}"><h4>${correct?"Why this works":"Correct answer: "+mathText(answer??"")}</h4><div class="explain-body">${mathText(explanation||"—")}</div></div>`;
  const cb=document.getElementById("checkBtn"); if(cb) cb.style.display="none";
}
function nextQuestion(){ PQ_go(P.idx+1); }
async function PQ_finish(){
  const open=P.items.filter(i=>!i.locked&&!(i.submitted||i.result||(P.results&&P.results[i.id]))).length;
  if(open&&!confirm(`${open} question${open===1?" is":"s are"} still unanswered. Finish this set anyway?`)) return;
  if(P.server){ await PQ_flush(); try{ await api(`practice/sessions/${P.sid}/complete`,{method:"POST"}); }catch(e){ toast(e.message); return; } QB.sessions=null; }
  finishPractice();
}
// The completion screen (unchanged flow): score, then practise again or return.
function finishPractice(fromStatus){
  clearActiveQuiz();
  if(desmosFloatEl) desmosDestroy();
  const graded=P.items.filter(i=>i.submitted||i.result||(P.results&&P.results[i.id]));
  const total=P.items.length, c=graded.filter(i=>i.correct||i.result?.correct||(P.results&&P.results[i.id]?.correct)).length;
  const pct=total?Math.round((c/total)*100):0;
  crumbs([{label:practiceReturnLabel(P.returnView),onclick:`go('${P.returnView}')`},{label:P.label}]);
  $c().innerHTML=`<div class="q-shell fade"><div class="q-card" style="text-align:center;padding:2.4rem">
    <div class="badge-ic ${pct>=80?'tone-ebrw':pct>=50?'tone-gold':''}" style="margin:0 auto 1.1rem;width:54px;height:54px">${svg("trophy")}</div>
    <h1 style="font-family:var(--disp);font-size:2rem;font-weight:800;letter-spacing:-.02em">${fromStatus===true?"This set has ended":"Set complete"}</h1>
    <p style="color:var(--ink2);margin:.4rem 0 1.6rem">${esc(P.label)}</p>
    <div style="font-family:var(--disp);font-size:3.4rem;font-weight:800;color:${pct>=80?'var(--mint)':pct>=50?'var(--gold)':'var(--red)'}">${pct}%</div>
    <p style="color:var(--ink2);margin-bottom:1.8rem">${c} of ${total} correct · ${graded.length} answered</p>
    <div style="display:flex;gap:.7rem;justify-content:center;flex-wrap:wrap">
      <button class="btn btn-primary" onclick="go('${P.returnView}')">${svg("back","ic-sm")} Return to ${practiceReturnLabel(P.returnView)}</button>
      ${P.server&&P.kind==="bank"?`<button class="btn btn-ghost" onclick="go('bank',{bankStage:'results',bf:${plJs(P.filters||{})}})">${svg("target","ic-sm")} Back to these results</button>`:""}
      <button class="btn btn-ghost" onclick="go('profile')">${svg("profile","ic-sm")} View progress</button>
    </div></div></div>`;
}

// Records and grades one answer on the server (tasks, review, rush).
async function recordAttempt(q,selected,mode){
  return api("attempts",{method:"POST",body:JSON.stringify({questionId:q.id, selected:String(selected), mode})});
}
async function gradeAnswer(q,selected,mode){
  if(state.user?.role!=="student"&&q.answer!==undefined)
    return {correct:q.type==="spr"?sprMatches(selected,q.answer):selected===q.answer,answer:q.answer,explanation:q.explanation||""};
  const row=await recordAttempt(q,selected,mode);
  return {correct:!!row?.correct,answer:row?.answer??null,explanation:row?.explanation||""};
}
// Kept for links that still call the old entry point.
async function startPractice(section,category,subcategory=null){
  const bf=blankBankFilters(); bf.subjects=[section]; if(category) bf.domains=[category]; if(subcategory) bf.skills=[subcategory];
  go("bank",{bankStage:"results",bf});
}

// ──────────────── Question Rush ────────────────
let R=null;
const RUSH={f:null,count:null};
async function viewRush(){
  crumbs([{label:"Question Rush"}]);
  if(R&&R.active){ renderRushQ(); return; }
  await loadAccess();
  if(state.user?.role==="student"&&!accSubjects("rush").length){ $c().innerHTML=lockedHTML("Question Rush"); return; }
  const dur=R?.dur||120;
  R={active:false,dur};
  RUSH.f=cleanFilters(RUSH.f||blankBankFilters(),{area:"rush",status:false});
  $c().innerHTML=`<div class="q-shell fade">
    <div class="page-head" style="text-align:center"><h1>Question Rush</h1><p style="margin:.4rem auto 0">Beat the clock. Answer as many as you can — instant feedback, building streaks.</p></div>
    <div class="q-card" style="padding:1.6rem">
      <div id="rushFilters">${filterPanelHTML(RUSH.f,{area:"rush",status:false,setter:"RUSH_set"})}</div>
      <div id="rushChips">${chipsHTML(RUSH.f,"RUSH_set")}</div>
      <p style="font-size:.74rem;text-transform:uppercase;letter-spacing:.08em;color:var(--ink3);margin:1rem 0 .6rem;text-align:center">Time</p>
      <div class="opt-row" id="durRow">${[[60,"60s"],[120,"2 min"],[180,"3 min"]].map(([v,l])=>`<button class="opt ${v===dur?'on':''}" data-dur="${v}" onclick="setDur(${v})">${l}</button>`).join("")}</div>
      <div id="rushAvail" class="rush-avail" role="status" aria-live="polite"></div>
      <button class="btn btn-primary btn-block" id="rushStart" style="margin-top:1rem;max-width:280px;margin-left:auto;margin-right:auto" onclick="beginRush()">${svg("rush","ic-sm")} Start rush</button>
    </div></div>`;
  RUSH_count();
}
function RUSH_set(k,v,on){
  RUSH.f=cleanFilters(toggleFilter(RUSH.f,k,v,on),{area:"rush",status:false});
  document.getElementById("rushFilters").innerHTML=filterPanelHTML(RUSH.f,{area:"rush",status:false,setter:"RUSH_set"});
  document.getElementById("rushChips").innerHTML=chipsHTML(RUSH.f,"RUSH_set");
  RUSH_count();
}
// About one question per six seconds keeps a rush going for its whole time.
const rushNeeded=d=>Math.ceil(d/6);
let rushCountSeq=0;
async function RUSH_count(){
  const seq=++rushCountSeq, el=document.getElementById("rushAvail"); if(!el) return;
  el.textContent="Counting matching questions…";
  try{ const r=await api(`practice/pool?mode=rush&${filterQuery(RUSH.f)}`); if(seq!==rushCountSeq) return; RUSH.count=r.count; paintRushAvail(); }
  catch(e){ if(seq===rushCountSeq) el.textContent=e.message; }
}
function paintRushAvail(){
  const el=document.getElementById("rushAvail"), btn=document.getElementById("rushStart"); if(!el) return;
  const n=RUSH.count, need=rushNeeded(R.dur);
  if(n==null){ el.textContent=""; return; }
  if(!n){ el.innerHTML=`<b>No questions match these filters.</b> Remove a filter to continue.`; if(btn) btn.disabled=true; return; }
  if(btn) btn.disabled=false;
  el.innerHTML=n>=need?`${n} matching questions.`:`<b>Only ${n} question${n===1?"":"s"} match.</b> The rush ends when they run out — nothing outside your filters is added. ${R.dur>60?`<button type="button" class="linkish" onclick="setDur(60)">Use 60 seconds</button> or `:""}change the filters.`;
}
function setDur(v){ R.dur=v; document.querySelectorAll("#durRow .opt").forEach(o=>o.classList.toggle("on",Number(o.dataset.dur)===v)); paintRushAvail(); }
async function beginRush(){
  const dur=R.dur; loading();
  let draw={questions:[],available:0},usage={enrolled:true,remaining:null};
  try{ [draw,usage]=await Promise.all([api("practice/rush",{method:"POST",body:JSON.stringify({filters:RUSH.f})}),api("usage")]); }catch(e){ toast(e.message); go("rush"); return; }
  if(!usage.enrolled&&usage.remaining<=0){ toast("Daily practice limit reached. It resets tomorrow."); go("home"); return; }
  let list=draw.questions;
  if(!usage.enrolled&&usage.remaining!=null) list=list.slice(0,usage.remaining);
  if(!list.length){ $c().innerHTML=`<div class="empty fade"><div class="ei">${svg("flame")}</div><p>No questions match these filters.</p><button class="btn btn-ghost" onclick="go('rush')">${svg("back","ic-sm")} Change filters</button></div>`; return; }
  R={active:true,dur,pending:false,list,idx:0,score:0,streak:0,best:0,answered:0,timeLeft:dur};
  R.timer=setInterval(()=>{ R.timeLeft--; updateRushTimer(); if(R.timeLeft<=0) endRush(); },1000);
  renderRushQ();
}

async function toggleSavedQuestion(questionId){
  const btn=document.getElementById("saveQBtn");
  try{ await api("saved-questions",{method:"POST",body:JSON.stringify({questionId})}); if(btn){btn.disabled=true;btn.textContent="Saved for review";} toast("Question saved for review"); }
  catch(e){ toast(e.message); }
}
