// workspace.js — the shared Full Mock question workspace.
//
// One look and one behaviour for every place a question is shown: Question
// Bank, Challenging Questions, class tasks and review queues, Question Rush,
// Full Mocks, and the question previews / reviews that students, mentors and
// admins (including the super admin) open. Built from the same markup and
// classes as the Full Mock runner (fulltest.css: .bb-work, .bb-pane,
// .bb-divider, .bb-qhead, .bb-opt, .bb-spr…):
//   • Reading & Writing: source material (passage / figure) on the left, the
//     prompt and answers on the right. Math: single column, or split for
//     student-produced responses (directions on the left), with answer preview.
//   • The divider really resizes the panes — mouse, touch (pointer events) or
//     keyboard (←/→, Home/End, PageUp/PageDown) — and the split is shared and
//     remembered, so it stays put while moving between questions and screens.
//   • Panes scroll independently on desktop; phones get one stacked reading flow.
//   • Reviews are read-only: submitted answer, correct answer and the full
//     explanation.

// ──────────────── split position (one value for every workspace) ────────────────
const QW={split:(()=>{ const v=Number(localStorage.getItem("fnf_split")); return v>=25&&v<=75?v:50; })()};
if(typeof BB==="object") BB.split=QW.split;
function qwSetSplit(v,persist=true){
  v=Math.max(25,Math.min(75,Math.round(Number(v)*10)/10||50));
  QW.split=v; if(typeof BB==="object") BB.split=v;
  document.querySelectorAll(".bb-work.split").forEach(w=>w.style.setProperty("--split",v+"%"));
  document.querySelectorAll(".bb-divider[role=separator]").forEach(d=>{ d.setAttribute("aria-valuenow",String(Math.round(v))); d.setAttribute("aria-valuetext",`Left pane ${Math.round(v)} percent`); });
  if(persist) try{ localStorage.setItem("fnf_split",String(v)); }catch{}
}
function qwDividerHTML(){
  return `<div class="bb-divider" role="separator" tabindex="0" aria-orientation="vertical" aria-label="Resize the passage and question panes" aria-valuemin="25" aria-valuemax="75" aria-valuenow="${Math.round(QW.split)}" aria-valuetext="Left pane ${Math.round(QW.split)} percent" title="Drag, or use the arrow keys, to resize · double-click to reset" onpointerdown="QW_dragStart(event)" ondblclick="qwSetSplit(50)" onkeydown="QW_dividerKey(event)"><span></span></div>`;
}
// Mouse and touch: pointer events with capture, so the drag keeps tracking
// even when the pointer crosses an iframe (Desmos) or leaves the divider.
function QW_dragStart(e){
  const div=e.currentTarget||e.target.closest(".bb-divider"), work=div?.closest(".bb-work.split"); if(!work) return;
  if(e.button!==undefined&&e.button!==0&&e.pointerType==="mouse") return;
  e.preventDefault();
  try{ window.getSelection()?.removeAllRanges(); }catch{}
  try{ div.setPointerCapture(e.pointerId); }catch{}
  div.focus({preventScroll:true});
  const move=ev=>{ const r=work.getBoundingClientRect(); if(r.width>0) qwSetSplit(((ev.clientX-r.left)/r.width)*100,false); };
  const up=ev=>{
    div.removeEventListener("pointermove",move); div.removeEventListener("pointerup",up); div.removeEventListener("pointercancel",up);
    try{ div.releasePointerCapture(ev.pointerId); }catch{}
    document.body.classList.remove("bb-dragging"); qwSetSplit(QW.split,true);
  };
  document.body.classList.add("bb-dragging");
  div.addEventListener("pointermove",move); div.addEventListener("pointerup",up); div.addEventListener("pointercancel",up);
}
function QW_dividerKey(e){
  const step={ArrowLeft:-2,ArrowRight:2,PageUp:-10,PageDown:10}[e.key];
  if(step!==undefined){ e.preventDefault(); qwSetSplit(QW.split+step); return; }
  if(e.key==="Home"){ e.preventDefault(); qwSetSplit(25); }
  else if(e.key==="End"){ e.preventDefault(); qwSetSplit(75); }
  else if(e.key==="Enter"){ e.preventDefault(); qwSetSplit(50); }
}
// The Full Mock runner and its previews use the same divider (previews used
// to render a divider that could not be dragged).
function FT_dragStart(e){ QW_dragStart(e); }
if(typeof ftWorkspaceHTML==="function"){
  const ftBase=ftWorkspaceHTML;
  ftWorkspaceHTML=function(q,ctx){
    if(typeof BB==="object") BB.split=QW.split;
    return ftBase(q,ctx).replace(/<div class="bb-divider"[^>]*>/,qwDividerHTML().replace(/<span><\/span><\/div>$/,""));
  };
}

