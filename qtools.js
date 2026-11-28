// qtools.js — shared question tools for every role and every question screen.
//
//  • Layout preferences: the app sidebar is expanded, compact (icons only) or
//    hidden, remembered per user and role on this device. Focus Mode hides the
//    sidebar for the question workspace and restores the previous state on exit.
//    Layout changes are class toggles only — nothing re-renders, so answers,
//    timers, annotations and scroll positions are untouched.
//  • Personal annotations for the shared workspace (qwWorkspaceHTML): colour
//    highlights / underline and eliminated answer choices. They are stored
//    apart from the question, keyed by user + workspace context (practice
//    session, task set…) + question id. Previews and reviews use an in-memory
//    context, so nothing is ever written to shared content or student attempts.
//    The Full Mock runner keeps its own server-saved highlighter (fulltest.js).
//  • The Question Progress & Difficulty Navigator helpers used by practice
//    sessions and the Full Mock question map.

// ──────────────── tiny icons ────────────────
const QT_IC={
  panel:'<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16"/>',
  collapse:'<path d="M15 18l-6-6 6-6"/>',
  expand:'<path d="M9 18l6-6-6-6"/>',
  hide:'<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16"/><path d="M15 10l-2 2 2 2"/>',
  focus:'<path d="M4 9V4h5"/><path d="M20 9V4h-5"/><path d="M4 15v5h5"/><path d="M20 15v5h-5"/>',
  unfocus:'<path d="M9 4v5H4"/><path d="M15 4v5h5"/><path d="M9 20v-5H4"/><path d="M15 20v-5h5"/>',
  check:'<path d="M5 12l5 5 9-10"/>', x:'<path d="M6 6l12 12M18 6L6 18"/>',
  book:'<path d="M6 3h12v18l-6-4-6 4z"/>', dot:'<circle cx="12" cy="12" r="4"/>', skip:'<path d="M5 12h14"/>',
};
function qtIc(n,cls="ic-sm"){ return `<svg class="ic ${cls}" viewBox="0 0 24 24" aria-hidden="true">${QT_IC[n]||""}</svg>`; }

