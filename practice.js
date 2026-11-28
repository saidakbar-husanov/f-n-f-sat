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
const ACC={data:null,at:0,p:null};
async function loadAccess(force){
  if(state.user?.role!=="student") return null;
  if(ACC.data&&!force&&Date.now()-ACC.at<15000) return ACC.data;
  // One request in flight at a time, however many views ask.
  if(!ACC.p) ACC.p=api("access",{bg:true}).then(d=>{ ACC.data=d; ACC.at=Date.now(); return d; }).catch(()=>ACC.data).finally(()=>{ ACC.p=null; });
  return ACC.p;
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
// One JSON value: domain and skill names can contain commas ("Form, structure,
// and sense"), so they are never joined or split on commas.
function filterQuery(f){
  const o={};
  for(const k of ["subjects","difficulties","domains","skills","status"]) if(f[k]?.length) o[k]=f[k];
  return Object.keys(o).length?"f="+encodeURIComponent(JSON.stringify(o)):"";
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
// The landing page shows the subject and domain cards straight away; a domain
// card starts practice in one click. Filters live in a compact popover (bottom
// sheet on phones) that is closed by default. There is no results page: both
// entry paths open the first matching question directly.
//
// QB.applied — the filters last used to start practice (kept in the URL so
//              Back returns here with them); QB.draft — unconfirmed edits in
//              the open panel (discarded by Escape / Cancel).
const QB={applied:null,draft:null,open:false,trigger:null,stats:null,statsAt:0,cont:null,starting:false};
async function qbStats(){
  if(QB.stats&&Date.now()-QB.statsAt<60000) return QB.stats;
  const s=await getStats(true);
  if(s===null) return null;            // failed: never shown as "0 items"
  QB.stats=s; QB.statsAt=Date.now(); return QB.stats;
}
async function viewBank(){
  crumbs([{label:"Question Bank"}]);
  QB_closeFilters(false);
  // Paint straight away from what is already known; counts fill in after.
  const statsP=qbStats();
  if(!ACC.data&&state.user?.role==="student") loading();
  await loadAccess();
  if(state.view!=="bank") return;
  if(state.user?.role==="student"&&!accSubjects("bank").length){ $c().innerHTML=lockedHTML("Question Bank practice"); return; }
  // Old links: /bank/results?… and ?section=…&category=… now land here with
  // those filters applied (the results page is gone).
  if(state.bankStage==="results"||state.section){
    const bf=state.bf?{...blankBankFilters(),...state.bf}:blankBankFilters();
    if(state.section){ bf.subjects=[state.section]; if(state.category) bf.domains=[state.category]; if(state.subcategory) bf.skills=[state.subcategory]; }
    Object.assign(state,{bankStage:null,section:null,category:null,subcategory:null,bf:activeFilterCount(bf)?bf:null});
    replaceRoute();
  }
  QB.applied=cleanFilters(state.bf||blankBankFilters(),{area:"bank",status:true});
  QB.applied.shuffle=!!state.bf?.shuffle?.length;
  const subs=accSubjects("bank");
  $c().innerHTML=`<div class="qb-head fade">
      <div class="page-head"><h1>Question Bank</h1><p>Pick a domain to start practising right away, or use Filters to combine subjects, difficulty, topics and your answer history.</p></div>
      <div class="qb-actions" id="qbActions"><span id="qbCont"></span>
        <button type="button" class="btn btn-ghost btn-sm qb-filter-btn" id="qbFilterBtn" aria-haspopup="dialog" aria-expanded="false" onclick="QB_openFilters(this)">${svg("funnel","ic-sm")} Filters${activeFilterCount(QB.applied)?` <span class="qb-badge">${activeFilterCount(QB.applied)}</span>`:""}</button></div>
    </div>
    ${activeFilterCount(QB.applied)?`<div class="qb-applied fade" aria-label="Last applied filters"><span class="umeta">Last filters:</span>${appliedChipsHTML(QB.applied)}<button type="button" class="btn btn-primary btn-xs" onclick="QB_startWith(QB.applied)">${svg("rush","ic-sm")} Practise again</button><button type="button" class="btn btn-ghost btn-xs" onclick="QB_clearApplied()">Clear</button></div>`:""}
    ${CR_costHTML()}<div id="qbCards">${subs.map(k=>qbSubjectHTML(k,null)).join("")}</div>`;
  CR_paint();
  QB_renderContinue();
  const stats=await statsP;
  if(state.view!=="bank") return;
  const host=document.getElementById("qbCards"); if(!host) return;
  if(stats===null){ host.insertAdjacentHTML("afterbegin",`<p class="st-note qb-statfail" role="alert">${svg("info","ic-sm")} Question counts couldn't be loaded. Practice still works — <button type="button" class="linkish" onclick="viewBank()">Retry</button></p>`); return; }
  host.innerHTML=subs.map(k=>qbSubjectHTML(k,stats)).join("");
}
// The original subject + domain cards.
function qbSubjectHTML(k,stats){
  const s=SECTIONS[k]; if(!s) return "";
  const n=c=>stats?countFor(stats,k,c):null;
  const total=stats?countFor(stats,k):null;
  return `<section class="qb-subject fade" aria-labelledby="qbS_${k}">
    <div class="qb-subhead"><div class="badge-ic ${s.tone}">${svg(s.icon)}</div><div class="qb-subtitle"><h2 id="qbS_${k}">${esc(s.label)}</h2><p class="umeta">${esc(s.blurb)}${total!=null?` · ${total} question${total===1?"":"s"}`:""}</p></div>
      <button type="button" class="btn btn-ghost btn-xs" onclick="QB_openFilters(this,{subjects:['${k}']})" aria-label="Filter ${esc(s.label)} questions">${svg("funnel","ic-sm")} Filter</button></div>
    <div class="tile-grid tg-2">${s.categories.map(cat=>{ const c=n(cat);
      return `<div class="tile qb-dom ${c===0?"empty":""}"><button type="button" class="qb-dom-go" onclick="QB_startDomain('${k}',${plJs(cat)})" ${c===0?"disabled":""} aria-label="Start practice: ${esc(cat)}${c!=null?`, ${c} questions`:""}"></button>
        <span class="count">${c==null?"…":`${c} item${c===1?"":"s"}`}</span>
        <div class="badge-ic ${s.tone}">${svg("target")}</div>
        <h3>${esc(cat)}</h3><p>${esc(CAT_BLURB[cat]||"")}</p>
        <div class="qb-dom-foot"><span class="arr">${c===0?"No questions yet":`Start practice ${svg("arr","ic-sm")}`}</span>
          <button type="button" class="qb-dom-filter" onclick="event.stopPropagation();QB_openFilters(this,{subjects:['${k}'],domains:[${plJs(cat)}]})" aria-label="Filter ${esc(cat)}" title="Filter this domain">${svg("funnel","ic-sm")}</button></div></div>`; }).join("")}</div>
  </section>`;
}
function appliedChipsHTML(f){
  const out=[]; f.subjects.forEach(v=>out.push(SUBJECT_LABEL[v]||v)); f.difficulties.forEach(v=>out.push(BAND_LABEL[v])); f.domains.forEach(v=>out.push(v)); f.skills.forEach(v=>out.push(v)); (f.status||[]).forEach(v=>out.push(STATUS_LABEL[v]));
  return out.map(l=>`<span class="pf-chip static">${esc(l)}</span>`).join("");
}
function QB_clearApplied(){ state.bf=null; replaceRoute(); viewBank(); }
async function QB_renderContinue(){
  let rows=[]; try{ rows=await api("practice/sessions?kind=bank"); }catch{ return; }
  QB.cont=rows;
  const el=document.getElementById("qbCont"); if(!el||state.view!=="bank") return;
  if(!rows.length){ el.innerHTML=""; return; }
  const s=rows[0];
  el.innerHTML=`<button type="button" class="btn btn-primary btn-sm qb-cont" onclick="resumeSession(${s.id})" title="${esc(s.label)} · question ${s.position+1} of ${s.total} · ${s.answered} answered">${svg("play","ic-sm")} Continue practice <span class="qb-cont-meta">${s.position+1}/${s.total}</span></button>`;
}

// ── filter panel (popover on desktop, bottom sheet on phones) ──
const qbSheet=()=>window.matchMedia("(max-width:760px)").matches;
function QB_openFilters(trigger,context){
  if(QB.open) QB_closeFilters(false);
  const base={...blankBankFilters(),...(QB.applied||blankBankFilters())};
  // Opened from a subject or domain: preselect that context.
  if(context){ Object.assign(base,blankBankFilters(),{subjects:context.subjects||[],domains:context.domains||[]}); }
  QB.draft=cleanFilters(base,{area:"bank",status:true});
  QB.draft.shuffle=!context&&!!QB.applied?.shuffle;
  QB.open=true; QB.trigger=trigger||document.getElementById("qbFilterBtn");
  document.getElementById("qbFilterBtn")?.setAttribute("aria-expanded","true");
  const el=document.createElement("div");
  el.id="qbFilterLayer"; el.className="qbf-layer"+(qbSheet()?" sheet":"");
  el.innerHTML=`<div class="qbf-scrim" onclick="QB_closeFilters(true)"></div>
    <div class="qbf" id="qbf" role="dialog" aria-modal="${qbSheet()}" aria-labelledby="qbfTitle">
      <div class="qbf-head"><b id="qbfTitle">Filters</b><span class="umeta" id="qbfCount" role="status" aria-live="polite">Counting…</span>
        <button type="button" class="btn btn-ghost btn-xs" onclick="QB_closeFilters(true)" aria-label="Close filters">${svg("x","ic-sm")}</button></div>
      <div class="qbf-body" id="qbfBody"></div>
      ${CR_costHTML()}<div class="qbf-foot"><button type="button" class="btn btn-ghost btn-sm" onclick="QB_draftSet('*',null,false)">Clear all</button><span class="spacer"></span>
        <button type="button" class="btn btn-ghost btn-sm" onclick="QB_closeFilters(true)">Cancel</button>
        <button type="button" class="btn btn-primary btn-sm" id="qbfStart" onclick="QB_startFiltered()">${svg("rush","ic-sm")} Start practice</button></div>
    </div>`;
  document.body.appendChild(el);
  QB_paintDraft(); CR_paint();
  QB_place();
  setTimeout(()=>el.querySelector(".qbf-body input, .qbf-body summary")?.focus(),0);
}
function QB_paintDraft(){
  const body=document.getElementById("qbfBody"); if(!body) return;
  const keep=body.scrollTop;
  body.innerHTML=filterPanelHTML(QB.draft,{area:"bank",status:true,setter:"QB_draftSet"})+
    `<label class="pf-opt qbf-shuffle ${QB.draft.shuffle?"on":""}"><input type="checkbox" ${QB.draft.shuffle?"checked":""} onchange="QB.draft.shuffle=this.checked;this.parentElement.classList.toggle('on',this.checked)"/><span>Shuffle question order</span></label>`;
  body.scrollTop=keep;
  QB_count();
}
function QB_draftSet(k,v,on){
  const shuffle=!!QB.draft?.shuffle;
  QB.draft=cleanFilters(toggleFilter(QB.draft,k,v,on),{area:"bank",status:true});
  QB.draft.shuffle=k==="*"?false:shuffle;
  // Keep focus on the option that was just toggled.
  const focusKey=document.activeElement?.closest?.(".pf-opt")?.textContent?.trim();
  QB_paintDraft();
  if(focusKey) [...document.querySelectorAll("#qbfBody .pf-opt")].find(l=>l.textContent.trim()===focusKey)?.querySelector("input")?.focus();
}
// Desktop: anchored under its trigger, clamped to the viewport.
function QB_place(){
  const layer=document.getElementById("qbFilterLayer"), box=document.getElementById("qbf"); if(!layer||!box) return;
  const sheet=qbSheet(); layer.classList.toggle("sheet",sheet); box.setAttribute("aria-modal",String(sheet));
  if(sheet){ box.style.cssText=""; return; }
  const t=QB.trigger&&document.body.contains(QB.trigger)?QB.trigger:document.getElementById("qbFilterBtn");
  const r=t?.getBoundingClientRect()||{bottom:80,right:innerWidth-16,left:innerWidth-400};
  const w=Math.min(560,innerWidth-24);
  let left=Math.min(Math.max(12,r.right-w),innerWidth-w-12);
  let top=r.bottom+8;
  const spaceBelow=innerHeight-top-12;
  if(spaceBelow<320&&r.top>spaceBelow){ top=Math.max(12,r.top-8-Math.min(620,r.top-20)); }
  box.style.cssText=`left:${left}px;top:${top}px;width:${w}px;max-height:${Math.max(240,innerHeight-top-12)}px`;
}
window.addEventListener("resize",()=>{ if(QB.open) QB_place(); });
window.addEventListener("scroll",()=>{ if(QB.open&&!qbSheet()) QB_place(); },{passive:true});
function QB_closeFilters(restoreFocus){
  if(!QB.open){ document.getElementById("qbFilterLayer")?.remove(); return; }
  QB.open=false; QB.draft=null; clearTimeout(qbCountT); qbCountSeq++;
  document.getElementById("qbFilterLayer")?.remove();
  document.getElementById("qbFilterBtn")?.setAttribute("aria-expanded","false");
  const t=QB.trigger; QB.trigger=null;
  if(restoreFocus&&t&&document.body.contains(t)) t.focus();
}
document.addEventListener("keydown",e=>{
  if(!QB.open) return;
  if(e.key==="Escape"){ e.preventDefault(); e.stopPropagation(); QB_closeFilters(true); return; }
  // Keep Tab inside the panel while it is open.
  if(e.key==="Tab"){
    const box=document.getElementById("qbf"); if(!box) return;
    const f=[...box.querySelectorAll("button:not([disabled]),input:not([disabled]),summary,[tabindex]:not([tabindex='-1'])")].filter(x=>x.offsetParent!==null);
    if(!f.length) return;
    if(e.shiftKey&&document.activeElement===f[0]){ e.preventDefault(); f[f.length-1].focus(); }
    else if(!e.shiftKey&&document.activeElement===f[f.length-1]){ e.preventDefault(); f[0].focus(); }
  }
},true);
// Three distinct states: counting (Start waits), failed (Retry — not a
// zero), and a real count. Every toggle bumps the sequence immediately, so a
// slower answer for an earlier selection can never overwrite the latest one.
let qbCountT=null, qbCountSeq=0;
function QB_count(){
  clearTimeout(qbCountT);
  const seq=++qbCountSeq;
  QB.draftCount=null;
  const el=document.getElementById("qbfCount"); if(el){ el.textContent="Counting…"; el.className="umeta qbf-count loading"; }
  const b0=document.getElementById("qbfStart"); if(b0) b0.disabled=true;
  QB_emptyNote(false);
  qbCountT=setTimeout(async()=>{
    const want=filterQuery(QB.draft);
    try{ const r=await api(`practice/pool?${want}&pageSize=5`); if(seq!==qbCountSeq||!QB.open) return;
      const c=document.getElementById("qbfCount"); if(c){ c.textContent=`${r.count} matching question${r.count===1?"":"s"}`; c.className="umeta qbf-count"; }
      const b=document.getElementById("qbfStart"); if(b) b.disabled=!r.count;
      QB.draftCount=r.count; QB_emptyNote(!r.count);
    }catch(e){
      if(seq!==qbCountSeq||!QB.open) return;
      const c=document.getElementById("qbfCount");
      if(c){ c.className="umeta qbf-count bad"; c.innerHTML=`Couldn't count matches${e.message?` (${esc(e.message)})`:""} · <button type="button" class="linkish" onclick="QB_count()">Retry</button>`; }
      // Not a zero: the server still decides when Start is pressed.
      const b=document.getElementById("qbfStart"); if(b) b.disabled=false;
    }
  },180);
}
function QB_emptyNote(show){
  const body=document.getElementById("qbfBody"); if(!body) return;
  let n=document.getElementById("qbfEmpty");
  if(!show){ n?.remove(); return; }
  if(!n){ n=document.createElement("p"); n.id="qbfEmpty"; n.className="qbf-empty"; n.setAttribute("role","alert"); body.prepend(n); }
  n.innerHTML=`${svg("info","ic-sm")} No questions match. Remove a filter — for example a topic, a difficulty or “${esc(STATUS_LABEL.incorrect)}”.`;
}
function newClientKey(){ return (crypto.randomUUID?crypto.randomUUID():Date.now().toString(36)+Math.random().toString(36).slice(2)); }
// Start a Question Bank session and open its first question. The landing
// page's history entry is updated first (applied filters + scroll), so Back
// returns to exactly this view.
async function QB_startWith(filters,opts={}){
  if(QB.starting) return false;
  const f=cleanFilters(filters,{area:"bank",status:true});
  const shuffle=!!filters.shuffle;
  QB.starting=true;
  const btn=opts.button; const label=btn?.innerHTML; if(btn){ btn.disabled=true; btn.textContent="Starting…"; }
  const navAt=navCurrent();
  try{
    const s=await api("practice/sessions",{method:"POST",body:JSON.stringify({kind:"bank",filters:f,shuffle,clientKey:newClientKey()})});
    // The student went to another section meanwhile: the session is saved
    // (Continue practice) but never pulls them back.
    if(navStale(navAt)){ QB.cont=null; return false; }
    if(opts.remember!==false){ state.bf=activeFilterCount(f)||shuffle?{...f,...(shuffle?{shuffle:["1"]}:{})}:null; replaceRoute(); }
    QB_closeFilters(false);
    openSession(s);
    return true;
  }catch(e){
    if(btn){ btn.disabled=false; btn.innerHTML=label; }
    if(e.data?.count===0||/No questions match/i.test(e.message||"")){ if(QB.open) QB_emptyNote(true); else toast("No questions match yet."); }
    else toast(e.message||"Could not start practice.");
    return false;
  }finally{ QB.starting=false; }
}
function QB_startFiltered(){
  if(!QB.draft) return;
  if(QB.draftCount===0){ QB_emptyNote(true); return; }   // keep the panel open to adjust
  if(QB.draftCount==null&&document.getElementById("qbfCount")?.classList.contains("loading")) return; // still counting
  QB_startWith({...QB.draft},{button:document.getElementById("qbfStart")});
}
function QB_startDomain(section,domain){
  const f=blankBankFilters(); f.subjects=[section]; f.domains=[domain];
  QB_startWith(f,{remember:false});
}
// Kept for old callers.
function QB_quick(section,domain){ if(domain) QB_startDomain(section,domain); else { const f=blankBankFilters(); f.subjects=[section]; QB_startWith(f,{remember:false}); } }

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
  $c().innerHTML=`<div class="page-head fade"><h1>Challenging Questions</h1><p>Named sets of harder questions. Each set is practised like the Question Bank — move freely between questions, check answers when you're ready, and continue later on any device.</p></div>${CR_costHTML()}<div id="chContinue"></div><div id="chList"><div class="spin"></div></div>`;
  CR_paint();
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
    const usage=await api("usage",{bg:true}); const ch=usage.limits?.challengeDaily;
    if(ch&&ch.limit!==null&&ch.remaining<=0){ toast(`Daily Challenging Questions limit (${ch.limit}) reached. It resets ${new Date(ch.resetsAt).toLocaleString()}.`); return; }
  }catch{}
  const navAt=navCurrent();
  try{ const s=await api("practice/sessions",{method:"POST",body:JSON.stringify({kind:"challenge",setId,clientKey:newClientKey()})}); if(navStale(navAt)) return; openSession(s); }
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
      items:list.map(q=>({id:q.id,section:q.section,difficulty:q.difficulty,locked:false,selected:null,submitted:false,correct:null,flagged:false})),idx:0,cache:new Map(list.map(q=>[q.id,q])),results:{}};
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
  crumbs([{label:practiceReturnLabel(P.returnView),onclick:`go('${P.returnView}')`},{label:P.label}]);
  const q=P.cache.get(it.id);
  if(!q&&!it.locked){
    $c().innerHTML=practiceFrameHTML(`<div class="bb bb-inline pq-work"><main class="bb-work single"><section class="bb-center"><div class="spin"></div></section></main></div>`);
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
  const [dl]=DIFF[q.difficulty]||DIFF[3];
  const reportSrc=P.mode==="challenge"?"challenge":String(P.mode).startsWith("task:")?"task":P.mode==="review"?"review":"bank";
  // Keep each pane's scroll when the same question is re-painted (after checking).
  const same=P.painted===it.id;
  const prevScroll=same?[...document.querySelectorAll(".pq-work .bb-pane, .pq-work .bb-work")].map(p=>p.scrollTop):[];
  const tools=`${q.section==="math"?`<button type="button" class="bb-tool qw-tool" id="practiceCalcBtn" onclick="toggleDesmosFloat()">${svg("calc","ic-sm")}<span>Calculator</span></button>`:""}`;
  const work=qwWorkspaceHTML(q,{
    num:P.idx+1, section:q.section, mode:"answer", given:it.selected??"", result,
    flagged:!!it.flagged, onFlag:"PQ_flag()", onPick:"pickChoice", onSpr:"PQ_sprInput", onSprEnter:"checkAnswer()",
    anno:pqAnnoCtx(), onClear:"PQ_clearPick",
    meta:`${esc(q.category)}${q.subcategory?` · ${esc(q.subcategory)}`:""} · ${dl}`, headExtra:tools,
  });
  $c().innerHTML=practiceFrameHTML(`<div class="bb bb-inline pq-work" data-qid="${q.id}">${work}
      <div class="q-actions pq-actions">
        <span class="feedback-tag" id="fbTag"></span>
        <button class="btn btn-ghost btn-sm" id="saveQBtn" onclick="toggleSavedQuestion(${q.id})">${svg("save","ic-sm")} Save for review</button>${plReportButtonHTML(q.id,reportSrc)}<span class="spacer"></span>
        ${typeof CR_costNote==="function"?CR_costNote(result):""}
        ${result?"":`<button class="btn btn-primary" id="checkBtn" onclick="checkAnswer()" ${String(it.selected??"").trim()?"":"disabled"}>Check answer</button>`}
      </div></div>`);
  if(same) document.querySelectorAll(".pq-work .bb-pane, .pq-work .bb-work").forEach((p,i)=>{ p.scrollTop=prevScroll[i]||0; });
  P.painted=it.id;
  typesetMath($c());
  if(desmosFloatEl&&DF.ctx!==dfContext()) desmosDestroy();
  if(desmosFloatEl&&DF.open&&q.section!=="math") desmosHide();
  dfAfterRender();
  wirePracticeKeys();
  savePracticeProgress();
  // Warm the next questions so moving on is instant.
  if(P.server) ensureQuestions([itemAt(P.idx+1)?.id,itemAt(P.idx+2)?.id]).catch(()=>{});
}
function PQ_sprInput(v){ PQ_select(v,true); }
// Question frame: the shared progress bar, save status and the navigator bar.
function practiceFrameHTML(inner){
  const total=P.items.length, done=P.items.filter(i=>i.submitted||i.result||(P.results&&P.results[i.id])).length;
  const pct=Math.round(done/total*100), last=P.idx+1>=total;
  return `<div class="q-shell fade pq">
    <div class="q-topline"><b class="pq-label">${esc(P.label)}</b><span style="flex:1"></span>${typeof qtFocusBtnHTML==="function"?qtFocusBtnHTML():""}${P.server?`<span class="pq-save" id="pqSave" role="status" aria-live="polite">${pqSaveText()}</span>`:""}</div>
    <div class="q-progress" title="${done} of ${total} answered"><i style="width:${pct}%"></i></div>
    ${inner}
    <nav class="pq-bar" aria-label="Question navigation">
      <button type="button" class="bb-btn" id="pqPrev" onclick="PQ_go(${P.idx-1})" ${P.idx<=0?"disabled":""}>Previous</button>
      <button type="button" class="bb-qpill" id="pqPill" onclick="PQ_toggleNav()" aria-haspopup="dialog" aria-expanded="false" aria-controls="pqPop">Question ${P.idx+1} of ${total} ${typeof ftIcon==="function"?ftIcon("chev"):""}</button>
      ${last?`<button type="button" class="bb-btn primary" onclick="PQ_finish()">Finish</button>`:`<button type="button" class="bb-btn primary" id="pqNext" onclick="PQ_go(${P.idx+1})">Next</button>`}
    </nav>
  </div>`;
}
// ── numbered question picker ──
// Rendered into <body> (outside the animated question frame, whose transform
// would otherwise trap a fixed element and clip it). Desktop: anchored above
// the footer bar and constrained to the viewport. Phones: a bottom sheet. The
// header (title, answered count, close) and legend stay put while the grid
// scrolls; the grid wraps, so every number is reachable without sideways
// scrolling.
const pqAnswered=x=>!!(x.submitted||x.result||(P.results&&P.results[x.id]));
const pqIsSheet=()=>window.matchMedia("(max-width:760px)").matches;
// Answer status from the session's own data. Correctness is shown only for
// answers already checked — practice reveals it at that moment anyway.
function pqStatus(x){
  if(x.locked) return "locked";
  const r=x.result||(P.results&&P.results[x.id]);
  if(x.submitted||r) return (r?r.correct:x.correct)?"correct":"incorrect";
  return x.selected!=null&&x.selected!==""?"pending":"unanswered";
}
function pqDiff(x){ return x.difficulty??P.cache.get(x.id)?.difficulty??null; }
const PQ_NAV_OPTS={correctness:true,showDiff:true};
function pqCells(){ return P.items.map((x,i)=>({i,status:pqStatus(x),diff:x.locked?null:pqDiff(x),flagged:!!x.flagged,cur:i===P.idx})); }
function pqNavF(){ return P.navF||(P.navF={st:"all",df:"all"}); }
function pqPopHTML(){
  const cells=pqCells(), f=pqNavF();
  return `<div class="pq-scrim" onclick="PQ_closeNav(true)"></div>
  <div class="pq-pop qn-pop" id="pqPop" role="dialog" aria-modal="true" aria-labelledby="pqPopTitle">
    <div class="pq-pop-head"><div class="pq-pop-title"><b id="pqPopTitle">${esc(P.label)}</b><span class="umeta" id="pqPopCount">Question ${P.idx+1} of ${P.items.length}</span></div>
      <button type="button" class="btn btn-ghost btn-xs" onclick="PQ_closeNav(true)" aria-label="Close question navigator">${svg("x","ic-sm")}</button></div>
    <div class="qn-head" id="qnHead">${pqNavHeadHTML(cells,f)}</div>
    <div class="pq-pop-grid" id="pqGrid" role="group" aria-label="Questions">${qnGridHTML(cells,f,PQ_NAV_OPTS,"PQ_jump")}</div>
    ${qnLegendHTML(PQ_NAV_OPTS)}</div>`;
}
function pqNavHeadHTML(cells,f){ return qnSummaryHTML(cells,PQ_NAV_OPTS)+qnFiltersHTML(cells,f,PQ_NAV_OPTS,"PQ_nav")+qnQuickHTML(cells,PQ_NAV_OPTS,"PQ_nav"); }
// Filters, jump-to-number and "next …" — they only move within this set.
function PQ_nav(k,v){
  if(!P) return;
  const f=pqNavF(), cells=pqCells();
  if(k==="reset"){ f.st="all"; f.df="all"; }
  else if(k==="st"||k==="df"){ f[k]=v; }
  else if(k==="jump"){ const n=Math.floor(Number(v)); if(n>=1&&n<=P.items.length) PQ_jump(n-1); else toast(`Enter a number from 1 to ${P.items.length}.`); return; }
  else if(k==="next"){ const i=qnNext(cells,P.idx,v); if(i<0) toast(QN_NONE[v]||"Nothing found."); else PQ_jump(i); return; }
  PQ_refreshNav(true);
}
function PQ_placeNav(){
  const layer=document.getElementById("pqLayer"), pop=document.getElementById("pqPop"); if(!layer||!pop) return;
  const sheet=pqIsSheet(); layer.classList.toggle("sheet",sheet);
  if(sheet){ pop.style.cssText=""; return; }
  const bar=document.querySelector(".pq-bar"), pill=document.getElementById("pqPill");
  const br=bar?.getBoundingClientRect(), pr=pill?.getBoundingClientRect();
  const w=Math.min(600,innerWidth-24);
  const center=pr?pr.left+pr.width/2:innerWidth/2;
  const left=Math.min(Math.max(12,center-w/2),innerWidth-w-12);
  // Bottom edge just above the footer bar (or the viewport bottom when the bar is off-screen).
  const barTop=br&&br.top>0&&br.top<innerHeight?br.top:innerHeight-12;
  const bottom=Math.max(12,innerHeight-barTop+10);
  const topbar=document.querySelector(".topbar")?.getBoundingClientRect().bottom||0;
  const maxH=Math.max(220,innerHeight-bottom-Math.max(12,topbar+8));
  pop.style.cssText=`left:${left}px;bottom:${bottom}px;width:${w}px;max-height:${maxH}px`;
}
function PQ_openNav(){
  if(!P) return;
  PQ_closeNav(false);
  P.nav=true;
  const layer=document.createElement("div"); layer.id="pqLayer"; layer.className="pq-layer";
  layer.innerHTML=pqPopHTML();
  document.body.appendChild(layer);
  PQ_placeNav();
  document.getElementById("pqPill")?.setAttribute("aria-expanded","true");
  // Show the current question straight away and focus its number.
  const grid=document.getElementById("pqGrid"), cur=grid?.querySelector(".bb-cell.cur")||grid?.querySelector('.bb-cell[tabindex="0"]');
  if(grid&&cur){ grid.scrollTop=Math.max(0,cur.offsetTop-grid.offsetTop-grid.clientHeight/2+cur.offsetHeight/2); cur.focus({preventScroll:true}); }
}
function PQ_closeNav(restoreFocus){
  const had=!!document.getElementById("pqLayer");
  document.getElementById("pqLayer")?.remove();
  if(P) P.nav=false;
  document.getElementById("pqPill")?.setAttribute("aria-expanded","false");
  if(had&&restoreFocus) document.getElementById("pqPill")?.focus();
}
function PQ_toggleNav(){ if(document.getElementById("pqLayer")) PQ_closeNav(true); else PQ_openNav(); }
// Re-paint the open picker (after an answer is checked) without moving its scroll.
function PQ_refreshNav(filtered){
  const grid=document.getElementById("pqGrid"); if(!grid||!P) return;
  const st=grid.scrollTop, focused=document.activeElement?.dataset?.i;
  const active=document.activeElement, sel=active?.closest?.("#qnHead")?[...document.querySelectorAll("#qnHead select")].indexOf(active):-1;
  const cells=pqCells(), f=pqNavF();
  grid.innerHTML=qnGridHTML(cells,f,PQ_NAV_OPTS,"PQ_jump");
  const head=document.getElementById("qnHead"); if(head) head.innerHTML=pqNavHeadHTML(cells,f);
  grid.scrollTop=filtered?0:st;
  if(sel>=0) document.querySelectorAll("#qnHead select")[sel]?.focus({preventScroll:true});
  else if(focused!=null) grid.querySelector(`[data-i="${focused}"]`)?.focus({preventScroll:true});
  if(filtered&&!grid.querySelector(".bb-cell")) document.querySelector("#qnHead button[onclick*=reset]")?.focus({preventScroll:true});
}
function PQ_jump(i){ PQ_closeNav(false); PQ_go(i); setTimeout(()=>document.getElementById("pqPill")?.focus({preventScroll:true}),0); }
function PQ_go(i){
  if(!P||i<0||i>=P.items.length) return;
  PQ_closeNav(false);
  P.idx=i;
  if(P.server) PQ_queue({position:i});
  renderQuestion();
  window.scrollTo(0,0);
}
window.addEventListener("resize",()=>{ if(document.getElementById("pqLayer")) PQ_placeNav(); });
window.addEventListener("scroll",()=>{ if(document.getElementById("pqLayer")&&!pqIsSheet()) PQ_placeNav(); },{passive:true});
// Escape closes the picker and returns focus to "Question X of Y"; arrow keys,
// Home and End move between numbers.
function wirePracticeKeys(){}
document.addEventListener("keydown",e=>{
  if(state.view!=="practice"||!P) return;
  const layer=document.getElementById("pqLayer");
  if(layer){
    if(e.key==="Escape"){ e.preventDefault(); e.stopPropagation(); PQ_closeNav(true); return; }
    const cell=e.target.closest?.("#pqGrid .bb-cell");
    if(cell&&["ArrowRight","ArrowLeft","ArrowDown","ArrowUp","Home","End"].includes(e.key)){
      const cells=[...document.querySelectorAll("#pqGrid .bb-cell")], i=cells.indexOf(cell);
      const cols=Math.max(1,Math.round(document.getElementById("pqGrid").clientWidth/(cell.offsetWidth+8)));
      const step={ArrowRight:1,ArrowLeft:-1,ArrowDown:cols,ArrowUp:-cols}[e.key];
      const n=e.key==="Home"?0:e.key==="End"?cells.length-1:Math.min(cells.length-1,Math.max(0,i+step));
      e.preventDefault(); cells[i].tabIndex=-1; cells[n].tabIndex=0; cells[n].focus(); return;
    }
    if(e.key==="Tab"){
      const pop=document.getElementById("pqPop");
      const f=[...pop.querySelectorAll("button,select,input")].filter(el=>!el.disabled&&el.offsetParent!==null&&(!el.closest("#pqGrid")||el.tabIndex===0));
      if(f.length){ const at=f.indexOf(document.activeElement); e.preventDefault(); f[(at+(e.shiftKey?f.length-1:1))%f.length].focus(); }
      return;
    }
  }
  const c=e.target.closest?.("#answerArea .choice");
  if(c&&(e.key==="ArrowDown"||e.key==="ArrowRight"||e.key==="ArrowUp"||e.key==="ArrowLeft")&&!e.altKey){
    const all=[...document.querySelectorAll("#answerArea .choice:not([disabled])")]; const i=all.indexOf(c);
    const n=all[(i+(e.key==="ArrowDown"||e.key==="ArrowRight"?1:all.length-1))%all.length]; if(n){ e.preventDefault(); n.focus(); }
  }
},true);