// ──────────────── layout rules (same as the Full Mock runner) ────────────────
function qwIsSplit(q,section){
  const sec=section||q.section;
  return (sec==="ebrw"&&!!(q.passage||q.questionImage))||(sec==="math"&&!!(q.passage||q.type==="spr"));
}
const QW_SPR_DIRECTIONS=`<div class="bb-spr-dir"><h4>Student-produced response directions</h4><ul>
  <li>If you find more than one correct answer, enter only one answer.</li>
  <li>You can enter up to 5 characters for a positive answer and up to 6 characters (including the negative sign) for a negative answer.</li>
  <li>If your answer is a fraction that doesn't fit in the provided space, enter the decimal equivalent.</li>
  <li>If your answer is a decimal that doesn't fit, you may either round it or truncate it, but it must fill the entire space.</li>
  <li>If your answer is a mixed number (such as 3½), enter it as an improper fraction (7/2) or its decimal equivalent (3.5).</li>
  <li>Don't enter symbols such as a percent sign, comma, or dollar sign.</li></ul></div>`;
function qwSprPreview(v){ return typeof ftSprPreview==="function"?ftSprPreview(v):esc(v||""); }

// Build one workspace.
// ctx: { num, section, mode: "answer" | "review", given, result:{selected,correct,answer,acceptableAnswers,explanation},
//        flagged, onFlag, onPick, onSpr, onSprEnter, headExtra, meta, showKey, explanation, sprId }
function qwWorkspaceHTML(q,ctx={}){
  const sec=ctx.section||q.section;
  const review=ctx.mode==="review";
  const res=ctx.result||null;
  const locked=review||!!res;
  const given=String(res?.selected??ctx.given??"");
  const key=res?.answer??(ctx.showKey?q.answer:undefined);
  // Personal annotations (highlights, eliminated choices) live outside the
  // question, keyed by this workspace's context (session / attempt) and the
  // question id. See qtools.js.
  const anno=ctx.anno||"mem:ws";
  const elim=typeof qaGet==="function"?qaGet(anno,q.id).el:[];
  // Elimination Mode (the ABC toggle) is a view setting shared by every
  // workspace in this tab; the eliminated choices themselves are annotations.
  const mc=q.type!=="spr";
  const elimOn=mc&&!locked&&typeof QA==="object"&&!!QA.elimMode;
  const metaTip=ctx.meta?String(ctx.meta).replace(/<[^>]*>/g,"").replace(/&amp;/g,"&").replace(/&lt;/g,"<").replace(/&gt;/g,">").replace(/&quot;/g,"\u0022").replace(/&#39;/g,"'"):"";
  const head=`<div class="bb-qhead qw-head">
    <span class="bb-qnum">${esc(ctx.num??"")}</span>
    ${ctx.onFlag?`<button type="button" class="bb-mark ${ctx.flagged?"on":""}" id="pqFlag" aria-pressed="${!!ctx.flagged}" onclick="${ctx.onFlag}">${ftIcon("bookmark")} <span>${ctx.flagged?"Marked for Review":"Mark for Review"}</span></button>`:""}
    ${ctx.meta?`<span class="bb-qmeta qw-meta" title="${esc(metaTip)}">${ctx.meta}</span>`:`<span class="qw-meta"></span>`}
    <span class="qw-head-tools">${typeof qaToolsHTML==="function"?qaToolsHTML(q,anno,locked,ctx.headExtra||""):(ctx.headExtra||"")}</span></div>`;
  const media=q.questionImage?`<div class="bb-figure">${questionMediaHTML(q.questionImage,"Figure for this question")}</div>`:"";
  let answer;
  if(q.type==="spr"){
    const id=ctx.sprId||"sprIn";
    const ok=res?(res.correct?"ok":"no"):"";
    answer=`<div class="bb-spr ${ok}">
      <input class="bb-spr-input" id="${id}" value="${esc(given)}" maxlength="7" inputmode="decimal" autocomplete="off" aria-label="Your answer" ${locked?"disabled":""}
        ${locked?"":`oninput="${ctx.onSpr||""}(this.value);QW_sprPreview('${id}',this.value)" onkeydown="if(event.key==='Enter'&&this.value.trim()){event.preventDefault();${ctx.onSprEnter||""}}"`}/>
      <div class="bb-spr-prev"><span>Answer Preview:</span> <b id="${id}Prev">${qwSprPreview(given)}</b></div>
      ${key!=null&&(review||res)?`<div class="qw-key">Correct answer: <b>${mathText(key)}</b>${(res?.acceptableAnswers||q.acceptableAnswers||[]).length?` <span class="umeta">(also accepted: ${(res?.acceptableAnswers||q.acceptableAnswers).map(a=>esc(a)).join(", ")})</span>`:""}</div>`:""}</div>`;
  } else {
    answer=`<div class="bb-opts" role="radiogroup" aria-label="Answer choices">${["A","B","C","D"].filter(l=>q.choices&&q.choices[l]!=null).map(l=>{
      const sel=given===l, isKey=key!=null&&key===l, wrong=sel&&key!=null&&key!==l, struck=elim.includes(l);
      const cls=[locked?"":sel?"sel":"", isKey?"key":"", wrong?"wrong":"", locked&&sel?"given":"", struck?(locked?"struck qa-was":"struck"):""].join(" ");
      return `<div class="bb-opt ${cls}" data-l="${l}">
        <div class="bb-opt-main" role="radio" ${locked?`aria-disabled="true" tabindex="-1"`:`tabindex="${sel||(!given&&l==="A")?0:-1}" onpointerdown="QA_down(event)" onclick="QA_pick(event,'${l}','${ctx.onPick}')" onkeydown="QW_choiceKey(event,'${l}','${ctx.onPick}')"`} aria-checked="${sel}" aria-label="Answer ${l}${isKey?", correct answer":""}${wrong?", your answer, incorrect":locked&&sel?", your answer":""}${struck?", eliminated":""}">
          <span class="bb-ltr">${l}</span><span class="bb-otext" data-hl="choice:${l}">${mathText(q.choices[l])}${questionMediaHTML(q.choiceImages?.[l],`Answer choice ${l}`,"choice")}</span>
          ${locked&&sel?`<span class="qw-tag ${wrong?"no":"ok"}">${review?"Submitted":"Your answer"}</span>`:""}${isKey&&!sel?`<span class="qw-tag ok">Correct</span>`:""}${locked&&struck?`<span class="qw-tag qa-was-tag">Eliminated</span>`:""}</div>
        ${locked?"":`<button type="button" class="bb-strike qa-strike" onpointerdown="event.stopPropagation()" onclick="QA_elim(event,'${l}')" aria-pressed="${struck}" aria-label="${struck?"Restore":"Eliminate"} answer ${l}" title="${struck?"Restore":"Eliminate"} answer ${l}" ${elimOn?"":`tabindex="-1" aria-hidden="true"`}>${struck?"Undo":`<s>${l}</s>`}</button>`}</div>`;
    }).join("")}</div>`;
  }
  const expl=res?.explanation??(ctx.showKey?q.explanation:undefined);
  const feedback=(res||review)?qwFeedbackHTML(q,{correct:res?res.correct:(given?qwSameAnswer(q,given,key):null),answer:key,explanation:expl,given,review}):"";
  const prompt=`<div class="bb-prompt" data-hl="prompt">${mathText(q.prompt)}</div>`;
  const passage=q.passage?`<div class="bb-passage" data-hl="passage">${mathText(q.passage)}</div>`:"";
  const qa=`data-qa="${esc(anno)}" data-qid="${esc(q.id??"")}" data-qa-clear="${esc(ctx.onClear||"")}"`;
  const right=`${head}${qwIsSplit(q,sec)?"":media}${prompt}${answer}<div id="${ctx.feedbackId||"explainArea"}" class="qw-feedback">${feedback}</div>`;
  const qaCls=elimOn?" qa-elim-on":"";
  if(!qwIsSplit(q,sec)) return `<main class="bb-work single${qaCls}" ${qa}><section class="bb-center">${right}</section></main>`;
  const left=sec==="math"&&q.type==="spr"&&!q.passage?`${QW_SPR_DIRECTIONS}${media}`:`${media}${passage}`;
  return `<main class="bb-work split${qaCls}" ${qa} style="--split:${QW.split}%">
    <section class="bb-pane bb-left" aria-label="Source material">${left}</section>${qwDividerHTML()}
    <section class="bb-pane bb-right" aria-label="Question">${right}</section></main>`;
}
function qwSameAnswer(q,given,key){
  if(key==null||!given) return null;
  if(q.type==="spr"){ const all=[key,...(q.acceptableAnswers||[])]; return typeof sprMatches==="function"?all.some(a=>sprMatches(given,a)):all.includes(given); }
  return given===key;
}
function qwFeedbackHTML(q,{correct,answer,explanation,given,review}){
  const verdict=correct===true?`<span class="feedback-tag ok">${svg("check","ic-sm")}Correct</span>`:correct===false?`<span class="feedback-tag no">${svg("x","ic-sm")}${review?"Incorrect":"Not quite"}</span>`:review&&!given?`<span class="feedback-tag">Not answered</span>`:"";
  return `<div class="explain bb-explain ${correct===false?"bad":""}">
    <div class="qw-verdict">${verdict}${review&&given?`<span class="umeta">Submitted: <b>${mathText(given)}</b></span>`:""}${answer!=null?`<span class="umeta">Correct answer: <b>${mathText(answer)}</b></span>`:""}</div>
    ${explanation!==undefined?`<h4>Explanation</h4><div class="explain-body">${mathText(explanation||"No explanation added.")}</div>`:""}</div>`;
}
function QW_sprPreview(id,v){ const el=document.getElementById(id+"Prev"); if(el){ el.innerHTML=qwSprPreview(v); typesetMath(el); } }
// Arrow keys move between choices (radio-group behaviour); Enter / Space picks.
function QW_choiceKey(e,l,fn){
  const opts=[...e.currentTarget.closest(".bb-opts").querySelectorAll(".bb-opt-main[role=radio]:not([aria-disabled=true])")];
  const i=opts.indexOf(e.currentTarget);
  if(e.key==="Enter"||e.key===" "){ e.preventDefault(); if(typeof QA_unElim==="function") QA_unElim(e.currentTarget,l); window[fn]?.(l); return; }
  const d={ArrowDown:1,ArrowRight:1,ArrowUp:-1,ArrowLeft:-1}[e.key];
  if(d&&!e.altKey){ e.preventDefault(); const n=opts[(i+d+opts.length)%opts.length]; opts.forEach(o=>o.tabIndex=-1); n.tabIndex=0; n.focus(); }
}

// ──────────────── read-only review / preview (every role) ────────────────
// Used through fullQuestionHTML() by review queues, mistake lists, the
// student monitor, All Questions, Manage, test editor lists and reports.
function qwReviewHTML(q,opts={}){
  const meta=`${esc(SECTIONS[q.section]?.label||q.section||"")}${q.category?` · ${esc(q.category)}`:""}${q.subcategory?` · ${esc(q.subcategory)}`:""}${opts.meta?` · ${opts.meta}`:""}`;
  const hasKey=q.answer!==undefined&&q.answer!==null&&q.answer!=="";
  return `<div class="bb bb-inline qw-review">${qwWorkspaceHTML(q,{num:opts.num??"",mode:"review",given:opts.given??"",meta,showKey:hasKey,
    result:hasKey?{selected:opts.given??"",correct:opts.given?qwSameAnswer(q,opts.given,q.answer):null,answer:q.answer,acceptableAnswers:q.acceptableAnswers,explanation:q.explanation??""}:null,
    feedbackId:"qwFb"+(q.id||"")})}</div>`;
}

// ──────────────── scroll safety ────────────────
// Closing any dialog or layer must never leave the page (or the admin
// sidebar / question review) unable to scroll.
function qwUnlockScroll(){
  const b=document.body, h=document.documentElement;
  if(state?.view!=="testsit"){ b.classList.remove("bb-on","test-paused"); }
  if(!document.querySelector(".ft-modal-back,.qbf-layer.sheet,#pqLayer")){ b.style.overflow=""; h.style.overflow=""; }
  b.classList.remove("bb-dragging");
}
if(typeof ftCloseModal==="function"){
  const ftCloseBase=ftCloseModal;
  ftCloseModal=function(){ ftCloseBase(); qwUnlockScroll(); };
}

// ──────────────── section navigation guard ────────────────
// Every navigation (menu click, Back / Forward, direct link) starts a new
// generation. A response that belongs to an older generation is dropped
// instead of painting the previous page over the new one, rewriting the URL
// or re-opening a practice session. Background requests opt out ({bg:true}).
const NAV_GEN={seq:0};
function navBump(){ NAV_GEN.seq++; return NAV_GEN.seq; }
const navCurrent=()=>NAV_GEN.seq;
const navStale=seq=>seq!==NAV_GEN.seq;