// ──────────────── sidebar state + Focus Mode ────────────────
const QT={focus:false};
function qtSideKey(){ const u=typeof state==="object"?state.user:null; return `fnf_side_${u?.key||u?.id||"anon"}_${u?.role||""}`; }
function qtSide(){ try{ const v=localStorage.getItem(qtSideKey()); return v==="compact"||v==="hidden"?v:"expanded"; }catch{ return "expanded"; } }
// Classes for the shell element (used by shellHTML so a rebuilt shell keeps its state).
function qtShellClass(){ const s=qtSide(); return `${s==="expanded"?"":"side-"+s}${QT.focus?" side-focus":""}`; }
function qtApplyShell(){
  const sh=document.getElementById("shell");
  const s=qtSide();
  if(sh){ sh.classList.toggle("side-compact",s==="compact"); sh.classList.toggle("side-hidden",s==="hidden"); sh.classList.toggle("side-focus",QT.focus); }
  document.body.classList.toggle("qt-focus",QT.focus);
  document.querySelectorAll("[data-side-ctl=compact]").forEach(b=>{ const c=s==="compact"; b.innerHTML=qtIc(c?"expand":"collapse"); b.title=c?"Expand sidebar":"Collapse sidebar to icons"; b.setAttribute("aria-label",b.title); b.setAttribute("aria-expanded",String(!c)); });
  document.querySelectorAll(".qt-focus-btn").forEach(b=>{ b.classList.toggle("on",QT.focus); b.setAttribute("aria-pressed",String(QT.focus)); b.innerHTML=`${qtIc(QT.focus?"unfocus":"focus")}<span>${QT.focus?"Exit Focus Mode":"Focus Mode"}</span>`; });
  qtTipHide();
}
function QT_setSide(v){
  try{ localStorage.setItem(qtSideKey(),v); }catch{}
  qtApplyShell();
  if(v==="hidden") setTimeout(()=>document.getElementById("sideRestore")?.focus({preventScroll:true}),0);
}
function QT_toggleCompact(){ QT_setSide(qtSide()==="compact"?"expanded":"compact"); }
function QT_focusMode(on){
  on=on===undefined?!QT.focus:!!on;
  if(on===QT.focus) return;
  QT.focus=on; qtApplyShell();
  // The split/grid recomputes from CSS; Desmos and the open navigator re-measure.
  window.dispatchEvent(new Event("resize"));
}
function qtFocusBtnHTML(){
  return `<button type="button" class="qt-focus-btn ${QT.focus?"on":""}" aria-pressed="${QT.focus}" onclick="QT_focusMode()" title="Hide the sidebar and give the question all the room">${qtIc(QT.focus?"unfocus":"focus")}<span>${QT.focus?"Exit Focus Mode":"Focus Mode"}</span></button>`;
}
// Sidebar controls (desktop only — phones use the drawer).
function qtSideCtlHTML(){
  const c=qtSide()==="compact";
  return `<div class="side-ctl-row">
    <button type="button" class="side-ctl" data-side-ctl="compact" onclick="QT_toggleCompact()" title="${c?"Expand sidebar":"Collapse sidebar to icons"}" aria-label="${c?"Expand sidebar":"Collapse sidebar to icons"}" aria-expanded="${!c}">${qtIc(c?"expand":"collapse")}</button>
    <button type="button" class="side-ctl" onclick="QT_setSide('hidden')" title="Hide sidebar" aria-label="Hide sidebar">${qtIc("hide")}</button></div>`;
}
function qtTopCtlHTML(){
  return `<button type="button" class="side-restore" id="sideRestore" onclick="QT_setSide('expanded')" title="Show sidebar" aria-label="Show sidebar">${qtIc("panel")}<span>Menu</span></button>
    <button type="button" class="qt-exit-focus" onclick="QT_focusMode(false)">${qtIc("unfocus")}<span>Exit Focus Mode</span></button>`;
}
// Compact sidebar: a tooltip naming each icon, on hover and on keyboard focus.
function qtTipHide(){ document.getElementById("qtTip")?.remove(); }
function qtTipShow(btn){
  if(!btn.closest(".shell.side-compact")||!matchMedia("(min-width:861px)").matches) return;
  const label=btn.dataset.tip||btn.textContent.trim(); if(!label) return;
  qtTipHide();
  const t=document.createElement("div"); t.id="qtTip"; t.className="qt-tip"; t.setAttribute("role","tooltip"); t.textContent=label;
  document.body.appendChild(t);
  const r=btn.getBoundingClientRect();
  t.style.top=Math.round(r.top+r.height/2-t.offsetHeight/2)+"px"; t.style.left=Math.round(r.right+10)+"px";
}
document.addEventListener("mouseover",e=>{ const b=e.target.closest?.(".shell.side-compact .sidebar .nav-item,.shell.side-compact .sidebar [data-tip]"); if(b) qtTipShow(b); else if(document.getElementById("qtTip")&&!e.target.closest?.(".sidebar")) qtTipHide(); });
document.addEventListener("mouseout",e=>{ if(e.target.closest?.(".sidebar")&&!e.relatedTarget?.closest?.(".sidebar")) qtTipHide(); });
document.addEventListener("focusin",e=>{ const b=e.target.closest?.(".shell.side-compact .sidebar .nav-item,.shell.side-compact .sidebar [data-tip]"); if(b) qtTipShow(b); else qtTipHide(); });
document.addEventListener("scroll",qtTipHide,true);
document.addEventListener("keydown",e=>{ if(e.key==="Escape"&&QT.focus&&!document.querySelector("#pqLayer,.ft-modal-back,#qaBar,#bbPop")&&!document.body.classList.contains("bb-on")) QT_focusMode(false); });