function markChoice(l){
  document.querySelectorAll(".pq-work .bb-opt").forEach(o=>{ const on=o.dataset.l===l; o.classList.toggle("sel",on); const m=o.querySelector(".bb-opt-main"); if(m){ m.setAttribute("aria-checked",String(on)); m.tabIndex=on?0:-1; } });
  const b=document.getElementById("checkBtn"); if(b) b.disabled=!l;
}
function pickChoice(l){
  const it=itemAt(P.idx); if(!it||P.checking||it.submitted||it.result||(P.results&&P.results[it.id])) return;
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
  PQ_refreshNav();
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
  const lock=on=>{ const inp=document.getElementById("sprIn"); if(inp) inp.disabled=on; document.querySelector(".pq-work .bb-opts")?.classList.toggle("qw-locked",on); };
  P.checking=true; btn.disabled=true; btn.textContent="Checking…"; lock(true);
  let res=null, err=null;
  try{
    if(P.server){
      if(PQ.pending) PQ_flush();
      const r=await api(`practice/sessions/${P.sid}/answer`,{method:"POST",body:JSON.stringify({questionId:it.id,selected})});
      res={selected:r.selected,correct:r.correct,answer:r.answer,acceptableAnswers:r.acceptableAnswers,explanation:r.explanation,credit:r.credit};
    } else {
      // One id per submission: a retry after a dropped connection is the
      // same attempt (never a second score or charge).
      it.attemptKey=it.attemptKey||newClientKey();
      const g=await gradeAnswer(q,selected,P.mode,it.attemptKey);
      res={selected,...g};
    }
  }catch(e){ err=e; }
  P.checking=false;
  if(res&&typeof CR_receipt==="function") CR_receipt(res.credit);
  if(state.view!=="practice"||!P||itemAt(P.idx)!==it){ if(res) storeResult(it,res); return; }
  if(!res){
    if(err?.data?.locked){ it.locked=true; renderQuestion(); return; }
    if(err?.data?.outOfCredits){ if(typeof CR_outOfCredits==="function") CR_outOfCredits(err.data); lock(false); btn.innerHTML=label; btn.disabled=true; return; }
    if(!err?.status){
      // Connection dropped: the server may already have accepted it. Show
      // "Submission pending" and reconcile automatically on reconnect — the
      // same request returns the stored result and receipt if it landed.
      btn.innerHTML="Submission pending…"; btn.disabled=true;
      const tag=document.getElementById("fbTag"); if(tag){ tag.className="feedback-tag pend"; tag.textContent="Submission pending — reconnecting"; }
      const retry=()=>{ window.removeEventListener("online",retry); clearTimeout(P.pendT); if(P&&itemAt(P.idx)===it&&state.view==="practice") checkAnswer(); };
      window.addEventListener("online",retry); P.pendT=setTimeout(retry,4000);
      return;
    }
    toast(err?.message||"Could not check your answer. Try again.");
    lock(false); btn.innerHTML=label; btn.disabled=false;
    return;
  }
  storeResult(it,res);
  paintPracticeResult(q,res);
  PQ_refreshNav();
  const bar=document.querySelector(".q-progress i"); if(bar){ const done=P.items.filter(i=>i.submitted||i.result||(P.results&&P.results[i.id])).length; bar.style.width=Math.round(done/P.items.length*100)+"%"; }
  savePracticeProgress();
}
function storeResult(it,res){
  it.submitted=true; it.correct=!!res.correct; it.selected=res.selected; it.result=res;
  if(!P.server){ P.results=P.results||{}; P.results[it.id]=res; }
}
// The checked question is re-painted read-only by the shared workspace:
// submitted answer, correct answer and the full explanation.
function paintPracticeResult(q,result){ renderQuestion(); }
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
      ${P.server&&P.kind==="bank"?`<button class="btn btn-ghost" onclick="QB_startWith(${plJs({...(P.filters||{}),shuffle:!!P.filters?.shuffle})},{remember:false})">${svg("rush","ic-sm")} Practise these again</button>`:""}
      ${graded.length-c>0?`<button class="btn btn-ghost" onclick="PQ_reviewIncorrect()">${svg("back","ic-sm")} Review ${graded.length-c} incorrect question${graded.length-c===1?"":"s"}</button>`:""}
      <button class="btn btn-ghost" onclick="go('profile')">${svg("profile","ic-sm")} View progress</button>
    </div></div></div>`;
}

// Mistake-based practice: the incorrectly answered questions of this set as a
// fresh review set (the existing "review" flow). The original session, its
// answers and scores stay as they were; the retry is recorded separately
// under the existing review mode and its rules.
async function PQ_reviewIncorrect(){
  if(!P) return;
  const wrong=P.items.filter(i=>pqStatus(i)==="incorrect");
  if(!wrong.length){ toast("No incorrect answers in this set."); return; }
  const missing=wrong.map(i=>i.id).filter(id=>!P.cache.has(id));
  try{ for(let k=0;k<missing.length;k+=6) await ensureQuestions(missing.slice(k,k+6)); }
  catch(e){ toast(e.message||"Could not load the questions."); return; }
  const list=wrong.map(i=>P.cache.get(i.id)).filter(Boolean).map(q=>{ const {result,...rest}=q; return rest; });
  if(!list.length){ toast("These questions are no longer available."); return; }
  const back=P.returnView;
  clearActiveQuiz();
  go("practice",{practiceSet:list,practiceLabel:`Incorrect · ${P.label}`,practiceMode:"review",practiceReturn:back,sid:null,q:null});
}

// Records and grades one answer on the server (tasks, review, rush).
async function recordAttempt(q,selected,mode,attemptKey){
  return api("attempts",{method:"POST",body:JSON.stringify({questionId:q.id, selected:String(selected), mode, attemptKey:attemptKey||newClientKey()})});
}
// Network failures are retried with the same attempt id, so a retry can never
// score or charge twice.
async function gradeAnswer(q,selected,mode,attemptKey){
  if(state.user?.role!=="student"&&q.answer!==undefined)
    return {correct:q.type==="spr"?sprMatches(selected,q.answer):selected===q.answer,answer:q.answer,acceptableAnswers:q.acceptableAnswers,explanation:q.explanation||""};
  const key=attemptKey||newClientKey();
  let row, lastErr;
  for(let i=0;i<3;i++){
    try{ row=await recordAttempt(q,selected,mode,key); break; }
    catch(e){ lastErr=e; if(e.status) throw e; await new Promise(r=>setTimeout(r,800*(i+1))); }
  }
  if(!row) throw lastErr;
  if(typeof CR_receipt==="function") CR_receipt(row.credit);
  return {correct:!!row?.correct,answer:row?.answer??null,acceptableAnswers:row?.acceptableAnswers,explanation:row?.explanation||"",credit:row.credit};
}
// Kept for links that still call the old entry point.
async function startPractice(section,category,subcategory=null){
  const bf=blankBankFilters(); bf.subjects=[section]; if(category) bf.domains=[category]; if(subcategory) bf.skills=[subcategory];
  QB_startWith(bf,{remember:false});
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
      <div id="rushAvail" class="rush-avail" role="status" aria-live="polite"></div>${CR_costHTML()}
      <button class="btn btn-primary btn-block" id="rushStart" style="margin-top:1rem;max-width:280px;margin-left:auto;margin-right:auto" onclick="beginRush()">${svg("rush","ic-sm")} Start rush</button>
    </div></div>`;
  RUSH_count(); CR_paint();
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
  try{ [draw,usage]=await Promise.all([api("practice/rush",{method:"POST",body:JSON.stringify({filters:RUSH.f})}),api("usage")]); }catch(e){ if(e.data?.outOfCredits) CR_outOfCredits(e.data); else toast(e.message); go("rush"); return; }
  CR_receipt(draw.credit);
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
