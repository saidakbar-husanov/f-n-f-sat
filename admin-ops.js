// admin-ops.js — confirmation dialogs for destructive admin actions:
// bulk / single question deletion, account removal and class deletion.
// Loaded before the main studio script; relies on its helpers at call time
// (api, svg, esc, toast, go, ftModal, ftCloseModal, state, viewClassesAdmin,
// afterQuestionDeletion). Every action is authorised again on the server and
// every server step is idempotent, so a failed batch can simply be retried.

const AO={q:null,u:null,c:null};
const aoList=items=>`<ul class="ao-list">${items.map(i=>`<li>${i}</li>`).join("")}</ul>`;
const aoNum=n=>Number(n||0).toLocaleString();
const aoErr=msg=>`<p class="form-error" role="alert">${esc(msg)}</p>`;

// ═══════════════ QUESTIONS ═══════════════
async function AO_deleteQuestions(ids,label){
  ids=[...new Set(ids)].filter(Number.isInteger);
  if(!ids.length){ toast("Select at least one question"); return; }
  ftModal("Delete questions",`<div class="spin"></div><p class="umeta" style="text-align:center">Checking where ${aoNum(ids.length)} question${ids.length===1?" is":"s are"} used…</p>`);
  let p;
  try{ p=await api("admin/questions/delete-preview",{method:"POST",body:JSON.stringify({ids})}); }
  catch(e){ ftModal("Delete questions",aoErr(e.message)); return; }
  AO.q={ids,label,preview:p,operationId:`qdel-${Date.now().toString(36)}-${Math.random().toString(36).slice(2,8)}`,done:{deleted:[],retired:[],skipped:[]},next:0};
  const u=p.usage;
  const usageRows=[
    ["Used in published mocks",u.publishedMocks],["Used in draft tests",u.draftTests],["In assigned tasks",u.tasks],
    ["Answered in completed attempts",u.attempts],["Used in lesson practice",u.lessons],["Have question reports",u.reports],
  ].filter(r=>r[1]).map(([k,v])=>`<tr><td>${k}</td><td><b>${aoNum(v)}</b></td></tr>`).join("");
  const n=ids.length;
  ftModal(`Delete ${n===1?"1 question":aoNum(n)+" questions"}`,`
    <p>You selected <b>${esc(label||`${n} questions`)}</b> — <b>${aoNum(n)}</b> in total.</p>
    <div class="ao-split">
      <div class="ao-box ok"><b>${aoNum(p.deletable)}</b><span>unused — removed from the bank</span></div>
      <div class="ao-box warn"><b>${aoNum(p.retire)}</b><span>referenced — retired, not removed</span></div>
      <div class="ao-box"><b>${aoNum(p.skipped)}</b><span>skipped${Object.keys(p.skippedReasons||{}).length?` (${Object.entries(p.skippedReasons).map(([k,v])=>`${v} ${esc(k)}`).join(", ")})`:""}</span></div>
    </div>
    ${usageRows?`<table class="mini-table" style="margin:.4rem 0 .8rem"><thead><tr><th>Of the selected questions</th><th>Count</th></tr></thead><tbody>${usageRows}</tbody></table>`:`<p class="umeta">None of the selected questions is used anywhere yet.</p>`}
    <p class="umeta">Retired questions disappear from the bank, practice, pickers and new tasks, but keep their prompt, choices, correct answer and explanation wherever students and mentors review existing work — completed mocks, tasks and attempts look exactly as before.</p>
    <div class="field" style="margin-top:.8rem"><label for="aoQConfirm">Type <b>${n}</b> to confirm</label><input id="aoQConfirm" inputmode="numeric" autocomplete="off" oninput="document.getElementById('aoQGo').disabled=this.value.trim()!=='${n}'"/></div>
    <div id="aoQProgress"></div>`,
    {foot:`<button class="btn btn-ghost" onclick="ftCloseModal()">Cancel</button><button class="btn btn-danger" id="aoQGo" disabled onclick="AO_runQuestionDeletion()">${svg("trash","ic-sm")} Delete / retire ${aoNum(n)}</button>`});
}
async function AO_runQuestionDeletion(){
  const job=AO.q; if(!job) return;
  const size=job.preview.batchSize||250, total=job.ids.length, batches=Math.ceil(total/size);
  const btn=document.getElementById("aoQGo"); if(btn) btn.disabled=true;
  const bar=document.getElementById("aoQProgress");
  for(let i=job.next;i<batches;i++){
    if(bar) bar.innerHTML=`<div class="q-progress" style="margin-top:.8rem"><i style="width:${Math.round(i/batches*100)}%"></i></div><p class="umeta">Batch ${i+1} of ${batches}…</p>`;
    try{
      const r=await api("admin/questions/bulk-delete",{method:"POST",body:JSON.stringify({ids:job.ids.slice(i*size,(i+1)*size),operationId:job.operationId,batchIndex:i,batchCount:batches,expectedTotal:total,confirmCount:total})});
      job.done.deleted.push(...r.deleted); job.done.retired.push(...r.retired); job.done.skipped.push(...r.skipped);
      job.next=i+1;
    }catch(e){
      if(bar) bar.innerHTML=`${aoErr(`Batch ${i+1} of ${batches} failed: ${e.message}`)}<p class="umeta">Batches already finished are saved. Retrying is safe — questions that were already handled are reported as skipped.</p>`;
      if(btn){ btn.disabled=false; btn.textContent="Retry remaining batches"; }
      return;
    }
  }
  const d=job.done; AO.q=null;
  ftModal("Deletion complete",`<div class="ao-split">
      <div class="ao-box ok"><b>${aoNum(d.deleted.length)}</b><span>deleted</span></div>
      <div class="ao-box warn"><b>${aoNum(d.retired.length)}</b><span>retired</span></div>
      <div class="ao-box"><b>${aoNum(d.skipped.length)}</b><span>skipped</span></div></div>
    <p class="umeta">Recorded in the audit log with your name, the time and every affected question ID.</p>`,
    {foot:`<button class="btn btn-primary" onclick="ftCloseModal()">Done</button>`});
  if(typeof afterQuestionDeletion==="function") await afterQuestionDeletion();
}