// ──────────────── personal annotations ────────────────
const QA={mem:new Map(),pending:null,down:null,raf:0};
const QA_COLORS=[["yellow","Yellow"],["green","Green"],["blue","Blue"],["pink","Pink"]];
const qaMemCtx=ctx=>String(ctx).startsWith("mem:");
function qaStoreKey(ctx){ return `fnf_qa_${state?.user?.key||state?.user?.id||"anon"}_${ctx}`; }
function qaAll(ctx){
  if(qaMemCtx(ctx)){ if(!QA.mem.has(ctx)) QA.mem.set(ctx,{}); return QA.mem.get(ctx); }
  try{ const v=JSON.parse(localStorage.getItem(qaStoreKey(ctx))||"{}"); return v&&typeof v==="object"?v:{}; }catch{ return {}; }
}
function qaSaveAll(ctx,all){
  if(qaMemCtx(ctx)){ QA.mem.set(ctx,all); return; }
  try{ if(Object.keys(all).length) localStorage.setItem(qaStoreKey(ctx),JSON.stringify(all)); else localStorage.removeItem(qaStoreKey(ctx)); }catch{}
}
function qaGet(ctx,qid){ const e=qaAll(ctx||"mem:ws")[String(qid)]||{}; return {hl:Array.isArray(e.hl)?e.hl:[],el:Array.isArray(e.el)?e.el:[]}; }
function qaPut(ctx,qid,entry){
  const all=qaAll(ctx);
  if(!entry.hl.length&&!entry.el.length) delete all[String(qid)]; else all[String(qid)]={hl:entry.hl,el:entry.el};
  qaSaveAll(ctx,all);
}
const qaWorkOf=el=>el?.closest?.(".bb-work[data-qa]");
const qaEntry=work=>qaGet(work.dataset.qa,work.dataset.qid);

// Toolbar in the question header: clear actions appear only when there is something to clear.
function qaToolsHTML(q,ctx,locked){
  const e=qaGet(ctx||"mem:ws",q.id);
  const mc=q.type!=="spr";
  return `<span class="qa-tools">
    <button type="button" class="bb-hlclear qa-clear-hl" onclick="QA_clearHl(this)" ${e.hl.length?"":"hidden"} title="Remove every highlight on this question">${typeof ftIcon==="function"?ftIcon("marker"):""} Clear highlights</button>
    ${mc&&!locked?`<button type="button" class="bb-hlclear qa-clear-el" onclick="QA_clearElim(this)" ${e.el.length?"":"hidden"} title="Restore every eliminated answer choice">${qtIc("x")} Clear eliminations</button>`:""}
    <span class="qa-hint" title="Select text in the passage, question or an answer choice to highlight or underline it">${typeof ftIcon==="function"?ftIcon("marker"):""}<span>Select text to highlight</span></span></span>`;
}
function qaSyncTools(work){
  const e=qaEntry(work);
  const hl=work.querySelector(".qa-clear-hl"); if(hl) hl.hidden=!e.hl.length;
  const el=work.querySelector(".qa-clear-el"); if(el) el.hidden=!e.el.length;
}
function qaUnwrap(work){
  const parents=new Set();
  work.querySelectorAll("mark.qa-hl").forEach(m=>{ const p=m.parentNode; while(m.firstChild) p.insertBefore(m.firstChild,m); p.removeChild(m); parents.add(p); });
  parents.forEach(p=>p.normalize());
}
// Paint the stored highlights over the rendered question (never changes the question).
function qaPaint(work){
  if(typeof ftHlPaint!=="function") return;
  qaUnwrap(work);
  for(const h of qaEntry(work).hl){
    const root=work.querySelector(`[data-hl="${CSS.escape(h.field)}"]`);
    if(!root) continue;
    if(ftHlPaint(root,h)) root.querySelectorAll(`mark.bb-hl[data-hid="${h.id}"]`).forEach(m=>{
      m.classList.add("qa-hl","qa-"+(QA_COLORS.some(c=>c[0]===h.color)||h.color==="underline"?h.color:"yellow"));
      m.setAttribute("aria-label",`${h.color==="underline"?"Underlined":"Highlighted"} text — press Delete to remove`);
    });
  }
  qaSyncTools(work);
}
// New workspaces are painted as soon as they are in the page (every screen
// that renders the shared workspace gets this without its own wiring).
const qaObs=new MutationObserver(()=>{
  if(QA.raf) return;
  QA.raf=requestAnimationFrame(()=>{ QA.raf=0; document.querySelectorAll(".bb-work[data-qa]:not([data-qa-done])").forEach(w=>{ w.dataset.qaDone="1"; qaPaint(w); }); });
});
if(document.body) qaObs.observe(document.body,{childList:true,subtree:true});
else document.addEventListener("DOMContentLoaded",()=>qaObs.observe(document.body,{childList:true,subtree:true}));

