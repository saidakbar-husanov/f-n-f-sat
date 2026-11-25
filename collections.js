// collections.js — Question Bank domain uploads and Challenging Questions.
//
//  • <CollectionImport />: the one "Import JSON" dialog used by the management
//    pages. The page preselects the destination; the file declares its own;
//    the server compares the two and the dialog shows the full destination,
//    the question count and how many questions are new / changed / unchanged
//    before anything is written. Full-length tests keep their uploader on the
//    Full-Length Tests page; choosing that destination here goes there.
//  • Student "Challenging Questions": named sets grouped by section, practised
//    in the regular question player (answer review, progress, shared Desmos).
//  • Staff "Challenging Questions": the sets, their questions, Import JSON.
// Loaded before the main script; everything here runs on demand.

const CI_TEMPLATES={
  domain:"/docs/collection-import/question-bank-domain-template.json",
  challenge:"/docs/collection-import/challenge-set-template.json",
  guide:"/docs/collection-import/README.md",
};
const CI_SECTION_LABEL={math:"Math",ebrw:"Reading and Writing"};
let CI=null; // the open import dialog
let CH={sets:null};

async function ciLoadSets(force){
  if(CH.sets&&!force) return CH.sets;
  try{ CH.sets=await api("challenge-sets"); }catch{ CH.sets=[]; }
  return CH.sets;
}

// ──────────────── shared Import JSON dialog ────────────────
// dest: {type:"questionBankDomain",section,domain} | {type:"challengeSet",section,setId|null}
async function openCollectionImport(dest,onDone){
  CI={dest:{skill:"",difficulty:"mixed",overrides:{},...dest},file:null,data:null,preview:null,busy:false,error:null,onDone:onDone||null};
  await ciLoadSets(true);
  let el=document.getElementById("ciModal");
  if(!el){
    el=document.createElement("div"); el.id="ciModal"; el.className="ci-modal";
    el.setAttribute("role","dialog"); el.setAttribute("aria-modal","true"); el.setAttribute("aria-labelledby","ciTitle");
    el.addEventListener("click",e=>{ if(e.target===el) closeCollectionImport(); });
    el.addEventListener("keydown",e=>{ if(e.key==="Escape") closeCollectionImport(); });
    document.body.appendChild(el);
  }
  ciRender();
  el.querySelector("#ciType")?.focus();
}
function closeCollectionImport(){ document.getElementById("ciModal")?.remove(); CI=null; }