// ═══════════════ ACCOUNTS ═══════════════
async function AO_removeUser(userId){
  ftModal("Remove account",`<div class="spin"></div>`);
  let d; try{ d=await api(`admin/users/${userId}/impact`); }catch(e){ ftModal("Remove account",aoErr(e.message)); return; }
  AO.u=d;
  const u=d.user, c=d.counts, isMentor=u.role==="mentor";
  if(d.isSelf){ ftModal("Remove account",`<p>You cannot remove your own account.</p>`); return; }
  const blockers=d.isLastActiveAdmin?aoErr("This is the last active admin. Give another account admin access before removing this one."):"";
  const classesHTML=isMentor?(d.classesAsMentor.length?`<h4>Classes this mentor teaches — choose who takes each one</h4>
    ${d.classesAsMentor.map(cl=>`<div class="ao-transfer"><div><b>${esc(cl.name)}</b><div class="umeta">${cl.students.length} student${cl.students.length===1?"":"s"}${cl.students.length?`: ${cl.students.slice(0,8).map(s=>esc(s.displayName)).join(", ")}${cl.students.length>8?"…":""}`:""}</div></div>
      <select id="aoT${cl.id}" aria-label="New mentor for ${esc(cl.name)}"><option value="">Transfer to…</option>${d.otherMentors.map(m=>`<option value="${m.id}">${esc(m.displayName)}</option>`).join("")}</select></div>`).join("")}
    ${d.otherMentors.length?"":aoErr("There is no other active mentor to take these classes. Approve another mentor first.")}
    <p class="umeta">Students, their memberships and their completed work stay with the class. Practice tasks move to the new mentor.</p>`:`<p class="umeta">This mentor has no active classes.</p>`):"";
  const studentHTML=d.classesAsStudent.length?`<h4>Class memberships that will end</h4>${aoList(d.classesAsStudent.map(x=>`${esc(x.name)} <span class="umeta">· mentor ${esc(x.mentorName)}</span>`))}`:"";
  const records=`<h4>Records linked to this account</h4><div class="ao-counts">
    ${[["Practice answers",c.attempts],["Test sittings",c.testSittings],["Submitted tests",c.testsSubmitted],["Lessons started",c.lessonProgress],["Mastery evidence",c.skillEvidence],["Badges",c.badges],["Messages",c.messages],["Saved questions",c.saved],["Lesson comments",c.comments],["Active sessions",c.sessions],...(isMentor?[["Tasks authored",c.tasksAuthored],["Lessons authored",c.lessonsAuthored]]:[])].map(([k,v])=>`<span><b>${aoNum(v)}</b> ${k}</span>`).join("")}</div>`;
  const modes=[
    {k:"deactivate",title:"Deactivate access",tag:"Reversible · keeps all data",items:d.retention.deactivate},
    ...(isMentor?[{k:"remove_mentor_role",title:"Remove the mentor role only",tag:"Keeps the account as a student account",items:["Mentor tools are removed; the person signs in again as a student.",d.hasStudentHistory?"Their existing student memberships and practice history are kept.":"Their account, login and messages are kept.","Their classes must be transferred to another mentor first."]}]:[]),
    {k:"delete",title:"Permanently delete personal data",tag:"Cannot be undone",items:d.retention.delete},
  ];
  ftModal(`Remove ${esc(u.displayName)}`,`
    <p><b>${esc(u.displayName)}</b> <span class="prov-tag">${esc(u.role)}</span> <span class="prov-tag">${esc(u.status)}</span> <span class="umeta">${esc(u.login||"")}</span></p>
    ${blockers}${classesHTML}${studentHTML}${records}
    <h4>Choose the action</h4>
    <div class="ao-modes">${modes.map((m,i)=>`<label class="ao-mode ${m.k==="delete"?"danger":""}"><input type="radio" name="aoMode" value="${m.k}" ${i===0?"checked":""} onchange="AO_userModeChanged()"/>
      <div><b>${m.title}</b> <span class="pill ${m.k==="delete"?"ft-pill-red":"pill-muted"}">${m.tag}</span>${aoList(m.items.map(esc))}</div></label>`).join("")}</div>
    <div class="field" id="aoUConfirmWrap" style="display:none;margin-top:.6rem"><label for="aoUConfirm">Type <b>${esc(u.displayName)}</b> to confirm permanent deletion</label><input id="aoUConfirm" autocomplete="off"/></div>
    <div id="aoUMsg"></div>`,
    {wide:true,foot:`<button class="btn btn-ghost" onclick="ftCloseModal()">Cancel</button><button class="btn btn-danger" id="aoUGo" ${d.isLastActiveAdmin?"disabled":""} onclick="AO_runRemoveUser()">Confirm</button>`});
  AO_userModeChanged();
}
function AO_userModeChanged(){
  const mode=document.querySelector('input[name="aoMode"]:checked')?.value;
  const wrap=document.getElementById("aoUConfirmWrap"); if(wrap) wrap.style.display=mode==="delete"?"":"none";
  const btn=document.getElementById("aoUGo");
  if(btn) btn.innerHTML=mode==="delete"?`${svg("trash","ic-sm")} Permanently delete`:mode==="remove_mentor_role"?"Remove mentor role":"Deactivate access";
}
async function AO_runRemoveUser(){
  const d=AO.u; if(!d) return;
  const mode=document.querySelector('input[name="aoMode"]:checked')?.value;
  const transfers={};
  for(const cl of d.classesAsMentor||[]){ const v=document.getElementById("aoT"+cl.id)?.value; if(v) transfers[cl.id]=Number(v); }
  const msg=document.getElementById("aoUMsg");
  if(d.user.role==="mentor"&&(d.classesAsMentor||[]).some(cl=>!transfers[cl.id])){ msg.innerHTML=aoErr("Choose a new mentor for every class first."); return; }
  if(mode!=="delete"&&!confirm(mode==="deactivate"?`Deactivate ${d.user.displayName}? They are signed out immediately.`:`Remove the mentor role from ${d.user.displayName}?`)) return;
  const btn=document.getElementById("aoUGo"); if(btn) btn.disabled=true;
  try{
    const r=await api(`admin/users/${d.user.id}/remove`,{method:"POST",body:JSON.stringify({mode,transfers,confirm:document.getElementById("aoUConfirm")?.value||""})});
    ftCloseModal();
    toast(r.alreadyDone?r.message:mode==="delete"?"Personal data deleted; records anonymised":mode==="deactivate"?"Access deactivated":"Mentor role removed");
    go("users");
  }catch(e){
    msg.innerHTML=aoErr(e.message)+`<p class="umeta">Nothing was half-applied: retrying is safe.</p>`;
    if(btn) btn.disabled=false;
  }
}
async function AO_reactivate(userId){
  if(!confirm("Reactivate this account? Class memberships are not restored automatically.")) return;
  try{ await api("users/"+userId,{method:"PATCH",body:JSON.stringify({action:"unban"})}); toast("Account reactivated"); go("users"); }catch(e){ toast(e.message); }
}

