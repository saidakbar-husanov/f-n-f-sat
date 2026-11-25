// features.js — profile settings, leaderboard privacy, subject access editor,
// class announcements and the Reading Library.

// ──────────────── navigation: hide switched-off areas ────────────────
const NAV_AREA={bank:"bank",challenge:"challenge",rush:"rush",learn:"lessons",lessons:"lessons"};
function navAllowed(v){
  if(state.user?.role!=="student"||!ACC.data) return true;
  if(v==="library") return !!ACC.data.library;
  const area=NAV_AREA[v]; if(!area) return true;
  return (ACC.data.subjects?.[area]||[]).length>0;
}
function refreshNav(){
  const shell=document.getElementById("shell"); if(!shell||!state.user) return;
  shell.querySelectorAll(".nav-item[data-v]").forEach(b=>{ b.hidden=!navAllowed(b.dataset.v); });
}
async function primeAccess(){ if(state.user?.role==="student"){ await loadAccess(true); refreshNav(); } }

// ──────────────── settings: profile, privacy, password ────────────────
function viewSettings(){
  crumbs([{label:"Settings"}]);
  const u=state.user, p=u.profile||{}, theme=currentTheme();
  const admin=p.provider==="admin";
  $c().innerHTML=`<div class="page-head fade"><h1>Settings</h1><p>Your profile, privacy and sign-in details.</p></div>
  <div class="fade settings-grid">
    <section class="panel" aria-labelledby="stProfileH"><h2 id="stProfileH">${svg("profile","ic-sm")} Profile</h2>
      <div class="f-row"><div class="field"><label for="stName">Name</label><input id="stName" autocomplete="name" value="${esc(p.displayName||u.name)}"/></div>
      <div class="field"><label for="stUser">Username</label><input id="stUser" autocomplete="username" ${admin?"disabled":""} value="${esc(p.username||"")}" aria-describedby="stUserHelp"/>
        <p class="umeta" id="stUserHelp">Shown on leaderboards instead of your name. Letters, numbers, dots, dashes or underscores; letter case doesn't matter.</p></div></div>
      ${admin?"":`<div class="f-row"><div class="field"><label for="stEmail">Login email</label><input id="stEmail" type="email" autocomplete="email" value="${esc(p.email||"")}" ${p.hasPassword?"":"disabled"}/>
        ${p.hasPassword?`<p class="umeta">Changing it needs your current password.</p>`:`<p class="umeta">This account signs in with Google, which manages its email. Set a password below to change it here.</p>`}</div>
      <div class="field"><label for="stCur">Current password <span class="umeta">(only to change email)</span></label><input id="stCur" type="password" autocomplete="current-password"/></div></div>`}
      ${p.previousEmail?`<div class="st-note">${svg("info","ic-sm")} <div>Your previous login email <b>${esc(p.previousEmail)}</b> still signs in because email delivery isn't configured, so the new address can't be confirmed by link. <button type="button" class="linkish" onclick="FX_dropPrevEmail()">Stop using it</button></div></div>`:""}
      <p class="st-err" id="stErr" role="alert"></p>
      <button class="btn btn-primary" id="stSave" onclick="FX_saveProfile()">${svg("save","ic-sm")} Save profile</button>
    </section>
    ${u.role==="student"?`<section class="panel" aria-labelledby="stLbH"><h2 id="stLbH">${svg("trophy","ic-sm")} Leaderboard privacy</h2>
      <label class="st-switch"><input type="checkbox" id="stLb" ${p.leaderboardVisible!==false?"checked":""} onchange="FX_setLbVisible(this.checked)"/> <span><b>Show me on the leaderboard</b><br><span class="umeta">Other students, mentors and admins see only your username. When this is off you are left out of their rankings, searches and exports. Your scores and history are kept, and the super admin can still see hidden entries.</span></span></label>
    </section>`:""}
    <section class="panel"><h2>${svg(theme==="dark"?"moon":"sun","ic-sm")} Appearance</h2>
      <div class="opt-row" style="justify-content:flex-start">
        <button type="button" class="opt ${theme==='dark'?'on':''}" data-theme-opt="dark" onclick="setTheme('dark',event)">${svg("moon","ic-sm")} Dark</button>
        <button type="button" class="opt ${theme==='light'?'on':''}" data-theme-opt="light" onclick="setTheme('light',event)">${svg("sun","ic-sm")} Light</button>
      </div></section>
    ${p&&(p.username||p.email||p.phone)&&!admin?`<section class="panel"><h2>${svg("lock","ic-sm")} Password</h2>${plPasswordFormHTML(false)}</section>`:""}
    <section class="panel"><h2>${svg("logout","ic-sm")} Session</h2>
      <p style="color:var(--ink2);font-size:.9rem;margin-bottom:1rem">Signed in as <b>${esc(u.name)}</b>${p.username?` (@${esc(p.username)})`:""} · ${esc(u.role)}.</p>
      <button class="btn btn-danger" onclick="logout()">${svg("logout","ic-sm")} Log out</button></section>
  </div>`;
}
function FX_applyUser(user){
  localStorage.setItem(LS.user,JSON.stringify(user)); state.user=loadUser();
  const chip=document.querySelector(".user-chip .un"); if(chip) chip.textContent=state.user.name;
}
async function FX_saveProfile(){
  const err=document.getElementById("stErr"), btn=document.getElementById("stSave"); err.textContent="";
  const p=state.user.profile||{};
  const body={displayName:document.getElementById("stName").value};
  const un=document.getElementById("stUser"); if(un&&!un.disabled) body.username=un.value;
  const em=document.getElementById("stEmail");
  if(em&&!em.disabled&&em.value.trim().toLowerCase()!==(p.email||"")){ body.email=em.value; body.currentPassword=document.getElementById("stCur").value; }
  btn.disabled=true; btn.textContent="Saving…";
  try{
    const r=await api("auth/profile",{method:"PUT",body:JSON.stringify(body)});
    FX_applyUser(r.user); toast(r.unchanged?"Nothing to change":"Profile saved");
    if(r.notice) alert(r.notice);
    viewSettings();
  }catch(e){
    err.textContent=e.message; btn.disabled=false; btn.innerHTML=`${svg("save","ic-sm")} Save profile`;
    const f=e.data?.field; const map={username:"stUser",email:"stEmail",currentPassword:"stCur"}; if(map[f]) document.getElementById(map[f])?.focus();
  }finally{ const c=document.getElementById("stCur"); if(c) c.value=""; }
}
async function FX_dropPrevEmail(){
  if(!confirm("Stop signing in with your previous email? Only your current login email will work.")) return;
  try{ const r=await api("auth/profile/previous-email",{method:"DELETE"}); FX_applyUser(r.user); toast("Previous email removed"); viewSettings(); }catch(e){ toast(e.message); }
}
async function FX_setLbVisible(on){
  try{ const r=await api("auth/leaderboard-visibility",{method:"PUT",body:JSON.stringify({visible:on})}); FX_applyUser(r.user); toast(on?"You're shown on the leaderboard":"You're hidden from the leaderboard"); }
  catch(e){ toast(e.message); const b=document.getElementById("stLb"); if(b) b.checked=!on; }
}
// Kept for old callers.
function saveName(){ FX_saveProfile(); }