// ── elimination ──
function qaSetOpt(work,l,struck){
  const opt=work.querySelector(`.bb-opt[data-l="${l}"]`); if(!opt) return;
  opt.classList.toggle("struck",struck);
  const b=opt.querySelector(".qa-strike");
  if(b){ b.setAttribute("aria-pressed",String(struck)); b.title=`${struck?"Restore":"Eliminate"} answer ${l}`; b.setAttribute("aria-label",b.title); b.innerHTML=struck?"Undo":`<s>${l}</s>`; }
  const m=opt.querySelector(".bb-opt-main"); if(m){ const lab=(m.getAttribute("aria-label")||"").replace(/, eliminated$/,""); m.setAttribute("aria-label",lab+(struck?", eliminated":"")); }
}
// Elimination never selects, submits, grades or charges — it is a personal mark.
function QA_elim(e,l){
  e.preventDefault(); e.stopPropagation();
  const work=qaWorkOf(e.currentTarget||e.target); if(!work) return;
  const en=qaEntry(work), set=new Set(en.el);
  const on=!set.has(l); if(on) set.add(l); else set.delete(l);
  qaPut(work.dataset.qa,work.dataset.qid,{hl:en.hl,el:[...set].sort()});
  qaSetOpt(work,l,on);
  // Eliminating the chosen (not yet submitted) answer clears that choice.
  const opt=work.querySelector(`.bb-opt[data-l="${l}"]`);
  if(on&&opt?.classList.contains("sel")&&work.dataset.qaClear) window[work.dataset.qaClear]?.(l);
  qaSyncTools(work);
}
function QA_unElim(el,l){
  const work=qaWorkOf(el); if(!work) return;
  const en=qaEntry(work); if(!en.el.includes(l)) return;
  qaPut(work.dataset.qa,work.dataset.qid,{hl:en.hl,el:en.el.filter(x=>x!==l)});
  qaSetOpt(work,l,false); qaSyncTools(work);
}
function QA_clearElim(btn){
  const work=qaWorkOf(btn); if(!work) return;
  const en=qaEntry(work);
  en.el.forEach(l=>qaSetOpt(work,l,false));
  qaPut(work.dataset.qa,work.dataset.qid,{hl:en.hl,el:[]}); qaSyncTools(work);
}
// Choosing an answer: a click that ends a text selection (or lands on a
// highlight) is not a pick; picking an eliminated choice restores it first.
function QA_down(e){ QA.down={x:e.clientX,y:e.clientY}; }
function QA_pick(e,l,fn){
  const sel=window.getSelection?.(), opt=e.currentTarget;
  if(sel&&!sel.isCollapsed&&opt.contains(sel.anchorNode)) return;
  if(QA.down&&Math.hypot(e.clientX-QA.down.x,e.clientY-QA.down.y)>6) return;
  if(e.target.closest("mark.qa-hl")) return;
  QA_unElim(opt,l);
  window[fn]?.(l);
}

