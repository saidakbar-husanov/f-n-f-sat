// learning.js — class-based SAT Lessons (Class → Unit → Lesson → Practice).
// Students: class switcher, learning path, lesson player with resumable video,
// bilingual teaching content (English–Uzbek / English–Russian), practice that
// builds skill mastery. Staff: curriculum builder per class, reuse / copy
// lessons, publish & assign, student preview, mastery dashboard with
// drill-down. Loaded before the main studio script and relies on its helpers
// at call time (api, svg, esc, go, crumbs, toast, state, $c, loading,
// mathText, typesetMath, questionMediaHTML, richHTML, SECTIONS, SUBSECTIONS,
// ftModal, ftCloseModal, plWhen, LS). The server checks every permission again.

const LX={ov:null,classId:null,path:null,lesson:null,lang:"uz",tab:"path",skills:null,dash:null,library:null,editing:null,
  player:null,saveT:null,lastSaved:0,pos:0,dur:0,practiceIdx:0,assisted:new Set(),preview:false,bankCache:null};
const LX_LANG={uz:{mode:"English–Uzbek",name:"Uzbek",short:"EN–UZ"},ru:{mode:"English–Russian",name:"Russian",short:"EN–RU"}};
const LX_LEVEL={not_started:["Not started","pill-muted"],practising:["Practising","ft-pill-gold"],proficient:["Proficient","pill-sec"],mastered:["Mastered","ft-pill-mint"]};
const lxPill=l=>{ const [t,c]=LX_LEVEL[l]||LX_LEVEL.not_started; return `<span class="pill ${c} lx-level lx-${l}">${t}</span>`; };
const lxIsStaff=()=>state.user.role==="admin"||state.user.role==="mentor";
const lxJs=v=>JSON.stringify(v).replace(/"/g,"&quot;");

// Pick the teaching-language text, falling back to English with a clear label.
function lxPick(obj,lang){
  const o=obj&&typeof obj==="object"?obj:{};
  if(o[lang]) return {text:o[lang],lang,fallback:false};
  if(o.en) return {text:o.en,lang:"en",fallback:true};
  return {text:"",lang:"en",fallback:false};
}
function lxFallbackNote(lang){ return `<span class="lx-fallback" role="note">${LX_LANG[lang].name} translation not available yet — showing the English version</span>`; }
// A teaching block in the chosen language, with the English original one tap away.
function lxBlock(obj,lang,{rich=true}={}){
  const p=lxPick(obj,lang); if(!p.text) return "";
  const body=rich?richHTML(p.text):`<p>${esc(p.text).replace(/\n/g,"<br>")}</p>`;
  const en=obj?.en&&!p.fallback?`<details class="lx-orig"><summary>English original</summary>${rich?richHTML(obj.en):`<p>${esc(obj.en).replace(/\n/g,"<br>")}</p>`}</details>`:"";
  return `<div class="lx-block" lang="${p.lang}">${p.fallback?lxFallbackNote(lang):`<span class="lx-lang">${p.lang==="en"?"English":LX_LANG[p.lang].name}</span>`}${body}${en}</div>`;
}
function lxRulesHTML(r){
  return `<details class="lx-rules"><summary>${svg("info","ic-sm")} How skill levels work</summary>
    <ul>
      <li><b>Lesson progress</b> and <b>skill mastery</b> are tracked separately. Finishing a lesson's video completes the lesson; correct answers on tagged practice build mastery.</li>
      <li>You earn <b>${r.pointsPerQuestion} points</b> the first time you answer a question correctly on your own. Each question counts once — across retries, classes and language modes.</li>
      <li>Only your <b>first try</b> on a question counts, and only if you didn't open help. Assisted answers and retries still show full feedback, and are listed separately.</li>
      <li>${lxPill("not_started")} no answers yet · ${lxPill("practising")} at least one answer · ${lxPill("proficient")} ${r.proficientCount} different questions correct on your own · ${lxPill("mastered")} ${r.masteredCount} different questions correct on your own <i>and</i> at least ${r.masteredAccuracy}% correct across your ${r.masteredWindow} most recent first tries.</li>
    </ul></details>`;
}
function lxSaveLang(lang){
  if(!LX_LANG[lang]) return;
  LX.lang=lang;
  const p=state.user.profile; if(p){ p.preferences={...(p.preferences||{}),teachLang:lang}; localStorage.setItem(LS.user,JSON.stringify(p)); }
  if(state.user.role==="student") api("auth/preferences",{method:"PUT",body:JSON.stringify({teachLang:lang})}).catch(()=>{});
}
function lxLangSwitch(onchange){
  return `<div class="lx-langs" role="group" aria-label="Teaching mode">${Object.entries(LX_LANG).map(([k,v])=>`<button type="button" class="${LX.lang===k?"on":""}" aria-pressed="${LX.lang===k}" onclick="${onchange}('${k}')">${v.mode}</button>`).join("")}</div>`;
}

// ═════════════════════ ENTRY ═════════════════════
async function viewLearn(){
  lxStopPlayer();
  if(state.learnLessonId) return lxViewLesson();
  crumbs([{label:"Lessons"}]); loading();
  try{ LX.ov=await api("learn/overview"); }catch(e){ $c().innerHTML=`<div class="empty"><p>${esc(e.message)}</p></div>`; return; }
  LX.lang=(state.user.profile?.preferences?.teachLang)||LX.ov.lang||"uz";
  const cls=LX.ov.classes;
  if(!cls.length){
    $c().innerHTML=`<div class="page-head fade"><h1>Lessons</h1><p>${lxIsStaff()?"Build a learning path for each of your classes.":"Your class learning path appears here."}</p></div>
      <div class="empty fade"><div class="ei">${svg("book")}</div><h3>${lxIsStaff()?"No classes yet":"You're not in a class yet"}</h3>
      <p>${lxIsStaff()?(state.user.role==="admin"?"Create a class in Classes &amp; Mentors, then build its curriculum here.":"Create a class first, then build its curriculum here."):"Lessons are published by your mentor for each class. Join a class with the code your mentor gives you, and its lessons appear here."}</p>
      ${lxIsStaff()?"":`<button class="btn btn-primary" onclick="go('classes')">${svg("users","ic-sm")} Join a class</button>`}</div>`;
    return;
  }
  if(!cls.some(c=>c.id===state.learnClassId)) state.learnClassId=cls[0].id;
  LX.classId=state.learnClassId;
  if(lxIsStaff()) return lxStaffHome();
  return lxStudentHome();
}
function lxClassSwitch(){
  const cls=LX.ov.classes; if(cls.length<2) return "";
  return `<div class="field lx-switch"><label for="lxClass">Class</label><select id="lxClass" onchange="state.learnClassId=Number(this.value);viewLearn()">${cls.map(c=>`<option value="${c.id}" ${c.id===LX.classId?"selected":""}>${esc(c.name)}${c.mentorName?` · ${esc(c.mentorName)}`:""}</option>`).join("")}</select></div>`;
}

// ═════════════════════ STUDENT ═════════════════════
async function lxStudentHome(){
  loading();
  let path,skills;
  try{ [path,skills]=await Promise.all([api(`learn/classes/${LX.classId}/path`),api("learn/me/skills")]); }
  catch(e){ $c().innerHTML=`<div class="empty"><p>${esc(e.message)}</p></div>`; return; }
  LX.path=path; LX.skills=skills;
  const tab=state.learnTab==="skills"?"skills":"path";
  const pct=path.total?Math.round(path.completed/path.total*100):0;
  const cont=path.continueLesson, rec=skills.recommended;
  $c().innerHTML=`<div class="page-head fade lx-head"><div><h1>Lessons</h1><p>${esc(path.class.name)} · your learning path, lesson by lesson.</p></div>${lxClassSwitch()}</div>
    <div class="lx-hero fade">
      <div class="lx-hero-main">
        <div class="umeta">${path.completed} of ${path.total} lessons complete</div>
        <div class="q-progress lx-bar"><i style="width:${pct}%"></i></div>
        ${cont?`<button class="btn btn-primary" onclick="lxOpen(${cont.lessonId})">${svg("play","ic-sm")} ${path.completed||cont&&LX_hasStarted(cont.lessonId)?"Continue learning":"Start learning"}: ${esc(cont.title)}</button>`:path.total?`<p><b>You've finished every lesson in this class.</b></p>`:`<p class="umeta">Your mentor hasn't published lessons for this class yet.</p>`}
      </div>
      <div class="lx-hero-side">
        <div class="lx-points"><b>${skills.points}</b><span>mastery points</span></div>
        ${rec&&(!cont||rec.lessonId!==cont.lessonId)?`<div class="umeta">Recommended next</div><button class="btn btn-ghost btn-sm" onclick="lxOpen(${rec.lessonId},${rec.classId})">${esc(rec.title)}</button>`:""}
      </div>
    </div>
    <div class="calc-tabs fade" role="tablist"><button role="tab" class="${tab==="path"?"on":""}" onclick="state.learnTab='path';lxStudentHome()">Learning path</button><button role="tab" class="${tab==="skills"?"on":""}" onclick="state.learnTab='skills';lxStudentHome()">My skills</button></div>
    <div class="fade">${tab==="path"?lxPathHTML(path.units,false):lxSkillsHTML(skills)}</div>`;
}
function LX_hasStarted(lessonId){ return (LX.path?.units||[]).some(u=>u.lessons.some(l=>l.lessonId===lessonId&&l.progress)); }
function lxLessonState(l){
  if(l.progress?.completed) return ["done","Completed"];
  if(l.progress) return ["going","In progress"];
  return ["new","Not started"];
}
function lxPathHTML(units,staffPreview){
  if(!units.length) return `<div class="empty"><div class="ei">${svg("book")}</div><h3>No lessons published yet</h3><p>${staffPreview?"Publish a unit and at least one lesson to see them here.":"Your mentor publishes lessons here as the course moves along."}</p></div>`;
  return units.map((u,ui)=>`<section class="panel lx-unit"><div class="lx-unit-head"><span class="lx-unit-no">Unit ${ui+1}</span><h2>${esc(u.titleI18n?.[LX.lang]||u.title)}</h2></div>
    ${u.description?`<p class="umeta">${esc(u.description)}</p>`:""}
    <ol class="lx-steps">${u.lessons.map(l=>{ const [k,t]=lxLessonState(l); const obj=lxPick(l.objective,LX.lang);
      return `<li class="lx-step ${k}"><button type="button" onclick="lxOpen(${l.lessonId})">
        <span class="lx-dot" aria-hidden="true">${k==="done"?svg("check","ic-sm"):k==="going"?svg("play","ic-sm"):""}</span>
        <span class="lx-step-body"><b>${esc(l.title)}</b>${obj.text?`<span class="umeta">${esc(obj.text)}</span>`:""}
          <span class="lx-step-tags">${(l.skillTags||[]).slice(0,3).map(s=>`<span class="pill pill-muted">${esc(s)}</span>`).join("")}${l.practiceCount?`<span class="pill pill-muted">${l.practiceCount} practice</span>`:""}${l.assignedAt?`<span class="pill ft-pill-gold">Assigned${l.dueAt?` · due ${new Date(l.dueAt).toLocaleDateString()}`:""}</span>`:""}</span></span>
        <span class="lx-step-state">${t}</span></button></li>`; }).join("")||`<li class="umeta">No lessons in this unit yet.</li>`}</ol></section>`).join("");
}
function lxSkillsHTML(sk){
  const rows=sk.skills.slice().sort((a,b)=>b.points-a.points);
  return `${lxRulesHTML(sk.rules)}
    <div class="stat-grid" style="margin-top:1rem">
      <div class="stat-card"><div class="lbl">${svg("trophy","ic-sm")} Points</div><div class="val">${sk.points}</div></div>
      <div class="stat-card"><div class="lbl">${svg("target","ic-sm")} Proficient or better</div><div class="val">${rows.filter(s=>s.level==="proficient"||s.level==="mastered").length}</div></div>
      <div class="stat-card"><div class="lbl">${svg("flame","ic-sm")} Mastered</div><div class="val" style="color:var(--mint)">${rows.filter(s=>s.level==="mastered").length}</div></div>
    </div>
    <div class="panel"><h2>${svg("graph","ic-sm")} Skills</h2>${rows.length?`<div class="utable-wrap"><table class="utable"><thead><tr><th>Skill</th><th>Level</th><th>Points</th><th>Correct on your own</th><th>Recent first tries</th><th>Assisted</th></tr></thead><tbody>
      ${rows.map(s=>`<tr><td><div class="uname">${esc(s.skill)}</div><div class="umeta">${esc(s.domain)}</div></td><td>${lxPill(s.level)}</td><td>${s.points}</td><td>${s.independentCorrect}${s.level!=="mastered"?`<div class="umeta">${s.toProficient?`${s.toProficient} more for Proficient`:s.toMastered?`${s.toMastered} more for Mastered`:`need ${sk.rules.masteredAccuracy}% recent accuracy`}</div>`:""}</td><td>${s.recentAccuracy===null?"—":`${s.recentAccuracy}% of ${s.recentCount}`}</td><td>${s.assistedAnswers}</td></tr>`).join("")}</tbody></table></div>`:`<p class="umeta">Answer practice questions in a lesson to start building skills.</p>`}</div>
    <div class="panel"><h2>${svg("flame","ic-sm")} Level-ups</h2>${sk.levelUps.length?`<ul class="lx-ups">${sk.levelUps.map(u=>`<li>${lxPill(u.level)} <b>${esc(u.skill)}</b> <span class="umeta">${esc(plWhen(u.reachedAt))}</span></li>`).join("")}</ul>`:`<p class="umeta">No level-ups yet.</p>`}</div>`;
}
function lxOpen(lessonId,classId){ go("learn",{learnLessonId:lessonId,...(classId?{learnClassId:classId}:{})}); }

// ═════════════════════ LESSON PLAYER ═════════════════════
async function lxViewLesson(){
  loading();
  const cid=state.learnClassId?`?classId=${state.learnClassId}`:"";
  try{ LX.lesson=await api(`learn/lessons/${state.learnLessonId}${cid}`); }
  catch(e){
    crumbs([{label:"Lessons",onclick:"go('learn',{learnLessonId:null})"},{label:"Unavailable"}]);
    $c().innerHTML=`<div class="empty"><div class="ei">${svg("lock")}</div><h3>This lesson isn't available</h3><p>${esc(e.message)}</p><button class="btn btn-primary" onclick="go('learn',{learnLessonId:null})">Back to Lessons</button></div>`; return;
  }
  const d=LX.lesson, L=d.lesson;
  LX.lang=state.user.profile?.preferences?.teachLang||d.lang||"uz";
  LX.practiceIdx=Math.min(Number(d.progress?.practiceState?.currentIndex)||0,Math.max(0,d.practice.length-1));
  LX.assisted=new Set(); LX.answered={...(d.answered||{})}; LX.pos=d.progress?.videoPositionSeconds||0; LX.dur=d.progress?.videoDurationSeconds||0;
  crumbs([{label:"Lessons",onclick:"go('learn',{learnLessonId:null})"},{label:L.title}]);
  const staff=lxIsStaff();
  $c().innerHTML=`<div class="page-head fade lx-head"><div><h1>${esc(L.title)}</h1><p>${esc(d.className||"")}${L.category?` · ${esc(L.category)}`:""}</p></div>${lxLangSwitch("lxSetLang")}</div>
    ${staff?`<div class="lx-preview-note fade">${svg("info","ic-sm")} Staff preview — students see this lesson exactly like this. Practice answers here are checked locally and never recorded.${d.scope?` Used by ${d.scope.classes.length} class${d.scope.classes.length===1?"":"es"}.`:""}</div>`:""}
    <div class="lx-lesson fade">
      <div class="lx-main">
        <div id="lxObjective"></div>
        <div class="panel lx-video-panel">${lxVideoHTML(L)}<div id="lxVideoState" class="umeta" style="margin-top:.6rem"></div></div>
        <div id="lxTeach"></div>
        <div class="panel" id="lxPractice"></div>
      </div>
      <aside class="lx-side">
        <div class="panel" id="lxNext"></div>
        <div class="panel" id="lxMaterials"></div>
      </aside>
    </div>`;
  lxRenderLangParts();
  lxRenderPractice();
  lxRenderNext();
  lxMountPlayer(L);
}
function lxSetLang(lang){ lxSaveLang(lang); document.querySelectorAll(".lx-langs button").forEach(b=>{ const on=b.textContent===LX_LANG[lang].mode; b.classList.toggle("on",on); b.setAttribute("aria-pressed",on); }); lxRenderLangParts(); lxSaveProgress(true); }
// Everything that depends on the teaching language — re-rendered on a switch
// without touching the video player or the practice state.
function lxRenderLangParts(){
  const d=LX.lesson, L=d.lesson, c=L.content||{}, lang=LX.lang;
  const obj=lxPick(L.objective,lang);
  document.getElementById("lxObjective").innerHTML=`<div class="lx-objective"><span class="lx-k">Learning objective</span>${obj.fallback?lxFallbackNote(lang):""}<p>${esc(obj.text||"—")}</p>
    <div class="lesson-tags"><span class="pill ${L.section==="math"?"pill-med":"pill-sec"}">${esc(SECTIONS[L.section]?.label||L.section)}</span>${L.category?`<span class="pill pill-muted">${esc(L.category)}</span>`:""}${(L.skillTags||[]).map(s=>`<span class="pill pill-muted">${esc(s)}</span>`).join("")}</div></div>`;
  const parts=[];
  if(c.transcript&&(c.transcript.en||c.transcript[lang])) parts.push(`<details class="panel lx-transcript"><summary><b>${svg("pages","ic-sm")} Captions &amp; transcript</b></summary>${lxBlock(c.transcript,lang,{rich:false})}</details>`);
  if(c.slidesUrl) parts.push(`<div class="panel"><h2>${svg("image","ic-sm")} Presentation</h2><div class="lx-slides"><iframe src="${esc(c.slidesUrl)}" title="Lesson presentation" loading="lazy" allowfullscreen referrerpolicy="strict-origin-when-cross-origin"></iframe></div><a class="umeta" href="${esc(c.slidesUrl)}" target="_blank" rel="noopener">Open the presentation in a new tab</a></div>`);
  if(c.explanation&&(c.explanation.en||c.explanation[lang])) parts.push(`<div class="panel"><h2>${svg("book","ic-sm")} Explanation</h2>${lxBlock(c.explanation,lang)}</div>`);
  if((c.vocabulary||[]).length) parts.push(`<div class="panel"><h2>${svg("vocab","ic-sm")} Vocabulary support</h2><div class="utable-wrap"><table class="utable lx-vocab"><thead><tr><th>English term</th><th>Meaning</th><th>${LX_LANG[lang].name}</th></tr></thead><tbody>${c.vocabulary.map(v=>`<tr><td><b lang="en">${esc(v.term)}</b></td><td lang="en">${esc(v.en||"")}</td><td lang="${lang}">${v[lang]?esc(v[lang]):`<span class="lx-fallback">not translated yet</span>`}</td></tr>`).join("")}</tbody></table></div></div>`);
  if((c.workedExamples||[]).length) parts.push(`<div class="panel"><h2>${svg("edit","ic-sm")} Worked examples</h2>${c.workedExamples.map((w,i)=>`<details class="lx-example" ${i===0?"open":""}><summary><b>${esc(w.title||`Example ${i+1}`)}</b></summary>${lxBlock(w.body,lang)}</details>`).join("")}</div>`);
  if(L.description) parts.push(`<div class="panel"><h2>${svg("info","ic-sm")} Notes</h2>${richHTML(L.description)}</div>`);
  document.getElementById("lxTeach").innerHTML=parts.join("");
  const mats=d.materials.filter(m=>m.lang==="all"||m.lang==="en"||m.lang===lang);
  const hidden=d.materials.length-mats.length;
  const missingLang=d.materials.some(m=>m.lang!=="all"&&m.lang!=="en")&&!d.materials.some(m=>m.lang===lang);
  document.getElementById("lxMaterials").innerHTML=`<h2>${svg("upload","ic-sm")} Materials</h2>${mats.length?`<ul class="lx-mats">${mats.map(m=>`<li><span class="pill pill-muted">${esc(m.kind)}</span> <span>${esc(m.title)}</span> <span class="umeta">${m.lang==="all"?"":m.lang==="en"?"English":LX_LANG[m.lang]?.name||m.lang}</span>
      <span class="lx-mat-actions">${m.hasFile?`${m.kind==="pdf"||m.contentType==="application/pdf"?`<button class="btn btn-ghost btn-xs" onclick="lxMaterial(${m.id},'view')">View</button>`:""}<button class="btn btn-ghost btn-xs" onclick="lxMaterial(${m.id},'download')">Download</button>`:`<a class="btn btn-ghost btn-xs" href="${esc(m.url)}" target="_blank" rel="noopener">Open</a>`}</span></li>`).join("")}</ul>`:`<p class="umeta">No materials for this lesson.</p>`}
    ${missingLang?`<p class="lx-fallback">No ${LX_LANG[lang].name} materials yet — English materials are shown.</p>`:""}${hidden?`<p class="umeta">${hidden} item${hidden===1?"":"s"} in the other language mode.</p>`:""}`;
  typesetMath($c());
}
// Private files are fetched with the session token, then shown from memory.
async function lxMaterial(id,how){
  try{
    const token=localStorage.getItem(LS.token);
    const r=await fetch(`/api/learn/materials/${id}/file${how==="download"?"?download=1":""}`,{headers:token?{authorization:"Bearer "+token}:{}});
    if(!r.ok){ let m="This material is not available"; try{m=(await r.json()).error||m}catch{} throw new Error(m); }
    const blob=await r.blob(), href=URL.createObjectURL(blob);
    const mat=LX.lesson?.materials.find(m=>m.id===id);
    if(how==="view") ftModal(esc(mat?.title||"Material"),`<iframe class="lx-pdf" src="${href}" title="${esc(mat?.title||"Material")}"></iframe>`,{wide:true});
    else { const a=document.createElement("a"); a.href=href; a.download=mat?.fileName||"material"; a.click(); }
    setTimeout(()=>URL.revokeObjectURL(href),120000);
  }catch(e){ toast(e.message); }
}

// ── video: YouTube IFrame API or a direct file; position saved for resume ──
function lxVideoHTML(L){
  if(L.videoProvider==="none") return `<div class="lx-novideo"><p>This lesson has no video — read through it, then mark it complete.</p>${lxIsStaff()?"":`<button class="btn btn-primary btn-sm" onclick="lxMarkComplete()">${svg("check","ic-sm")} Mark lesson complete</button>`}</div>`;
  if(L.videoProvider==="url") return `<div class="player-frame"><video id="lxVideo" controls playsinline preload="metadata" src="${esc(L.videoUrl)}"></video></div>`;
  if(!L.videoId) return `<div class="empty"><p>This lesson's video link is missing.</p></div>`;
  return `<div class="player-frame"><div id="lxYT"></div></div>`;
}
function lxLoadYT(){
  if(window.YT?.Player) return Promise.resolve();
  if(LX.ytLoading) return LX.ytLoading;
  LX.ytLoading=new Promise(res=>{ const prev=window.onYouTubeIframeAPIReady; window.onYouTubeIframeAPIReady=()=>{ prev&&prev(); res(); };
    const s=document.createElement("script"); s.src="https://www.youtube.com/iframe_api"; document.head.appendChild(s); });
  return LX.ytLoading;
}
async function lxMountPlayer(L){
  const d=LX.lesson;
  lxVideoState();
  if(L.videoProvider==="url"){
    const v=document.getElementById("lxVideo"); if(!v) return;
    // Captions uploaded as .vtt materials become selectable tracks.
    for(const m of d.materials.filter(m=>m.kind==="captions"&&m.hasFile)){
      try{ const token=localStorage.getItem(LS.token); const r=await fetch(`/api/learn/materials/${m.id}/file`,{headers:{authorization:"Bearer "+token}}); if(!r.ok) continue;
        const t=document.createElement("track"); t.kind="subtitles"; t.label=m.title; t.srclang=m.lang==="all"?"en":m.lang; t.src=URL.createObjectURL(await r.blob()); if(m.lang===LX.lang) t.default=true; v.appendChild(t); }catch{}
    }
    v.addEventListener("loadedmetadata",()=>{ LX.dur=Math.round(v.duration||0); if(LX.pos&&LX.pos<LX.dur-5) v.currentTime=LX.pos; });
    v.addEventListener("timeupdate",()=>{ LX.pos=Math.round(v.currentTime); LX.dur=Math.round(v.duration||LX.dur); lxSaveProgress(false); });
    v.addEventListener("pause",()=>lxSaveProgress(true));
    v.addEventListener("ended",()=>{ LX.pos=LX.dur; lxSaveProgress(true,true); });
    LX.player={stop:()=>{ try{ v.pause(); }catch{} }};
    return;
  }
  if(L.videoProvider!=="youtube"||!L.videoId) return;
  await lxLoadYT();
  if(!document.getElementById("lxYT")) return;
  const yt=new YT.Player("lxYT",{videoId:L.videoId,host:"https://www.youtube-nocookie.com",playerVars:{rel:0,modestbranding:1,playsinline:1,start:Math.max(0,Math.floor(LX.pos>5?LX.pos-2:0)),cc_load_policy:1,cc_lang_pref:LX.lang,hl:LX.lang},
    events:{onStateChange:e=>{ if(e.data===YT.PlayerState.ENDED){ LX.pos=LX.dur||Math.round(yt.getDuration()); lxSaveProgress(true,true); } else if(e.data===YT.PlayerState.PAUSED) lxSaveProgress(true); }}});
  const tick=setInterval(()=>{ try{ if(typeof yt.getCurrentTime!=="function") return; LX.pos=Math.round(yt.getCurrentTime()); LX.dur=Math.round(yt.getDuration()||LX.dur); lxSaveProgress(false); }catch{} },4000);
  LX.player={stop:()=>{ clearInterval(tick); try{ yt.destroy(); }catch{} }};
}
function lxStopPlayer(){ if(LX.player){ lxSaveProgress(true); LX.player.stop(); LX.player=null; } }
function lxVideoState(){
  const el=document.getElementById("lxVideoState"); if(!el) return;
  const p=LX.lesson?.progress;
  const done=!!p?.videoCompletedAt||!!p?.completedAt;
  el.innerHTML=lxIsStaff()?"Students resume from where they stopped, on any device.":done?`${svg("check","ic-sm")} Video complete — lesson progress saved.`:LX.pos>5?`Resumes at ${fmtClock(LX.pos)}${LX.dur?` of ${fmtClock(LX.dur)}`:""}. Watch to the end (90%) to complete the lesson.`:"Watch to the end (90%) to complete the lesson.";
}
function fmtClock(s){ s=Math.max(0,Math.round(s||0)); return `${Math.floor(s/60)}:${String(s%60).padStart(2,"0")}`; }
async function lxSaveProgress(force,ended){
  if(lxIsStaff()||!LX.lesson||state.view!=="learn") return;
  const now=Date.now();
  if(!force&&now-LX.lastSaved<15000&&!(LX.dur&&LX.pos>=LX.dur*0.9&&!LX.lesson.progress?.videoCompletedAt)) return;
  LX.lastSaved=now;
  try{
    const row=await api(`learn/lessons/${LX.lesson.lesson.id}/progress`,{method:"PUT",body:JSON.stringify({videoPositionSeconds:LX.pos,videoDurationSeconds:LX.dur,videoCompleted:!!ended,lang:LX.lang,classId:LX.lesson.classId,practiceIndex:LX.practiceIdx})});
    const wasDone=!!LX.lesson.progress?.completedAt; LX.lesson.progress=row;
    if(row?.completedAt&&!wasDone){ toast("Lesson complete"); lxRenderNext(); }
    lxVideoState();
  }catch{}
}
async function lxMarkComplete(){
  try{ const row=await api(`learn/lessons/${LX.lesson.lesson.id}/progress`,{method:"PUT",body:JSON.stringify({markComplete:true,lang:LX.lang,classId:LX.lesson.classId})}); LX.lesson.progress=row; toast("Lesson complete"); lxRenderNext(); }catch(e){ toast(e.message); }
}
function lxRenderNext(){
  const el=document.getElementById("lxNext"); if(!el) return;
  const d=LX.lesson, p=d.progress, L=d.lesson;
  const videoDone=L.videoProvider==="none"?!!p?.completedAt:!!p?.videoCompletedAt;
  const unanswered=d.practice.filter(q=>!LX.answered[String(q.id)]).length;
  let step;
  if(lxIsStaff()) step=`<p class="umeta">Students see their next step here: finish the video, then the practice, then the next lesson.</p>`;
  else if(!videoDone) step=`<p><b>Next step:</b> ${L.videoProvider==="none"?"read the lesson and mark it complete.":"finish the video."}</p>`;
  else if(unanswered) step=`<p><b>Next step:</b> answer the ${unanswered} remaining practice question${unanswered===1?"":"s"}.</p><button class="btn btn-primary btn-sm" onclick="document.getElementById('lxPractice').scrollIntoView({behavior:'smooth'})">Go to practice</button>`;
  else step=d.next?`<p><b>Lesson complete.</b> Up next:</p>`:`<p><b>You've reached the end of this class path.</b></p>`;
  el.innerHTML=`<h2>${svg("arr","ic-sm")} Next step</h2>${step}
    ${d.next?`<button class="btn ${videoDone&&!unanswered?"btn-primary":"btn-ghost"} btn-sm lx-nextbtn" onclick="lxOpen(${d.next.lessonId})">${esc(d.next.title)} ${svg("arr","ic-sm")}</button>`:""}
    ${d.prev?`<button class="btn btn-ghost btn-xs" style="margin-top:.5rem" onclick="lxOpen(${d.prev.lessonId})">${svg("back","ic-sm")} ${esc(d.prev.title)}</button>`:""}
    <button class="btn btn-ghost btn-xs" style="margin-top:.5rem" onclick="go('learn',{learnLessonId:null})">All lessons</button>`;
}

// ── practice: existing bank questions, server-side answer checking ──
function lxRenderPractice(){
  const el=document.getElementById("lxPractice"); if(!el) return;
  const d=LX.lesson, qs=d.practice;
  if(!qs.length){ el.innerHTML=`<h2>${svg("target","ic-sm")} Practice</h2><p class="umeta">This lesson has no practice questions.</p>`; return; }
  const i=Math.min(LX.practiceIdx,qs.length-1), q=qs[i], fb=LX.answered[String(q.id)];
  const staff=lxIsStaff();
  const pick=fb?.selected||LX.pick||"";
  const choices=(q.type||"mcq")==="spr"?`<input class="spr-input" id="lxSpr" placeholder="Type your answer" value="${esc(fb?fb.selected:"")}" ${fb?"disabled":""} onkeydown="if(event.key==='Enter')lxSubmit()" aria-label="Your answer"/>`
    :`<div class="lx-choices">${Object.entries(q.choices||{}).map(([k,v])=>{ const cls=fb?(k===fb.answer?"right":k===fb.selected?"wrong":""):(pick===k?"sel":"");
      return `<button type="button" class="choice ${cls}" ${fb?"disabled":""} onclick="LX.pick='${k}';lxRenderPractice()" aria-pressed="${pick===k}"><span class="ltr">${k}</span><span class="ct">${mathText(v)}${questionMediaHTML(q.choiceImages?.[k],`Answer choice ${k}`,"choice")}</span></button>`; }).join("")}</div>`;
  const assisted=LX.assisted.has(q.id);
  const examples=(d.lesson.content?.workedExamples||[]);
  el.innerHTML=`<div class="lx-practice-head"><h2>${svg("target","ic-sm")} Practice</h2><span class="umeta">Question ${i+1} of ${qs.length} · ${qs.filter(x=>LX.answered[String(x.id)]).length} answered</span></div>
    <div class="lx-qnav">${qs.map((x,j)=>{ const f=LX.answered[String(x.id)]; return `<button type="button" class="${j===i?"on":""} ${f?(f.correct?"ok":"bad"):""}" onclick="lxGoQ(${j})" aria-label="Question ${j+1}${f?(f.correct?", correct":", incorrect"):""}">${j+1}</button>`; }).join("")}</div>
    <div class="umeta" lang="en">${esc(q.subcategory||q.category)} · SAT question in original English</div>
    <div lang="en">${q.passage?`<div class="q-passage">${mathText(q.passage)}</div>`:""}${questionMediaHTML(q.questionImage,"Question graphic")}<div class="q-prompt">${mathText(q.prompt)}</div>${choices}</div>
    ${assisted&&!fb?`<div class="lx-help">${examples.length?examples.map(w=>`<details open><summary><b>${esc(w.title||"Worked example")}</b></summary>${lxBlock(w.body,LX.lang)}</details>`).join(""):`<p>Re-read the explanation above, then try the question.</p>`}<p class="umeta">Help is open — this answer will be recorded as assisted.</p></div>`:""}
    ${fb?lxFeedbackHTML(fb):""}
    <div class="q-actions">
      ${fb?"":`<button class="btn btn-primary" onclick="lxSubmit()">${svg("check","ic-sm")} Check answer</button>${assisted?"":`<button class="btn btn-ghost btn-sm" onclick="LX.assisted.add(${q.id});lxRenderPractice()">Get help</button>`}`}
      ${fb&&!staff?`<button class="btn btn-ghost btn-sm" onclick="lxRetry(${q.id})">Try again (practice only)</button>`:""}
      ${i<qs.length-1?`<button class="btn ${fb?"btn-primary":"btn-ghost"} btn-sm" onclick="lxGoQ(${i+1})">Next question ${svg("arr","ic-sm")}</button>`:""}
    </div>`;
  typesetMath(el);
}
function lxGoQ(j){ LX.practiceIdx=j; LX.pick=""; lxRenderPractice(); lxSaveProgress(true); }
function lxRetry(qid){ delete LX.answered[String(qid)]; LX.pick=""; lxRenderPractice(); }
function lxFeedbackHTML(fb){
  const head=fb.correct?"Correct":"Not quite";
  const notes=[];
  if(fb.pointsEarned) notes.push(`<span class="pill ft-pill-mint">+${fb.pointsEarned} points · ${esc(fb.skill)}</span>`);
  if(fb.assisted&&!fb.retry) notes.push(`<span class="pill ft-pill-gold">Assisted — feedback only, no points</span>`);
  if(fb.retry) notes.push(`<span class="pill pill-muted">Retry — this question already counted once</span>`);
  for(const l of fb.levelUps||[]) notes.push(`<span class="pill ft-pill-mint lx-levelup">${svg("flame","ic-sm")} Level up: ${LX_LEVEL[l]?.[0]||l} in ${esc(fb.skill)}</span>`);
  return `<div class="explain ${fb.correct?"":"bad"}" role="status"><h4>${head} · correct answer: ${mathText(fb.answer)}</h4>${fb.explanation?`<div lang="en">${mathText(fb.explanation)}</div>`:""}${notes.length?`<div class="lx-notes">${notes.join("")}</div>`:""}</div>`;
}
async function lxSubmit(){
  const d=LX.lesson, q=d.practice[LX.practiceIdx]; if(!q) return;
  const selected=(q.type||"mcq")==="spr"?(document.getElementById("lxSpr")?.value||"").trim():LX.pick;
  if(!selected){ toast("Choose or type an answer first"); return; }
  const assisted=LX.assisted.has(q.id);
  if(lxIsStaff()){ // preview: check locally with the staff copy of the key
    const ok=(q.type||"mcq")==="spr"?[q.answer,...(q.acceptableAnswers||[])].map(String).some(a=>a.trim()===selected):selected===q.answer;
    LX.answered[String(q.id)]={selected,correct:ok,answer:q.answer,explanation:q.explanation,assisted};
    LX.pick=""; lxRenderPractice(); return;
  }
  try{
    const r=await api(`learn/lessons/${d.lesson.id}/answer`,{method:"POST",body:JSON.stringify({questionId:q.id,selected,assisted,classId:d.classId,lang:LX.lang})});
    LX.answered[String(q.id)]={...r,selected};
    LX.pick=""; lxRenderPractice(); lxRenderNext();
    if((r.levelUps||[]).length) toast(`Level up: ${LX_LEVEL[r.levelUps[r.levelUps.length-1]]?.[0]} in ${r.skill}`);
  }catch(e){ toast(e.message); }
}

// ═════════════════════ STAFF ═════════════════════
async function lxStaffHome(){
  const tab=["path","preview","dashboard","settings"].includes(state.learnTab)?state.learnTab:"path";
  loading();
  let path;
  try{ path=await api(`learn/classes/${LX.classId}/path${tab==="preview"?"?preview=1":""}`); }catch(e){ $c().innerHTML=`<div class="empty"><p>${esc(e.message)}</p></div>`; return; }
  LX.path=path;
  const tabs=[["path","Curriculum"],["preview","Student preview"],["dashboard","Mastery dashboard"],...(state.user.role==="admin"?[["settings","Mastery rules"]]:[])];
  $c().innerHTML=`<div class="page-head fade lx-head"><div><h1>Lessons &amp; Mastery</h1><p>${esc(path.class.name)} · Class → Unit → Lesson → Practice. Each class has its own curriculum, order and assignments.</p></div>${lxClassSwitch()}</div>
    <div class="calc-tabs fade lx-tabs" role="tablist">${tabs.map(([k,t])=>`<button role="tab" class="${tab===k?"on":""}" onclick="state.learnTab='${k}';lxStaffHome()">${t}</button>`).join("")}</div>
    <div class="fade" id="lxStaffBody"></div>`;
  const body=document.getElementById("lxStaffBody");
  if(tab==="preview") body.innerHTML=`<div class="lx-preview-note">${svg("info","ic-sm")} This is what students in ${esc(path.class.name)} see: published units and lessons only.</div>${lxPathHTML(path.units,true)}`;
  else if(tab==="dashboard") lxDashboard(body);
  else if(tab==="settings") lxSettings(body);
  else body.innerHTML=lxCurriculumHTML(path.units);
}
function lxCurriculumHTML(units){
  return `<div class="panel"><h2>${svg("plus","ic-sm")} New unit</h2><div class="f-row"><div class="field"><label for="lxUnitT">Unit title (English)</label><input id="lxUnitT" placeholder="Linear equations"/></div>
      <div class="field"><label for="lxUnitUz">Uzbek title</label><input id="lxUnitUz"/></div><div class="field"><label for="lxUnitRu">Russian title</label><input id="lxUnitRu"/></div>
      <div class="field" style="display:flex;align-items:flex-end"><button class="btn btn-primary" onclick="lxAddUnit()">${svg("plus","ic-sm")} Add unit</button></div></div>
      <p class="umeta">New units and lessons start as drafts. Students see them only after you publish both the unit and the lesson.</p></div>
    ${units.map((u,ui)=>`<section class="panel lx-unit ${u.status}"><div class="lx-unit-head">
        <span class="lx-unit-no">Unit ${ui+1}</span><h2>${esc(u.title)}</h2>${u.status==="published"?`<span class="pill ft-pill-mint">Published</span>`:`<span class="pill pill-muted">Draft</span>`}
        <div class="lx-row-actions">
          <button class="btn btn-ghost btn-xs" ${ui===0?"disabled":""} onclick="lxMoveUnit(${u.id},-1)" aria-label="Move unit up">↑</button>
          <button class="btn btn-ghost btn-xs" ${ui===units.length-1?"disabled":""} onclick="lxMoveUnit(${u.id},1)" aria-label="Move unit down">↓</button>
          <button class="btn btn-ghost btn-xs" onclick="lxEditUnit(${u.id})">${svg("edit","ic-sm")} Rename</button>
          <button class="btn ${u.status==="published"?"btn-ghost":"btn-primary"} btn-xs" onclick="lxUnitStatus(${u.id},'${u.status==="published"?"draft":"published"}')">${u.status==="published"?"Unpublish":"Publish unit"}</button>
          <button class="btn btn-danger btn-xs" onclick="lxUnitStatus(${u.id},'archived')">Archive</button>
        </div></div>
      <ol class="lx-admin-lessons">${u.lessons.map((l,li)=>`<li class="${l.status}">
        <div class="lx-al-main"><b>${esc(l.title)}</b>
          <div class="lesson-tags">${l.status==="published"?`<span class="pill ft-pill-mint">Published</span>`:`<span class="pill pill-muted">Draft</span>`}${l.assignedAt?`<span class="pill ft-pill-gold">Assigned${l.dueAt?` · due ${new Date(l.dueAt).toLocaleDateString()}`:""}</span>`:""}
          ${l.usedByClasses>1||l.visibility==="public"?`<span class="pill pill-sec" title="Edits change every class that uses it">Shared · ${l.usedByClasses} class${l.usedByClasses===1?"":"es"}${l.visibility==="public"?" + library":""}</span>`:`<span class="pill pill-muted">This class only</span>`}
          ${l.sourceLessonId?`<span class="pill pill-muted">Class copy</span>`:""}${(l.skillTags||[]).slice(0,2).map(s=>`<span class="pill pill-muted">${esc(s)}</span>`).join("")}<span class="pill pill-muted">${l.practiceCount} practice</span></div></div>
        <div class="lx-row-actions">
          <button class="btn btn-ghost btn-xs" ${li===0?"disabled":""} onclick="lxMoveLesson(${u.id},${l.placementId},-1)" aria-label="Move lesson up">↑</button>
          <button class="btn btn-ghost btn-xs" ${li===u.lessons.length-1?"disabled":""} onclick="lxMoveLesson(${u.id},${l.placementId},1)" aria-label="Move lesson down">↓</button>
          <button class="btn btn-ghost btn-xs" onclick="lxOpen(${l.lessonId})">Preview</button>
          <button class="btn btn-ghost btn-xs" onclick="lxEditLesson(${l.lessonId},${l.placementId})">${svg("edit","ic-sm")} Edit</button>
          ${l.usedByClasses>1||l.visibility==="public"?`<button class="btn btn-ghost btn-xs" onclick="lxCopy(${l.placementId})">Make class copy</button>`:""}
          <button class="btn ${l.status==="published"?"btn-ghost":"btn-primary"} btn-xs" onclick="lxPlacement(${l.placementId},{status:'${l.status==="published"?"draft":"published"}'})">${l.status==="published"?"Unpublish":"Publish"}</button>
          <button class="btn btn-ghost btn-xs" onclick="lxAssign(${l.placementId},${lxJs(l.dueAt||"")})">${l.assignedAt?"Edit assignment":"Assign"}</button>
          <button class="btn btn-danger btn-xs" onclick="lxRemovePlacement(${l.placementId})">Remove</button>
        </div></li>`).join("")||`<li class="umeta">No lessons yet.</li>`}</ol>
      <div class="lx-add"><button class="btn btn-primary btn-sm" onclick="lxEditLesson(null,null,${u.id})">${svg("plus","ic-sm")} New lesson</button><button class="btn btn-ghost btn-sm" onclick="lxReuse(${u.id})">Reuse an existing lesson</button></div>
    </section>`).join("")||`<div class="empty"><p>No units yet — add the first one above.</p></div>`}`;
}
async function lxAddUnit(){
  const v=id=>document.getElementById(id).value.trim();
  try{ await api(`learn/classes/${LX.classId}/units`,{method:"POST",body:JSON.stringify({title:v("lxUnitT"),titleI18n:{en:v("lxUnitT"),uz:v("lxUnitUz"),ru:v("lxUnitRu")}})}); toast("Unit added"); lxStaffHome(); }catch(e){ toast(e.message); }
}
function lxEditUnit(id){
  const u=LX.path.units.find(x=>x.id===id); if(!u) return;
  ftModal("Rename unit",`<div class="field"><label>English title</label><input id="lxEU" value="${esc(u.title)}"/></div><div class="field"><label>Uzbek title</label><input id="lxEUuz" value="${esc(u.titleI18n?.uz||"")}"/></div><div class="field"><label>Russian title</label><input id="lxEUru" value="${esc(u.titleI18n?.ru||"")}"/></div><div class="field"><label>Description</label><input id="lxEUd" value="${esc(u.description||"")}"/></div>`,
    {foot:`<button class="btn btn-primary" onclick="lxSaveUnit(${id})">${svg("save","ic-sm")} Save</button>`});
}
async function lxSaveUnit(id){
  const v=k=>document.getElementById(k).value.trim();
  try{ await api(`learn/units/${id}`,{method:"PATCH",body:JSON.stringify({title:v("lxEU"),titleI18n:{en:v("lxEU"),uz:v("lxEUuz"),ru:v("lxEUru")},description:v("lxEUd")})}); ftCloseModal(); lxStaffHome(); }catch(e){ toast(e.message); }
}
async function lxUnitStatus(id,status){
  if(status==="archived"&&!confirm("Archive this unit? Students lose access to its lessons; their progress is kept.")) return;
  try{ await api(`learn/units/${id}`,{method:"PATCH",body:JSON.stringify({status})}); toast(status==="published"?"Unit published":status==="draft"?"Unit unpublished":"Unit archived"); lxStaffHome(); }catch(e){ toast(e.message); }
}
async function lxReorder(units){
  const payload={units:units.map(u=>u.id),lessons:Object.fromEntries(units.map(u=>[u.id,u.lessons.map(l=>l.placementId)]))};
  try{ await api(`learn/classes/${LX.classId}/reorder`,{method:"POST",body:JSON.stringify(payload)}); lxStaffHome(); }catch(e){ toast(e.message); }
}
function lxMoveUnit(id,dir){ const u=LX.path.units.slice(), i=u.findIndex(x=>x.id===id), j=i+dir; if(j<0||j>=u.length) return; [u[i],u[j]]=[u[j],u[i]]; lxReorder(u); }
function lxMoveLesson(unitId,pid,dir){
  const units=LX.path.units.map(u=>({...u,lessons:u.lessons.slice()})); const u=units.find(x=>x.id===unitId); const i=u.lessons.findIndex(l=>l.placementId===pid), j=i+dir;
  if(j<0||j>=u.lessons.length) return; [u.lessons[i],u.lessons[j]]=[u.lessons[j],u.lessons[i]]; lxReorder(units);
}
async function lxPlacement(id,patch){ try{ await api(`learn/placements/${id}`,{method:"PATCH",body:JSON.stringify(patch)}); toast(patch.status==="published"?"Lesson published":patch.status==="draft"?"Lesson unpublished":"Saved"); lxStaffHome(); }catch(e){ toast(e.message); } }
function lxAssign(id,due){
  const v=due?localDateTimeValue(due):"";
  ftModal("Assign lesson",`<p class="umeta">Assigning publishes the lesson (if needed) and notifies every student in the class.</p><div class="field"><label for="lxDue">Due date (optional)</label><input id="lxDue" type="datetime-local" value="${v}"/></div>`,
    {foot:`<button class="btn btn-ghost" onclick="ftCloseModal();lxPlacement(${id},{assign:false,dueAt:null})">Remove assignment</button><button class="btn btn-primary" onclick="const d=document.getElementById('lxDue').value;ftCloseModal();lxPlacement(${id},{assign:true,dueAt:d?new Date(d).toISOString():null})">Assign</button>`});
}
async function lxRemovePlacement(id){
  if(!confirm("Remove this lesson from the unit? The lesson itself, other classes using it, and students' progress are kept.")) return;
  try{ await api(`learn/placements/${id}`,{method:"DELETE"}); toast("Removed from unit"); lxStaffHome(); }catch(e){ toast(e.message); }
}
async function lxCopy(pid){
  if(!confirm("Make a class-specific copy? This class will use its own copy from now on; other classes keep the shared original.")) return;
  try{ await api(`learn/placements/${pid}/copy`,{method:"POST"}); toast("Class copy created — edits now affect this class only"); lxStaffHome(); }catch(e){ toast(e.message); }
}
async function lxReuse(unitId){
  let lib=[]; try{ lib=await api("learn/library"); }catch(e){ toast(e.message); return; }
  LX.library=lib; LX.reuseUnit=unitId;
  ftModal("Reuse an existing lesson",`<p class="umeta">The lesson is shared: edits to it change every class that uses it. Make a class copy later if you want to edit it independently.</p>
    <div class="field"><label for="lxLibQ">Search</label><input id="lxLibQ" oninput="lxLibList()" placeholder="Title or skill"/></div><div id="lxLib"></div>`,{wide:true});
  lxLibList();
}
function lxLibList(){
  const q=(document.getElementById("lxLibQ")?.value||"").toLowerCase();
  const rows=LX.library.filter(l=>!q||l.title.toLowerCase().includes(q)||(l.skillTags||[]).join(" ").toLowerCase().includes(q));
  document.getElementById("lxLib").innerHTML=rows.length?`<ul class="lx-mats">${rows.slice(0,80).map(l=>`<li><b>${esc(l.title)}</b> <span class="umeta">${esc(SECTIONS[l.section]?.label||"")} · ${(l.skillTags||[]).map(esc).join(", ")||"no skills"} · ${l.practiceCount} practice · ${l.hasUz?"UZ":""}${l.hasUz&&l.hasRu?" / ":""}${l.hasRu?"RU":""}${l.visibility==="public"?" · library":""}</span><span class="lx-mat-actions"><button class="btn btn-primary btn-xs" onclick="lxAddExisting(${l.id})">Add</button></span></li>`).join("")}</ul>`:`<p class="umeta">No lessons match.</p>`;
}
async function lxAddExisting(lessonId){
  try{ await api(`learn/units/${LX.reuseUnit}/placements`,{method:"POST",body:JSON.stringify({lessonId})}); ftCloseModal(); toast("Lesson added as a draft"); lxStaffHome(); }catch(e){ toast(e.message); }
}

// ── lesson editor ──
function lxBlankLesson(){ return {title:"",section:"math",category:"",skillTags:[],objective:{},videoProvider:"youtube",youtubeUrl:"",videoUrl:"",content:{explanation:{},transcript:{},vocabulary:[],workedExamples:[],slidesUrl:""},practiceQuestionIds:[],description:""}; }
async function lxEditLesson(lessonId,placementId,unitId){
  let L=lxBlankLesson(), scope=null, materials=[];
  if(lessonId){
    try{ const d=await api(`learn/lessons/${lessonId}?classId=${LX.classId}`); L=d.lesson; scope=d.scope; materials=d.materials; }catch(e){ toast(e.message); return; }
  }
  if(!LX.bankCache){ try{ LX.bankCache=await api("questions"); }catch{ LX.bankCache=[]; } }
  LX.editing={L:JSON.parse(JSON.stringify(L)),lessonId,placementId,unitId,scope,materials,pick:new Set(L.practiceQuestionIds||[]),qf:{q:"",skill:""}};
  lxEditorModal();
}
function lxI18nFields(prefix,label,obj,{area=false,rows=3}={}){
  return `<fieldset class="lx-i18n"><legend>${label}</legend>${["en","uz","ru"].map(l=>`<div class="field"><label for="${prefix}_${l}">${l==="en"?"English":l==="uz"?"Uzbek":"Russian"}</label>${area?`<textarea id="${prefix}_${l}" rows="${rows}">${esc(obj?.[l]||"")}</textarea>`:`<input id="${prefix}_${l}" value="${esc(obj?.[l]||"")}"/>`}</div>`).join("")}</fieldset>`;
}
function lxEditorModal(){
  const E=LX.editing, L=E.L, c=L.content||{};
  const domains=allDomains(L.section);
  const skills=(L.category?SUBSECTIONS[L.category]:domains.flatMap(d=>SUBSECTIONS[d]||[]))||[];
  const scope=E.scope;
  const scopeNote=!E.lessonId?`<div class="lx-scope">${svg("info","ic-sm")} New lesson — it will belong to <b>${esc(LX.path.class.name)}</b> as a draft.</div>`
    :scope?(scope.canEdit?`<div class="lx-scope ${scope.classes.length>1||scope.shared?"warn":""}">${svg("info","ic-sm")} Saving changes this lesson in <b>${scope.classes.length} class${scope.classes.length===1?"":"es"}</b>${scope.classes.length?`: ${scope.classes.map(x=>esc(x.name)).join(", ")}`:""}${scope.shared?" (shared lesson)":""}.${scope.classes.length>1&&E.placementId?` To change only ${esc(LX.path.class.name)}, choose <b>Save as class copy</b>.`:""}</div>`
      :`<div class="lx-scope warn">${svg("lock","ic-sm")} ${esc(scope.reason)}</div>`):"";
  const canEdit=!E.lessonId||scope?.canEdit;
  ftModal(E.lessonId?"Edit lesson":"New lesson",`${scopeNote}
    <div class="f-row"><div class="field"><label for="lxT">Title</label><input id="lxT" value="${esc(L.title)}"/></div>
      <div class="field"><label for="lxSec">Section</label><select id="lxSec" onchange="lxEdSync();LX.editing.L.section=this.value;LX.editing.L.category='';LX.editing.L.skillTags=[];lxEditorModal()">${Object.entries(SECTIONS).map(([k,s])=>`<option value="${k}" ${L.section===k?"selected":""}>${s.label}</option>`).join("")}</select></div>
      <div class="field"><label for="lxDom">SAT domain</label><select id="lxDom" onchange="lxEdSync();LX.editing.L.category=this.value;LX.editing.L.skillTags=[];lxEditorModal()"><option value="">Choose…</option>${domains.map(d=>`<option ${L.category===d?"selected":""}>${esc(d)}</option>`).join("")}</select></div></div>
    <fieldset class="lx-i18n"><legend>SAT skill tags</legend><div class="lx-tags">${skills.map(s=>`<label><input type="checkbox" class="lxSkill" value="${esc(s)}" ${(L.skillTags||[]).includes(s)?"checked":""}/> ${esc(s)}</label>`).join("")||`<span class="umeta">Choose a domain first.</span>`}</div></fieldset>
    ${lxI18nFields("lxObj","Learning objective",L.objective)}
    <fieldset class="lx-i18n"><legend>Video</legend>
      <div class="f-row"><div class="field"><label for="lxVP">Source</label><select id="lxVP" onchange="lxEdSync();LX.editing.L.videoProvider=this.value;lxEditorModal()"><option value="youtube" ${L.videoProvider==="youtube"?"selected":""}>YouTube (public or unlisted)</option><option value="url" ${L.videoProvider==="url"?"selected":""}>Video file link (.mp4 / .webm)</option><option value="none" ${L.videoProvider==="none"?"selected":""}>No video (reading lesson)</option></select></div>
      ${L.videoProvider==="youtube"?`<div class="field"><label for="lxYTU">YouTube link</label><input id="lxYTU" value="${esc(L.youtubeUrl||(L.videoId?`https://youtu.be/${L.videoId}`:""))}" placeholder="https://www.youtube.com/watch?v=…"/></div>`:L.videoProvider==="url"?`<div class="field"><label for="lxVU">Video file URL (https)</label><input id="lxVU" value="${esc(L.videoUrl||"")}"/></div>`:""}</div>
      <p class="umeta">Captions: YouTube shows its own captions; for video files, upload .vtt caption files under Materials (kind “captions”) per language. A transcript in each language can be added below.</p></fieldset>
    ${lxI18nFields("lxTr","Captions / transcript text",c.transcript,{area:true,rows:4})}
    ${lxI18nFields("lxEx","Teaching explanation (basic HTML allowed; LaTeX with \\( … \\))",c.explanation,{area:true,rows:5})}
    <fieldset class="lx-i18n"><legend>Vocabulary support — one per line: term | English meaning | Uzbek | Russian</legend><textarea id="lxVoc" rows="4">${esc((c.vocabulary||[]).map(v=>[v.term,v.en,v.uz,v.ru].join(" | ")).join("\n"))}</textarea></fieldset>
    <fieldset class="lx-i18n"><legend>Worked examples</legend><div id="lxWE">${(c.workedExamples||[]).map((w,i)=>lxWEHTML(w,i)).join("")}</div><button class="btn btn-ghost btn-sm" onclick="lxEdSync();LX.editing.L.content.workedExamples=[...(LX.editing.L.content.workedExamples||[]),{title:'',body:{}}];lxEditorModal()">${svg("plus","ic-sm")} Add worked example</button></fieldset>
    <div class="field"><label for="lxSl">Presentation embed link (Google Slides “Publish to web” / OneDrive embed, https)</label><input id="lxSl" value="${esc(c.slidesUrl||"")}"/></div>
    <fieldset class="lx-i18n"><legend>Practice — ready-to-assign question-bank items (${E.pick.size} selected)</legend>
      <div class="f-row"><div class="field"><label for="lxQQ">Search the bank</label><input id="lxQQ" value="${esc(E.qf.q)}" oninput="LX.editing.qf.q=this.value;lxQList()"/></div>
      <div class="field"><label for="lxQS">Skill</label><select id="lxQS" onchange="LX.editing.qf.skill=this.value;lxQList()"><option value="">Lesson skills</option><option value="*" ${E.qf.skill==="*"?"selected":""}>Any skill</option>${skills.map(s=>`<option ${E.qf.skill===s?"selected":""}>${esc(s)}</option>`).join("")}</select></div></div>
      <div id="lxQList" class="lx-qpick"></div></fieldset>
    ${E.lessonId?lxMaterialsEditorHTML():`<p class="umeta">Save the lesson first, then upload PDFs, slides, downloads and caption files.</p>`}
    <div id="lxEdMsg"></div>`,
    {wide:true,foot:canEdit?`<button class="btn btn-ghost" onclick="ftCloseModal()">Cancel</button>${E.lessonId&&E.placementId&&scope&&(scope.classes.length>1||scope.shared)?`<button class="btn btn-ghost" onclick="lxSaveLesson(true)">Save as class copy</button>`:""}<button class="btn btn-primary" onclick="lxSaveLesson(false)">${svg("save","ic-sm")} ${E.lessonId?(scope&&scope.classes.length>1?`Save for all ${scope.classes.length} classes`:"Save lesson"):"Create lesson"}</button>`
      :`<button class="btn btn-ghost" onclick="ftCloseModal()">Close</button>${E.placementId?`<button class="btn btn-primary" onclick="ftCloseModal();lxCopy(${E.placementId})">Make class copy to edit</button>`:""}`});
  lxQList();
}
function lxWEHTML(w,i){ return `<div class="lx-we"><div class="field"><label>Example ${i+1} title</label><input id="lxWEt${i}" value="${esc(w.title||"")}"/></div>${lxI18nFields(`lxWEb${i}`,"Steps",w.body,{area:true,rows:3})}<button class="btn btn-ghost btn-xs" onclick="lxEdSync();LX.editing.L.content.workedExamples.splice(${i},1);lxEditorModal()">Remove example</button></div>`; }
// Read the open form back into LX.editing before any re-render.
function lxEdSync(){
  const E=LX.editing; if(!E||!document.getElementById("lxT")) return;
  const L=E.L, v=id=>document.getElementById(id)?.value??"";
  const tri=p=>({en:v(p+"_en"),uz:v(p+"_uz"),ru:v(p+"_ru")});
  L.title=v("lxT"); L.objective=tri("lxObj");
  L.skillTags=[...document.querySelectorAll(".lxSkill:checked")].map(x=>x.value);
  if(document.getElementById("lxYTU")) L.youtubeUrl=v("lxYTU");
  if(document.getElementById("lxVU")) L.videoUrl=v("lxVU");
  L.content={...(L.content||{}),transcript:tri("lxTr"),explanation:tri("lxEx"),slidesUrl:v("lxSl"),
    vocabulary:v("lxVoc").split("\n").map(r=>r.split("|").map(x=>x.trim())).filter(r=>r[0]).map(([term,en,uz,ru])=>({term,en:en||"",uz:uz||"",ru:ru||""})),
    workedExamples:(L.content?.workedExamples||[]).map((w,i)=>({title:v(`lxWEt${i}`),body:tri(`lxWEb${i}`)}))};
  L.practiceQuestionIds=[...E.pick];
}
function lxQList(){
  const E=LX.editing, el=document.getElementById("lxQList"); if(!E||!el) return;
  const tags=[...document.querySelectorAll(".lxSkill:checked")].map(x=>x.value);
  const q=E.qf.q.trim().toLowerCase();
  let rows=(LX.bankCache||[]).filter(x=>x.section===E.L.section);
  if(E.qf.skill&&E.qf.skill!=="*") rows=rows.filter(x=>x.subcategory===E.qf.skill);
  else if(!E.qf.skill&&tags.length) rows=rows.filter(x=>tags.includes(x.subcategory));
  if(q) rows=rows.filter(x=>String(x.id)===q.replace(/^#/,"")||questionSearchText(x).includes(q));
  const picked=[...E.pick].map(id=>(LX.bankCache||[]).find(x=>x.id===id)||{id,prompt:"(retired or not in bank)",subcategory:""});
  el.innerHTML=`${picked.length?`<div class="lx-picked">${picked.map((x,i)=>`<span class="pill pill-sec">${i+1}. #${x.id} ${esc(mathPlain(x.prompt||"").slice(0,40))} <button class="pl-x" onclick="LX.editing.pick.delete(${x.id});lxQList()" aria-label="Remove question ${x.id}">×</button></span>`).join("")}</div>`:""}
    <div class="lx-qrows">${rows.slice(0,60).map(x=>`<label class="lx-qrow"><input type="checkbox" ${E.pick.has(x.id)?"checked":""} onchange="this.checked?LX.editing.pick.add(${x.id}):LX.editing.pick.delete(${x.id});lxQList()"/> <span>#${x.id} · ${esc(x.subcategory||x.category)} · L${x.difficulty}</span> <span class="umeta">${esc(mathPlain(x.prompt||"").slice(0,90))}</span></label>`).join("")||`<p class="umeta">No bank questions match. Tag skills above or change the filter.</p>`}</div>
    ${rows.length>60?`<p class="umeta">Showing 60 of ${rows.length}. Search to narrow.</p>`:""}`;
  const legend=el.closest("fieldset")?.querySelector("legend"); if(legend) legend.textContent=`Practice — ready-to-assign question-bank items (${E.pick.size} selected)`;
}
async function lxSaveLesson(asCopy){
  lxEdSync();
  const E=LX.editing, L=E.L;
  const payload={title:L.title,section:L.section,category:L.category,skillTags:L.skillTags,objective:L.objective,videoProvider:L.videoProvider,youtubeUrl:L.youtubeUrl,videoUrl:L.videoUrl,content:L.content,practiceQuestionIds:L.practiceQuestionIds,description:L.description||""};
  const msg=document.getElementById("lxEdMsg");
  try{
    if(!E.lessonId){
      await api(`learn/units/${E.unitId}/placements`,{method:"POST",body:JSON.stringify({lesson:payload})});
      ftCloseModal(); toast("Lesson created as a draft — publish it when it's ready"); lxStaffHome(); return;
    }
    let id=E.lessonId;
    if(asCopy){ const r=await api(`learn/placements/${E.placementId}/copy`,{method:"POST"}); id=r.lesson.id; }
    await api(`learn/lessons/${id}`,{method:"PUT",body:JSON.stringify(payload)});
    ftCloseModal(); toast(asCopy?`Saved as a copy for ${LX.path.class.name}`:"Lesson saved"); lxStaffHome();
  }catch(e){ if(msg) msg.innerHTML=`<p class="form-error">${esc(e.message)}</p>`; else toast(e.message); }
}
function lxMaterialsEditorHTML(){
  const E=LX.editing;
  return `<fieldset class="lx-i18n"><legend>Materials</legend>
    ${E.materials.length?`<ul class="lx-mats">${E.materials.map(m=>`<li><span class="pill pill-muted">${esc(m.kind)}</span> ${esc(m.title)} <span class="umeta">${esc(m.lang)}${m.size?` · ${Math.round(m.size/1024)} KB`:""}</span><span class="lx-mat-actions"><button class="btn btn-danger btn-xs" onclick="lxDelMaterial(${m.id})">Delete</button></span></li>`).join("")}</ul>`:`<p class="umeta">No materials yet.</p>`}
    <div class="f-row"><div class="field"><label for="lxMK">Kind</label><select id="lxMK"><option value="pdf">PDF</option><option value="slides">Presentation file</option><option value="download">Download</option><option value="captions">Captions (.vtt)</option></select></div>
      <div class="field"><label for="lxML">Language</label><select id="lxML"><option value="all">All modes</option><option value="en">English</option><option value="uz">Uzbek</option><option value="ru">Russian</option></select></div>
      <div class="field"><label for="lxMT">Title</label><input id="lxMT"/></div>
      <div class="field"><label for="lxMF">File (max 4.5 MB)</label><input id="lxMF" type="file"/></div></div>
    <button class="btn btn-ghost btn-sm" onclick="lxUpload()">${svg("upload","ic-sm")} Upload</button>
    <div class="f-row" style="margin-top:.6rem"><div class="field"><label for="lxMU">…or link (https)</label><input id="lxMU" placeholder="https://drive.google.com/…"/></div><div class="field" style="display:flex;align-items:flex-end"><button class="btn btn-ghost btn-sm" onclick="lxAddLink()">Add link</button></div></div>
    <p class="umeta">Uploaded files are private: only members of classes that use this lesson can open them.</p></fieldset>`;
}
async function lxRefreshMaterials(){ const d=await api(`learn/lessons/${LX.editing.lessonId}?classId=${LX.classId}`); LX.editing.materials=d.materials; lxEdSync(); lxEditorModal(); }
async function lxUpload(){
  const E=LX.editing, f=document.getElementById("lxMF")?.files?.[0];
  if(!f){ toast("Choose a file"); return; }
  if(f.size>4.5e6){ toast("Files must be under 4.5 MB — add larger files as a link"); return; }
  const q=new URLSearchParams({kind:document.getElementById("lxMK").value,lang:document.getElementById("lxML").value,title:document.getElementById("lxMT").value||f.name,fileName:f.name});
  try{
    const token=localStorage.getItem(LS.token);
    const r=await fetch(`/api/learn/lessons/${E.lessonId}/materials?${q}`,{method:"POST",headers:{"content-type":f.type||"application/octet-stream",authorization:"Bearer "+token},body:f});
    if(!r.ok){ let m="Upload failed"; try{m=(await r.json()).error||m}catch{} throw new Error(m); }
    toast("Material uploaded"); await lxRefreshMaterials();
  }catch(e){ toast(e.message); }
}
async function lxAddLink(){
  const E=LX.editing;
  try{ await api(`learn/lessons/${E.lessonId}/materials`,{method:"POST",body:JSON.stringify({url:document.getElementById("lxMU").value,title:document.getElementById("lxMT").value,lang:document.getElementById("lxML").value})}); toast("Link added"); await lxRefreshMaterials(); }catch(e){ toast(e.message); }
}
async function lxDelMaterial(id){ if(!confirm("Delete this material from the lesson (in every class that uses it)?")) return; try{ await api(`learn/materials/${id}`,{method:"DELETE"}); await lxRefreshMaterials(); }catch(e){ toast(e.message); } }

// ── mastery dashboard ──
async function lxDashboard(el){
  el.innerHTML=`<div class="spin"></div>`;
  let d; try{ d=await api(`learn/classes/${LX.classId}/dashboard`); }catch(e){ el.innerHTML=`<div class="empty"><p>${esc(e.message)}</p></div>`; return; }
  LX.dash=d;
  if(!d.students.length){ el.innerHTML=`<div class="empty"><p>No students in this class yet.</p></div>`; return; }
  const skills=d.skills;
  el.innerHTML=`${lxRulesHTML(d.rules)}
    <div class="panel" style="margin-top:1rem"><div class="ch-admin-head"><h2>${svg("graph","ic-sm")} ${esc(d.class.name)} · ${d.students.length} students · ${d.lessons.length} published lessons</h2><button class="btn btn-ghost btn-sm" onclick="lxDashboard(document.getElementById('lxStaffBody'))">Refresh</button></div>
    <div class="utable-wrap"><table class="utable lx-dash"><thead><tr><th>Student</th><th>Lessons</th><th>Points</th>${skills.map(s=>`<th title="${esc(s)}">${esc(s.length>22?s.slice(0,21)+"…":s)}</th>`).join("")}</tr></thead><tbody>
      ${d.students.map(s=>`<tr><td><div class="uname">${esc(s.displayName)}</div></td>
        <td><b>${s.lessonsCompleted}</b>/${s.lessonsTotal}<div class="q-progress" style="min-width:70px"><i style="width:${s.lessonsTotal?Math.round(s.lessonsCompleted/s.lessonsTotal*100):0}%"></i></div></td>
        <td>${s.points}</td>
        ${skills.map(k=>{ const x=s.skills.find(y=>y.skill===k); return `<td>${x?`<button class="lx-cell" onclick="lxEvidence(${s.id},${lxJs(k)})" aria-label="${esc(s.displayName)}, ${esc(k)}: ${LX_LEVEL[x.level][0]}. Show evidence">${lxPill(x.level)}<span class="umeta">${x.independentCorrect} correct${x.assistedAnswers?` · ${x.assistedAnswers} assisted`:""}</span></button>`:lxPill("not_started")}</td>`; }).join("")}</tr>`).join("")}
    </tbody></table></div></div>`;
}
async function lxEvidence(studentId,skill){
  let d; try{ d=await api(`learn/classes/${LX.classId}/students/${studentId}?skill=${encodeURIComponent(skill)}`); }catch(e){ toast(e.message); return; }
  const s=d.summary;
  ftModal(`${esc(d.student.displayName)} · ${esc(skill)}`,`${s?`<p>${lxPill(s.level)} <b>${s.points}</b> points · <b>${s.independentCorrect}</b> different questions correct on their own · recent first-try accuracy ${s.recentAccuracy===null?"—":`${s.recentAccuracy}% of ${s.recentCount}`} · ${s.assistedAnswers} assisted answers</p>`:""}
    <p class="umeta">Proficient: ${d.rules.proficientCount} independent correct. Mastered: ${d.rules.masteredCount} independent correct and ≥${d.rules.masteredAccuracy}% across the ${d.rules.masteredWindow} most recent first tries.</p>
    ${d.evidence.length?`<div class="utable-wrap"><table class="mini-table"><thead><tr><th>Question</th><th>First try</th><th>Points</th><th>Attempts</th><th>Latest</th><th>Lesson</th></tr></thead><tbody>${d.evidence.map(e=>`<tr>
      <td><details><summary>#${e.questionId}</summary>${e.question?fullQuestionHTML(e.question):"<p class='umeta'>Question removed.</p>"}</details></td>
      <td>${e.firstIndependentAt?(e.firstIndependentCorrect?`<span class="pill ft-pill-mint">Correct</span>`:`<span class="pill ft-pill-red">Incorrect</span>`):`<span class="pill ft-pill-gold">Assisted</span>`}<div class="umeta">${esc(plWhen(e.firstIndependentAt||e.lastAttemptAt))}</div></td>
      <td>${e.points}</td><td>${e.attempts}${e.assistedAnswers?` <span class="umeta">(${e.assistedAnswers} assisted)</span>`:""}</td>
      <td>${esc(e.lastSelected||"—")} ${e.lastCorrect?"✓":"✗"}${e.lastAssisted?` <span class="umeta">assisted</span>`:""}</td><td class="umeta">${esc(e.lessonTitle)}${e.lang?` · ${esc(LX_LANG[e.lang]?.short||e.lang)}`:""}</td></tr>`).join("")}</tbody></table></div>`:`<p class="umeta">No evidence yet.</p>`}`,{wide:true});
}
// ── mastery rules (admin) ──
async function lxSettings(el){
  let r; try{ r=await api("learn/settings"); }catch(e){ el.innerHTML=`<p>${esc(e.message)}</p>`; return; }
  const f=(k,l)=>`<div class="field"><label for="lxR_${k}">${l}</label><input id="lxR_${k}" type="number" min="1" value="${r[k]}"/></div>`;
  el.innerHTML=`<div class="panel"><h2>${svg("settings","ic-sm")} Mastery thresholds</h2><p class="umeta">Changes apply to every class and are recalculated from existing evidence — no answers are lost.</p>
    <div class="pl-limits">${f("pointsPerQuestion","Points per first independent correct answer")}${f("proficientCount","Distinct correct questions for Proficient")}${f("masteredCount","Distinct correct questions for Mastered")}${f("masteredAccuracy","Mastered: minimum recent accuracy (%)")}${f("masteredWindow","Mastered: number of recent first tries")}</div>
    <button class="btn btn-primary" onclick="lxSaveSettings()">${svg("save","ic-sm")} Save rules</button></div>${lxRulesHTML(r)}`;
}
async function lxSaveSettings(){
  const keys=["pointsPerQuestion","proficientCount","masteredCount","masteredAccuracy","masteredWindow"];
  const body=Object.fromEntries(keys.map(k=>[k,Number(document.getElementById("lxR_"+k).value)]));
  try{ await api("learn/settings",{method:"PUT",body:JSON.stringify(body)}); toast("Mastery rules saved"); lxStaffHome(); }catch(e){ toast(e.message); }
}

// Save the position when the tab is hidden or closed.
document.addEventListener("visibilitychange",()=>{ if(document.hidden&&LX.player) lxSaveProgress(true); });

// Student dashboard card.
function lxDashboardCardHTML(ov){
  if(!ov||!ov.classes?.length) return "";
  const c=ov.classes.find(x=>x.continueLesson)||ov.classes[0];
  return `<div class="panel"><h2>${svg("book","ic-sm")} Lessons</h2><div style="display:flex;justify-content:space-between;gap:1rem;align-items:center;flex-wrap:wrap"><div><b>${esc(c.name)}</b><div class="umeta">${c.completed||0} of ${c.total||0} lessons complete</div></div>
    ${c.continueLesson?`<button class="btn btn-primary btn-sm" onclick="lxOpen(${c.continueLesson.lessonId},${c.id})">${svg("play","ic-sm")} Continue learning</button>`:`<button class="btn btn-ghost btn-sm" onclick="go('learn')">Open Lessons</button>`}</div></div>`;
}