// ──────────────── leaderboards ────────────────
const PL_LB={category:"points",period:"weekly",classId:"",q:"",page:0};
let lbSearchT=null;
async function viewLeaderboards(){
  crumbs([{label:"Leaderboards"}]);
  const first=!document.getElementById("lbBody"); if(first) loading();
  const qs=`category=${PL_LB.category}&period=${PL_LB.period}${PL_LB.classId?`&classId=${PL_LB.classId}`:""}${PL_LB.q?`&q=${encodeURIComponent(PL_LB.q)}`:""}`;
  let d; try{ d=await api(`leaderboards?${qs}&page=${PL_LB.page}`); }catch(e){ $c().innerHTML=`<div class="empty"><p>${esc(e.message)}</p></div>`; return; }
  if(state.view!=="leaderboards") return;
  const seg=(key,opts)=>`<div class="vb-seg">${opts.map(([k,l])=>`<button class="${PL_LB[key]===k?"on":""}" onclick="PL_LB.${key}='${k}';PL_LB.page=0;viewLeaderboards()">${l}</button>`).join("")}</div>`;
  const unit=d.category==="points"?"points":d.category==="accuracy"?"%":"days";
  const me=state.user.profile?.id;
  const rows=d.rows.map(r=>`<tr class="${r.studentId===me?"pl-me":""} ${r.hidden?"lb-hidden":""}"><td class="ft-num">${r.rank<=3?`<span class="pl-medal m${r.rank}">${r.rank}</span>`:r.rank}</td><td><b>@${esc(r.username)}</b>${r.studentId===me?` <span class="pill pill-sec">You</span>`:""}${r.hidden?` <span class="pill pill-muted" title="Hidden from everyone except the super admin">Hidden</span>`:""}</td>
    <td class="ft-n"><b>${r.value}</b> ${unit}${d.category==="accuracy"?`<div class="umeta">${r.extra.correct}/${r.extra.answered}</div>`:d.category==="streak"?`<div class="umeta">best ${r.extra.longest}</div>`:`<div class="umeta">${r.extra.questionPoints} q · ${r.extra.qualifyingDays} days · ${r.extra.mocks} mocks</div>`}</td>
    <td>${(r.badges||[]).slice(0,6).map(k=>`<span class="pl-badge-mini" title="${esc(k.replace(/_/g," "))}">${svg("trophy","ic-sm")}</span>`).join("")}${r.badges?.length>6?`<span class="umeta">+${r.badges.length-6}</span>`:""}</td></tr>`).join("");
  const help={points:"Easy correct 1 · Medium 2 · Hard 3 (first answer to each question in the period) · 5 per qualifying day · 20 per completed full-length mock.",
    accuracy:`First answer to each question in the period; at least ${d.minAccuracyQuestions} questions to appear. Ties: more correct answers, then more questions.`,
    streak:"Consecutive qualifying days (10 practice questions or one finished mock-test module). Ranked by the current streak."}[d.category];
  const pages=Math.max(1,Math.ceil(d.total/d.pageSize));
  const body=`${d.superAdmin?`<p class="lb-super">${svg("lock","ic-sm")} Super admin view: the complete leaderboard, including ${d.hiddenCount} hidden entr${d.hiddenCount===1?"y":"ies"} (marked <b>Hidden</b>). Everyone else sees visible entries only.</p>`:""}
    ${state.user.role==="student"&&d.myVisibility===false?`<p class="st-note">${svg("info","ic-sm")} You're hidden from the leaderboard. <button class="linkish" onclick="go('settings')">Change in Settings</button></p>`:""}
    ${d.me?`<p><b>Your rank: ${d.me.rank}</b> · ${d.me.value} ${unit}</p>`:""}
    ${rows?`<div class="ft-table-wrap lb-wrap"><table class="ft-table"><thead><tr><th>#</th><th>Username</th><th class="ft-n">Score</th><th>Badges</th></tr></thead><tbody>${rows}</tbody></table></div>
      ${pages>1?`<div class="qb-pager"><button class="btn btn-ghost btn-sm" ${d.page<=0?"disabled":""} onclick="PL_LB.page--;viewLeaderboards()">Previous</button><span class="umeta">Page ${d.page+1} of ${pages} · ${d.total} entries</span><button class="btn btn-ghost btn-sm" ${d.page+1>=pages?"disabled":""} onclick="PL_LB.page++;viewLeaderboards()">Next</button></div>`:`<p class="umeta">${d.total} entr${d.total===1?"y":"ies"}</p>`}`
      :`<div class="empty" style="padding:1.5rem"><p>${PL_LB.q?`No usernames match “${esc(PL_LB.q)}”.`:"No ranked students yet for this view."}</p></div>`}`;
  if(!first&&document.getElementById("lbBody")){ document.getElementById("lbBody").innerHTML=body; return; }
  $c().innerHTML=`<div class="page-head fade"><h1>Leaderboards</h1><p>Calculated on the server from verified answers. Entries show usernames only — never names or emails.</p></div>
    <div class="panel fade"><div class="pl-lb-filters">${seg("category",[["points","Points"],["accuracy","Accuracy"],["streak","Streak"]])}
      ${d.category==="streak"?"":seg("period",[["daily","Today"],["weekly","This week"],["monthly","This month"],["all","All time"]])}
      <select aria-label="Class" onchange="PL_LB.classId=this.value;PL_LB.page=0;viewLeaderboards()"><option value="">Platform-wide</option>${d.classes.map(c=>`<option value="${c.id}" ${String(PL_LB.classId)===String(c.id)?"selected":""}>${esc(c.name)}</option>`).join("")}</select>
      <input type="search" class="lb-search" placeholder="Search usernames" aria-label="Search usernames" value="${esc(PL_LB.q)}" oninput="clearTimeout(lbSearchT);const v=this.value;lbSearchT=setTimeout(()=>{PL_LB.q=v.trim();PL_LB.page=0;viewLeaderboards();},300)"/>
      <button class="btn btn-ghost btn-sm" onclick="FX_lbExport()">${svg("upload","ic-sm")} Export CSV</button></div>
      <p class="umeta" style="margin:.6rem 0">${esc(help)} Days follow the ${esc(d.timezone)} calendar.</p>
      <div id="lbBody">${body}</div></div>`;
}
async function FX_lbExport(){
  const qs=`category=${PL_LB.category}&period=${PL_LB.period}${PL_LB.classId?`&classId=${PL_LB.classId}`:""}${PL_LB.q?`&q=${encodeURIComponent(PL_LB.q)}`:""}&format=csv`;
  try{
    const r=await fetch(`/api/leaderboards?${qs}`,{headers:{authorization:"Bearer "+localStorage.getItem(LS.token)}});
    if(!r.ok) throw new Error("Export failed");
    const blob=await r.blob(); const a=document.createElement("a"); a.href=URL.createObjectURL(blob); a.download=`leaderboard-${PL_LB.category}-${PL_LB.period}.csv`; a.click(); setTimeout(()=>URL.revokeObjectURL(a.href),2000);
  }catch(e){ toast(e.message); }
}

// ──────────────── subject access (admin limits panel) ────────────────
const AX={data:null};
const AX_AREAS=[["bank","Question Bank"],["challenge","Challenging Questions"],["lessons","Lessons"],["rush","Question Rush"]];
const AX_SUBJ=[["math","SAT Math"],["ebrw","SAT English (Reading and Writing)"]];
const AX_PRESET={english:"English only",math:"Math only",both:"Both",custom:"Custom"};
const AX_SOURCE={user:"individual override",class:"class settings",default:"platform default (everything on)",conflict:"conflicting classes — current access kept"};
function axSummary(r){
  if(!r) return "";
  return AX_SUBJ.map(([s,l])=>{ const x=r[s]; if(!x.enabled) return `${l}: off`; const off=AX_AREAS.filter(([a])=>!x[a]).map(([,al])=>al); return `${l}: ${off.length?"on except "+off.join(", "):"on"}`; }).join(" · ");
}
async function FX_renderAccess(){
  const el=document.getElementById("fxAccess"); if(!el) return;
  let d; try{ d=AX.data=await api("admin/access"); }catch(e){ el.innerHTML=`<div class="panel"><p>${esc(e.message)}</p></div>`; return; }
  el.innerHTML=`<div class="panel fade"><h2>${svg("lock","ic-sm")} Subject access</h2>
    <p class="umeta">Each student has independent <b>SAT Math</b> and <b>SAT English (Reading and Writing)</b> master switches, with separate controls below them. The Reading Library follows the English switch. Turning a subject off keeps its section choices so they come back when it is turned on. Precedence: individual override → class preset → everything on. Full-length mock assignments and scoring are not affected.</p>
    ${d.conflicts.length?`<div class="ax-conflicts" role="alert"><b>${svg("flag","ic-sm")} ${d.conflicts.length} student${d.conflicts.length===1?" has":"s have"} conflicting class settings</b><p class="umeta">Their current access is kept until you set an individual override (or align the class presets).</p>
      <ul>${d.conflicts.map(c=>`<li><b>${esc(c.displayName)}</b> @${esc(c.username||"")} — ${c.classes.map(x=>`${esc(x.name||"Class #"+x.classId)}: ${AX_PRESET[x.preset]||x.preset}`).join(" vs ")} <button class="btn btn-ghost btn-xs" onclick="FX_userAccess(${c.id})">Resolve</button></li>`).join("")}</ul></div>`:""}
    <h4 style="margin-top:.8rem">Class presets</h4>
    <div class="ax-classes">${d.classes.map(c=>`<div class="ax-class"><b>${esc(c.name)}</b>
      <div class="vb-seg" role="group" aria-label="Preset for ${esc(c.name)}">${["english","math","both"].map(p=>`<button class="${c.preset===p?"on":""}" onclick="FX_classPreset(${c.id},'${p}')">${AX_PRESET[p]}</button>`).join("")}${c.preset?`<button onclick="FX_classPreset(${c.id},null)" title="Students inherit the default again">No preset</button>`:""}</div>
      <span class="umeta">${c.preset?AX_PRESET[c.preset]:"No preset (everything on)"}</span></div>`).join("")||`<p class="umeta">No classes yet.</p>`}</div>
    <h4 style="margin-top:1rem">Individual overrides</h4>
    ${d.users.length?`<table class="mini-table"><thead><tr><th>Student</th><th>Access</th><th></th></tr></thead><tbody>${d.users.map(u=>`<tr><td>${esc(u.displayName)} <span class="umeta">@${esc(u.username||"")}</span></td><td class="umeta">${esc(axSummary(u.rules))}</td><td><button class="btn btn-ghost btn-xs" onclick="FX_userAccess(${u.id})">Edit</button></td></tr>`).join("")}</tbody></table>`:`<p class="umeta">No individual overrides — students follow their class presets.</p>`}
  </div>`;
}
async function FX_classPreset(classId,preset){
  const body=preset?{scope:"class",targetId:classId,preset}:{scope:"class",targetId:classId,clear:true};
  let pv; try{ pv=await api("admin/access/preview",{method:"POST",body:JSON.stringify(body)}); }catch(e){ toast(e.message); return; }
  const name=AX.data?.classes.find(c=>c.id===classId)?.name||"this class";
  ftModal(`Preview · ${esc(name)} → ${preset?AX_PRESET[preset]:"No preset"}`,axPreviewHTML(pv.students),{wide:true,foot:`<button class="btn btn-ghost" onclick="ftCloseModal()">Cancel</button><button class="btn btn-primary" onclick="FX_classPresetSave(${classId},${plJs(preset)})">${svg("save","ic-sm")} Save preset</button>`});
}
async function FX_classPresetSave(classId,preset){
  try{
    if(preset) await api(`admin/access/class/${classId}`,{method:"PUT",body:JSON.stringify({preset})});
    else await api(`admin/access/class/${classId}`,{method:"DELETE"});
    toast("Class access saved"); ftCloseModal(); FX_renderAccess();
  }catch(e){ toast(e.message); }
}
function axPreviewHTML(students){
  if(!students.length) return `<p class="umeta">No active students in this class right now. The preset applies to anyone who joins.</p>`;
  return `<p class="umeta">Effective access after saving, and where it comes from.</p><div class="ft-table-wrap"><table class="mini-table"><thead><tr><th>Student</th><th>After saving</th><th>Source</th></tr></thead><tbody>${students.map(s=>`<tr class="${s.after.source==="conflict"?"ax-warn":""}"><td>${esc(s.displayName)} <span class="umeta">@${esc(s.username||"")}</span></td><td class="umeta">${esc(axSummary(s.after.rules))}${s.changed?` <span class="pill pill-sec">changes</span>`:""}</td><td>${esc(AX_SOURCE[s.after.source]||s.after.source)}${s.after.source==="conflict"?`<div class="umeta">${s.after.conflict.classes.map(c=>`${esc(c.name||"Class #"+c.classId)}: ${AX_PRESET[c.preset]||c.preset}`).join(" vs ")}</div>`:""}</td></tr>`).join("")}</tbody></table></div>`;
}
function axEditorHTML(r){
  return `<div class="ax-editor">${AX_SUBJ.map(([s,l])=>`<fieldset class="ax-col"><legend><label class="st-switch"><input type="checkbox" id="ax_${s}_enabled" ${r[s].enabled?"checked":""} onchange="FX_axMaster('${s}')"/> <b>${l}</b></label></legend>
    ${AX_AREAS.map(([a,al])=>`<label class="ax-area"><input type="checkbox" id="ax_${s}_${a}" ${r[s][a]?"checked":""} ${r[s].enabled?"":"disabled"}/> ${al}</label>`).join("")}
    ${s==="ebrw"?`<p class="umeta">Reading Library follows this switch.</p>`:""}</fieldset>`).join("")}</div>`;
}
function FX_axMaster(s){ const on=document.getElementById(`ax_${s}_enabled`).checked; AX_AREAS.forEach(([a])=>{ document.getElementById(`ax_${s}_${a}`).disabled=!on; }); }
function axRead(){ const out={}; AX_SUBJ.forEach(([s])=>{ out[s]={enabled:document.getElementById(`ax_${s}_enabled`).checked}; AX_AREAS.forEach(([a])=>{ out[s][a]=document.getElementById(`ax_${s}_${a}`).checked; }); }); return out; }
async function FX_userAccess(id){
  let d; try{ d=await api(`admin/access/user/${id}`); }catch(e){ toast(e.message); return; }
  const r=d.override||d.effective.rules;
  const eff=d.effective;
  ftModal(`Subject access · ${esc(d.user.displayName)}`,`<p class="umeta">Currently: <b>${esc(axSummary(eff.rules))}</b> — from ${esc(AX_SOURCE[eff.source]||eff.source)}.${d.classes.length?` Class presets: ${d.classes.map(c=>`${esc(c.name||"Class #"+c.classId)} (${AX_PRESET[c.preset]||c.preset})`).join(", ")}.`:""}</p>
    ${eff.source==="conflict"?`<p class="ax-conflicts">${svg("flag","ic-sm")} Conflicting class settings. Saving an individual override resolves it.</p>`:""}
    <h4>Individual override</h4>${axEditorHTML(r)}<div id="axPreview"></div>`,
    {wide:true,foot:`${d.override?`<button class="btn btn-ghost" onclick="FX_userAccessClear(${id})">Remove override</button>`:""}<button class="btn btn-ghost" onclick="FX_userAccessPreview(${id})">Preview</button><button class="btn btn-primary" onclick="FX_userAccessSave(${id})">${svg("save","ic-sm")} Save override</button>`});
}
async function FX_userAccessPreview(id){
  try{ const pv=await api("admin/access/preview",{method:"POST",body:JSON.stringify({scope:"user",targetId:id,rules:axRead()})}); document.getElementById("axPreview").innerHTML=axPreviewHTML(pv.students); }catch(e){ toast(e.message); }
}
async function FX_userAccessSave(id){
  try{ const pv=await api("admin/access/preview",{method:"POST",body:JSON.stringify({scope:"user",targetId:id,rules:axRead()})});
    const box=document.getElementById("axPreview");
    if(box&&!box.dataset.shown){ box.dataset.shown="1"; box.innerHTML=axPreviewHTML(pv.students)+`<p class="umeta">Check the result above, then select <b>Save override</b> again to confirm.</p>`; return; }
    await api(`admin/access/user/${id}`,{method:"PUT",body:JSON.stringify({rules:axRead()})}); toast("Subject access saved"); ftCloseModal(); FX_renderAccess();
  }catch(e){ toast(e.message); }
}
async function FX_userAccessClear(id){
  if(!confirm("Remove the individual override? The student follows their class presets again.")) return;
  try{ await api(`admin/access/user/${id}`,{method:"DELETE"}); toast("Override removed"); ftCloseModal(); FX_renderAccess(); }catch(e){ toast(e.message); }
}

// ──────────────── super admin: administrator access ────────────────
async function FX_setAdmin(userId,grant){
  if(!confirm(grant?"Give this mentor ordinary admin access? They will need to sign in again.":"Remove admin access? The account becomes a mentor again and signs in again.")) return;
  try{ await api(`users/${userId}`,{method:"PATCH",body:JSON.stringify({action:grant?"grant-admin":"revoke-admin"})}); toast(grant?"Admin access granted":"Admin access removed"); go("users"); }catch(e){ toast(e.message); }
}

// ──────────────── class announcements ────────────────
const AN={list:null,targets:null};
async function viewAnnouncements(){
  if(state.announcementId) return viewAnnouncement(Number(state.announcementId));
  crumbs([{label:"Announcements"}]); loading();
  const staff=state.user.role!=="student";
  let list=[],targets=[];
  try{ [list,targets]=await Promise.all([api("announcements"),staff?api("announcements/targets"):Promise.resolve([])]); }catch(e){ $c().innerHTML=`<div class="empty"><p>${esc(e.message)}</p></div>`; return; }
  if(state.view!=="announcements"||state.announcementId) return;
  AN.list=list; AN.targets=targets;
  $c().innerHTML=`<div class="page-head fade"><h1>Announcements</h1><p>${staff?(state.user.role==="mentor"?"Publish to the classes assigned to you. Every student in the chosen classes gets one in-app notification.":"Publish to one or more classes. Every student in the chosen classes gets one in-app notification."):"News from your classes, newest first."}</p></div>
    ${staff?`<div class="panel fade"><h2>${svg("edit","ic-sm")} New announcement</h2>
      <div class="field"><label for="anTitle">Title</label><input id="anTitle" maxlength="160"/></div>
      <div class="field"><label for="anBody">Message</label><textarea id="anBody" rows="5" maxlength="6000"></textarea></div>
      <fieldset class="pf-group"><legend>Classes</legend><div class="pf-opts">${targets.map(c=>`<label class="pf-opt"><input type="checkbox" class="anCls" value="${c.id}"/> <span>${esc(c.name)}</span></label>`).join("")||`<span class="umeta">No classes available to you.</span>`}</div></fieldset>
      <p class="st-err" id="anErr" role="alert"></p>
      <button class="btn btn-primary" id="anPub" onclick="FX_publish()" ${targets.length?"":"disabled"}>${svg("arr","ic-sm")} Publish</button></div>`:""}
    <div class="fade an-list">${list.length?list.map(a=>`<button type="button" class="an-card ${a.unread?"unread":""}" onclick="go('announcements',{announcementId:${a.id}})">
      <span class="an-title">${a.unread?`<i class="an-dot" aria-label="Unread"></i>`:""}${esc(a.title)}</span>
      <span class="an-prev">${esc(a.body.slice(0,180))}${a.body.length>180?"…":""}</span>
      <span class="umeta">${esc(a.author.displayName)} · ${esc(a.classes.map(c=>c.name).join(", "))} · ${esc(plWhen(a.publishedAt))}</span></button>`).join(""):`<div class="empty"><div class="ei">${svg("info")}</div><p>No announcements yet.</p></div>`}</div>`;
}
let anKey=null;
async function FX_publish(){
  const title=document.getElementById("anTitle").value.trim(), body=document.getElementById("anBody").value.trim();
  const classIds=[...document.querySelectorAll(".anCls:checked")].map(x=>Number(x.value));
  const err=document.getElementById("anErr"); err.textContent="";
  if(!title||!body||!classIds.length){ err.textContent="Add a title, a message and at least one class."; return; }
  const btn=document.getElementById("anPub"); btn.disabled=true; btn.textContent="Publishing…";
  // The same key is reused for retries of this draft, so a retry never publishes twice.
  anKey=anKey||newClientKey();
  for(let attempt=0;attempt<3;attempt++){
    try{ const r=await api("announcements",{method:"POST",body:JSON.stringify({title,body,classIds,clientKey:anKey})}); anKey=null;
      toast(`Published · ${r.delivered} student${r.delivered===1?"":"s"} notified`); viewAnnouncements(); return; }
    catch(e){ if(e.status){ err.textContent=e.message; break; } await new Promise(r=>setTimeout(r,800*(attempt+1))); if(attempt===2) err.textContent="Connection problem — select Publish to retry. It will not be sent twice."; }
  }
  btn.disabled=false; btn.innerHTML=`${svg("arr","ic-sm")} Publish`;
}
async function viewAnnouncement(id){
  crumbs([{label:"Announcements",onclick:"go('announcements',{announcementId:null})"},{label:"Announcement"}]); loading();
  let a; try{ a=await api(`announcements/${id}`); }catch(e){
    $c().innerHTML=`<div class="empty fade"><div class="ei">${svg("lock")}</div><h3>Announcement not available</h3><p>${esc(e.message)} It may belong to a class you're not in.</p><button class="btn btn-ghost" onclick="go('announcements',{announcementId:null})">All announcements</button></div>`; return; }
  if(state.view!=="announcements") return;
  crumbs([{label:"Announcements",onclick:"go('announcements',{announcementId:null})"},{label:a.title}]);
  $c().innerHTML=`<article class="reader fade"><p class="umeta">${esc(a.classes.map(c=>c.name).join(", "))}</p><h1>${esc(a.title)}</h1>
    <p class="umeta">By ${esc(a.author.displayName)} · ${esc(plWhen(a.publishedAt))}</p>
    <div class="reader-body">${a.body.split(/\n{2,}/).map(p=>`<p>${esc(p).replace(/\n/g,"<br>")}</p>`).join("")}</div>
    <button class="btn btn-ghost" onclick="go('announcements',{announcementId:null})">${svg("back","ic-sm")} All announcements</button></article>`;
  plRefreshInbox();
}