function ciDestLabel(d){
  if(!d) return "";
  const sec=CI_SECTION_LABEL[d.section]||d.section;
  if(d.type==="fullLengthTest") return "Full-Length Tests";
  if(d.type==="questionBankDomain") return `Question Bank → ${sec} → ${d.domain}`;
  const set=(CH.sets||[]).find(s=>s.externalId===d.setId);
  return `Challenging Questions → ${sec} → ${set?set.title:"New set (title from the file)"}`;
}
function ciDestFieldsHTML(){
  const d=CI.dest;
  const sets=(CH.sets||[]).filter(s=>s.section===d.section);
  return `<div class="f-row ci-dest">
    <div class="field"><label for="ciType">Upload destination</label><select id="ciType" onchange="CI_setDest('type',this.value)">
      <option value="fullLengthTest">Full-Length Tests</option>
      <option value="questionBankDomain" ${d.type==="questionBankDomain"?"selected":""}>Question Bank</option>
      <option value="challengeSet" ${d.type==="challengeSet"?"selected":""}>Challenging Questions</option></select></div>
    <div class="field"><label for="ciSection">Section</label><select id="ciSection" onchange="CI_setDest('section',this.value)">
      ${Object.entries(CI_SECTION_LABEL).map(([k,l])=>`<option value="${k}" ${d.section===k?"selected":""}>${l}</option>`).join("")}</select></div>
    ${d.type==="questionBankDomain"
      ?`<div class="field"><label for="ciDomain">Domain</label><select id="ciDomain" onchange="CI_setDest('domain',this.value)">
          ${SECTIONS[d.section].categories.map(c=>`<option value="${esc(c)}" ${d.domain===c?"selected":""}>${esc(c)}</option>`).join("")}</select></div>`
      :`<div class="field"><label for="ciSet">Set</label><select id="ciSet" onchange="CI_setDest('setId',this.value)">
          <option value="">New set (id and title from the file)</option>
          ${sets.map(s=>`<option value="${esc(s.externalId)}" ${d.setId===s.externalId?"selected":""}>${esc(s.title)} · ${s.questionCount} question${s.questionCount===1?"":"s"}</option>`).join("")}</select></div>`}
  </div>
  <div class="f-row ci-dest ci-defaults">
    ${d.type==="questionBankDomain"?`<div class="field"><label for="ciSkill">Skill (batch default)</label><select id="ciSkill" onchange="CI_setDest('skill',this.value)">
      <option value="">Per question (from the file)</option>${(SUBSECTIONS[d.domain]||[]).map(k=>`<option value="${esc(k)}" ${d.skill===k?"selected":""}>${esc(k)}</option>`).join("")}</select></div>`
      :`<div class="field"><label>Skill</label><p class="umeta" style="margin-top:.4rem">Per question — a set mixes domains, so each question names its own skill.</p></div>`}
    <div class="field"><label for="ciDiff">Difficulty (batch default)</label><select id="ciDiff" onchange="CI_setDest('difficulty',this.value)">
      ${[["mixed","Mixed / Per question"],["Easy","Easy"],["Medium","Medium"],["Hard","Hard"]].map(([v,l])=>`<option value="${v}" ${d.difficulty===v?"selected":""}>${l}</option>`).join("")}</select></div>
    <div class="field" style="display:flex;align-items:flex-end"><button type="button" class="btn btn-ghost btn-sm" onclick="CI_downloadSample()">${svg("upload","ic-sm")} Download Sample JSON</button></div>
  </div>
  <p class="umeta">A question's own <code>skill</code> and <code>difficulty</code> override the batch defaults; corrections you pick in the preview override both. Every question needs a valid skill for its domain and a difficulty.</p>`;
}
function ciRender(){
  const el=document.getElementById("ciModal"); if(!el||!CI) return;
  const d=CI.dest;
  if(d.type==="fullLengthTest"){
    el.innerHTML=`<div class="ci-card"><div class="ci-head"><h2 id="ciTitle">${svg("upload","ic-sm")} Import JSON</h2><button class="btn btn-ghost btn-sm" onclick="closeCollectionImport()" aria-label="Close">${svg("x","ic-sm")}</button></div>
      ${ciDestFieldsHTML()}
      <p class="umeta">A full-length test file creates one test with its sections, modules and timing. It is checked and saved by the test importer on the Full-Length Tests page, which keeps its existing file format.</p>
      <div class="ci-actions"><button class="btn btn-primary" onclick="closeCollectionImport();go('tests')">${svg("layers","ic-sm")} Open Full-Length Tests</button></div></div>`;
    return;
  }
  const p=CI.preview;
  el.innerHTML=`<div class="ci-card">
    <div class="ci-head"><h2 id="ciTitle">${svg("upload","ic-sm")} Import JSON</h2><button class="btn btn-ghost btn-sm" onclick="closeCollectionImport()" aria-label="Close">${svg("x","ic-sm")}</button></div>
    ${ciDestFieldsHTML()}
    <p class="ci-dest-line">Destination: <b>${esc(ciDestLabel(d))}</b></p>
    <p class="umeta">${d.type==="questionBankDomain"
      ?"One file adds a batch of questions to this one domain. Each question keeps its SAT skill."
      :"One file creates or updates one named set. Questions may come from several domains of the section and stay in this set only."}
      The file must declare the same destination — it is never guessed from the file name or difficulty.
      Templates: <a href="${CI_TEMPLATES.domain}" download>domain batch</a> · <a href="${CI_TEMPLATES.challenge}" download>challenging set</a> · <a href="${CI_TEMPLATES.guide}" target="_blank" rel="noopener">format guide</a></p>
    <div class="vb-drop ci-drop" id="ciDrop" role="button" tabindex="0"
      ondragover="event.preventDefault();this.classList.add('over')" ondragleave="this.classList.remove('over')"
      ondrop="event.preventDefault();this.classList.remove('over');CI_file(event.dataTransfer?.files?.[0])"
      onclick="document.getElementById('ciFile').click()" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();document.getElementById('ciFile').click()}">
      <div class="vb-drop-ic">${svg("upload")}</div>
      <div><h3>${CI.file?esc(CI.file):"Choose one .json file"}</h3><p class="umeta">${CI.file?"Choose another file to replace it.":"Drop it here or click to browse. Nothing is saved until you confirm the preview."}</p></div>
      <input type="file" id="ciFile" accept=".json,application/json" hidden onchange="CI_file(this.files[0]);this.value=''"/>
    </div>
    <div id="ciBody">${CI.busy&&!p?`<div class="ft-progress"><div class="spin"></div><span>Checking the whole file…</span></div>`:ciPreviewHTML()}</div>
  </div>`;
}
const ciLi=m=>{ const at=m.indexOf(" — "); return at>0?`<li><b>${esc(m.slice(0,at))}</b>${esc(m.slice(at))}</li>`:`<li>${esc(m)}</li>`; };
function ciPreviewHTML(){
  if(CI.error) return `<div class="vb-err"><b>${esc(CI.error)}</b></div>`;
  const p=CI.preview; if(!p) return "";
  const c=p.counts||{};
  const mism=(p.mismatches||[]).length?`<div class="vb-err ci-mismatch" role="alert"><b>The file declares a different destination. Nothing will be imported until they match.</b>
      <table class="ft-table"><thead><tr><th></th><th>Selected on this page</th><th>Declared in the file</th></tr></thead><tbody>
      ${p.mismatches.map(m=>`<tr><td>${esc(m.field)}</td><td>${esc(m.selected)}</td><td>${esc(m.declared)}</td></tr>`).join("")}</tbody></table>
      ${p.declared?`<div class="ci-actions"><button class="btn btn-primary btn-sm" onclick="CI_useDeclared()">Use the file's destination: ${esc(ciDestLabel(ciDeclaredDest(p.declared)))}</button><span class="umeta">or fix the file and choose it again.</span></div>`:""}</div>`:"";
  const errs=(p.errors||[]).length?`<div class="vb-err" role="alert"><b>${p.errors.length} problem${p.errors.length===1?"":"s"} must be fixed in the file. Nothing was saved and the collection is unchanged.</b><ul>${p.errors.map(ciLi).join("")}</ul></div>`:"";
  const warns=(p.warnings||[]).length?`<details class="ci-notes"><summary>${p.warnings.length} note${p.warnings.length===1?"":"s"}</summary><ul>${p.warnings.map(ciLi).join("")}</ul></details>`:"";
  const setLine=p.set?`<p class="umeta">${p.set.exists?`Updates the existing set <code>${esc(p.set.externalId)}</code>${p.set.titleChanged?` — its title / description will change to “${esc(p.set.title)}”`:""}.`:`Creates the new set <code>${esc(p.set.externalId)}</code> “${esc(p.set.title)}”.`}${c.keptNotInFile?` ${c.keptNotInFile} question${c.keptNotInFile===1?"":"s"} already in the set but not in this file will be kept.`:""}</p>`:"";
  const summary=p.counts&&c.questions?`<div class="ft-summary ci-summary">
      ${[["Questions",c.questions],["Valid",c.valid??c.questions],["Invalid",c.invalid??0],["New",c.new],["Changed",c.changed],["Unchanged",c.unchanged],["Multiple choice",c.mcq],["Grid-in (SPR)",c.spr],["No explanation",c.missingExplanations??0],["Possible duplicates",c.duplicates??0],["Tables",c.tables],["Images",c.images]].map(([l,v])=>`<div><b>${v}</b><span>${l}</span></div>`).join("")}</div>`:"";
  const ov=CI.dest.overrides||{};
  const skillSel=it=>`<select class="ci-inline-sel" onchange="CI_override(${JSON.stringify(it.id).replace(/"/g,"&quot;")},'skill',this.value)"><option value="">${ov[it.id]?.skill?"(file / default)":esc(it.skill||"—")}</option>${(SUBSECTIONS[it.domain]||[]).map(k=>`<option value="${esc(k)}" ${ov[it.id]?.skill===k?"selected":""}>${esc(k)}</option>`).join("")}</select>`;
  const diffSel=it=>`<select class="ci-inline-sel" onchange="CI_override(${JSON.stringify(it.id).replace(/"/g,"&quot;")},'difficulty',this.value)"><option value="">${ov[it.id]?.difficulty?"(file / default)":esc(it.difficulty||"missing")}</option>${["Easy","Medium","Hard"].map(k=>`<option value="${k}" ${ov[it.id]?.difficulty===k?"selected":""}>${k}</option>`).join("")}</select>`;
  const rows=(p.items||[]).length?`<details class="ci-items" ${p.items.length<=30||c.invalid?"open":""}><summary>Questions in the file — correct skill or difficulty per question here</summary><div class="ft-table-wrap"><table class="ft-table"><thead><tr><th>#</th><th>Id</th><th>Domain</th><th>Skill</th><th>Difficulty</th><th>Type</th><th>Status</th></tr></thead><tbody>
      ${p.items.map((it,i)=>`<tr class="${it.valid===false?"ci-bad":""}"><td class="ft-num">${i+1}</td><td><code>${esc(it.id)}</code></td><td>${esc(it.domain)}</td><td>${skillSel(it)}</td><td>${diffSel(it)}</td><td>${it.type}</td>
        <td>${it.valid===false?`<span class="ci-st ci-changed">invalid</span>${(it.problems||[]).map(x=>`<div class="umeta">${esc(x)}</div>`).join("")}`:`<span class="ci-st ci-${it.status}">${it.status}</span>`}</td></tr>`).join("")}</tbody></table></div></details>`:"";
  const dist=p.difficulty&&c.questions?`<div class="ci-dist">${Object.entries(p.difficulty).map(([k,v])=>`<span class="pill ${k==="Easy"?"pill-easy":k==="Hard"?"pill-hard":"pill-med"}">${k}: ${v}</span>`).join("")}${(p.skills||[]).map(x=>`<span class="pill pill-muted">${esc(x.skill)} · ${x.count}</span>`).join("")}</div>`:"";
  const report=(p.errors||[]).length||(p.warnings||[]).length?`<button class="btn btn-ghost btn-sm" onclick="CI_downloadReport()">${svg("upload","ic-sm")} Download validation report</button>`:"";
  const writes=(c.new||0)+(c.changed||0);
  const action=p.ok
    ?(writes?`<button class="btn btn-primary" id="ciConfirm" onclick="CI_commit()" ${CI.busy?"disabled":""}>${svg("check","ic-sm")} Import into ${esc(p.destinationLabel)}: add ${c.new}, update ${c.changed}</button>`
      :`<span class="ci-ok">${svg("check","ic-sm")} Already up to date — all ${c.unchanged} question${c.unchanged===1?" is":"s are"} unchanged. Importing again creates no duplicates.</span>`)
    :"";
  return `${mism}${errs}
    ${p.ok||c.questions?`<p class="ci-dest-line">${p.ok?"Ready to import into":"Destination"} <b>${esc(p.destinationLabel)}</b> · ${c.questions||0} question${c.questions===1?"":"s"}</p>`:""}
    ${setLine}${summary}${dist}
    ${p.ok&&c.changed?`<p class="umeta">${c.changed} existing question${c.changed===1?"":"s"} will be replaced by the file's version only when you confirm.</p>`:""}
    <div class="ci-actions">${action}${report}<button class="btn btn-ghost" onclick="closeCollectionImport()">${p.ok&&writes?"Cancel":"Close"}</button></div>
    ${rows}${warns}`;
}
function ciDeclaredDest(dec){
  return dec.type==="challengeSet"?{type:"challengeSet",section:dec.section,setId:(CH.sets||[]).some(s=>s.externalId===dec.setId)?dec.setId:""}
    :{type:dec.type,section:dec.section,domain:dec.domain};
}
function CI_setDest(key,value){
  const d=CI.dest;
  if(key==="type"){ d.type=value; d.skill=""; if(value==="questionBankDomain"&&!SECTIONS[d.section].categories.includes(d.domain)) d.domain=SECTIONS[d.section].categories[0]; if(value==="challengeSet") d.setId=d.setId||""; }
  else if(key==="section"){ d.section=value; d.domain=SECTIONS[value].categories[0]; d.setId=""; d.skill=""; }
  else if(key==="domain"){ d.domain=value; d.skill=""; }
  else d[key]=value;
  CI.preview=null; CI.error=null;
  ciRender();
  if(CI.data!=null&&d.type!=="fullLengthTest") CI_preview();
}
function CI_override(id,key,value){
  const o=CI.dest.overrides||(CI.dest.overrides={});
  const cur={...(o[id]||{})};
  if(value) cur[key]=value; else delete cur[key];
  if(Object.keys(cur).length) o[id]=cur; else delete o[id];
  CI_preview();
}
function CI_downloadReport(){
  const p=CI?.preview; if(!p) return;
  const lines=[`Validation report — ${ciDestLabel(CI.dest)} — ${CI.file||"file"}`,`Questions: ${p.counts?.questions??0} · valid ${p.counts?.valid??0} · invalid ${p.counts?.invalid??0}`,"",
    `ERRORS (${(p.errors||[]).length})`,...(p.errors||[]).map(e=>"- "+e),"",`WARNINGS (${(p.warnings||[]).length})`,...(p.warnings||[]).map(w=>"- "+w),
    ...(p.mismatches||[]).length?["","DESTINATION MISMATCHES",...p.mismatches.map(m=>`- ${m.field}: selected ${m.selected}, file declares ${m.declared}`)]:[]];
  const a=document.createElement("a"); a.href=URL.createObjectURL(new Blob([lines.join("\n")],{type:"text/plain;charset=utf-8"})); a.download="import-validation-report.txt"; a.click(); setTimeout(()=>URL.revokeObjectURL(a.href),2000);
}
// A sample file in the importer's real format, shaped by the current selections.
function ciSampleJSON(){
  const d=CI.dest, math=d.section==="math";
  const diff=k=>d.difficulty&&d.difficulty!=="mixed"?d.difficulty:k;
  const doms=SECTIONS[d.section].categories;
  const domainOf=i=>d.type==="questionBankDomain"?d.domain:doms[i%doms.length];
  const skillOf=i=>{ const dom=domainOf(i); return d.type==="questionBankDomain"&&d.skill?d.skill:(SUBSECTIONS[dom]||[])[0]; };
  const q=(i,extra)=>({id:`${d.type==="challengeSet"?"set":"bank"}-${d.section}-${String(i+1).padStart(3,"0")}`,...(d.type==="challengeSet"?{domain:domainOf(i)}:{}),skill:skillOf(i),...extra});
  const qs=math?[
    q(0,{difficulty:diff("Easy"),questionType:"MCQ",passageText:null,questionPrompt:"If $3x + 7 = 22$, what is the value of $x$?",options:[{id:"A",text:"$3$"},{id:"B",text:"$5$"},{id:"C",text:"$7$"},{id:"D",text:"$15$"}],correctAnswer:"B",explanation:"Subtract 7 from both sides: $3x = 15$, so $x = 5$."}),
    q(1,{difficulty:diff("Medium"),questionType:"SPR",passageText:"| Months | Total cost (dollars) |\n|---|---|\n| 1 | 23 |\n| 3 | 51 |",questionPrompt:"The total cost is a linear function of the number of months. What is the monthly price, in dollars?",options:[],correctAnswer:"14",acceptableAnswers:["14.00"],explanation:"The cost rises by $51 - 23 = 28$ dollars over 2 months, so the price is $14$ dollars per month."}),
    q(2,{difficulty:diff("Hard"),questionType:"MCQ",passageText:null,questionPrompt:"The function $f$ is defined by $f(x) = \\frac{x^2 - 9}{x - 3}$ for $x \\neq 3$. What is $f(5)$?",options:[{id:"A",text:"$2$"},{id:"B",text:"$5$"},{id:"C",text:"$8$"},{id:"D",text:"$16$"}],correctAnswer:"C",explanation:"$\\frac{x^2-9}{x-3} = x + 3$ for $x \\neq 3$, so $f(5) = 8$."}),
  ]:[
    q(0,{difficulty:diff("Medium"),questionType:"MCQ",passageText:"The ______ of the old bridge surprised engineers: after a century of floods, its stone arches showed almost no wear.",questionPrompt:"Which choice completes the text with the most logical and precise word or phrase?",options:[{id:"A",text:"fragility"},{id:"B",text:"durability"},{id:"C",text:"novelty"},{id:"D",text:"symmetry"}],correctAnswer:"B",explanation:"The arches survived floods with almost no wear, which shows durability."}),
    q(1,{difficulty:diff("Hard"),questionType:"MCQ",passageText:"Researchers found that bees trained to link a color with sugar water kept visiting that color for days after the reward was removed.",questionPrompt:"Which choice best states the main idea of the text?",options:[{id:"A",text:"Bees cannot see color."},{id:"B",text:"Bees retain learned associations for some time."},{id:"C",text:"Sugar water harms bees."},{id:"D",text:"Bees prefer one color by nature."}],correctAnswer:"B",explanation:"The bees kept returning after the reward ended, so the association lasted."}),
  ];
  const destination=d.type==="questionBankDomain"?{type:"questionBankDomain",section:d.section,domain:d.domain}
    :{type:"challengeSet",section:d.section,setId:d.setId||`${d.section}-sample-set`,title:(CH.sets||[]).find(x=>x.externalId===d.setId)?.title||"Sample Challenge Set",description:"Replace with your set description."};
  return {formatVersion:"1.0",destination,assets:[],questions:qs};
}
function CI_downloadSample(){
  const data=ciSampleJSON(), d=CI.dest;
  const name=d.type==="questionBankDomain"?`sample-${d.section}-${d.domain.toLowerCase().replace(/[^a-z0-9]+/g,"-")}.json`:`sample-challenge-set-${d.section}.json`;
  const a=document.createElement("a"); a.href=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:"application/json"})); a.download=name; a.click(); setTimeout(()=>URL.revokeObjectURL(a.href),2000);
}
function CI_useDeclared(){ if(!CI?.preview?.declared) return; const keep={difficulty:CI.dest.difficulty,overrides:CI.dest.overrides}; CI.dest={...ciDeclaredDest(CI.preview.declared),skill:"",...keep}; CI.preview=null; ciRender(); CI_preview(); }
async function CI_file(file){
  if(!file||!CI) return;
  CI.file=file.name; CI.data=null; CI.preview=null; CI.error=null;
  if(file.size>40*1024*1024){ CI.error="The file is over 40 MB. Keep each image under 3 MB."; ciRender(); return; }
  let text=""; try{ text=await file.text(); }catch{ CI.error="The file could not be read."; ciRender(); return; }
  try{ CI.data=JSON.parse(text); }catch(e){ CI.error=`The file is not valid JSON (${e.message}). Nothing was saved.`; ciRender(); return; }
  CI_preview();
}
async function CI_preview(){
  if(!CI||CI.data==null) return;
  CI.busy=true; CI.preview=null; ciRender();
  try{ CI.preview=await api("collections/import/preview",{method:"POST",body:JSON.stringify({data:CI.data,destination:CI.dest})}); }
  catch(e){ CI.error=e.message; }
  CI.busy=false; ciRender();
  const body=document.getElementById("ciBody"); if(body) typesetMath?.(body);
}
async function CI_commit(){
  const p=CI?.preview; if(!p?.ok||CI.busy) return;
  CI.busy=true; const btn=document.getElementById("ciConfirm"); if(btn){ btn.disabled=true; btn.textContent="Importing…"; }
  try{
    const r=await api("collections/import",{method:"POST",body:JSON.stringify({data:CI.data,destination:CI.dest,confirm:true,previewToken:p.previewToken})});
    const done=CI.onDone;
    toast(`Imported into ${r.destinationLabel}: ${r.created} added, ${r.updated} updated, ${r.unchanged} unchanged`);
    closeCollectionImport(); statsCache=null; CH.sets=null;
    if(done) done(r);
  }catch(e){
    CI.busy=false;
    if(e.data&&e.data.counts){ CI.preview=e.data; CI.error=null; ciRender(); toast(e.message); }
    else { CI.error=e.message; ciRender(); }
  }
}

// Student Challenging Questions pages live in practice.js (shared practice engine).

// ──────────────── staff: Challenging Questions management ────────────────
async function viewChallengeAdmin(){
  crumbs([{label:"Challenging Questions"}]);
  $c().innerHTML=`<div class="page-head fade"><h1>Challenging Questions</h1><p>Named practice sets for students, grouped by section. Each set comes from one JSON file; importing the same file again updates it without duplicates.</p></div><div id="chaList"><div class="spin"></div></div>`;
  const sets=await ciLoadSets(true);
  const el=document.getElementById("chaList"); if(!el) return;
  const admin=state.user?.role==="admin";
  el.innerHTML=["math","ebrw"].map(sec=>{
    const list=sets.filter(s=>s.section===sec);
    return `<div class="panel fade"><div class="ch-admin-head"><h2>${svg("trophy","ic-sm")} ${esc(CI_SECTION_LABEL[sec])}</h2>
        <button class="btn btn-primary btn-sm" onclick="openCollectionImport({type:'challengeSet',section:'${sec}',setId:''},viewChallengeAdmin)">${svg("upload","ic-sm")} Import JSON (new set)</button></div>
      ${list.length?`<div class="ft-table-wrap"><table class="ft-table"><thead><tr><th>Set</th><th class="ft-n">Questions</th><th></th></tr></thead><tbody>
        ${list.map(s=>`<tr><td><b>${esc(s.title)}</b><div class="umeta"><code>${esc(s.externalId)}</code>${s.description?` · ${esc(s.description)}`:""}</div></td><td class="ft-n">${s.questionCount}</td>
          <td class="ft-acts"><button class="btn btn-ghost btn-xs" onclick="CHA_view(${s.id})">${svg("pages","ic-sm")} Questions</button>
            <button class="btn btn-ghost btn-xs" onclick="openCollectionImport({type:'challengeSet',section:'${sec}',setId:${JSON.stringify(s.externalId).replace(/"/g,"&quot;")}},viewChallengeAdmin)">${svg("upload","ic-sm")} Import JSON</button>
            ${admin?`<button class="btn btn-ghost btn-xs ft-rm" onclick="CHA_delete(${s.id})">${svg("x","ic-sm")} Delete</button>`:""}</td></tr>`).join("")}
      </tbody></table></div>`:`<p class="umeta">No ${esc(CI_SECTION_LABEL[sec])} sets yet. Use the <a href="${CI_TEMPLATES.challenge}" download>challenging-set template</a> to write one.</p>`}
      <div id="chaQ-${sec}"></div></div>`;
  }).join("");
}
async function CHA_view(id){
  let data; try{ data=await api("challenge-sets/"+id); }catch(e){ toast(e.message); return; }
  const box=document.getElementById("chaQ-"+data.set.section); if(!box) return;
  box.innerHTML=`<div class="ch-qlist"><h3>${esc(data.set.title)} · ${data.questions.length} question${data.questions.length===1?"":"s"}</h3>
    <div class="ft-table-wrap"><table class="ft-table"><thead><tr><th>#</th><th>Id</th><th>Domain · skill</th><th>Question</th><th>Answer</th></tr></thead><tbody>
    ${data.questions.map((q,i)=>`<tr><td class="ft-num">${i+1}</td><td><code>${esc(q.externalId||"")}</code></td><td>${esc(q.category)}<div class="umeta">${esc(q.subcategory||"")}</div></td><td class="ft-prompt"><span class="ft-clip">${esc(mathPlain(q.prompt)).slice(0,200)}</span></td><td>${mathText(q.answer)}</td></tr>`).join("")}
    </tbody></table></div><p class="umeta">To change these questions, edit the set's JSON file and import it again — the preview lists exactly which questions change before you confirm.</p></div>`;
  typesetMath?.(box); box.scrollIntoView({behavior:"smooth",block:"nearest"});
}
async function CHA_delete(id){
  const s=(CH.sets||[]).find(x=>x.id===id);
  if(!confirm(`Delete the set “${s?.title||id}” and its ${s?.questionCount??""} questions? Students' past answers stay in their history.`)) return;
  try{ await api("challenge-sets/"+id,{method:"DELETE"}); toast("Set deleted"); viewChallengeAdmin(); }catch(e){ toast(e.message); }
}

// Question Bank management pages: Import JSON preselected to the filtered domain.
function bankImportButtonHTML(filterVar){
  return `<button class="btn btn-primary btn-sm" onclick="openBankImport(${filterVar})">${svg("upload","ic-sm")} Import JSON</button>`;
}
function openBankImport(filter){
  const section=filter?.section||"math";
  const domain=filter?.category&&SECTIONS[section].categories.includes(filter.category)?filter.category:SECTIONS[section].categories[0];
  openCollectionImport({type:"questionBankDomain",section,domain},()=>routeView());
}
