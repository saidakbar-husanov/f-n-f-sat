// ════════════════════════════════════════════════════════════
//  FULL-LENGTH DIGITAL SAT — 1-click file importer, exam tasks,
//  score analytics, the Bluebook-style exam runner and score report.
//  Loaded before the main studio script; it only defines functions and
//  state, and relies on the studio's shared helpers (api, svg, esc, go,
//  crumbs, toast, state, mathText, T…) at call time.
// ════════════════════════════════════════════════════════════

const FT_ICONS={
  upload:'<path d="M12 16V4M7 9l5-5 5 5"/><path d="M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3"/>',
  download:'<path d="M12 4v12M7 11l5 5 5-5"/><path d="M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3"/>',
  eye:'<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  up:'<path d="M12 19V5M6 11l6-6 6 6"/>',
  down:'<path d="M12 5v14M6 13l6 6 6-6"/>',
  minus:'<path d="M5 12h14"/>',
  plus:'<path d="M12 5v14M5 12h14"/>',
  bookmark:'<path d="M6 3h12v18l-6-4-6 4z"/>',
  formula:'<path d="M5 4h14M5 20h14M7 4l6 8-6 8"/>',
  grid:'<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
  chev:'<path d="M6 15l6-6 6 6"/>',
  dots:'<circle cx="5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="19" cy="12" r="1.6"/>',
  chart:'<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
  task:'<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 8h8M8 12h8M8 16h5"/>',
  marker:'<path d="M15 4l5 5-9 9H6v-5z"/><path d="M4 21h9"/>',
};
function ftIcon(name,cls){ return `<svg class="ic ${cls||"ic-sm"}" viewBox="0 0 24 24">${FT_ICONS[name]||""}</svg>`; }
const FT_SECTION_LABEL={ebrw:"Reading and Writing",math:"Math"};
const FT_STATUS={
  Pending:{label:"Not started",cls:"pill-muted"},
  In_Progress:{label:"In progress",cls:"ft-pill-gold"},
  Completed:{label:"Completed",cls:"ft-pill-mint"},
  Completed_Late:{label:"Completed late",cls:"ft-pill-gold"},
  Overdue:{label:"Overdue",cls:"ft-pill-red"},
};
function ftStatusPill(s){ const v=FT_STATUS[s]||{label:s,cls:"pill-muted"}; return `<span class="pill ${v.cls}">${esc(v.label)}</span>`; }
function ftMyId(){ return state.user?.profile?.id; }
function ftDate(v){ try{ return v?new Date(v).toLocaleString([], {dateStyle:"medium",timeStyle:"short"}):"—"; }catch{ return "—"; } }
function ftScore(v){ return v==null?"—":String(v); }

// ──────────────── ADMIN & MENTOR · Tests hub ────────────────
let FT={tab:"tests",tests:[],tasks:[],draft:null,busy:false,analytics:null,anTest:""};

async function viewTestsAdmin(){
  crumbs([{label:"Full-Length Tests"}]); loading();
  try{
    const [rows,tasks]=await Promise.all([api("tests"),api("test-assignments").catch(()=>[])]);
    FT.tests=rows; FT.tasks=tasks;
  }catch(e){ toast(e.message); }
  renderTestsAdmin();
}
function renderTestsAdmin(){
  const admin=state.user.role==="admin";
  const tabs=[["tests","Tests",FT.tests.length],["tasks","Exam tasks",FT.tasks.length],["analytics","Score analytics",null]];
  $c().innerHTML=`<div class="page-head fade"><h1>Full-Length Tests</h1><p>Drop in a test file to publish a complete multi-module Digital SAT in one click, hand it out as a timed exam task, and follow every score${admin?" across the platform":" your students earn"}.</p></div>
    <div class="fade">${ftUploaderHTML()}<div id="ftDraft">${FT.draft?ftDraftHTML():""}</div></div>
    <div class="vb-tabs fade" style="margin-top:1.4rem">${tabs.map(([k,l,n])=>`<button class="${FT.tab===k?"on":""}" onclick="FT_tab('${k}')">${l}${n!=null?` <span class="cnt">${n}</span>`:""}</button>`).join("")}</div>
    <div class="fade" id="ftTab"></div>`;
  renderFtTab();
}
function FT_tab(k){ FT.tab=k; document.querySelectorAll(".vb-tabs button").forEach((b,i)=>b.classList.toggle("on",["tests","tasks","analytics"][i]===k)); renderFtTab(); }
function renderFtTab(){
  const el=document.getElementById("ftTab"); if(!el) return;
  if(FT.tab==="tasks") el.innerHTML=ftTasksHTML();
  else if(FT.tab==="analytics"){ el.innerHTML=`<div class="spin"></div>`; loadFtAnalytics(); }
  else el.innerHTML=ftTestListHTML();
}

function ftTestListHTML(){
  const cards=FT.tests.map(t=>`<div class="panel">
    <h2>${svg("layers","ic-sm")} ${esc(t.title)} <span class="pill ${t.status==="published"?"pill-sec":"pill-muted"}">${t.status}</span>
      ${t.source==="import"?`<span class="pill pill-muted">Imported</span>`:""}${t.isAdaptive?`<span class="pill ft-pill-gold">Adaptive</span>`:""}</h2>
    <div class="umeta">${testShape(t)} · ${esc(testTimingNote(t))} · ${t.attemptCount||0} sitting${(t.attemptCount||0)===1?"":"s"}${t.externalId?` · id <code>${esc(t.externalId)}</code>`:""}</div>
    ${t.description?`<p style="color:var(--ink2);margin-top:.6rem">${esc(t.description)}</p>`:""}
    <div style="display:flex;gap:.6rem;flex-wrap:wrap;margin-top:1rem">
      ${t.status==="published"?`<button class="btn btn-primary btn-sm" onclick="openFtAssign({testId:${t.id}})">${ftIcon("task")} Assign as exam task</button>`:""}
      <button class="btn ${t.status==="published"?"btn-ghost":"btn-primary"} btn-sm" onclick="go('testpreview',{testId:${t.id}})">${ftIcon("eye")} ${t.status==="published"?"Preview":"Preview & publish"}</button>
      <button class="btn btn-ghost btn-sm" onclick="go('testedit',{testId:${t.id}})">${svg("edit","ic-sm")} Edit modules & questions</button>
      <button class="btn btn-ghost btn-sm" onclick="go('testreview',{testId:${t.id}})">${svg("book","ic-sm")} Review & assign questions</button>
      ${canDeleteTest(t)?EXP_buttonHTML({scope:"test",testId:t.id}):""}
      ${canDeleteTest(t)?`<button class="btn btn-danger btn-sm" onclick="deleteTest(${t.id})">${svg("x","ic-sm")} Delete</button>`:""}
    </div></div>`).join("");
  return `${cards||`<div class="empty"><div class="ei">${svg("layers")}</div><p>No full-length tests yet — import a file above.</p></div>`}
    <details class="panel ft-manual"><summary><b>${svg("plus","ic-sm")} Build a test by hand instead</b></summary>
      <div class="field" style="margin-top:1rem"><label>Title</label><input id="ntTitle" placeholder="Practice Test 1"/></div>
      <div class="field"><label>Description</label><textarea id="ntDesc" placeholder="Optional note shown to students before they start"></textarea></div>
      <div class="field"><label>Total time to solve the test (minutes)</label>
        <input id="ntMinutes" type="number" min="1" max="600" value="134"/>
        <p class="mathhint">This is the countdown the student sees. Give an individual module its own minutes later if you want each module timed separately instead.</p></div>
      <button class="btn btn-primary" onclick="createTest()">Create test</button></details>`;
}
// A mentor may manage a test they authored; an admin may manage any of them.
function canDeleteTest(test){ return state.user.role==="admin"||test.createdBy===ftMyId(); }

function ftDownload(name,obj){
  const blob=new Blob([JSON.stringify(obj,null,2)],{type:"application/json"});
  const a=document.createElement("a"); a.href=URL.createObjectURL(blob); a.download=name;
  document.body.appendChild(a); a.click(); setTimeout(()=>{ URL.revokeObjectURL(a.href); a.remove(); },500);
}
async function exportFtTest(id){
  try{ const data=await api(`tests/${id}/export`); ftDownload(`${data.testId||"test-"+id}.json`,data); }
  catch(e){ toast(e.message); }
}