// ═══════════════ CLASSES ═══════════════
async function AO_deleteClass(classId){
  ftModal("Delete class",`<div class="spin"></div>`);
  let d; try{ d=await api(`admin/classes/${classId}/impact`); }catch(e){ ftModal("Delete class",aoErr(e.message)); return; }
  AO.c=d;
  const opts=`<option value="remove">Remove from this class only</option>${d.otherClasses.map(o=>`<option value="${o.id}">Transfer to ${esc(o.name)}</option>`).join("")}`;
  ftModal(`Delete “${esc(d.class.name)}”`,`
    <p>Mentor: <b>${esc(d.mentor?.displayName||"—")}</b>. Student accounts, their other class memberships and all completed work and scores are kept.</p>
    <h4>Students (${d.students.length})</h4>
    ${d.students.length?`<div class="ao-bulkset"><label>Apply to everyone <select onchange="document.querySelectorAll('.aoCS').forEach(s=>s.value=this.value)">${opts}</select></label></div>
      ${d.students.map(s=>`<div class="ao-transfer"><div><b>${esc(s.displayName)}</b><div class="umeta">${s.otherClasses.length?`Also in ${s.otherClasses.map(o=>esc(o.name)).join(", ")}`:"No other classes"}</div></div>
        <select class="aoCS" data-sid="${s.id}" aria-label="What happens to ${esc(s.displayName)}">${opts}</select></div>`).join("")}`:`<p class="umeta">No active students.</p>`}
    <h4>Class-specific content that will be archived</h4>
    ${d.lessonsToArchive.length?aoList(d.lessonsToArchive.map(l=>esc(l.title))):`<p class="umeta">None.</p>`}
    <p class="umeta">The class's ${d.curriculum.units} unit${d.curriculum.units===1?"":"s"} and ${d.curriculum.placements} lesson placement${d.curriculum.placements===1?"":"s"} are archived; students lose access to them immediately.</p>
    <h4>Shared lessons that stay available elsewhere</h4>
    ${d.lessonsPreserved.length?aoList(d.lessonsPreserved.map(l=>`${esc(l.title)} <span class="umeta">· used by ${l.usedBy.map(esc).join(", ")}</span>`)):`<p class="umeta">None.</p>`}
    <h4>Tasks that reference this class</h4>
    <p class="umeta">${d.practiceTasks.length} practice task${d.practiceTasks.length===1?"":"s"}, ${d.examTasks.length} exam task${d.examTasks.length===1?"":"s"}, ${d.vocabTasks.length} vocabulary task${d.vocabTasks.length===1?"":"s"}. Their submissions and scores are kept for history.</p>
    <div class="field" style="margin-top:.8rem"><label for="aoCConfirm">Type <b>${esc(d.class.name)}</b> to confirm</label><input id="aoCConfirm" autocomplete="off"/></div>
    <div id="aoCMsg"></div>`,
    {wide:true,foot:`<button class="btn btn-ghost" onclick="ftCloseModal()">Cancel</button><button class="btn btn-danger" id="aoCGo" onclick="AO_runDeleteClass()">${svg("trash","ic-sm")} Delete class</button>`});
}
async function AO_runDeleteClass(){
  const d=AO.c; if(!d) return;
  const students={};
  document.querySelectorAll(".aoCS").forEach(s=>{ students[s.dataset.sid]=s.value==="remove"?{action:"remove"}:{action:"transfer",toClassId:Number(s.value)}; });
  const btn=document.getElementById("aoCGo"); if(btn) btn.disabled=true;
  try{
    const r=await api(`admin/classes/${d.class.id}/delete`,{method:"POST",body:JSON.stringify({confirm:document.getElementById("aoCConfirm").value,students})});
    ftCloseModal();
    toast(r.alreadyDone?r.message:`Class deleted · ${r.transferred} transferred, ${r.removed} removed, ${r.archivedLessons} lesson${r.archivedLessons===1?"":"s"} archived`);
    viewClassesAdmin();
  }catch(e){
    document.getElementById("aoCMsg").innerHTML=aoErr(e.message)+`<p class="umeta">No changes were saved — retrying is safe.</p>`;
    if(btn) btn.disabled=false;
  }
}