// ──────────────── Reading Library ────────────────
const LIB={q:"",topic:"",editing:null};
async function viewLibrary(){
  if(state.articleId) return viewArticle(Number(state.articleId));
  crumbs([{label:"Reading Library"}]);
  if(state.user.role==="student"){ await loadAccess(); if(ACC.data&&!ACC.data.library){ $c().innerHTML=lockedHTML("The Reading Library"); return; } }
  if(!document.getElementById("libList")) loading();
  let d; try{ d=await api(`library?q=${encodeURIComponent(LIB.q)}&topic=${encodeURIComponent(LIB.topic)}`); }catch(e){ $c().innerHTML=e.data?.locked?lockedHTML("The Reading Library"):`<div class="empty"><p>${esc(e.message)}</p></div>`; return; }
  if(state.view!=="library"||state.articleId) return;
  const cards=d.articles.map(a=>`<li><button type="button" class="lib-card" onclick="go('library',{articleId:${a.id}})">
    <span class="lib-topic">${esc(a.topic||"Reading")}</span><span class="lib-title">${esc(a.title)}</span><span class="lib-prev">${esc(a.excerpt)}</span>
    <span class="umeta">${a.readingMinutes} min read${a.hasQuestion?" · comprehension question":""}${d.canEdit||state.user.role==="mentor"?` · ${a.status==="published"?"Published":"Draft"}`:""}</span></button></li>`).join("");
  const list=`<ul class="lib-grid" id="libList">${cards}</ul>${d.articles.length?"":`<div class="empty"><p>${LIB.q||LIB.topic?"Nothing matches your search.":"No pieces yet."}</p></div>`}`;
  if(document.getElementById("libList")&&document.getElementById("libWrap")){ document.getElementById("libWrap").innerHTML=list; return; }
  $c().innerHTML=`<div class="page-head fade"><h1>Reading Library</h1><p>Short original articles and excerpts to build reading stamina. Each piece shows its topic and an estimated reading time.</p>
      ${d.canEdit?`<button class="btn btn-primary" onclick="FX_libEdit(null)">${svg("edit","ic-sm")} New piece</button>`:""}</div>
    <div class="panel fade lib-tools"><input type="search" placeholder="Search titles, topics and text" aria-label="Search the library" value="${esc(LIB.q)}" oninput="clearTimeout(window.__libT);const v=this.value;window.__libT=setTimeout(()=>{LIB.q=v.trim();viewLibrary();},300)"/>
      <select aria-label="Topic" onchange="LIB.topic=this.value;viewLibrary()"><option value="">All topics</option>${d.topics.map(t=>`<option ${LIB.topic===t?"selected":""}>${esc(t)}</option>`).join("")}</select></div>
    <div id="libWrap" class="fade">${list}</div><div id="libEditor"></div>`;
}
async function viewArticle(id){
  crumbs([{label:"Reading Library",onclick:"go('library',{articleId:null})"},{label:"Article"}]); loading();
  let a; try{ a=await api(`library/${id}`); }catch(e){ $c().innerHTML=e.data?.locked?lockedHTML("The Reading Library"):`<div class="empty fade"><h3>Article not available</h3><p>${esc(e.message)}</p><button class="btn btn-ghost" onclick="go('library',{articleId:null})">Library</button></div>`; return; }
  if(state.view!=="library") return;
  crumbs([{label:"Reading Library",onclick:"go('library',{articleId:null})"},{label:a.title}]);
  const q=a.question;
  $c().innerHTML=`<article class="reader fade"><p class="lib-topic">${esc(a.topic||"Reading")} · ${a.readingMinutes} min read</p><h1>${esc(a.title)}</h1>
    ${a.canEdit?`<div class="reader-admin"><span class="pill ${a.status==="published"?"pill-sec":"pill-muted"}">${a.status==="published"?"Published":"Draft"}</span>
      <button class="btn btn-ghost btn-xs" onclick="FX_libEdit(${a.id})">${svg("edit","ic-sm")} Edit</button>
      <button class="btn btn-ghost btn-xs" onclick="FX_libStatus(${a.id},'${a.status==="published"?"draft":"published"}')">${a.status==="published"?"Unpublish":"Publish"}</button></div>`:""}
    <div class="reader-body" id="readerBody">${a.body.split(/\n{2,}/).map(p=>`<p>${esc(p).replace(/\n/g,"<br>")}</p>`).join("")}</div>
    ${q?`<section class="reader-q" aria-labelledby="rqH"><h2 id="rqH">Check your understanding</h2><p class="q-prompt">${esc(q.prompt)}</p>
      <div class="choices" id="rqChoices" role="radiogroup">${Object.entries(q.choices).map(([k,v])=>`<button type="button" class="choice" role="radio" aria-checked="false" data-l="${k}" onclick="FX_libAnswer(${a.id},'${k}')"><span class="ltr">${k}</span><span class="ct">${esc(v)}</span></button>`).join("")}</div>
      <div id="rqResult" aria-live="polite"></div></section>`:""}
    <div id="libEditor"></div>
    <button class="btn btn-ghost" style="margin-top:1.2rem" onclick="go('library',{articleId:null})">${svg("back","ic-sm")} Library</button></article>`;
}
async function FX_libAnswer(id,letter){
  document.querySelectorAll("#rqChoices .choice").forEach(c=>c.disabled=true);
  let r; try{ r=await api(`library/${id}/answer`,{method:"POST",body:JSON.stringify({selected:letter})}); }catch(e){ toast(e.message); document.querySelectorAll("#rqChoices .choice").forEach(c=>c.disabled=false); return; }
  document.querySelectorAll("#rqChoices .choice").forEach(c=>{ if(c.dataset.l===r.answer) c.classList.add("right"); else if(c.dataset.l===letter) c.classList.add("wrong"); c.setAttribute("aria-checked",String(c.dataset.l===letter)); });
  document.getElementById("rqResult").innerHTML=`<div class="explain ${r.correct?"":"bad"}"><h4>${r.correct?"Correct":"Correct answer: "+esc(r.answer)}</h4><p>${esc(r.explanation)}</p>${r.support?`<p class="umeta">Supporting sentence:</p><blockquote class="reader-support">${esc(r.support)}</blockquote>`:""}</div>`;
  // Point at the supporting sentence in the text.
  if(r.support){ const body=document.getElementById("readerBody"); const ps=[...body.querySelectorAll("p")]; const hit=ps.find(p=>p.textContent.includes(r.support.slice(0,40))); if(hit){ hit.classList.add("reader-hit"); } }
}
async function FX_libStatus(id,status){ try{ await api(`library/${id}/status`,{method:"POST",body:JSON.stringify({status})}); toast(status==="published"?"Published":"Unpublished"); viewArticle(id); }catch(e){ toast(e.message); } }
async function FX_libEdit(id){
  let a={title:"",topic:"",excerpt:"",body:"",status:"draft",question:null};
  if(id){ try{ a=await api(`library/${id}`); }catch(e){ toast(e.message); return; } }
  const q=a.question||{prompt:"",choices:{},answer:"",explanation:"",support:""};
  ftModal(id?"Edit piece":"New piece",`<div class="field"><label>Title</label><input id="leTitle" value="${esc(a.title)}"/></div>
    <div class="f-row"><div class="field"><label>Topic</label><input id="leTopic" value="${esc(a.topic)}" placeholder="e.g. Science"/></div><div class="field"><label>Status</label><select id="leStatus"><option value="draft" ${a.status!=="published"?"selected":""}>Draft</option><option value="published" ${a.status==="published"?"selected":""}>Published</option></select></div></div>
    <div class="field"><label>Preview (optional — first lines are used otherwise)</label><input id="leExcerpt" value="${esc(a.excerpt||"")}"/></div>
    <div class="field"><label>Text (blank line between paragraphs)</label><textarea id="leBody" rows="10">${esc(a.body)}</textarea></div>
    <details ${a.question?"open":""}><summary><b>Comprehension question (optional)</b></summary>
      <div class="field"><label>Question</label><input id="leQ" value="${esc(q.prompt)}"/></div>
      ${["A","B","C","D"].map(k=>`<div class="field"><label>Choice ${k}</label><input id="leC${k}" value="${esc(q.choices?.[k]||"")}"/></div>`).join("")}
      <div class="f-row"><div class="field"><label>Correct letter</label><input id="leAns" maxlength="1" value="${esc(q.answer||"")}"/></div></div>
      <div class="field"><label>Explanation</label><textarea id="leExp" rows="3">${esc(q.explanation||"")}</textarea></div>
      <div class="field"><label>Supporting sentence or passage (quoted from the text)</label><textarea id="leSup" rows="2">${esc(q.support||"")}</textarea></div></details>`,
    {wide:true,foot:`${id?`<button class="btn btn-danger" onclick="FX_libDelete(${id})">Delete</button>`:""}<button class="btn btn-primary" onclick="FX_libSave(${id||"null"})">${svg("save","ic-sm")} Save</button>`});
}
async function FX_libSave(id){
  const v=k=>document.getElementById(k).value;
  const prompt=v("leQ").trim();
  const body={title:v("leTitle"),topic:v("leTopic"),excerpt:v("leExcerpt"),body:v("leBody"),status:v("leStatus"),
    question:prompt?{prompt,choices:Object.fromEntries(["A","B","C","D"].map(k=>[k,v("leC"+k)]).filter(([,x])=>x.trim())),answer:v("leAns").trim().toUpperCase(),explanation:v("leExp"),support:v("leSup")}:null};
  try{ const r=await api(id?`library/${id}`:"library",{method:id?"PUT":"POST",body:JSON.stringify(body)}); ftCloseModal(); toast("Saved"); go("library",{articleId:r.id}); }catch(e){ toast(e.message); }
}
async function FX_libDelete(id){ if(!confirm("Delete this piece permanently?")) return; try{ await api(`library/${id}`,{method:"DELETE"}); ftCloseModal(); go("library",{articleId:null}); }catch(e){ toast(e.message); } }