// ── highlighting ──
function qaSelection(){
  if(typeof ftHlOffset!=="function") return null;
  const sel=window.getSelection?.(); if(!sel||sel.isCollapsed||!sel.rangeCount) return null;
  const r=sel.getRangeAt(0);
  const el=n=>n.nodeType===1?n:n.parentElement;
  const a=el(r.startContainer)?.closest(".bb-work[data-qa] [data-hl]"), b=el(r.endContainer)?.closest(".bb-work[data-qa] [data-hl]");
  if(!a) return null;
  if(a!==b) return {error:"Highlight one part at a time — the passage, the question or a single answer choice."};
  const start=ftHlOffset(a,r.startContainer,r.startOffset), end=ftHlOffset(a,r.endContainer,r.endOffset);
  if(start==null||end==null||end<=start) return null;
  const quote=ftHlText(a).slice(start,end);
  if(!quote.trim()) return null;
  return {work:qaWorkOf(a),root:a,field:a.dataset.hl,start,end,quote,rect:r.getBoundingClientRect()};
}
function qaHideBar(){ document.getElementById("qaBar")?.remove(); QA.pending=null; document.querySelectorAll("mark.qa-hl.on").forEach(x=>x.classList.remove("on")); }
function qaBar(rect,html,kind){
  qaHideBar();
  const bar=document.createElement("div"); bar.id="qaBar"; bar.className="bb-hlbar qa-bar"; bar.dataset.kind=kind; bar.setAttribute("role","toolbar"); bar.setAttribute("aria-label","Highlighter");
  bar.innerHTML=html;
  bar.addEventListener("pointerdown",e=>e.preventDefault());
  bar.addEventListener("mousedown",e=>e.preventDefault());
  document.body.appendChild(bar);
  const bw=bar.offsetWidth, bh=bar.offsetHeight, vw=document.documentElement.clientWidth;
  let top=rect.top-bh-10; if(top<8) top=rect.bottom+10;
  bar.style.top=Math.round(Math.min(top,innerHeight-bh-8))+"px";
  bar.style.left=Math.round(Math.max(8,Math.min(vw-bw-8,rect.left+rect.width/2-bw/2)))+"px";
  return bar;
}
function qaSwatches(action,current){
  return QA_COLORS.map(([c,label])=>`<button type="button" class="qa-sw qa-sw-${c} ${current===c?"on":""}" onclick="${action}('${c}')" aria-label="${label} highlight" title="${label}"></button>`).join("")
    +`<button type="button" class="bb-hlbtn qa-u-btn ${current==="underline"?"on":""}" onclick="${action}('underline')" aria-label="Underline" title="Underline"><u>U</u></button>`;
}
function qaCheck(){
  if(document.body.classList.contains("bb-on")) return; // the Full Mock runner has its own highlighter
  const s=qaSelection();
  if(!s){ if(document.getElementById("qaBar")?.dataset.kind!=="remove") qaHideBar(); return; }
  if(s.error){ qaBar(window.getSelection().getRangeAt(0).getBoundingClientRect(),`<span class="bb-hlnote">${esc(s.error)}</span>`,"note"); return; }
  qaBar(s.rect,`<span class="qa-bar-label">Highlight</span>${qaSwatches("QA_add")}`,"add");
  QA.pending=s;
}
let qaT=null;
document.addEventListener("selectionchange",()=>{ if(document.body.classList.contains("bb-on")) return; clearTimeout(qaT); qaT=setTimeout(qaCheck,220); });
document.addEventListener("pointerup",e=>{ if(document.body.classList.contains("bb-on")||e.target.closest?.("#qaBar")) return; if(e.target.closest?.(".bb-work[data-qa]")) setTimeout(qaCheck,10); });
document.addEventListener("click",e=>{
  const m=e.target.closest?.(".bb-work[data-qa] mark.qa-hl");
  if(!m||!window.getSelection()?.isCollapsed) return;
  qaOfferRemove(m);
});
document.addEventListener("keydown",e=>{
  const m=e.target.closest?.(".bb-work[data-qa] mark.qa-hl"); if(!m) return;
  if(e.key==="Delete"||e.key==="Backspace"){ e.preventDefault(); qaRemoveMark(m); }
  else if(e.key==="Enter"||e.key===" "){ e.preventDefault(); e.stopPropagation(); qaOfferRemove(m); }
});
document.addEventListener("pointerdown",e=>{
  const bar=document.getElementById("qaBar");
  if(bar&&!e.target.closest?.("#qaBar")&&!e.target.closest?.("mark.qa-hl")&&bar.dataset.kind!=="add") qaHideBar();
});
document.addEventListener("scroll",e=>{ if(document.getElementById("qaBar")&&e.target?.closest?.(".bb-work")) qaHideBar(); },true);
function qaOfferRemove(m){
  const work=qaWorkOf(m); if(!work) return;
  const id=String(m.dataset.hid), h=qaEntry(work).hl.find(x=>String(x.id)===id); if(!h) return;
  const bar=qaBar(m.getBoundingClientRect(),`${qaSwatches("QA_recolor",h.color||"yellow")}<button type="button" class="bb-hlbtn" onclick="QA_remove()">${svg("x","ic-sm")} Remove</button>`,"remove");
  QA.pending={work,id};
  work.querySelectorAll(`mark.qa-hl[data-hid="${CSS.escape(id)}"]`).forEach(x=>x.classList.add("on"));
  bar.dataset.kind="remove";
}
function qaKeepScroll(work,fn){
  const panes=[...work.querySelectorAll(".bb-pane"),work], tops=panes.map(p=>p.scrollTop);
  fn(); panes.forEach((p,i)=>{ p.scrollTop=tops[i]; });
}
function QA_add(color){
  const s=QA.pending; if(!s?.work||!s.root) return;
  const work=s.work, en=qaEntry(work);
  // Merge with any highlight it overlaps or touches in the same part.
  const over=en.hl.filter(h=>h.field===s.field&&h.startOffset<=s.end&&h.endOffset>=s.start);
  const start=Math.min(s.start,...over.map(h=>h.startOffset)), end=Math.max(s.end,...over.map(h=>h.endOffset));
  qaUnwrap(work);
  const root=work.querySelector(`[data-hl="${CSS.escape(s.field)}"]`);
  const quote=root?ftHlText(root).slice(start,end):s.quote;
  const h={id:Date.now().toString(36)+Math.random().toString(36).slice(2,6),field:s.field,startOffset:start,endOffset:end,quote,color};
  qaPut(work.dataset.qa,work.dataset.qid,{hl:[...en.hl.filter(x=>!over.includes(x)),h],el:en.el});
  qaHideBar(); window.getSelection()?.removeAllRanges();
  qaKeepScroll(work,()=>qaPaint(work));
}
function QA_recolor(color){
  const p=QA.pending; if(!p?.work||!p.id) return;
  const en=qaEntry(p.work);
  qaPut(p.work.dataset.qa,p.work.dataset.qid,{hl:en.hl.map(h=>String(h.id)===p.id?{...h,color}:h),el:en.el});
  const work=p.work; qaHideBar(); qaKeepScroll(work,()=>qaPaint(work));
}
function qaRemoveMark(m){ const work=qaWorkOf(m); if(!work) return; QA.pending={work,id:String(m.dataset.hid)}; QA_remove(); }
function QA_remove(){
  const p=QA.pending; if(!p?.work||!p.id) return;
  const en=qaEntry(p.work);
  qaPut(p.work.dataset.qa,p.work.dataset.qid,{hl:en.hl.filter(h=>String(h.id)!==p.id),el:en.el});
  const work=p.work; qaHideBar(); qaKeepScroll(work,()=>qaPaint(work));
}
function QA_clearHl(btn){
  const work=qaWorkOf(btn); if(!work) return;
  const en=qaEntry(work);
  qaPut(work.dataset.qa,work.dataset.qid,{hl:[],el:en.el});
  qaHideBar(); qaKeepScroll(work,()=>qaPaint(work));
}