// ──────────────── <FullTestUploader /> ────────────────
// One JSON file in → validated, summarised, saved as a draft → previewed with
// the student renderer → published. Embedded images are decoded and stored by
// the server during validation, so no question needs a separate upload.
const FT_REQUEST_LIMIT=4_500_000; // larger files send their images ahead, one at a time
function ftUploaderHTML(){
  return `<div class="vb-drop ft-drop" id="ftDrop" role="button" tabindex="0"
      ondragover="event.preventDefault();this.classList.add('over')" ondragleave="this.classList.remove('over')"
      ondrop="FTU_drop(event)" onclick="document.getElementById('ftFile').click()" onkeydown="if(event.key==='Enter')document.getElementById('ftFile').click()">
    <div class="vb-drop-ic">${ftIcon("upload","")}</div>
    <div><h3>Import a full-length test</h3>
      <p>Drop one self-contained <b>.json</b> test file. Modules, passages, Markdown tables, embedded images, LaTeX math and grid-ins are read and checked automatically — you review the summary, save a draft, preview it exactly as students will see it, then publish.</p>
      <p class="umeta" style="margin-top:.4rem"><a href="/docs/test-import/README.md" target="_blank" rel="noopener" onclick="event.stopPropagation()">Format guide</a> · <a href="/docs/test-import/sat-test-import.schema.json" target="_blank" rel="noopener" onclick="event.stopPropagation()">JSON Schema</a> · PNG, JPEG, GIF, WebP or SVG images up to 3 MB each</p></div>
    <div class="vb-drop-actions">
      <button type="button" class="btn btn-primary btn-sm" onclick="event.stopPropagation();document.getElementById('ftFile').click()">${ftIcon("upload")} Choose file</button>
      <button type="button" class="btn btn-ghost btn-sm" onclick="event.stopPropagation();FTU_sample(false)">${ftIcon("eye")} Preview example test</button>
      <button type="button" class="btn btn-ghost btn-sm" onclick="event.stopPropagation();FTU_sample(true)">${ftIcon("download")} Example JSON</button>
    </div>
    <input type="file" id="ftFile" accept=".json,.csv,application/json,text/csv" onchange="FTU_file(this.files[0]);this.value=''"/>
  </div>`;
}
function FTU_drop(e){
  e.preventDefault(); document.getElementById("ftDrop")?.classList.remove("over");
  const f=e.dataTransfer?.files?.[0]; if(f) FTU_file(f);
}
async function FTU_sample(download){
  try{
    const data=await api("tests/import/template");
    if(download) ftDownload("example-test.json",data);
    else FTU_preview(data,"example-test.json");
  }catch(e){ toast(e.message); }
}
// RFC-4180-ish CSV: quoted fields, doubled quotes, newlines inside quotes.
function ftParseCsv(text){
  const rows=[]; let row=[], field="", q=false;
  text=text.replace(/^﻿/,"");
  for(let i=0;i<text.length;i++){
    const c=text[i];
    if(q){
      if(c==='"'){ if(text[i+1]==='"'){ field+='"'; i++; } else q=false; }
      else field+=c;
    } else if(c==='"') q=true;
    else if(c===","){ row.push(field); field=""; }
    else if(c==="\n"||c==="\r"){ if(c==="\r"&&text[i+1]==="\n") i++; row.push(field); rows.push(row); row=[]; field=""; }
    else field+=c;
  }
  if(field||row.length){ row.push(field); rows.push(row); }
  const clean=rows.filter(r=>r.some(v=>String(v).trim()));
  if(clean.length<2) return [];
  const head=clean[0].map(h=>h.trim());
  return clean.slice(1).map(r=>Object.fromEntries(head.map((h,i)=>[h,(r[i]??"").trim()]).filter(([h,v])=>h&&v!=="")));
}
function ftDraftStatus(msg){ const el=document.getElementById("ftDraft"); if(el) el.innerHTML=`<div class="ft-progress"><div class="spin"></div><span>${esc(msg)}</span></div>`; }
async function FTU_file(file){
  if(!file) return;
  if(file.size>60*1024*1024){ ftDraftError(["The file is over 60 MB. Keep each image under 3 MB (compress large PNGs or use JPEG/WebP)."]); return; }
  ftDraftStatus(`Reading ${file.name}…`);
  let text;
  try{
    text=typeof file.text==="function"?await file.text():await new Promise((res,rej)=>{ const r=new FileReader(); r.onload=()=>res(String(r.result||"")); r.onerror=rej; r.readAsText(file); });
  }catch{ ftDraftError(["The file could not be read."]); return; }
  let data;
  const isCsv=/\.csv$/i.test(file.name)||(!/^\s*[[{]/.test(text)&&text.includes(","));
  if(isCsv){
    const rows=ftParseCsv(text);
    if(!rows.length){ ftDraftError(["The CSV needs a header row and at least one question row."]); return; }
    const first=rows[0]||{};
    data={testId:first.testId,title:first.title||file.name.replace(/\.csv$/i,""),description:first.description,
      totalTimeMinutes:first.totalTimeMinutes,isAdaptive:first.isAdaptive?/^(1|true|yes)$/i.test(first.isAdaptive):undefined,questions:rows};
  } else {
    try{ data=JSON.parse(text); }catch(e){ ftDraftError([`File — is not valid JSON (${e.message}).`]); return; }
  }
  if(text.length>FT_REQUEST_LIMIT){
    try{ data=await ftOffloadImages(data); }
    catch(e){ ftDraftError([e.message]); return; }
    if(JSON.stringify(data).length>FT_REQUEST_LIMIT*1.25){ ftDraftError(["File — is still too large to send after its images were uploaded. Split very long text or remove unused assets."]); return; }
  }
  FTU_preview(data,file.name);
}
// Files over one request's size send each embedded image to the importer's
// asset endpoint first (same validation, same storage) and reference it by URL.
async function ftOffloadImages(doc){
  const jobs=[]; const cache=new Map();
  const upload=async(mime,b64)=>{
    const k=mime+":"+b64.length+":"+b64.slice(0,64)+b64.slice(-64);
    if(!cache.has(k)) cache.set(k,(async()=>{
      let bin; try{ bin=atob(b64.replace(/\s+/g,"")); }catch{ return null; } // invalid data stays in place for the validator to report
      const bytes=new Uint8Array(bin.length); for(let i=0;i<bin.length;i++) bytes[i]=bin.charCodeAt(i);
      const token=localStorage.getItem(LS.token);
      const r=await fetch("/api/tests/import/asset",{method:"POST",headers:{"content-type":mime,authorization:"Bearer "+token},body:bytes});
      if(!r.ok){ let m="An image could not be uploaded"; try{ m=(await r.json()).error||m; }catch{} return {error:m}; }
      return (await r.json()).url;
    })());
    return cache.get(k);
  };
  const DATA_URI=/data:(image\/[a-z+.-]+);base64,([A-Za-z0-9+/=\s]+)/gi;
  const walk=async(v)=>{
    if(typeof v==="string"){
      if(!v.includes("data:image/")) return v;
      let out=v;
      for(const m of [...v.matchAll(DATA_URI)]){ const url=await upload(m[1],m[2]); if(typeof url==="string") out=out.split(m[0]).join(url); }
      return out;
    }
    if(Array.isArray(v)){ const out=[]; for(const x of v) out.push(await walk(x)); return out; }
    if(v&&typeof v==="object"){ const out={}; for(const [k,x] of Object.entries(v)) out[k]=await walk(x); return out; }
    return v;
  };
  ftDraftStatus("Uploading embedded images…");
  const copy={...doc};
  if(Array.isArray(doc.assets)){
    copy.assets=[];
    for(const a of doc.assets){
      const raw=String(a?.data||""); const m=raw.match(/^data:([^;,]+);base64,(.*)$/s);
      const mime=a?.mimeType||m?.[1]||""; const b64=m?m[2]:raw;
      const url=raw&&mime?await upload(mime,b64):null;
      if(typeof url==="string"){ const {data,...rest}=a; copy.assets.push({...rest,mimeType:mime,url}); }
      else copy.assets.push(a);
    }
  }
  copy.modules=await walk(doc.modules); if(doc.questions) copy.questions=await walk(doc.questions);
  return copy;
}
async function FTU_preview(data,fileName,keep){
  ftDraftStatus("Checking the file and storing its images…");
  try{
    const r=await api("tests/import/preview",{method:"POST",body:JSON.stringify({data,fileName,sourceHash:keep?.sourceHash})});
    if(!r.draft){ ftDraftError(r.errors?.length?r.errors:["The file could not be read."],r.warnings); return; }
    FT.draft={test:r.draft,issues:r.issues||[],summary:r.summary,existing:r.existing,duplicateOf:r.duplicateOf,
      sourceHash:r.sourceHash,fileName,removed:new Set(),modified:!!keep?.modified};
    const el=document.getElementById("ftDraft");
    if(el){ el.innerHTML=ftDraftHTML(); typesetMath(el); if(!keep) el.scrollIntoView({behavior:"smooth",block:"start"}); }
  }catch(e){ ftDraftError(e.data?.errors?.length?e.data.errors:[e.message],e.data?.warnings); }
}
// Re-check the edited draft (e.g. after switching adaptive routing off).
function FTU_revalidate(){ if(!FT.draft) return; const d=FT.draft; FTU_preview(ftDraftPayload(),d.fileName,{sourceHash:d.modified?null:d.sourceHash,modified:d.modified}); }
function ftIssueHTML(i){
  return `<li><b>${esc(i.location)}</b> — ${esc(i.message)}</li>`;
}
function ftDraftError(errors,warnings=[]){
  FT.draft=null;
  const el=document.getElementById("ftDraft"); if(!el) return;
  const li=m=>{ const at=m.indexOf(" — "); return at>0?`<li><b>${esc(m.slice(0,at))}</b>${esc(m.slice(at))}</li>`:`<li>${esc(m)}</li>`; };
  el.innerHTML=`<div class="vb-err"><b>The file could not be imported. Nothing was saved, and existing tests are unchanged.</b><ul>${errors.map(li).join("")}</ul>
    ${warnings?.length?`<details><summary>${warnings.length} note${warnings.length===1?"":"s"}</summary><ul>${warnings.map(li).join("")}</ul></details>`:""}</div>`;
}
const ftQKey=(mi,qi)=>`${mi}:${qi}`;
function ftDraftStats(){
  const d=FT.draft; let qs=0,mods=0,min=0;
  d.test.modules.forEach((m,mi)=>{ const n=m.questions.filter((_,qi)=>!d.removed.has(ftQKey(mi,qi))).length; if(n&&!d.removed.has(`m${mi}`)){ qs+=n; mods+=1; min+=Number(m.timeLimitMinutes)||0; } });
  return {qs,mods,min};
}
function ftSummaryHTML(sum){
  if(!sum) return "";
  const t=sum.totals;
  const cells=[["Sections",sum.sections.length],["Modules",t.modules],["Questions",t.questions],["Multiple choice",t.mcq],["Grid-in (SPR)",t.spr],["Tables",t.tables],["Images",t.images+(t.distinctImages&&t.distinctImages!==t.images?` <span class="umeta">(${t.distinctImages} distinct)</span>`:"")],["Minutes",t.minutes],...(t.vocabulary?[["Vocabulary words",t.vocabulary]]:[])];
  return `<div class="ft-summary">${cells.map(([l,v])=>`<div><b>${v}</b><span>${l}</span></div>`).join("")}</div>
    <div class="ft-table-wrap"><table class="ft-table ft-sumtable"><thead><tr><th>Module</th><th>Section</th><th class="ft-n">Questions</th><th class="ft-n">MCQ</th><th class="ft-n">SPR</th><th class="ft-n">Tables</th><th class="ft-n">Images</th><th class="ft-n">Minutes</th></tr></thead>
    <tbody>${sum.modules.map(m=>`<tr><td><code>${esc(m.moduleId)}</code><div class="umeta">Module ${m.moduleNumber}${m.difficultyTrack?` · ${esc(m.difficultyTrack)}`:""}</div></td><td>${esc(m.section)}</td><td class="ft-n">${m.questions}</td><td class="ft-n">${m.mcq}</td><td class="ft-n">${m.spr}</td><td class="ft-n">${m.tables}</td><td class="ft-n">${m.images}</td><td class="ft-n">${m.timeLimitMinutes}</td></tr>`).join("")}</tbody></table></div>`;
}
function ftDraftHTML(){
  const d=FT.draft, t=d.test, st=ftDraftStats();
  const errors=d.issues.filter(i=>i.level==="error"), warnings=d.issues.filter(i=>i.level==="warning");
  const blocked=errors.length>0||FT.busy;
  const official={ebrw:27,math:22};
  const mods=t.modules.map((m,mi)=>{
    const sec=m.section==="Math"?"math":"ebrw";
    const off=d.removed.has(`m${mi}`);
    const live=m.questions.filter((_,qi)=>!d.removed.has(ftQKey(mi,qi))).length;
    const rows=m.questions.map((q,qi)=>{
      const gone=d.removed.has(ftQKey(mi,qi));
      const ans=q.questionType==="SPR"?[q.correctAnswer,...(q.acceptableAnswers||[])].join(" | "):q.correctAnswer;
      const v=q.visuals||{};
      return `<tr class="${gone?"off":""}">
        <td class="ft-num">${qi+1}</td>
        <td><span class="pill ${q.questionType==="SPR"?"ft-pill-gold":"pill-muted"}">${q.questionType}</span></td>
        <td class="ft-dom"><b>${esc(q.domain)}</b><div class="umeta">${esc(q.skill)}</div><div class="umeta"><code>${esc(q.id)}</code></div></td>
        <td class="ft-prompt">${q.passageText?`<span class="ft-tag">Passage</span>`:""}${v.tables?`<span class="ft-tag">Table${v.tables>1?` ×${v.tables}`:""}</span>`:""}${v.images?`<span class="ft-tag">Image${v.images>1?` ×${v.images}`:""}</span>`:""}<span class="ft-clip">${esc(mathPlain(q.questionPrompt)).slice(0,220)}</span></td>
        <td class="ft-ans">${mathText(ans)}</td>
        <td class="ft-acts">
          <button class="btn btn-ghost btn-xs" title="Preview as students see it" onclick="FTU_previewQ(${mi},${qi})">${ftIcon("eye")}</button>
          <button class="btn btn-ghost btn-xs" title="Move up" onclick="FTU_move(${mi},${qi},-1)" ${qi===0?"disabled":""}>${ftIcon("up")}</button>
          <button class="btn btn-ghost btn-xs" title="Move down" onclick="FTU_move(${mi},${qi},1)" ${qi===m.questions.length-1?"disabled":""}>${ftIcon("down")}</button>
          ${gone?`<button class="btn btn-ghost btn-xs ft-add" title="Include again" onclick="FTU_toggle(${mi},${qi})">${ftIcon("plus")}</button>`
                :`<button class="btn btn-ghost btn-xs ft-rm" title="Remove from the test" onclick="FTU_toggle(${mi},${qi})">${ftIcon("minus")}</button>`}
        </td></tr>`;
    }).join("");
    return `<details class="ft-mod ${off?"off":""}">
      <summary class="ft-mod-head">
        <div><div class="ft-mod-key">${esc(m.moduleId)}</div><h3>${esc(m.title)}</h3>
          <div class="umeta">${esc(m.section)} · Module ${m.moduleNumber}${m.difficultyTrack?` · ${esc(m.difficultyTrack)} track`:""} · ${live} question${live===1?"":"s"} (official ${official[sec]}) · ${m.timeLimitMinutes} min</div></div>
        <label class="ft-min" onclick="event.stopPropagation()">Minutes<input type="number" min="1" max="600" value="${m.timeLimitMinutes}" onchange="FT.draft.test.modules[${mi}].timeLimitMinutes=Math.max(1,Number(this.value)||1);FT.draft.modified=true;FTU_refreshStats()"/></label>
        <button class="btn btn-ghost btn-xs" onclick="event.preventDefault();FTU_toggleModule(${mi})">${off?`${ftIcon("plus")} Include module`:`${ftIcon("minus")} Drop module`}</button>
      </summary>
      ${off?"":`<div class="ft-table-wrap"><table class="ft-table"><thead><tr><th>#</th><th>Type</th><th>Domain · skill · id</th><th>Question</th><th>Answer</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>`}
    </details>`;
  }).join("");
  return `<div class="vb-upload ft-upload">
    <div class="vb-upload-head">
      <div style="flex:1;min-width:240px">
        <div class="umeta">${esc(d.fileName||"Uploaded file")} · ${errors.length?"fix the problems below, then upload the file again":"checked — review, then save"}</div>
        <div class="f-row" style="margin-top:.6rem">
          <div class="field"><label>Title</label><input value="${esc(t.title)}" oninput="FT.draft.test.title=this.value"/></div>
          <div class="field"><label>Test id</label><input value="${esc(t.testId)}" oninput="FT.draft.test.testId=this.value.trim()" onchange="FTU_revalidate()"/></div>
        </div>
        <div class="field"><label>Description</label><input value="${esc(t.description||"")}" oninput="FT.draft.test.description=this.value"/></div>
        <label class="ft-check"><input type="checkbox" ${t.isAdaptive?"checked":""} onchange="FT.draft.test.isAdaptive=this.checked;FT.draft.modified=true;FTU_revalidate()"/> Adaptive — route each student to the Easy / Standard / Hard Module 2 their Module 1 result earns (unticked = fixed-form)</label>
      </div>
      <div class="ft-stats" id="ftStats">${ftStatsHTML(st)}</div>
    </div>
    ${ftSummaryHTML(d.summary)}
    ${errors.length?`<div class="vb-err ft-errs"><b>${errors.length} problem${errors.length===1?"":"s"} must be fixed before this test can be saved.</b> Nothing has been saved and existing tests are unchanged.<ul>${errors.slice(0,200).map(ftIssueHTML).join("")}</ul>${errors.length>200?`<p class="umeta">…and ${errors.length-200} more.</p>`:""}</div>`:""}
    ${d.duplicateOf?`<div class="ft-note">This exact file was already imported as “${esc(d.duplicateOf.title)}” (${esc(d.duplicateOf.status)}). Saving again only creates a separate copy if you confirm it; the existing test is never overwritten. <button class="btn btn-ghost btn-xs" onclick="go('testpreview',{testId:${d.duplicateOf.id}})">${ftIcon("eye")} Open it</button></div>`
      :d.existing?`<div class="ft-note">A test with the id <code>${esc(t.testId)}</code> already exists (“${esc(d.existing.title)}”, ${esc(d.existing.status)}). It will not be overwritten: change the id above, or save this file as a separate draft copy. <button class="btn btn-ghost btn-xs" onclick="go('testpreview',{testId:${d.existing.id}})">${ftIcon("eye")} Open existing</button></div>`:""}
    ${warnings.length?`<details class="ft-warn"><summary>${warnings.length} note${warnings.length===1?"":"s"} (these do not block the import)</summary><ul>${warnings.map(ftIssueHTML).join("")}</ul></details>`:""}
    ${mods}
    <div class="vb-actions">
      <button class="btn btn-primary" onclick="FTU_commit('draft')" ${blocked?"disabled":""}>${svg("save","ic-sm")} Save as draft &amp; preview</button>
      <button class="btn btn-ghost" onclick="FTU_commit('published')" ${blocked?"disabled":""}>${svg("check","ic-sm")} Save &amp; publish now</button>
      <button class="btn btn-ghost" onclick="FTU_commit('published',true)" ${blocked?"disabled":""}>${ftIcon("task")} Publish &amp; assign as exam task</button>
      <span class="spacer" style="flex:1"></span>
      <button class="btn btn-ghost btn-sm" onclick="FTU_discard()">${svg("x","ic-sm")} Discard</button>
    </div>
  </div>`;
}
function ftStatsHTML(st){
  return `<div><b>${st.mods}</b><span>modules</span></div><div><b>${st.qs}</b><span>questions</span></div><div><b>${st.min}</b><span>minutes</span></div>`;
}
function FTU_refreshStats(){ const el=document.getElementById("ftStats"); if(el) el.innerHTML=ftStatsHTML(ftDraftStats()); }
function FTU_rerender(){ const el=document.getElementById("ftDraft"); if(el&&FT.draft){ const open=[...el.querySelectorAll("details.ft-mod")].map(x=>x.open); el.innerHTML=ftDraftHTML(); el.querySelectorAll("details.ft-mod").forEach((x,i)=>{ if(open[i]) x.open=true; }); typesetMath(el); } }
function FTU_toggle(mi,qi){ const k=ftQKey(mi,qi), r=FT.draft.removed; if(r.has(k)) r.delete(k); else r.add(k); FT.draft.modified=true; FTU_rerender(); }
function FTU_toggleModule(mi){ const r=FT.draft.removed, k=`m${mi}`; if(r.has(k)) r.delete(k); else r.add(k); FT.draft.modified=true; FTU_rerender(); }
function FTU_move(mi,qi,dir){
  const d=FT.draft, list=d.test.modules[mi].questions, j=qi+dir;
  if(j<0||j>=list.length) return;
  [list[qi],list[j]]=[list[j],list[qi]];
  const a=d.removed.has(ftQKey(mi,qi)), b=d.removed.has(ftQKey(mi,j));
  d.removed.delete(ftQKey(mi,qi)); d.removed.delete(ftQKey(mi,j));
  if(a) d.removed.add(ftQKey(mi,j)); if(b) d.removed.add(ftQKey(mi,qi));
  d.modified=true;
  FTU_rerender();
}
function FTU_discard(){ FT.draft=null; const el=document.getElementById("ftDraft"); if(el) el.innerHTML=""; }
function ftDraftPayload(){
  const d=FT.draft, t=JSON.parse(JSON.stringify(d.test));
  t.modules=t.modules.map((m,mi)=>d.removed.has(`m${mi}`)?null:{...m,questions:m.questions.filter((_,qi)=>!d.removed.has(ftQKey(mi,qi))).map((q,i)=>({...q,questionNumber:i+1}))})
    .filter(m=>m&&m.questions.length);
  t.totalTimeMinutes=t.modules.reduce((n,m)=>n+(Number(m.timeLimitMinutes)||0),0);
  return t;
}
async function FTU_commit(status,assign=false,asCopy=false){
  if(!FT.draft||FT.busy) return;
  const payload=ftDraftPayload();
  if(!payload.modules.length){ toast("Keep at least one question in the test."); return; }
  if(!payload.title.trim()){ toast("Enter a test title."); return; }
  FT.busy=true; FTU_rerender();
  try{
    const d=FT.draft;
    const r=await api("tests/import",{method:"POST",body:JSON.stringify({data:payload,status,asCopy,fileName:d.fileName,sourceHash:d.modified?null:d.sourceHash})});
    FT.busy=false; FT.draft=null;
    if(status==="published"&&r.test.status!=="published"){
      toast(`Saved as a draft — it cannot be published yet: ${r.problems?.[0]||"see the preview"}`);
      return go("testpreview",{testId:r.test.id});
    }
    const v=r.vocabulary, vn=v?` · vocabulary: ${v.created} added, ${v.updated} updated${v.skipped?`, ${v.skipped} left unchanged (another author's)`:""}`:"";
    toast((status==="draft"?"Draft saved — preview it, then publish":"Full-length test published")+vn);
    if(assign){ await viewTestsAdmin(); return openFtAssign({testId:r.test.id}); }
    go("testpreview",{testId:r.test.id});
  }catch(e){
    FT.busy=false; FTU_rerender();
    if(e.status===409&&(e.data?.conflict||e.data?.duplicate)){
      if(confirm(`${e.message}\n\nSave this file as a separate draft copy instead? (The existing test stays exactly as it is.)`)) return FTU_commit(status,assign,true);
      return;
    }
    if(e.data?.issues){ FT.draft.issues=e.data.issues; FTU_rerender(); }
    toast(e.message);
  }
}
function ftSvgUrl(svgText){ return /^data:/i.test(svgText)?svgText:"data:image/svg+xml;charset=utf-8,"+encodeURIComponent(svgText); }
function ftDraftToQ(nq,section){
  const mcq=nq.questionType==="MCQ";
  return {id:nq.id,section,category:nq.domain,subcategory:nq.skill,type:mcq?"mcq":"spr",
    passage:nq.passageText,prompt:nq.questionPrompt,questionImage:nq.imageUrl||null,
    choices:mcq?Object.fromEntries(nq.options.map(o=>[o.id,o.text])):null,
    choiceImages:mcq?Object.fromEntries(nq.options.filter(o=>o.imageUrl).map(o=>[o.id,o.imageUrl])):null,
    answer:nq.correctAnswer,acceptableAnswers:nq.acceptableAnswers,explanation:nq.explanation};
}
// Answer key + explanation, shown only in admin / mentor previews.
function ftKeyHTML(q){
  return `<div class="explain bb-explain" style="margin-top:1rem"><h4>Correct answer: ${mathText(q.answer)}${q.acceptableAnswers?.length?` <span class="umeta">(also accepts ${q.acceptableAnswers.map(a=>esc(a)).join(", ")})</span>`:""}</h4>${mathText(q.explanation||"No explanation in the file.")}</div>`;
}
function FTU_previewQ(mi,qi){
  const m=FT.draft.test.modules[mi], sec=m.section==="Math"?"math":"ebrw";
  const q=ftDraftToQ(m.questions[qi],sec);
  ftModal(`${esc(m.title)} · Question ${qi+1}`,`<div class="bb bb-inline">${ftWorkspaceHTML(q,{num:qi+1,preview:true,section:sec})}</div>${ftKeyHTML(q)}`,{wide:true});
}

// ──────────────── Saved-test preview & publish ────────────────
// The persisted test, rendered question by question with the student runner's
// own workspace, plus the answer key and the server's publish checks.
let FP=null;
async function viewTestPreview(){
  if(!state.testId) return go("tests");
  crumbs([{label:"Full-Length Tests",onclick:"go('tests')"},{label:"Preview test"}]); loading();
  try{
    const [test,integrity]=await Promise.all([api("tests/"+state.testId),api(`tests/${state.testId}/integrity`)]);
    FP={test,integrity,mi:0,qi:0};
  }catch(e){ toast(e.message); return go("tests"); }
  renderTestPreview();
}
function renderTestPreview(){
  const {test:t,integrity:ig}=FP;
  const total=t.modules.reduce((n,m)=>n+m.questions.length,0);
  const mod=t.modules[FP.mi], q=mod?.questions[FP.qi];
  const problems=ig.problems||[];
  const draft=t.status!=="published";
  const tabs=t.modules.map((m,i)=>`<button class="${i===FP.mi?"on":""}" onclick="FP_go(${i},0)">${esc(m.title)} <span class="cnt">${m.questions.length}</span></button>`).join("");
  const grid=mod?mod.questions.map((x,i)=>`<button class="ft-pgrid-b ${i===FP.qi?"on":""}" onclick="FP_go(${FP.mi},${i})" title="${esc(x.externalId||"")}">${i+1}</button>`).join(""):"";
  $c().innerHTML=`<div class="page-head fade"><h1>${esc(t.title)} <span class="pill ${draft?"pill-muted":"pill-sec"}">${esc(t.status)}</span></h1>
      <p>${t.modules.length} module${t.modules.length===1?"":"s"} · ${total} questions · ${esc(testTimingNote(t))}${t.isAdaptive?" · adaptive":" · fixed-form"}${t.externalId?` · id <code>${esc(t.externalId)}</code>`:""}</p></div>
    <div class="panel fade">
      ${problems.length?`<div class="vb-err"><b>${problems.length} problem${problems.length===1?"":"s"} must be fixed before publishing.</b><ul>${problems.map(p=>`<li>${esc(p)}</li>`).join("")}</ul></div>`
        :`<div class="ft-ok">${svg("check","ic-sm")} All publish checks pass: every module has questions, every answer key matches its choices and every image is stored.</div>`}
      <div style="display:flex;gap:.6rem;flex-wrap:wrap;margin-top:1rem">
        ${draft?`<button class="btn btn-primary" onclick="FP_publish()" ${problems.length?"disabled":""}>${svg("check","ic-sm")} Publish to students</button>`:""}
        ${!draft?`<button class="btn btn-primary" onclick="openFtAssign({testId:${t.id}})">${ftIcon("task")} Assign as exam task</button>`:""}
        <button class="btn btn-ghost" onclick="go('testedit',{testId:${t.id}})">${svg("edit","ic-sm")} Edit modules &amp; questions</button>
        <button class="btn btn-ghost" onclick="FP_integrity()">${ftIcon("grid")} Integrity report</button>
        <button class="btn btn-ghost" onclick="go('tests')">Back to tests</button>
      </div>
      <div class="umeta" style="margin-top:.6rem">${draft?"Drafts are hidden from students. ":""}Questions below are drawn with the same renderer as the student test; the answer key is shown only here.</div>
    </div>
    <div class="vb-tabs fade" style="margin-top:1rem">${tabs}</div>
    <div class="panel fade">
      ${mod?`<div class="umeta">${esc(SECTIONS[mod.section]?.label||mod.section)} · Module ${mod.moduleNumber??FP.mi+1}${mod.difficultyTrack?` · ${esc(mod.difficultyTrack)}`:""} · ${mod.timeLimitMinutes?`${mod.timeLimitMinutes} min`:"shared clock"}</div>
        <div class="ft-pgrid">${grid}</div>`:""}
      ${q?`<div class="umeta" style="margin:.6rem 0">Question ${FP.qi+1} of ${mod.questions.length}${q.externalId?` · <code>${esc(q.externalId)}</code>`:""} · ${esc(q.category)}${q.subcategory?` · ${esc(q.subcategory)}`:""}</div>
        <div class="bb bb-inline" id="fpWork">${ftWorkspaceHTML(q,{num:FP.qi+1,preview:true,section:mod.section})}</div>${ftKeyHTML(q)}
        <div style="display:flex;gap:.6rem;margin-top:1rem"><button class="btn btn-ghost btn-sm" onclick="FP_step(-1)">← Previous</button><button class="btn btn-ghost btn-sm" onclick="FP_step(1)">Next →</button></div>`
        :`<p class="umeta">This module has no questions.</p>`}
    </div>`;
  typesetMath($c());
}
function FP_go(mi,qi){ FP.mi=mi; FP.qi=qi; renderTestPreview(); }
function FP_step(dir){
  const mods=FP.test.modules; let {mi,qi}=FP; qi+=dir;
  if(qi<0){ if(mi>0){ mi-=1; qi=mods[mi].questions.length-1; } else qi=0; }
  else if(qi>=mods[mi].questions.length){ if(mi<mods.length-1){ mi+=1; qi=0; } else qi-=1; }
  FP_go(mi,Math.max(0,qi));
}
async function FP_publish(){
  if(!confirm("Publish this test? Students will be able to open it.")) return;
  try{ await api(`tests/${FP.test.id}/publish`,{method:"POST",body:"{}"}); toast("Test published"); viewTestPreview(); }
  catch(e){ toast(e.message); if(e.data?.problems){ FP.integrity.problems=e.data.problems; renderTestPreview(); } }
}
function FP_integrity(){
  const ig=FP.integrity;
  const rows=ig.modules.map(m=>`<details class="ft-mod"><summary class="ft-mod-head"><div><div class="ft-mod-key">${esc(m.moduleId||"")}</div><h3>${esc(m.title)}</h3>
    <div class="umeta">${esc(m.section)} · Module ${m.moduleNumber??"—"}${m.difficultyTrack?` · ${esc(m.difficultyTrack)}`:""} · ${m.questionCount} questions · ${m.timeLimitMinutes??"—"} min</div></div></summary>
    <div class="ft-table-wrap"><table class="ft-table"><thead><tr><th>#</th><th>Source id</th><th>Type</th><th>Options</th><th>Key</th><th class="ft-n">Tables</th><th class="ft-n">Images</th></tr></thead><tbody>
    ${m.questions.map(q=>`<tr><td class="ft-num">${q.position}</td><td><code>${esc(q.id||"—")}</code></td><td>${q.type.toUpperCase()}</td><td>${esc(q.optionIds.join(" "))||"—"}</td><td class="ft-ans">${esc([q.answer,...q.acceptableAnswers].join(" | "))}</td><td class="ft-n">${q.tables}</td><td class="ft-n">${q.images}</td></tr>`).join("")}
    </tbody></table></div></details>`).join("");
  ftModal("Integrity report",`<p class="umeta">What is stored for this test, to compare against the source file.</p>${rows}`,{wide:true});
}

// ──────────────── Modal helper ────────────────
function ftModal(title,body,opts={}){
  ftCloseModal();
  const el=document.createElement("div");
  el.className="ft-modal-back"; el.id="ftModal";
  el.onclick=e=>{ if(e.target===el) ftCloseModal(); };
  el.innerHTML=`<div class="ft-modal ${opts.wide?"wide":""}" role="dialog" aria-modal="true">
    <div class="ft-modal-head"><h3>${title}</h3><button class="btn btn-ghost btn-xs" onclick="ftCloseModal()" aria-label="Close">${svg("x","ic-sm")}</button></div>
    <div class="ft-modal-body">${body}</div>${opts.foot?`<div class="ft-modal-foot">${opts.foot}</div>`:""}</div>`;
  document.body.appendChild(el);
  typesetMath(el);
  return el;
}
function ftCloseModal(){ document.getElementById("ftModal")?.remove(); }
document.addEventListener("keydown",e=>{ if(e.key==="Escape"&&document.getElementById("ftModal")) ftCloseModal(); });

// ──────────────── Exam tasks (assign) ────────────────
let FA=null;
async function openFtAssign({testId=null,taskId=null}={}){
  const task=taskId?FT.tasks.find(t=>t.id===taskId):null;
  let targets={classes:[],students:[]};
  try{ targets=await api("vocab/targets"); }catch(e){ toast(e.message); }
  const due=new Date(Date.now()+7*864e5); due.setHours(23,59,0,0);
  FA={
    taskId, testId:task?task.testId:(testId||FT.tests[0]?.id||null), targets,
    title:task?.title||"", instructions:task?.instructions||"",
    dueAt:task?new Date(task.dueAt):due, allowPause:task?task.allowPause:false,
    classIds:new Set(task?.classIds||[]), studentIds:new Set(task?.studentIds||[]), allStudents:!!task?.allStudents,
    moduleIds:new Set(task?.moduleIds||[]), modules:[], q:"",
  };
  await FA_loadModules();
  renderFtAssign();
}
async function FA_loadModules(){
  FA.modules=[];
  if(!FA.testId) return;
  try{ const t=await api("tests/"+FA.testId); FA.modules=t.modules||[]; if(!FA.title&&!FA.taskId) FA.title=t.title; }catch{}
}
function ftLocalInput(d){ const p=n=>String(n).padStart(2,"0"); return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`; }
function renderFtAssign(){
  const admin=state.user.role==="admin", editing=!!FA.taskId;
  const term=FA.q.trim().toLowerCase();
  const students=FA.targets.students.filter(s=>!term||[s.displayName,s.username,s.email].some(v=>String(v||"").toLowerCase().includes(term)));
  const body=`
    <div class="field"><label>Test</label><select ${editing?"disabled":""} onchange="FA.testId=Number(this.value);FA.moduleIds.clear();FA.title='';FA_loadModules().then(renderFtAssign)">
      ${FT.tests.map(t=>`<option value="${t.id}" ${t.id===FA.testId?"selected":""}>${esc(t.title)}${t.status!=="published"?" (draft — assigning publishes it)":""}</option>`).join("")}</select></div>
    <div class="f-row">
      <div class="field"><label>Task title</label><input value="${esc(FA.title)}" oninput="FA.title=this.value"/></div>
      <div class="field"><label>Due</label><input type="datetime-local" value="${ftLocalInput(FA.dueAt)}" onchange="FA.dueAt=new Date(this.value)"/></div>
    </div>
    <div class="field"><label>Instructions (optional)</label><input value="${esc(FA.instructions)}" placeholder="e.g. Sit this in one go, in a quiet room." oninput="FA.instructions=this.value"/></div>
    <div class="field"><label>What to sit</label>
      <div class="ft-chips">
        <button type="button" class="ft-chip ${FA.moduleIds.size===0?"on":""}" onclick="FA.moduleIds.clear();renderFtAssign()">Full test</button>
        ${FA.modules.map(m=>`<button type="button" class="ft-chip ${FA.moduleIds.has(m.id)?"on":""}" onclick="FA_toggleMod(${m.id})">${esc(m.title)}${m.timeLimitMinutes?` · ${m.timeLimitMinutes}m`:""}</button>`).join("")}
      </div><p class="mathhint">Pick single modules to assign them as a shorter timed task.</p></div>
    <label class="ft-check"><input type="checkbox" ${FA.allowPause?"checked":""} onchange="FA.allowPause=this.checked"/> Practice mode — students may pause and resume the clock</label>
    <div class="field" style="margin-top:1rem"><label>Assign to</label>
      ${admin?`<label class="ft-check"><input type="checkbox" ${FA.allStudents?"checked":""} onchange="FA.allStudents=this.checked;renderFtAssign()"/> Every student on the platform</label>`:""}
      ${FA.allStudents?"":`
      <div class="ft-chips" style="margin-top:.5rem">${FA.targets.classes.map(c=>`<button type="button" class="ft-chip ${FA.classIds.has(c.id)?"on":""}" onclick="FA_toggle('classIds',${c.id})">${svg("users","ic-sm")} ${esc(c.name)} · ${c.studentIds.length}</button>`).join("")||`<span class="umeta">No classes yet.</span>`}</div>
      <input class="ft-search" placeholder="Search students…" value="${esc(FA.q)}" oninput="FA.q=this.value;FA_renderStudents()"/>
      <div class="ft-students" id="faStudents">${ftStudentPicks(students)}</div>`}
    </div>`;
  ftModal(editing?"Edit exam task":"Assign as exam task",body,{foot:`<span class="umeta" id="faCount">${FA_countText()}</span><span style="flex:1"></span>
    <button class="btn btn-ghost" onclick="ftCloseModal()">Cancel</button>
    <button class="btn btn-primary" onclick="saveFtAssign()">${svg("check","ic-sm")} ${editing?"Save changes":"Assign exam"}</button>`});
}
function ftStudentPicks(list){
  return list.map(s=>`<label class="ft-stu"><input type="checkbox" ${FA.studentIds.has(s.id)?"checked":""} onchange="FA_toggle('studentIds',${s.id},true)"/> <span>${esc(s.displayName)}</span><span class="umeta">${esc(s.username||s.email||"")}</span></label>`).join("")||`<p class="umeta">No students match.</p>`;
}
function FA_renderStudents(){
  const term=FA.q.trim().toLowerCase();
  const el=document.getElementById("faStudents");
  if(el) el.innerHTML=ftStudentPicks(FA.targets.students.filter(s=>!term||[s.displayName,s.username,s.email].some(v=>String(v||"").toLowerCase().includes(term))));
}
function FA_countText(){
  if(FA.allStudents) return "Every student";
  const ids=new Set(FA.studentIds);
  FA.targets.classes.filter(c=>FA.classIds.has(c.id)).forEach(c=>c.studentIds.forEach(id=>ids.add(id)));
  return `${ids.size} student${ids.size===1?"":"s"} selected`;
}
function FA_toggle(key,id,quiet){ const s=FA[key]; if(s.has(id)) s.delete(id); else s.add(id); if(quiet){ const c=document.getElementById("faCount"); if(c) c.textContent=FA_countText(); } else renderFtAssign(); }
function FA_toggleMod(id){ if(FA.moduleIds.has(id)) FA.moduleIds.delete(id); else FA.moduleIds.add(id); if(FA.moduleIds.size===FA.modules.length) FA.moduleIds.clear(); renderFtAssign(); }
async function saveFtAssign(){
  if(!FA.testId){ toast("Choose a test"); return; }
  if(!FA.dueAt||isNaN(FA.dueAt.getTime())){ toast("Choose a due date"); return; }
  const payload={testId:FA.testId,title:FA.title.trim(),instructions:FA.instructions.trim(),dueAt:FA.dueAt.toISOString(),
    allowPause:FA.allowPause,allStudents:FA.allStudents,classIds:[...FA.classIds],studentIds:[...FA.studentIds],moduleIds:[...FA.moduleIds]};
  try{
    await api(FA.taskId?`test-assignments/${FA.taskId}`:"test-assignments",{method:FA.taskId?"PUT":"POST",body:JSON.stringify(payload)});
    toast(FA.taskId?"Exam task updated":"Exam assigned");
    ftCloseModal(); FT.tab="tasks"; viewTestsAdmin();
  }catch(e){ toast(e.message); }
}
async function deleteFtTask(id){
  if(!confirm("Delete this exam task? Sittings already taken stay on each student's record as practice.")) return;
  try{ await api(`test-assignments/${id}`,{method:"DELETE"}); toast("Exam task deleted"); viewTestsAdmin(); }
  catch(e){ toast(e.message); }
}
function ftTasksHTML(){
  const admin=state.user.role==="admin";
  const rows=FT.tasks.map(t=>{
    const pct=t.audienceCount?Math.round(t.completedCount/t.audienceCount*100):0;
    const overdue=new Date(t.dueAt).getTime()<Date.now();
    return `<div class="panel ft-task">
      <div class="ft-task-head"><div>
        <h2>${ftIcon("task")} ${esc(t.title)}</h2>
        <div class="umeta">${esc(t.testTitle)} · ${t.moduleIds.length?t.modules.map(m=>esc(m.title)).join(", "):"Full test"} · ${t.allowPause?"pausing allowed":"no pausing"}${admin?` · assigned by ${esc(t.assignedByName)}`:""}</div>
      </div><span class="pill ${overdue?"ft-pill-red":"pill-muted"}">${overdue?"Closed":"Due"} ${esc(ftDate(t.dueAt))}</span></div>
      <div class="ft-progress"><i style="width:${pct}%"></i></div>
      <div class="umeta">${t.completedCount} of ${t.audienceCount} student${t.audienceCount===1?"":"s"} completed</div>
      <div style="display:flex;gap:.6rem;flex-wrap:wrap;margin-top:.9rem">
        <button class="btn btn-primary btn-sm" onclick="openFtReport(${t.id})">${ftIcon("chart")} Scores & error breakdown</button>
        ${t.canManage?`<button class="btn btn-ghost btn-sm" onclick="openFtAssign({taskId:${t.id}})">${svg("edit","ic-sm")} Edit</button>
        <button class="btn btn-danger btn-sm" onclick="deleteFtTask(${t.id})">${svg("trash","ic-sm")} Delete</button>`:""}
      </div></div>`;
  }).join("");
  return rows||`<div class="empty"><div class="ei">${ftIcon("task","")}</div><h3>No exam tasks yet</h3><p>Use “Assign as exam task” on any test to hand it out with a due date.</p></div>`;
}

// Per-student score & error-domain report for one exam task.
async function openFtReport(id){
  ftModal("Exam task report",`<div class="spin"></div>`,{wide:true});
  let r; try{ r=await api(`test-assignments/${id}/report`); }catch(e){ ftCloseModal(); toast(e.message); return; }
  const done=r.students.filter(s=>s.report);
  const agg=ftAggregateDomains(done.map(s=>s.report.domains));
  const avg=k=>{ const v=done.map(s=>s.report[k]).filter(x=>x!=null); return v.length?Math.round(v.reduce((a,b)=>a+b,0)/v.length/10)*10:null; };
  const rows=r.students.map((s,i)=>`<tr class="ft-click" onclick="FT_toggleRow(${i})">
      <td><b>${esc(s.student.displayName)}</b><div class="umeta">${esc(s.student.username||s.student.email||"")}</div></td>
      <td>${ftStatusPill(s.status)}</td>
      <td class="ft-n"><b>${ftScore(s.report?.totalScaled)}</b></td>
      <td class="ft-n">${ftScore(s.report?.rwScaled)}</td>
      <td class="ft-n">${ftScore(s.report?.mathScaled)}</td>
      <td class="ft-n">${s.report?`${s.report.correctCount}/${s.report.totalCount}`:"—"}</td>
      <td>${s.attemptId&&s.submittedAt?`<button class="btn btn-ghost btn-xs" onclick="event.stopPropagation();ftCloseModal();go('testsit',{attemptId:${s.attemptId}})">${svg("book","ic-sm")} Review</button>`:""}</td>
    </tr>
    <tr class="ft-detail" id="ftRow${i}" hidden><td colspan="7">${s.report?ftDomainBarsHTML(s.report.domains,true):`<span class="umeta">No completed sitting yet.</span>`}</td></tr>`).join("");
  const m=document.querySelector("#ftModal .ft-modal-body");
  document.querySelector("#ftModal .ft-modal-head h3").textContent=r.assignment.title;
  m.innerHTML=`<div class="umeta">${esc(r.test?.title||"")} · ${r.assignment.moduleIds.length?r.modules.map(x=>esc(x.title)).join(", "):"Full test"} · due ${esc(ftDate(r.assignment.dueAt))}</div>
    <div class="ft-tiles">
      <div><span>Completed</span><b>${done.length}/${r.students.length}</b></div>
      <div><span>Avg total</span><b>${ftScore(avg("totalScaled"))}</b></div>
      <div><span>Avg R&amp;W</span><b>${ftScore(avg("rwScaled"))}</b></div>
      <div><span>Avg Math</span><b>${ftScore(avg("mathScaled"))}</b></div>
    </div>
    <h4 class="ft-h4">Error breakdown by domain · all completed sittings</h4>
    ${agg.length?ftDomainBarsHTML(agg,true):`<p class="umeta">Domain results appear once students finish.</p>`}
    <h4 class="ft-h4">Students <span class="umeta">— click a row for that student's domain breakdown</span></h4>
    <div class="ft-table-wrap"><table class="ft-table"><thead><tr><th>Student</th><th>Status</th><th>Total</th><th>R&amp;W</th><th>Math</th><th>Raw</th><th></th></tr></thead><tbody>${rows||`<tr><td colspan="7" class="umeta">Nobody is assigned yet.</td></tr>`}</tbody></table></div>`;
}
function FT_toggleRow(i){ const el=document.getElementById("ftRow"+i); if(el) el.hidden=!el.hidden; }
function ftAggregateDomains(lists){
  const map=new Map();
  lists.flat().forEach(d=>{ const k=d.section+"|"+d.domain; const v=map.get(k)||{section:d.section,domain:d.domain,correct:0,total:0}; v.correct+=d.correct; v.total+=d.total; map.set(k,v); });
  return [...map.values()];
}
// One row per domain: accuracy bar plus the number of questions missed.
function ftDomainBarsHTML(domains,showMissed){
  const list=[...domains].sort((a,b)=>a.section===b.section?(a.correct/a.total)-(b.correct/b.total):a.section==="ebrw"?-1:1);
  return `<div class="ft-dbars">${list.map(d=>{
    const pct=d.total?Math.round(d.correct/d.total*100):0;
    const tone=pct>=80?"good":pct>=55?"mid":"low";
    return `<div class="ft-dbar"><div class="ft-dbar-lbl"><b>${esc(d.domain)}</b><span>${esc(FT_SECTION_LABEL[d.section]||d.section)}</span></div>
      <div class="ft-dbar-track"><i class="${tone}" style="width:${pct}%"></i></div>
      <div class="ft-dbar-val">${pct}%<span>${d.correct}/${d.total}${showMissed&&d.total-d.correct?` · ${d.total-d.correct} missed`:""}</span></div></div>`;
  }).join("")}</div>`;
}

// ──────────────── Score analytics ────────────────
async function loadFtAnalytics(){
  const el=document.getElementById("ftTab"); if(!el) return;
  let r; try{ r=await api("test-analytics"+(FT.anTest?`?testId=${FT.anTest}`:"")); }catch(e){ el.innerHTML=`<div class="vb-err">${esc(e.message)}</div>`; return; }
  FT.analytics=r;
  const admin=state.user.role==="admin";
  const rows=r.attempts;
  const totals=rows.map(a=>a.totalScaled).filter(v=>v!=null);
  const mean=v=>v.length?Math.round(v.reduce((a,b)=>a+b,0)/v.length/10)*10:null;
  const bins=[]; for(let lo=400;lo<1600;lo+=100) bins.push({lo,hi:lo+100,n:0});
  totals.forEach(v=>{ const b=bins[Math.min(bins.length-1,Math.floor((v-400)/100))]; if(b) b.n++; });
  const maxN=Math.max(1,...bins.map(b=>b.n));
  const agg=ftAggregateDomains(rows.map(a=>a.domains||[]));
  // Latest sitting per student and test, for the per-student table.
  const seen=new Set(), latest=rows.filter(a=>{ const k=a.student.id+":"+a.testId; if(seen.has(k)) return false; seen.add(k); return true; });
  el.innerHTML=`<div class="panel">
    <div class="ft-an-head"><h2>${ftIcon("chart")} ${admin?"Platform-wide score distribution":"Your students' scores"}</h2>
      <select onchange="FT.anTest=this.value;renderFtTab()"><option value="">All tests</option>${FT.tests.map(t=>`<option value="${t.id}" ${String(t.id)===String(FT.anTest)?"selected":""}>${esc(t.title)}</option>`).join("")}</select></div>
    <div class="ft-tiles">
      <div><span>Completed sittings</span><b>${rows.length}</b></div>
      <div><span>Avg total</span><b>${ftScore(mean(totals))}</b></div>
      <div><span>Avg R&amp;W</span><b>${ftScore(mean(rows.map(a=>a.rwScaled).filter(v=>v!=null)))}</b></div>
      <div><span>Avg Math</span><b>${ftScore(mean(rows.map(a=>a.mathScaled).filter(v=>v!=null)))}</b></div>
    </div>
    ${totals.length?`<div class="ft-hist" role="img" aria-label="Distribution of total scores">${bins.map(b=>`<div class="ft-hcol" title="${b.lo}–${b.hi-10}: ${b.n} sitting${b.n===1?"":"s"}"><span class="ft-hn">${b.n||""}</span><i style="height:${Math.round(b.n/maxN*100)}%"></i><span class="ft-hl">${b.lo}</span></div>`).join("")}</div>
      <p class="umeta" style="margin-top:.4rem">Total scores (400–1600) of sittings that covered both sections, in bands of 100.</p>`
      :`<p class="umeta" style="margin-top:1rem">No full two-section sittings yet — the distribution appears once students finish a full-length test.</p>`}
  </div>
  <div class="panel"><h2>${svg("target","ic-sm")} Error breakdown by domain</h2>${agg.length?ftDomainBarsHTML(agg,true):`<p class="umeta">Nothing graded yet.</p>`}</div>
  <div class="panel"><h2>${svg("users","ic-sm")} Latest result per student</h2>
    <div class="ft-table-wrap"><table class="ft-table"><thead><tr><th>Student</th><th>Test</th><th>Total</th><th>R&amp;W</th><th>Math</th><th>Weakest domains</th><th>Finished</th><th></th></tr></thead><tbody>
    ${latest.map(a=>{
      const weak=[...(a.domains||[])].filter(d=>d.total).sort((x,y)=>x.correct/x.total-y.correct/y.total).slice(0,2);
      return `<tr><td><b>${esc(a.student.displayName)}</b></td><td>${esc(a.testTitle)}${a.assignmentId?` <span class="pill pill-muted">task</span>`:""}</td>
        <td class="ft-n"><b>${ftScore(a.totalScaled)}</b></td><td class="ft-n">${ftScore(a.rwScaled)}</td><td class="ft-n">${ftScore(a.mathScaled)}</td>
        <td>${weak.map(d=>`<span class="ft-tag">${esc(d.domain)} ${Math.round(d.correct/d.total*100)}%</span>`).join(" ")||"—"}</td>
        <td class="umeta">${esc(ftDate(a.submittedAt))}</td>
        <td><button class="btn btn-ghost btn-xs" onclick="go('testsit',{attemptId:${a.attemptId}})">${svg("book","ic-sm")} Review</button></td></tr>`;
    }).join("")||`<tr><td colspan="8" class="umeta">No completed sittings yet.</td></tr>`}</tbody></table></div></div>`;
}

// ──────────────── STUDENT · tests & exam tasks ────────────────
async function viewTestsStudent(){
  crumbs([{label:"Full-Length Tests"}]); loading();
  let rows=[], tasks=[];
  try{ [rows,tasks]=await Promise.all([api("tests"),api("test-assignments").catch(()=>[])]); }catch(e){ toast(e.message); }
  const taskCards=tasks.map(ftStudentTaskCard).join("");
  const cards=rows.map(t=>{
    const a=t.attempt;
    const inProgress=a&&!a.submittedAt;
    const paused=inProgress&&a.status==="paused";
    const done=a&&a.submittedAt;
    const actions=inProgress
      ? `<button class="btn btn-primary btn-sm" onclick="resumeTestFromCard(${a.id})">${svg(paused?"play":"clock","ic-sm")} Resume test</button>`
      : done
        ? `<button class="btn btn-ghost btn-sm" onclick="go('testsit',{attemptId:${a.id}})">${svg("book","ic-sm")} Score report</button>
           <button class="btn btn-primary btn-sm" onclick="FTS_open(${t.id})" aria-expanded="${FTS.open===t.id}" aria-controls="ftSetup${t.id}">${svg("rush","ic-sm")} Retake</button>`
        : `<button class="btn btn-primary btn-sm" onclick="FTS_open(${t.id})" aria-expanded="${FTS.open===t.id}" aria-controls="ftSetup${t.id}">${svg("rush","ic-sm")} Start test</button>`;
    const cfg=a?ftAttemptModeText(a):"";
    return `<div class="panel">
      <h2>${svg("layers","ic-sm")} ${esc(t.title)} ${t.isAdaptive?`<span class="pill ft-pill-gold">Adaptive</span>`:""}</h2>
      <div class="umeta">${testShape(t)} · ${esc(testTimingNote(t))}</div>
      ${t.description?`<p style="color:var(--ink2);margin-top:.6rem">${esc(t.description)}</p>`:""}
      ${done?`<p style="margin-top:.6rem;color:var(--ink2)">Last result${cfg?` (${esc(cfg)})`:""}: <b>${a.correctCount}/${a.totalCount}</b> correct${a.scoreReport?.totalScaled?` · <b>${a.scoreReport.totalScaled}</b> estimated SAT score`:""}</p>`:""}
      ${inProgress?`<p style="margin-top:.6rem;color:var(--gold)">${a.timed===false
        ?`${paused?"Paused":"In progress"} on module ${a.moduleIndex+1}, question ${(a.currentQuestionIndex||0)+1} · ${esc(cfg)} — no clock is running.`
        :paused
        ?`Paused on module ${a.moduleIndex+1}, question ${(a.currentQuestionIndex||0)+1} — ${fmtTime(a.remainingSeconds||0)} held on the clock.`
        :`In progress — the clock is still running on module ${a.moduleIndex+1}${a.practiceScope==="modules"?" (selected modules)":""}.`}</p>`:""}
      <div style="display:flex;gap:.6rem;flex-wrap:wrap;margin-top:1rem">${actions}</div>
      ${inProgress?"":`<div id="ftSetup${t.id}">${FTS.open===t.id?ftSetupHTML(t):""}</div>`}</div>`;
  }).join("");
  FTS.tests=new Map(rows.map(t=>[t.id,t]));
  $c().innerHTML=`<div class="page-head fade"><h1>Full-Length Tests</h1><p>Sit a complete Digital SAT end to end in the exam interface: timed modules, a calculator and reference sheet for Math, a 10-minute break between sections, and a scaled score report at the end.</p></div>
    ${taskCards?`<div class="fade"><h2 class="ft-sec-title">${ftIcon("task")} Assigned exams</h2>${taskCards}</div>`:""}
    <div class="fade"><h2 class="ft-sec-title">${svg("layers","ic-sm")} Practice tests</h2>${cards||`<div class="empty"><div class="ei">${svg("layers")}</div><p>No full-length tests are available yet.</p></div>`}</div>`;
}
// ──────────────── Practice set-up (before a self-started sitting) ────────────────
// Two independent choices — what to practice (full test / selected modules) and
// timing (timed / untimed) — saved on the sitting when it starts, so a refresh
// or a later sign-in resumes the same configuration.
let FTS={open:null,scope:"full",timed:true,sel:new Set(),tests:new Map()};
function ftAttemptModeText(a){
  const parts=[];
  if(a.practiceScope==="modules") parts.push("Selected-module practice");
  if(a.timed===false) parts.push("Untimed");
  return parts.join(" · ");
}
function ftModNo(m,mods){
  if(m.moduleNumber) return m.moduleNumber;
  return mods.filter(x=>x.section===m.section).indexOf(m)+1;
}
// Adaptive Module 2 groups with several difficulty tracks.
function ftTrackGroups(t){
  const mods=t.moduleOutline||[], g=new Map();
  if(!t.isAdaptive) return g;
  mods.forEach(m=>{ if(m.moduleNumber==null) return; const k=m.section+":"+m.moduleNumber; g.set(k,[...(g.get(k)||[]),m]); });
  [...g.keys()].forEach(k=>{ if(g.get(k).length<2) g.delete(k); });
  return g;
}
function ftModLabel(m,t){
  const mods=t.moduleOutline||[];
  const multi=ftTrackGroups(t).has(m.section+":"+m.moduleNumber);
  return `${FT_SECTION_LABEL[m.section]||m.section} · Module ${ftModNo(m,mods)}${multi&&m.difficultyTrack?` · ${m.difficultyTrack} track`:""}`;
}
// Mirrors the server: every planned module carries its own limit → the sum;
// otherwise the sitting runs on the test's one shared clock.
function ftPlanMinutes(t,mods){
  if(mods.length&&mods.every(m=>(m.timeLimitMinutes||0)>0)) return mods.reduce((n,m)=>n+m.timeLimitMinutes,0);
  return t.timeLimitMinutes||t.totalMinutes||0;
}
// Modules a full sitting covers: adaptive groups count once (the routed variant).
function ftFullPlan(t){
  const mods=t.moduleOutline||[], groups=ftTrackGroups(t), seen=new Set(), out=[];
  for(const m of mods){
    const k=m.section+":"+m.moduleNumber;
    if(groups.has(k)){ if(seen.has(k)) continue; seen.add(k); const g=groups.get(k); out.push(g.find(x=>/standard/i.test(x.difficultyTrack))||g[0]); }
    else out.push(m);
  }
  return out;
}
function FTS_open(testId){
  if(FTS.open===testId){ FTS.open=null; }
  else { FTS={...FTS,open:testId,scope:"full",timed:true,sel:new Set()}; }
  document.querySelectorAll('[id^="ftSetup"]').forEach(el=>{ const id=Number(el.id.slice(7)); el.innerHTML=FTS.open===id?ftSetupHTML(FTS.tests.get(id)):""; });
  document.querySelectorAll('[aria-controls^="ftSetup"]').forEach(b=>b.setAttribute("aria-expanded",String(b.getAttribute("aria-controls")===`ftSetup${FTS.open}`)));
  if(FTS.open) document.getElementById(`ftSetup${FTS.open}`)?.scrollIntoView({behavior:"smooth",block:"nearest"});
  if(typeof CR_paint==="function") CR_paint();
}
function FTS_rerender(){ const t=FTS.tests.get(FTS.open); const el=document.getElementById(`ftSetup${FTS.open}`); if(t&&el){ el.innerHTML=ftSetupHTML(t); if(typeof CR_paint==="function") CR_paint(); } }
function FTS_set(k,v){ FTS[k]=v; FTS_rerender(); }
function FTS_toggle(id){ if(FTS.sel.has(id)) FTS.sel.delete(id); else FTS.sel.add(id); FTS_rerender(); }
function ftSetupHTML(t){
  if(!t) return "";
  const mods=t.moduleOutline||[];
  const groups=ftTrackGroups(t);
  const seg=(key,val,label,sub)=>`<button type="button" role="radio" aria-checked="${FTS[key]===val}" class="ft-seg-b ${FTS[key]===val?"on":""}" onclick="FTS_set('${key}',${JSON.stringify(val).replace(/"/g,"'")})"><b>${label}</b><span>${sub}</span></button>`;
  const chosen=FTS.scope==="full"?ftFullPlan(t):mods.filter(m=>FTS.sel.has(m.id));
  const qn=chosen.reduce((n,m)=>n+(m.questionCount||0),0);
  const minutes=ftPlanMinutes(t,chosen);
  const ready=chosen.length>0;
  const list=FTS.scope==="modules"?`<fieldset class="ft-modpick"><legend>Modules <span class="umeta">— in test order; pick one or more</span></legend>
    ${mods.map(m=>`<label class="ft-modrow ${FTS.sel.has(m.id)?"on":""}"><input type="checkbox" ${FTS.sel.has(m.id)?"checked":""} onchange="FTS_toggle(${m.id})"/>
      <span class="ft-modrow-l"><b>${esc(ftModLabel(m,t))}</b><span class="umeta">${esc(m.title)}</span></span>
      <span class="umeta">${m.questionCount} question${m.questionCount===1?"":"s"}${m.timeLimitMinutes?` · ${m.timeLimitMinutes} min`:""}</span></label>`).join("")}
    ${groups.size?`<p class="mathhint">This adaptive test has more than one difficulty track for ${[...groups.values()].map(g=>`${FT_SECTION_LABEL[g[0].section]} Module ${g[0].moduleNumber}`).join(" and ")}. In selected-module practice you sit exactly the track you tick — nothing is routed.</p>`:""}
  </fieldset>`:"";
  const summary=ready?`<div class="ft-setup-sum" aria-live="polite">
      <div class="ft-setup-sum-h"><b>${FTS.scope==="full"?"Full test":"Selected-module practice"}</b> · ${FTS.timed?"Timed":"Untimed"}</div>
      <ol>${chosen.map(m=>`<li>${esc(FTS.scope==="full"&&groups.has(m.section+":"+m.moduleNumber)?`${FT_SECTION_LABEL[m.section]} · Module ${m.moduleNumber} (difficulty set by your Module 1 result)`:ftModLabel(m,t))} <span class="umeta">· ${m.questionCount} q${FTS.timed&&m.timeLimitMinutes?` · ${m.timeLimitMinutes} min`:""}</span></li>`).join("")}</ol>
      <div class="ft-setup-tot"><span><b>${qn}</b> question${qn===1?"":"s"}</span>${FTS.timed?`<span><b>${minutes}</b> min working time${chosen.every(m=>(m.timeLimitMinutes||0)>0)?"":" on one shared clock"}</span>`:`<span>No time limit — submit each module when you're ready</span>`}</div>
    </div>`:`<div class="ft-setup-sum muted" aria-live="polite">Select at least one module to start.</div>`;
  return `<div class="ft-setup fade" role="group" aria-label="Practice set-up for ${esc(t.title)}">
    <div class="ft-setup-row"><div class="ft-setup-lbl">What to practice</div>
      <div class="ft-seg" role="radiogroup" aria-label="What to practice">${seg("scope","full","Full test",t.isAdaptive?"Adaptive routing, as on test day":"Every module in order")}${seg("scope","modules","Select modules","Practice only the modules you pick")}</div></div>
    <div class="ft-setup-row"><div class="ft-setup-lbl">Timing</div>
      <div class="ft-seg" role="radiogroup" aria-label="Timing">${seg("timed",true,"Timed","Each module's configured time limit")}${seg("timed",false,"Untimed","No countdown, no automatic submit")}</div></div>
    ${list}${summary}${typeof CR_costHTML==="function"?CR_costHTML(chosen[0]?.questionCount||0):""}
    <div style="display:flex;gap:.6rem;margin-top:1rem;flex-wrap:wrap">
      <button class="btn btn-primary" ${ready?"":"disabled aria-disabled=\"true\""} onclick="FTS_start(${t.id})">${svg("rush","ic-sm")} Start</button>
      <button class="btn btn-ghost" onclick="FTS_open(${t.id})">Cancel</button></div>
  </div>`;
}
async function FTS_start(testId,examChoice){
  const t=FTS.tests.get(testId); if(!t) return;
  const payload={testId,scope:FTS.scope,timed:FTS.timed};
  if(FTS.scope==="modules"){ payload.moduleIds=(t.moduleOutline||[]).filter(m=>FTS.sel.has(m.id)).map(m=>m.id); if(!payload.moduleIds.length){ toast("Select at least one module"); return; } }
  // A full, timed sitting runs in Exam Mode: instructions and full screen first,
  // then the sitting (and its server clock) starts. Resuming skips this.
  if(examChoice===undefined&&FTS.scope==="full"&&FTS.timed&&!(t.attempt&&!t.attempt.submittedAt)){
    return plExamIntro({allowPractice:true,onStart:exam=>FTS_start(testId,exam)});
  }
  if(examChoice===false) payload.examMode=false;
  loading();
  try{
    const row=await api("test-attempts",{method:"POST",body:JSON.stringify(payload)});
    FTS.open=null;
    if(row.resumed) toast("You already have this test in progress — resuming it as it was set up.");
    go("testsit",{attemptId:row.id});
  }catch(e){ if(e.data?.outOfCredits&&typeof CR_outOfCredits==="function"){ CR_outOfCredits(e.data); viewTestsStudent(); return; } toast(e.message); viewTestsStudent(); }
}

function ftStudentTaskCard(t){
  const a=t.attempt, done=a?.submittedAt;
  const action=done
    ? `<button class="btn btn-ghost btn-sm" onclick="go('testsit',{attemptId:${a.id}})">${svg("book","ic-sm")} Score report &amp; explanations</button>`
    : a ? `<button class="btn btn-primary btn-sm" onclick="resumeTestFromCard(${a.id})">${svg(a.status==="paused"?"play":"clock","ic-sm")} Resume exam</button>`
    : `<button class="btn btn-primary btn-sm" onclick="startExamTask(${t.id})">${svg("rush","ic-sm")} Start exam</button>`;
  return `<div class="panel ft-task ft-task-stu">
    <div class="ft-task-head"><div><h2>${ftIcon("task")} ${esc(t.title)}</h2>
      <div class="umeta">${esc(t.testTitle)} · ${t.moduleIds.length?t.modules.map(m=>esc(m.title)).join(", "):"Full test"} · ${t.modules.reduce((n,m)=>n+(m.timeLimitMinutes||0),0)||"—"} min · ${t.allowPause?"you can pause":"no pausing once started"}</div></div>
      ${ftStatusPill(t.status)}</div>
    ${t.instructions?`<p style="color:var(--ink2);margin-top:.5rem">${esc(t.instructions)}</p>`:""}
    <div class="umeta" style="margin-top:.5rem">${esc(deadlineText(t.dueAt))}${done&&t.totalScaled?` · scored <b>${t.totalScaled}</b>`:done&&(t.rwScaled||t.mathScaled)?` · scored <b>${t.rwScaled||t.mathScaled}</b> on the section`:""}</div>
    <div style="margin-top:.9rem">${action}</div></div>`;
}
async function startExamTask(assignmentId,ready){
  if(!ready) return plExamIntro({allowPractice:false,onStart:()=>startExamTask(assignmentId,true)});
  loading();
  try{ const row=await api("test-attempts",{method:"POST",body:JSON.stringify({assignmentId})}); go("testsit",{attemptId:row.id}); }
  catch(e){ toast(e.message); viewTestsStudent(); }
}
// Pending exam tasks on the student dashboard.
function ftDashboardHTML(tasks){
  const open=(tasks||[]).filter(t=>!t.attempt?.submittedAt).sort((a,b)=>new Date(a.dueAt)-new Date(b.dueAt));
  if(!open.length) return "";
  return `<div class="panel ft-dash"><h2>${ftIcon("task")} Assigned exams</h2>${open.slice(0,4).map(t=>`<div class="ft-dash-row">
    <div><b>${esc(t.title)}</b><div class="umeta">${esc(t.testTitle)} · ${esc(deadlineText(t.dueAt))}</div></div>
    ${ftStatusPill(t.status)}
    ${t.attempt?`<button class="btn btn-primary btn-sm" onclick="resumeTestFromCard(${t.attempt.id})">Resume</button>`:`<button class="btn btn-primary btn-sm" onclick="startExamTask(${t.id})">Start exam</button>`}
  </div>`).join("")}</div>`;
}

// ════════════════════════════════════════════════════════════
//  <FullLengthTestRunner /> — Bluebook-style exam interface
// ════════════════════════════════════════════════════════════
const BB={hideTimer:false,abc:false,split:50,nav:false,review:false};
function ftEnterRunner(){ document.body.classList.add("bb-on"); }
function ftExitRunner(){ document.body.classList.remove("bb-on"); BB.nav=false; BB.review=false; document.getElementById("bbPop")?.remove(); ftHlHideBar?.(); }
const ftElimKey=()=>`fnf_elim_${state.user?.key||"anon"}_${T?.id}`;
function ftElim(){ try{ return JSON.parse(localStorage.getItem(ftElimKey())||"{}"); }catch{ return {}; } }
function ftSetElim(map){ try{ localStorage.setItem(ftElimKey(),JSON.stringify(map)); }catch{} }

function ftSectionNo(mod){
  // Section 1 is Reading and Writing, Section 2 is Math (whatever subset is sat).
  return mod.section==="math"?2:1;
}
function ftModuleNo(mod){
  if(mod.moduleNumber) return mod.moduleNumber;
  const same=T.test.modules.filter(m=>m.section===mod.section);
  return same.indexOf(mod)+1;
}
function ftSprPreview(v){
  const s=String(v||"").trim();
  if(!s) return "";
  const frac=s.match(/^(-?)(\d*\.?\d+)\/(\d*\.?\d+)$/);
  if(frac) return mathText(`\\(${frac[1]}\\dfrac{${frac[2]}}{${frac[3]}}\\)`);
  return esc(s);
}

// Shared question workspace — the live runner and the importer preview both use it.
function ftWorkspaceHTML(q,ctx){
  const sec=ctx.section||q.section;
  const flagged=!!ctx.flagged, given=ctx.given||"", elim=ctx.elim||[];
  const abc=!ctx.preview&&BB.abc;
  const head=`<div class="bb-qhead">
    <span class="bb-qnum">${ctx.num}</span>
    ${ctx.preview?`<span class="bb-qmeta">${esc(q.category)}${q.subcategory?` · ${esc(q.subcategory)}`:""}</span>`
      :`<button type="button" class="bb-mark ${flagged?"on":""}" id="flagBtn" aria-pressed="${flagged}" onclick="toggleTestFlag(${q.id})">${ftIcon("bookmark")} ${flagged?"Marked for Review":"Mark for Review"}</button>`}
    <span style="flex:1"></span>
    ${ctx.preview?"":`<button type="button" class="bb-hlclear" id="hlClear" onclick="FT_hlClear()" ${ctx.hlCount?"":"hidden"} title="Remove every highlight on this question">${ftIcon("marker")} Clear highlights</button>`}
    ${q.type!=="spr"&&!ctx.preview?`<button type="button" class="bb-abc ${abc?"on":""}" title="Cross out answer choices" aria-pressed="${abc}" onclick="FT_abc()"><s>ABC</s></button>`:""}
  </div>`;
  const media=q.questionImage?`<div class="bb-figure">${questionMediaHTML(q.questionImage,"Figure for this question")}</div>`:"";
  let answer;
  if(q.type==="spr"){
    answer=`<div class="bb-spr">
      <input class="bb-spr-input" id="testSpr" value="${esc(given)}" maxlength="7" inputmode="decimal" autocomplete="off" aria-label="Your answer"
        ${ctx.preview?"":`oninput="setTestAnswerLocal(${q.id},this.value);FT_sprPreview(this.value)" onchange="saveTestAnswer(${q.id},this.value)" onkeydown="if(event.key==='Enter')this.blur()"`}/>
      <div class="bb-spr-prev"><span>Answer Preview:</span> <b id="sprPrev">${ftSprPreview(given)}</b></div></div>`;
  } else {
    answer=`<div class="bb-opts">${["A","B","C","D"].filter(l=>q.choices&&q.choices[l]!=null).map(l=>{
      const struck=elim.includes(l), sel=given===l, ok=ctx.preview&&q.answer===l;
      // The choice is a div acting as a button (not a <button>) so its text can be
      // selected for highlighting; ftChoiceClick ignores clicks that end a selection.
      return `<div class="bb-opt ${sel?"sel":""} ${struck?"struck":""} ${ok?"key":""}" data-l="${l}">
        <div class="bb-opt-main" ${ctx.preview?"":`role="radio" tabindex="0" aria-checked="${sel}" aria-label="Answer ${l}" onpointerdown="FT_hlDown(event)" onclick="ftChoiceClick(event,'${l}')" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();pickTestChoice('${l}')}"`}>
          <span class="bb-ltr">${l}</span><span class="bb-otext" ${ctx.preview?"":`data-hl="choice:${l}"`}>${mathText(q.choices[l])}${questionMediaHTML(q.choiceImages?.[l],`Answer choice ${l}`,"choice")}</span></div>
        ${abc?`<button type="button" class="bb-strike" onclick="FT_strike('${l}')" title="${struck?"Undo":"Cross out"} ${l}">${struck?"Undo":`<s>${l}</s>`}</button>`:""}
      </div>`;
    }).join("")}</div>`;
  }
  const hl=ctx.preview?"":' data-hl="prompt"';
  const prompt=`<div class="bb-prompt"${hl}>${mathText(q.prompt)}</div>`;
  const passage=q.passage?`<div class="bb-passage"${ctx.preview?"":' data-hl="passage"'}>${mathText(q.passage)}</div>`:"";
  const split=(sec==="ebrw"&&(q.passage||q.questionImage))||(sec==="math"&&(q.passage||q.type==="spr"));
  if(!split){
    return `<main class="bb-work single"><section class="bb-center">${head}${media}${prompt}${answer}</section></main>`;
  }
  const left=sec==="math"&&q.type==="spr"&&!q.passage
    ? `<div class="bb-spr-dir"><h4>Student-produced response directions</h4><ul>
        <li>If you find more than one correct answer, enter only one answer.</li>
        <li>You can enter up to 5 characters for a positive answer and up to 6 characters (including the negative sign) for a negative answer.</li>
        <li>If your answer is a fraction that doesn't fit in the provided space, enter the decimal equivalent.</li>
        <li>If your answer is a decimal that doesn't fit, you may either round it or truncate it, but it must fill the entire space.</li>
        <li>If your answer is a mixed number (such as 3½), enter it as an improper fraction (7/2) or its decimal equivalent (3.5).</li>
        <li>Don't enter symbols such as a percent sign, comma, or dollar sign.</li></ul></div>${media}`
    : `${media}${passage}`;
  return `<main class="bb-work split" id="bbWork" style="--split:${BB.split}%">
    <section class="bb-pane bb-left">${left}</section>
    <div class="bb-divider" role="separator" aria-orientation="vertical" title="Drag to resize" ${ctx.preview?"":`onpointerdown="FT_dragStart(event)"`}><span></span></div>
    <section class="bb-pane bb-right">${head}${prompt}${answer}</section></main>`;
}

function currentTestModule(){ return T.test.modules[T.modIdx]; }
// Untimed practice: the sitting carries no clock (saved on the attempt, so a
// refresh or resume stays untimed).
function ftUntimed(){ return !!T&&(T.session?.timed===false||T.attempt?.timed===false); }
function renderTestQuestion(){
  const mod=currentTestModule();
  if(!mod){ submitTest(true); return; }
  ftEnterRunner();
  // The calculator belongs to Math modules; elsewhere it is tucked away (still mounted).
  if(mod.section!=="math"&&desmosFloatEl&&DF.open) desmosHide();
  // A new module (or a new sitting) starts on its first question, not on the review page.
  const modKey=`${T.id}:${T.modIdx}`;
  if(BB.modKey!==modKey){ BB.modKey=modKey; BB.review=false; BB.nav=false; BB.abc=false; }
  const total=mod.questions.length;
  const lastMod=T.modIdx+1>=T.test.modules.length;
  if(!total){
    $c().innerHTML=`<div class="bb">${ftTopBarHTML(mod)}<main class="bb-work single"><section class="bb-center" style="text-align:center">
      <p>This module has no questions.</p><button class="btn btn-primary" style="margin-top:1rem" onclick="advanceTestModule(true)">${lastMod?"Finish test":"Continue"}</button></section></main></div>`;
    return;
  }
  if(T.qIdx>=total) T.qIdx=total-1;
  if(T.qIdx<0) T.qIdx=0;
  const q=mod.questions[T.qIdx];
  const body=BB.review?ftReviewPageHTML(mod):ftWorkspaceHTML(q,{
    num:T.qIdx+1, section:mod.section, flagged:T.flagged.has(q.id), given:T.answers[String(q.id)]||"",
    elim:ftElim()[q.id]||[], hlCount:ftHlFor(q.id).length,
  });
  const prevScroll=[...document.querySelectorAll(".bb-pane")].map(p=>p.scrollTop);
  const prevWorkScroll=document.querySelector("#bb .bb-work")?.scrollTop||0;
  ftHlHideBar();
  $c().innerHTML=`<div class="bb" id="bb">${ftTopBarHTML(mod)}${body}${ftBottomBarHTML(mod)}</div>`;
  if(!BB.review) ftHlApply(q.id);
  if(BB.keepScroll){
    document.querySelectorAll(".bb-pane").forEach((p,i)=>{ p.scrollTop=prevScroll[i]||0; });
    const w=document.querySelector("#bb .bb-work"); if(w) w.scrollTop=prevWorkScroll;
  }
  BB.keepScroll=false;
  // Re-dock the calculator (left pane / narrow switch) around the new question.
  if(typeof dfAfterRender==="function") dfAfterRender();
  if(BB.nav) ftRenderNavPop();
}
function ftTopBarHTML(mod){
  const left=testRemaining();
  const math=mod.section==="math";
  const allowPause=T.session?.allowPause!==false;
  return `<header class="bb-top">
    <div class="bb-title"><b>Section ${ftSectionNo(mod)}, Module ${ftModuleNo(mod)}: ${esc(FT_SECTION_LABEL[mod.section]||mod.section)}</b>
      <button type="button" class="bb-link" onclick="FT_directions()">Directions ${ftIcon("down")}</button></div>
    ${ftUntimed()?`<div class="bb-clock untimed"><span class="bb-time" id="testTimer" title="Untimed practice — no countdown, submit each module when you're ready">Untimed</span></div>`
    :`<div class="bb-clock ${BB.hideTimer?"hidden":""}">
      <span class="bb-time ${left!==null&&left<=300?"low":""}" id="testTimer" role="timer" aria-label="Time remaining">${left===null?"—":fmtTime(left)}</span>
      <button type="button" class="bb-pillbtn" onclick="FT_toggleTimer()">${BB.hideTimer?"Show":"Hide"}</button></div>`}
    <div class="bb-tools">
      ${math?`<button type="button" class="bb-tool" onclick="toggleDesmosFloat()">${svg("calc")}<span>Calculator</span></button>
        <button type="button" class="bb-tool" onclick="FT_reference()">${ftIcon("formula","")}<span>Reference</span></button>`:""}
      ${allowPause?`<button type="button" class="bb-tool" onclick="pauseTest()">${svg("pause")}<span>Pause</span></button>`:""}
      <button type="button" class="bb-tool" onclick="FT_more()">${ftIcon("dots","")}<span>More</span></button>
    </div></header><div class="bb-stripe"></div>`;
}
function ftBottomBarHTML(mod){
  const total=mod.questions.length;
  const last=T.qIdx+1>=total;
  const lastMod=T.modIdx+1>=T.test.modules.length;
  return `<footer class="bb-bottom">
    <div class="bb-who">${esc(state.user.name)} <span class="test-save ${T.saveState==="offline"?"off":""}" id="testSave">${T.saveState==="offline"?"Offline · saved on this device":"Progress saved"}</span></div>
    <button type="button" class="bb-qpill" onclick="FT_toggleNav()" aria-expanded="${BB.nav}">${BB.review?"Review Page":`Question ${T.qIdx+1} of ${total}`} ${ftIcon("chev")}</button>
    <div class="bb-navbtns">
      ${BB.review||T.qIdx>0?`<button type="button" class="bb-btn" onclick="FT_back()">Back</button>`:""}
      ${BB.review?`<button type="button" class="bb-btn primary" onclick="advanceTestModule(false)">${lastMod?"Submit test":"Next module"}</button>`
        :`<button type="button" class="bb-btn primary" onclick="${last?"FT_openReview()":`gotoTestQuestion(${T.qIdx+1})`}">Next</button>`}
    </div></footer>`;
}
function ftNavGridHTML(mod){
  return `<div class="bb-grid">${mod.questions.map((x,i)=>{
    const answered=!!T.answers[String(x.id)], flagged=T.flagged.has(x.id), cur=!BB.review&&i===T.qIdx;
    return `<button type="button" class="bb-cell ${answered?"ans":""} ${flagged?"flag":""} ${cur?"cur":""}" onclick="FT_jump(${i})" aria-label="Question ${i+1}${answered?", answered":", unanswered"}${flagged?", marked for review":""}">
      ${cur?`<i class="bb-pin"></i>`:""}${i+1}${flagged?`<span class="bb-flagdot">${ftIcon("bookmark")}</span>`:""}</button>`;
  }).join("")}</div>
  <div class="bb-legend"><span><i class="lg cur"></i>Current</span><span><i class="lg un"></i>Unanswered</span><span><i class="lg ans"></i>Answered</span><span><i class="lg flag"></i>For Review</span></div>`;
}
function ftReviewPageHTML(mod){
  const answered=mod.questions.filter(x=>T.answers[String(x.id)]).length;
  const lastMod=T.modIdx+1>=T.test.modules.length;
  return `<main class="bb-work single"><section class="bb-center bb-review">
    <h2>Check Your Work</h2>
    <p>${ftUntimed()?`This is untimed practice — nothing is submitted automatically. Select <b>${lastMod?"Submit test":"Next module"}</b> when you're ready to move on.`
      :`On test day, you won't be able to move on to the next module until time expires. For this practice test, you can select <b>${lastMod?"Submit test":"Next module"}</b> when you're ready to move on.`}</p>
    <div class="bb-review-card"><div class="bb-review-head"><b>Section ${ftSectionNo(mod)}, Module ${ftModuleNo(mod)}: ${esc(FT_SECTION_LABEL[mod.section]||mod.section)} Questions</b>
      <span class="umeta">${answered} of ${mod.questions.length} answered</span></div>${ftNavGridHTML(mod)}</div>
  </section></main>`;
}
function ftRenderNavPop(){
  document.getElementById("bbPop")?.remove();
  if(!BB.nav) return;
  const mod=currentTestModule(); if(!mod) return;
  // Narrow screen showing the calculator: bring the question view back so the
  // question map isn't hidden behind it.
  if(document.body.classList.contains("df-dock-calc")&&typeof dfSetPane==="function") dfSetPane("question");
  const el=document.createElement("div"); el.id="bbPop"; el.className="bb-pop";
  el.innerHTML=`<div class="bb-pop-head"><b>Section ${ftSectionNo(mod)}, Module ${ftModuleNo(mod)}: ${esc(FT_SECTION_LABEL[mod.section]||mod.section)} Questions</b>
    <button type="button" class="btn btn-ghost btn-xs" onclick="FT_toggleNav()" aria-label="Close">${svg("x","ic-sm")}</button></div>
    ${ftNavGridHTML(mod)}
    <div style="text-align:center;margin-top:.9rem"><button type="button" class="bb-btn outline" onclick="FT_openReview()">Go to Review Page</button></div>`;
  document.getElementById("bb")?.appendChild(el);
}
function FT_toggleNav(){ BB.nav=!BB.nav; ftRenderNavPop(); document.querySelector(".bb-qpill")?.setAttribute("aria-expanded",String(BB.nav)); }
function FT_jump(i){ BB.nav=false; BB.review=false; document.getElementById("bbPop")?.remove(); gotoTestQuestion(i,true); }
function FT_openReview(){ if(T.status!=="active") return; BB.nav=false; BB.review=true; renderTestQuestion(); autosaveTest(); }
function FT_back(){ if(BB.review){ BB.review=false; renderTestQuestion(); return; } gotoTestQuestion(T.qIdx-1); }
function FT_toggleTimer(){ BB.hideTimer=!BB.hideTimer; document.querySelector(".bb-clock")?.classList.toggle("hidden",BB.hideTimer); const b=document.querySelector(".bb-clock .bb-pillbtn"); if(b) b.textContent=BB.hideTimer?"Show":"Hide"; }
function FT_abc(){ BB.abc=!BB.abc; BB.keepScroll=true; renderTestQuestion(); }
function FT_strike(letter){
  const mod=currentTestModule(); const q=mod?.questions[T.qIdx]; if(!q) return;
  const map=ftElim(); const set=new Set(map[q.id]||[]);
  if(set.has(letter)) set.delete(letter); else set.add(letter);
  map[q.id]=[...set]; ftSetElim(map);
  // Crossing out the selected answer clears the selection, as in the real app.
  if(set.has(letter)&&T.answers[String(q.id)]===letter){ saveTestAnswer(q.id,""); }
  BB.keepScroll=true; renderTestQuestion();
}
function FT_sprPreview(v){ const el=document.getElementById("sprPrev"); if(el){ el.innerHTML=ftSprPreview(v); typesetMath(el); } }
function FT_dragStart(e){
  const work=document.getElementById("bbWork"); if(!work) return;
  e.preventDefault();
  const move=ev=>{
    const r=work.getBoundingClientRect();
    BB.split=Math.max(25,Math.min(75,((ev.clientX-r.left)/r.width)*100));
    work.style.setProperty("--split",BB.split+"%");
  };
  const up=()=>{ window.removeEventListener("pointermove",move); window.removeEventListener("pointerup",up); document.body.classList.remove("bb-dragging"); };
  document.body.classList.add("bb-dragging");
  window.addEventListener("pointermove",move); window.addEventListener("pointerup",up);
}
function FT_directions(){
  const mod=currentTestModule();
  const rw=`<p>The questions in this section address a number of important reading and writing skills. Each question includes one or more passages, which may include a table or graph. Read each passage and question carefully, and then choose the best answer to the question based on the passage(s).</p><p>All questions in this section are multiple-choice with four answer choices. Each question has a single best answer.</p>`;
  const math=`<p>The questions in this section address a number of important math skills. Use of a calculator is permitted for all questions. A reference sheet, calculator, and these directions can be accessed throughout the test.</p><p>Unless otherwise indicated: all variables and expressions represent real numbers; figures provided are drawn to scale; all figures lie in a plane; the domain of a given function is the set of all real numbers x for which f(x) is a real number.</p><p>For <b>multiple-choice questions</b>, solve each problem and choose the correct answer from the choices provided. For <b>student-produced response questions</b>, solve each problem and enter your answer in the box.</p>`;
  ftModal("Directions",mod?.section==="math"?math:rw);
}
function FT_reference(){
  const f=(label,tex)=>`<div class="bb-ref-item"><div class="bb-ref-tex">${mathText(tex)}</div><span>${label}</span></div>`;
  ftModal("Reference",`<div class="bb-ref">
    ${f("Circle","\\(A=\\pi r^2\\quad C=2\\pi r\\)")}
    ${f("Rectangle","\\(A=\\ell w\\)")}
    ${f("Triangle","\\(A=\\tfrac{1}{2}bh\\)")}
    ${f("Pythagorean theorem","\\(c^2=a^2+b^2\\)")}
    ${f("Special right triangle 30°-60°-90°","\\(x,\\; x\\sqrt{3},\\; 2x\\)")}
    ${f("Special right triangle 45°-45°-90°","\\(s,\\; s,\\; s\\sqrt{2}\\)")}
    ${f("Rectangular prism","\\(V=\\ell wh\\)")}
    ${f("Cylinder","\\(V=\\pi r^2 h\\)")}
    ${f("Sphere","\\(V=\\tfrac{4}{3}\\pi r^3\\)")}
    ${f("Cone","\\(V=\\tfrac{1}{3}\\pi r^2 h\\)")}
    ${f("Pyramid","\\(V=\\tfrac{1}{3}\\ell wh\\)")}
  </div>
  <p class="bb-ref-note">The number of degrees of arc in a circle is 360. The number of radians of arc in a circle is 2π. The sum of the measures in degrees of the angles of a triangle is 180.</p>`,{wide:true});
}
function FT_more(){
  ftModal("More",`<p class="umeta">Your answers, flags and place are saved as you go.</p>
    <div style="display:flex;flex-direction:column;gap:.6rem;margin-top:1rem">
      <button class="btn btn-ghost" onclick="ftCloseModal();FT_shortcuts()">${svg("info","ic-sm")} Help</button>
      ${T&&currentTestModule()?.questions?.[T.qIdx]&&!BB.review?`<button class="btn btn-ghost" onclick="ftCloseModal();PL_reportQuestion(${currentTestModule().questions[T.qIdx].id},'mock',${T.id})">${svg("flag","ic-sm")} Report this question</button>`:""}
      <button class="btn btn-ghost" onclick="ftCloseModal();go('tests')">${svg("back","ic-sm")} Save and exit${T.session?.allowPause===false?" (the clock keeps running)":""}</button>
    </div>`);
}
function FT_shortcuts(){
  ftModal("Help",`<ul class="bb-help"><li><b>Mark for Review</b> flags a question so it stands out in the question navigator.</li>
    <li><b>ABC</b> turns on the answer eliminator — cross out choices you've ruled out.</li>
    <li>Drag the bar between the passage and the question to resize the two panes.</li>
    <li><b>Question X of Y</b> opens the navigator: jump to any question, or go to the Review Page.</li>
    <li>Select text in the passage, the question or an answer choice, then choose <b>Highlight</b>. Select a highlight to remove it; <b>Clear highlights</b> removes this question's.</li>
    ${T&&currentTestModule()?.section==="math"?`<li><b>Calculator</b> opens Desmos. Drag its title bar to move it (or use the arrow buttons / arrow keys on the title bar); <b>Minimize</b> keeps your work.</li>`:""}
    <li>${ftUntimed()?"This sitting is untimed: there is no countdown, and each module is submitted only when you choose.":"When time runs out the module is submitted automatically and the next one starts."}</li></ul>`);
}

function gotoTestQuestion(i,fromNav){
  if(T.status!=="active") return;
  const mod=currentTestModule(); if(!mod) return;
  if(i<0||i>=mod.questions.length) return;
  BB.review=false; if(!fromNav) BB.nav=false;
  T.qIdx=i; renderTestQuestion();
  autosaveTest();
}
function toggleTestFlag(questionId){
  if(T.status!=="active") return;
  if(T.flagged.has(questionId)) T.flagged.delete(questionId); else T.flagged.add(questionId);
  writeLocalTestSnapshot({synced:false});
  const on=T.flagged.has(questionId), btn=document.getElementById("flagBtn");
  if(btn){ btn.classList.toggle("on",on); btn.setAttribute("aria-pressed",String(on)); btn.innerHTML=`${ftIcon("bookmark")} ${on?"Marked for Review":"Mark for Review"}`; }
  if(BB.nav) ftRenderNavPop();
}
function pickTestChoice(letter){
  if(T.status!=="active") return;
  const mod=currentTestModule(); if(!mod) return;
  const q=mod.questions[T.qIdx];
  // Picking a crossed-out choice brings it back.
  const map=ftElim();
  if((map[q.id]||[]).includes(letter)){ map[q.id]=map[q.id].filter(l=>l!==letter); ftSetElim(map); }
  document.querySelectorAll(".bb-opt").forEach(c=>{ c.classList.toggle("sel",c.dataset.l===letter); if(c.dataset.l===letter) c.classList.remove("struck"); c.querySelector(".bb-opt-main")?.setAttribute("aria-checked",String(c.dataset.l===letter)); });
  saveTestAnswer(q.id,letter).then(()=>{ if(BB.nav) ftRenderNavPop(); });
}
// A click that finishes a text selection (mouse drag or touch long-press), or
// lands on a highlight, never changes the answer.
function ftChoiceClick(e,letter){
  const sel=window.getSelection?.();
  const opt=e.currentTarget;
  if(sel&&!sel.isCollapsed&&opt.contains(sel.anchorNode)) return;
  if(FT_HL.down&&Math.hypot(e.clientX-FT_HL.down.x,e.clientY-FT_HL.down.y)>6) return;
  if(e.target.closest("mark.bb-hl")) return;
  pickTestChoice(letter);
}
function clearTestAnswer(questionId){ saveTestAnswer(questionId,"").then(()=>renderTestQuestion()); }

// ──────────────── Personal highlighter ────────────────
// Highlights are the student's own annotations, saved per attempt, question
// and field ("passage", "prompt", "choice:A"…). They are painted over the
// rendered question as <mark> wrappers at character offsets of the field's
// text — the stored question (bold, tables, images, math, vocabulary) is never
// changed, and a repeated phrase is pinned to the occurrence that was chosen.
// Math islands are skipped when counting, so KaTeX loading late can't shift them.
const FT_HL={byQ:new Map(),down:null,pending:null};
function ftHlFor(qid){ return FT_HL.byQ.get(Number(qid))||[]; }
async function ftHlLoad(attemptId){
  FT_HL.byQ=new Map();
  if(state.user?.role!=="student") return;
  try{
    const rows=await api(`test-highlights?attemptId=${attemptId}`);
    rows.forEach(h=>{ const k=Number(h.questionId); FT_HL.byQ.set(k,[...(FT_HL.byQ.get(k)||[]),h]); });
  }catch{}
}
const HL_SKIP_PARENT=new Set(["TABLE","THEAD","TBODY","TFOOT","TR","UL","OL","COLGROUP"]);
function ftHlTextNodes(root){
  const out=[];
  const w=document.createTreeWalker(root,NodeFilter.SHOW_TEXT,{acceptNode:n=>n.parentElement?.closest(".mathseg,.katex,script,style")?NodeFilter.FILTER_REJECT:NodeFilter.FILTER_ACCEPT});
  for(let n=w.nextNode();n;n=w.nextNode()) out.push(n);
  return out;
}
function ftHlText(root){ return ftHlTextNodes(root).map(n=>n.data).join(""); }
// Character offset of a DOM boundary point within a field's counted text.
function ftHlOffset(root,node,off){
  const b=document.createRange();
  try{ b.setStart(node,off); }catch{ return null; }
  let acc=0;
  for(const t of ftHlTextNodes(root)){
    if(t===node) return acc+Math.min(off,t.length);
    if(b.comparePoint(t,0)>=0) return acc;
    acc+=t.length;
  }
  return acc;
}
function ftHlPaint(root,h){
  const text=ftHlText(root);
  // The stored quote guards against a question edited after the highlight was made.
  if(h.endOffset>text.length||(h.quote&&text.slice(h.startOffset,h.endOffset)!==h.quote)) return false;
  const segs=[]; let acc=0;
  for(const t of ftHlTextNodes(root)){
    const s0=Math.max(h.startOffset,acc), e0=Math.min(h.endOffset,acc+t.length);
    if(e0>s0&&!HL_SKIP_PARENT.has(t.parentElement?.tagName)) segs.push({t,s:s0-acc,e:e0-acc});
    acc+=t.length; if(acc>=h.endOffset) break;
  }
  segs.forEach(({t,s,e})=>{
    let mid=t; if(s>0) mid=t.splitText(s);
    if(e-s<mid.length) mid.splitText(e-s);
    const m=document.createElement("mark"); m.className="bb-hl"; m.dataset.hid=h.id; m.tabIndex=0;
    m.setAttribute("aria-label","Highlighted text — press Delete to remove");
    mid.parentNode.insertBefore(m,mid); m.appendChild(mid);
  });
  return segs.length>0;
}
function ftHlApply(qid){
  const work=document.querySelector("#bb .bb-work"); if(!work) return;
  for(const h of ftHlFor(qid)){
    const root=work.querySelector(`[data-hl="${h.field}"]`);
    if(root) ftHlPaint(root,h);
  }
  const c=document.getElementById("hlClear"); if(c) c.hidden=!ftHlFor(qid).length;
}
function ftHlRefresh(){ BB.keepScroll=true; renderTestQuestion(); }
function ftHlCurrentQ(){ const m=currentTestModule(); return m?.questions[T.qIdx]||null; }

// Selection → offer "Highlight" next to it; a highlight → offer "Remove".
function FT_hlDown(e){ FT_HL.down={x:e.clientX,y:e.clientY}; }
function ftHlSelection(){
  const sel=window.getSelection?.(); if(!sel||sel.isCollapsed||!sel.rangeCount) return null;
  const r=sel.getRangeAt(0);
  const el=n=>n.nodeType===1?n:n.parentElement;
  const a=el(r.startContainer)?.closest("#bb [data-hl]"), b=el(r.endContainer)?.closest("#bb [data-hl]");
  if(!a) return null;
  if(a!==b) return {error:"Highlight one part at a time — the passage, the question or a single answer choice."};
  const start=ftHlOffset(a,r.startContainer,r.startOffset), end=ftHlOffset(a,r.endContainer,r.endOffset);
  if(start==null||end==null||end<=start) return null;
  const quote=ftHlText(a).slice(start,end);
  if(!quote.trim()) return null;
  return {root:a,field:a.dataset.hl,start,end,quote,rect:r.getBoundingClientRect()};
}
function ftHlHideBar(){ document.getElementById("hlBar")?.remove(); FT_HL.pending=null; }
function ftHlBar(rect,html,kind="add"){
  ftHlHideBar();
  const bar=document.createElement("div"); bar.id="hlBar"; bar.className="bb-hlbar"; bar.dataset.kind=kind; bar.setAttribute("role","toolbar"); bar.setAttribute("aria-label","Highlighter");
  bar.innerHTML=html;
  // Keep the selection alive while the toolbar is pressed (mouse and touch).
  bar.addEventListener("pointerdown",e=>e.preventDefault());
  bar.addEventListener("mousedown",e=>e.preventDefault());
  document.body.appendChild(bar);
  const bw=bar.offsetWidth, bh=bar.offsetHeight, vw=document.documentElement.clientWidth;
  let top=rect.top-bh-10; if(top<8) top=rect.bottom+10;
  bar.style.top=Math.round(top)+"px";
  bar.style.left=Math.round(Math.max(8,Math.min(vw-bw-8,rect.left+rect.width/2-bw/2)))+"px";
  return bar;
}
function ftHlCheck(){
  if(!T||T.status!=="active"||state.view!=="testsit"||BB.review) return;
  const s=ftHlSelection();
  // The "Remove" bar outlives the collapsed selection; it closes on the next tap elsewhere.
  if(!s){ if(document.getElementById("hlBar")?.dataset.kind!=="remove") ftHlHideBar(); return; }
  if(s.error){ ftHlBar(window.getSelection().getRangeAt(0).getBoundingClientRect(),`<span class="bb-hlnote">${esc(s.error)}</span>`); return; }
  ftHlBar(s.rect,`<button type="button" class="bb-hlbtn" onclick="FT_hlAdd()">${ftIcon("marker")} Highlight</button>`);
  FT_HL.pending=s; // after ftHlBar, which resets it
}
let ftHlT=null;
document.addEventListener("selectionchange",()=>{ if(!document.body.classList.contains("bb-on")) return; clearTimeout(ftHlT); ftHlT=setTimeout(ftHlCheck,220); });
document.addEventListener("pointerup",e=>{ if(!document.body.classList.contains("bb-on")||e.target.closest?.("#hlBar")) return; setTimeout(ftHlCheck,10); });
document.addEventListener("click",e=>{
  if(!document.body.classList.contains("bb-on")) return;
  const m=e.target.closest?.("#bb mark.bb-hl");
  if(!m||!window.getSelection()?.isCollapsed) return;
  ftHlOfferRemove(m);
});
document.addEventListener("keydown",e=>{
  const m=e.target.closest?.("#bb mark.bb-hl"); if(!m) return;
  if(e.key==="Delete"||e.key==="Backspace"){ e.preventDefault(); FT_hlRemove(Number(m.dataset.hid)); }
  else if(e.key==="Enter"||e.key===" "){ e.preventDefault(); e.stopPropagation(); ftHlOfferRemove(m); }
});
function ftHlOfferRemove(m){
  const id=Number(m.dataset.hid);
  document.querySelectorAll("#bb mark.bb-hl.on").forEach(x=>x.classList.remove("on"));
  document.querySelectorAll(`#bb mark.bb-hl[data-hid="${id}"]`).forEach(x=>x.classList.add("on"));
  ftHlBar(m.getBoundingClientRect(),`<button type="button" class="bb-hlbtn" onclick="FT_hlRemove(${id})">${svg("x","ic-sm")} Remove highlight</button>`,"remove");
}
document.addEventListener("pointerdown",e=>{
  const bar=document.getElementById("hlBar");
  if(bar&&bar.dataset.kind==="remove"&&!e.target.closest?.("#hlBar")&&!e.target.closest?.("mark.bb-hl")){ ftHlHideBar(); document.querySelectorAll("#bb mark.bb-hl.on").forEach(x=>x.classList.remove("on")); }
});
async function FT_hlAdd(){
  const s=FT_HL.pending, q=ftHlCurrentQ(); if(!s||!q) return;
  ftHlHideBar(); window.getSelection()?.removeAllRanges();
  // Merge with any highlight it overlaps or touches, as the server does.
  const list=ftHlFor(q.id);
  const over=list.filter(h=>h.field===s.field&&h.startOffset<=s.end&&h.endOffset>=s.start);
  const start=Math.min(s.start,...over.map(h=>h.startOffset)), end=Math.max(s.end,...over.map(h=>h.endOffset));
  const mergedQuote=ftHlText(s.root).slice(start,end);
  const temp={id:-Date.now(),questionId:q.id,field:s.field,startOffset:start,endOffset:end,quote:mergedQuote};
  FT_HL.byQ.set(q.id,[...list.filter(h=>!over.includes(h)),temp]);
  ftHlRefresh();
  try{
    const r=await api("test-highlights",{method:"POST",body:JSON.stringify({attemptId:T.id,questionId:q.id,field:s.field,start:s.start,end:s.end,quote:s.quote,mergedQuote})});
    FT_HL.byQ.set(q.id,[...ftHlFor(q.id).filter(h=>h!==temp&&!r.replaced.includes(h.id)),r.highlight]);
  }catch(e){
    FT_HL.byQ.set(q.id,[...ftHlFor(q.id).filter(h=>h!==temp),...over]);
    toast(e.status?e.message:"You're offline — the highlight wasn't saved.");
  }
  if(ftHlCurrentQ()?.id===q.id) ftHlRefresh();
}
async function FT_hlRemove(id){
  const q=ftHlCurrentQ(); if(!q) return;
  ftHlHideBar();
  const prev=ftHlFor(q.id);
  FT_HL.byQ.set(q.id,prev.filter(h=>h.id!==id)); ftHlRefresh();
  if(id<0) return;
  try{ await api(`test-highlights/${id}`,{method:"DELETE"}); }
  catch(e){ FT_HL.byQ.set(q.id,prev); toast(e.status?e.message:"You're offline — the highlight wasn't removed."); if(ftHlCurrentQ()?.id===q.id) ftHlRefresh(); }
}
async function FT_hlClear(){
  const q=ftHlCurrentQ(); if(!q||!ftHlFor(q.id).length) return;
  ftHlHideBar();
  const prev=ftHlFor(q.id);
  FT_HL.byQ.set(q.id,[]); ftHlRefresh();
  try{ await api(`test-highlights?attemptId=${T.id}&questionId=${q.id}`,{method:"DELETE"}); }
  catch(e){ FT_HL.byQ.set(q.id,prev); toast(e.status?e.message:"You're offline — highlights weren't cleared."); if(ftHlCurrentQ()?.id===q.id) ftHlRefresh(); }
}

// ── Break between sections ──
let FT_breakTimer=null;
function stopFtBreak(){ if(FT_breakTimer){ clearInterval(FT_breakTimer); FT_breakTimer=null; } }
function ftBreakLeft(){ return T?.breakEndsAt?Math.max(0,Math.round((new Date(T.breakEndsAt).getTime()-(Date.now()+T.skew))/1000)):0; }
function startTestBreak(endsAt){
  T.breakEndsAt=endsAt;
  stopFtBreak(); ftEnterRunner(); desmosHide(); ftHlHideBar();
  const next=currentTestModule();
  $c().innerHTML=`<div class="bb bb-break">
    <div class="bb-break-card">
      <div class="bb-break-clock"><span>Remaining Break Time:</span><b id="bbBreak">${fmtTime(ftBreakLeft())}</b></div>
      <button type="button" class="bb-btn primary" onclick="skipTestBreak()">Resume Testing</button>
      <div class="bb-break-copy">
        <h2>Practice Test Break</h2>
        <p>You can resume this practice test as soon as you're ready to move on. On test day, you'll wait until the clock counts down.</p>
        <p>Next up: <b>${esc(next?next.title:"the next section")}</b>${next?.timeLimitMinutes?` · ${next.timeLimitMinutes} minutes`:""}.</p>
        <h3>Take a Break: Do Not Close Your Device</h3>
        <p>After the break, a <b>Resume Testing</b> button will appear and you'll start the next section. The section clock starts the moment the break ends.</p>
      </div></div></div>`;
  FT_breakTimer=setInterval(()=>{
    const left=ftBreakLeft();
    const el=document.getElementById("bbBreak"); if(el) el.textContent=fmtTime(left);
    if(left<=0){ stopFtBreak(); T.breakEndsAt=null; beginModuleAfterBreak(); }
  },1000);
}
function beginModuleAfterBreak(){
  if(!T||state.view!=="testsit") return;
  startTestTimer(); startTestAutosave(); renderTestQuestion(); writeLocalTestSnapshot();
}
async function skipTestBreak(){
  if(!T) return;
  stopFtBreak(); loading();
  try{ await api(`test-attempts/${T.id}/skip-break`,{method:"POST",body:"{}"}); }catch(e){ if(e.status) toast(e.message); }
  reloadTestSit();
}

// ──────────────── Score report & answer review ────────────────
let FR={filter:"all",open:null};
function renderTestResult(){
  stopTestTimer(); stopFtBreak(); ftExitRunner(); plExamEnd();
  if(desmosFloatEl) desmosDestroy();
  try{ localStorage.removeItem(dfKey(`test:${T.id}`)); }catch{}
  const a=T.attempt, t=T.test, r=T.report||a.scoreReport||null;
  FR={filter:"all",open:null};
  const answers=a.answers||{};
  const results=r?.questionResults||{};
  const isOk=q=>results[String(q.id)]!==undefined?results[String(q.id)]:testAnswerCorrect(q,answers[String(q.id)]||"");
  const sec=k=>r?.sections?.[k];
  const partial=(r?.scope||a.practiceScope)==="modules";
  const untimed=a.timed===false||r?.timed===false;
  const tile=(k,label)=>{ const s=sec(k); if(!s) return "";
    // A section the scaled model cannot score (only part of it was practised) shows its raw result.
    if(s.scaled==null) return `<div class="fr-sec"><div class="fr-sec-head"><span>${label}</span><b>${s.raw}/${s.total}</b></div>
      <div class="umeta">Raw result${partial?" · no scaled score for part of a section":""}${s.track?` · ${esc(s.track)} track`:""}</div></div>`;
    const pct=((s.scaled-200)/600)*100;
    return `<div class="fr-sec"><div class="fr-sec-head"><span>${label}</span><b>${s.scaled}</b></div>
      <div class="fr-scale"><i style="left:${pct}%"></i></div><div class="fr-scale-lbl"><span>200</span><span>800</span></div>
      <div class="umeta">${s.raw}/${s.total} correct${s.track?` · Module 2: ${esc(s.track)} track`:""}</div></div>`; };
  const total=r?.totalScaled;
  const modeTag=[partial?"Selected-module practice":"",untimed?"Untimed":""].filter(Boolean).map(x=>`<span class="pill ft-pill-gold">${x}</span>`).join(" ");
  const mods=t.modules.map((m,i)=>{
    const correct=m.questions.filter(isOk).length;
    return `<div class="fr-mod"><b>${esc(m.title)}</b><span>${correct}/${m.questions.length}</span><div class="ft-progress"><i style="width:${m.questions.length?Math.round(correct/m.questions.length*100):0}%"></i></div></div>`;
  }).join("");
  const viewer=state.user.role!=="student";
  $c().innerHTML=`<div class="fr fade">
    <div class="fr-hero">
      <div class="fr-total">
        <div class="umeta">${esc(t.title)}${a.submittedAt?` · ${esc(ftDate(a.submittedAt))}`:""}</div>
        <h1>${viewer?"Score report":"Your score report"}</h1>${modeTag?`<div class="fr-mode">${modeTag}</div>`:""}
        ${total!=null?`<div class="fr-big">${total}</div><div class="fr-range">Estimated total score · 400–1600</div>
          <div class="fr-scale wide"><i style="left:${((total-400)/1200)*100}%"></i></div><div class="fr-scale-lbl"><span>400</span><span>1600</span></div>`
          :`<div class="fr-big">${r?.correctCount??a.correctCount}<small>/${r?.totalCount??a.totalCount}</small></div><div class="fr-range">${partial?`Raw result · ${t.modules.length} selected module${t.modules.length===1?"":"s"} only`:sec("ebrw")||sec("math")?"Section score below — a total needs both sections":"Raw score"}</div>`}
      </div>
      <div class="fr-secs">${tile("ebrw","Reading and Writing")}${tile("math","Math")}</div>
    </div>
    <p class="umeta fr-disclaimer">${partial?"Selected-module practice: only the modules you chose are graded — questions outside them are not counted as skipped or incorrect. A scaled score is shown only for a section you practised in full. ":""}Scaled scores are estimates from your raw results${r?.adaptive&&!partial?" and the Module 2 difficulty you were routed to":""}; official scores use College Board's equating.</p>
    <div class="fr-grid">
      <div class="panel"><h2>${svg("layers","ic-sm")} Modules</h2>${mods}</div>
      <div class="panel"><h2>${svg("target","ic-sm")} Knowledge and skills</h2>${r?.domains?.length?ftDomainBarsHTML(r.domains,true):`<p class="umeta">No domain data.</p>`}</div>
    </div>
    <div class="panel"><div class="fr-rev-head"><h2>${svg("book","ic-sm")} Question-by-question review</h2>
      <div class="vb-seg">${[["all","All"],["missed","Missed"],["correct","Correct"]].map(([k,l])=>`<button class="${FR.filter===k?"on":""}" onclick="FR_filter('${k}')">${l}</button>`).join("")}</div></div>
      <p class="umeta">Select any question to see your answer, the correct answer and the explanation.</p>
      <div id="frGrids">${frGridsHTML(isOk)}</div>
      <div id="frDetail"></div></div>
    <div style="display:flex;gap:.7rem;justify-content:center;flex-wrap:wrap;margin:1.4rem 0">
      <button class="btn btn-primary" onclick="go('tests')">${svg("layers","ic-sm")} Back to tests</button>
      ${viewer?"":`<button class="btn btn-ghost" onclick="go('profile')">${svg("profile","ic-sm")} View progress</button>`}
    </div></div>`;
  FR.isOk=isOk;
  const firstMiss=t.modules.flatMap((m,mi)=>m.questions.map((q,qi)=>({q,mi,qi}))).find(x=>!isOk(x.q));
  if(firstMiss) FR_open(firstMiss.mi,firstMiss.qi);
}
function frGridsHTML(isOk){
  const t=T.test, answers=T.attempt.answers||{};
  return t.modules.map((m,mi)=>`<div class="fr-gmod"><div class="fr-gtitle">${esc(m.title)}</div><div class="fr-cells">${m.questions.map((q,qi)=>{
    const ok=isOk(q), blank=!answers[String(q.id)];
    if(FR.filter==="missed"&&ok) return ""; if(FR.filter==="correct"&&!ok) return "";
    return `<button type="button" class="fr-cell ${ok?"ok":blank?"blank":"no"} ${FR.open===mi+":"+qi?"cur":""}" onclick="FR_open(${mi},${qi})" title="${ok?"Correct":blank?"Omitted":"Incorrect"} · ${esc(q.category)}">${qi+1}</button>`;
  }).join("")||`<span class="umeta">Nothing to show.</span>`}</div></div>`).join("");
}
function FR_filter(k){ FR.filter=k; document.querySelectorAll(".fr-rev-head .vb-seg button").forEach((b,i)=>b.classList.toggle("on",["all","missed","correct"][i]===k)); document.getElementById("frGrids").innerHTML=frGridsHTML(FR.isOk); }
function FR_open(mi,qi){
  const m=T.test.modules[mi], q=m?.questions[qi]; if(!q) return;
  FR.open=mi+":"+qi;
  document.getElementById("frGrids").innerHTML=frGridsHTML(FR.isOk);
  const given=(T.attempt.answers||{})[String(q.id)]||"";
  const ok=FR.isOk(q);
  const el=document.getElementById("frDetail");
  el.innerHTML=`<div class="fr-detail">
    <div class="fr-detail-head"><b>${esc(m.title)} · Question ${qi+1}</b>
      <span class="pill ${ok?"ft-pill-mint":given?"ft-pill-red":"pill-muted"}">${ok?"Correct":given?"Incorrect":"Omitted"}</span>
      <span class="umeta">${esc(q.category)}${q.subcategory?` · ${esc(q.subcategory)}`:""}</span></div>
    <div class="bb bb-inline">${ftWorkspaceHTML({...q},{num:qi+1,preview:true,section:m.section,given})}</div>
    <div class="fr-answers"><div><span>Your answer</span><b>${given?mathText(given):"—"}</b></div><div><span>Correct answer</span><b>${mathText(q.answer)}</b>${q.acceptableAnswers?.length?`<div class="umeta">Also accepted: ${q.acceptableAnswers.map(x=>esc(x)).join(", ")}</div>`:""}</div></div>
    <div class="explain"><h4>Explanation</h4><p>${mathText(q.explanation||"No explanation added.")}</p></div>
    <div style="margin-top:.6rem">${plReportButtonHTML(q.id,"review",T.id)}</div></div>`;
  typesetMath(el);
}
// Results are graded on the server; this is only a fallback for the review
// screen when an older sitting has no per-question results.
function testAnswerCorrect(q,given){
  if(!given||q.answer===undefined) return false;
  if(q.type!=="spr") return given===q.answer;
  return [q.answer,...(q.acceptableAnswers||[])].some(x=>sprMatches(given,x));
}