// Practice: eliminating the chosen-but-unchecked answer clears the choice.
function PQ_clearPick(){
  if(typeof P!=="object"||!P) return;
  const it=itemAt(P.idx); if(!it||it.submitted||it.result||(P.results&&P.results[it.id])) return;
  markChoice(""); PQ_select("",false);
  // Keep the choices reachable by keyboard after the selection is cleared.
  const first=document.querySelector(".pq-work .bb-opt-main[role=radio]"); if(first) first.tabIndex=0;
}
function pqAnnoCtx(){ return P?.server?`ps${P.sid}`:`pl${P?.calcSid||"x"}`; }

// ──────────────── Question Progress & Difficulty Navigator ────────────────
// Difficulty uses the platform's stored 1–5 scale and its own bands
// (1–2 Easy, 3 Medium, 4–5 Hard — the same as the filters and DIFF labels).
// There is no separate "Very hard" level in the data, so none is shown.
function qnBand(d){ const n=Number(d); if(d==null||d===""||!Number.isFinite(n)) return "none"; return n<=2?"easy":n===3?"medium":"hard"; }
const QN_BAND_LABEL={easy:"Easy",medium:"Medium",hard:"Hard",none:"Unclassified"};
function qnDiffText(d){ const b=qnBand(d); return b==="none"?"Difficulty not set":`${QN_BAND_LABEL[b]} (level ${Number(d)} of 5)`; }
const QN_ST_LABEL={unanswered:"Unanswered",pending:"Answered · not checked",answered:"Answered",correct:"Correct",incorrect:"Incorrect",skipped:"Skipped",locked:"Not available"};
// cells: [{i, status, diff, flagged, cur}] ; opts: {correctness, showDiff}
function qnCounts(cells){
  const c={total:cells.length,unanswered:0,pending:0,answered:0,correct:0,incorrect:0,skipped:0,locked:0,flagged:0};
  for(const x of cells){ c[x.status]=(c[x.status]||0)+1; if(x.flagged) c.flagged++; }
  c.done=c.answered+c.pending+c.correct+c.incorrect;
  c.graded=c.correct+c.incorrect;
  return c;
}
function qnSummaryHTML(cells,opts){
  const c=qnCounts(cells), pct=n=>c.total?Math.round(n/c.total*1000)/10:0;
  const completion=c.total?Math.round(c.done/c.total*100):0;
  const acc=c.graded?Math.round(c.correct/c.graded*100)+"%":"—";
  const stat=(n,l,cls="")=>`<span class="qn-stat ${cls}"><b>${n}</b>${l}</span>`;
  const seg=opts.correctness
    ?`<i class="s-ok" style="width:${pct(c.correct)}%"></i><i class="s-no" style="width:${pct(c.incorrect)}%"></i><i class="s-pend" style="width:${pct(c.pending+c.answered)}%"></i>`
    :`<i class="s-pend" style="width:${pct(c.done)}%"></i>`;
  return `<div class="qn-sum" aria-live="polite">
    <div class="qn-stats">${stat(c.total,"Total")}${stat(c.done,"Answered","st-ans")}${stat(c.unanswered+c.skipped,"Unanswered")}
      ${opts.correctness?`${stat(c.correct,"Correct","st-ok")}${stat(c.incorrect,"Incorrect","st-no")}${c.pending?stat(c.pending,"Not checked","st-ans"):""}`:""}
      ${stat(c.flagged,"For review","st-flag")}${stat(completion+"%","Complete")}${opts.correctness?stat(acc,c.graded?"Accuracy":"Accuracy · none checked yet"):""}</div>
    <div class="qn-bar" role="img" aria-label="${completion}% complete${opts.correctness?`, ${c.correct} correct, ${c.incorrect} incorrect`:""}">${seg}</div></div>`;
}
function qnMatches(x,f){
  if(f.st&&f.st!=="all"){
    if(f.st==="flagged"){ if(!x.flagged) return false; }
    else if(f.st==="answered"){ if(!["answered","pending","correct","incorrect"].includes(x.status)) return false; }
    else if(f.st==="unanswered"){ if(x.status!=="unanswered"&&x.status!=="skipped") return false; }
    else if(x.status!==f.st) return false;
  }
  if(f.df&&f.df!=="all"&&qnBand(x.diff)!==f.df) return false;
  return true;
}
function qnFiltersHTML(cells,f,opts,fn){
  const has=s=>cells.some(x=>x.status===s);
  const st=[["all","All questions"],["unanswered","Unanswered"],["answered","Answered"],
    ...(opts.correctness&&has("pending")?[["pending","Answered · not checked"]]:[]),
    ...(opts.correctness?[["correct","Correct"],["incorrect","Incorrect"]]:[]),["flagged","Marked for review"],
    ...(has("skipped")?[["skipped","Skipped"]]:[])];
  const df=[["all","All difficulties"],["easy","Easy"],["medium","Medium"],["hard","Hard"],["none","Unclassified"]];
  const n=cells.filter(x=>qnMatches(x,f)).length;
  const sel=(k,list,label)=>`<label class="qn-f"><span>${label}</span><select onchange="${fn}('${k}',this.value)">${list.map(([v,l])=>`<option value="${v}" ${f[k]===v?"selected":""}>${l}</option>`).join("")}</select></label>`;
  return `<div class="qn-filters">${sel("st",st,"Status")}${opts.showDiff?sel("df",df,"Difficulty"):""}
    <span class="qn-count" id="qnCount">${n} of ${cells.length}</span>
    ${(f.st!=="all"||f.df!=="all")?`<button type="button" class="btn btn-ghost btn-xs" onclick="${fn}('reset')">Reset filters</button>`:""}</div>`;
}
function qnQuickHTML(cells,opts,fn){
  return `<div class="qn-quick">
    <form class="qn-jump" onsubmit="event.preventDefault();${fn}('jump',this.n.value)"><label><span class="sr-only">Go to question number</span><input name="n" type="number" min="1" max="${cells.length}" inputmode="numeric" placeholder="#" aria-label="Question number"/></label><button type="submit" class="btn btn-ghost btn-xs">Go</button></form>
    <button type="button" class="btn btn-ghost btn-xs" onclick="${fn}('next','unanswered')">Next unanswered</button>
    ${opts.correctness?`<button type="button" class="btn btn-ghost btn-xs" onclick="${fn}('next','incorrect')">Next incorrect</button>`:""}
    <button type="button" class="btn btn-ghost btn-xs" onclick="${fn}('next','flagged')">Next for review</button></div>`;
}
function qnCellHTML(x,opts,onclick){
  const band=qnBand(x.diff);
  const icon=x.status==="correct"?qtIc("check"):x.status==="incorrect"?qtIc("x"):x.status==="skipped"?qtIc("skip"):(x.status==="pending"||x.status==="answered")?qtIc("dot"):"";
  const tip=[`Question ${x.i+1}`,opts.showDiff?qnDiffText(x.diff):"",QN_ST_LABEL[x.status]||"",x.flagged?"Marked for review":"",x.cur?"Current question":""].filter(Boolean).join(" · ");
  return `<button type="button" class="bb-cell qn-cell st-${x.status} ${x.flagged?"flag":""} ${x.cur?"cur":""} ${x.status==="locked"?"locked":""}" data-i="${x.i}" tabindex="-1" onclick="${onclick}(${x.i})" title="${esc(tip)}" aria-label="${esc(tip)}" ${x.cur?'aria-current="true"':""}>
    ${x.cur?`<i class="bb-pin" aria-hidden="true"></i>`:""}<span class="qn-num">${x.i+1}</span>${icon?`<span class="qn-st" aria-hidden="true">${icon}</span>`:""}
    ${opts.showDiff?`<i class="qn-diff d-${band}" aria-hidden="true"></i>`:""}${x.flagged?`<span class="qn-flag" aria-hidden="true">${qtIc("book")}</span>`:""}</button>`;
}
function qnGridHTML(cells,f,opts,onclick){
  const shown=cells.filter(x=>qnMatches(x,f));
  if(!shown.length) return `<div class="qn-empty">No questions match these filters.</div>`;
  const focusI=(shown.find(x=>x.cur)||shown[0]).i;
  return shown.map(x=>qnCellHTML(x,opts,onclick).replace('tabindex="-1"',x.i===focusI?'tabindex="0"':'tabindex="-1"')).join("");
}
function qnLegendHTML(opts){
  return `<div class="bb-legend qn-legend">
    <span><i class="lg cur"></i>Current</span><span><i class="lg qn-lg-un"></i>Unanswered</span><span><i class="lg qn-lg-ans">${qtIc("dot")}</i>Answered${opts.correctness?" · not checked":""}</span>
    ${opts.correctness?`<span><i class="lg qn-lg-ok">${qtIc("check")}</i>Correct</span><span><i class="lg qn-lg-no">${qtIc("x")}</i>Incorrect</span>`:""}
    <span><i class="lg qn-lg-flag">${qtIc("book")}</i>For review</span>
    ${opts.showDiff?`<span class="qn-lg-diff"><i class="qn-diff d-easy"></i>Easy <i class="qn-diff d-medium"></i>Medium <i class="qn-diff d-hard"></i>Hard <i class="qn-diff d-none"></i>Unclassified</span>`:""}</div>`;
}
// Index of the next question (after `from`, wrapping) of a kind.
function qnNext(cells,from,kind){
  const ok=x=>kind==="flagged"?x.flagged:kind==="unanswered"?(x.status==="unanswered"||x.status==="skipped"):x.status===kind;
  for(let k=1;k<=cells.length;k++){ const x=cells[(from+k)%cells.length]; if(ok(x)) return x.i; }
  return -1;
}
const QN_NONE={unanswered:"Every question has an answer.",incorrect:"No incorrect answers.",flagged:"No questions are marked for review."};
