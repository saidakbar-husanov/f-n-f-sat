// platform.js — administration, communication, gamification and exam-integrity
// views. Loaded before the main studio script; relies on its shared helpers
// (api, svg, esc, go, crumbs, toast, state, $c, loading, mathText, typesetMath,
// SECTIONS, SUBSECTIONS, ftModal, ftCloseModal, ftDate, fmtTime) at call time.
// Every action here is authorised again on the server.

const PL={inbox:{notifications:0,messages:0,reports:0},timer:null,exam:null,chat:null,examSettings:null,introStart:null,fsFailedAtStart:false};
const PL_REASONS=[["incorrect_answer","Incorrect answer"],["incorrect_explanation","Incorrect explanation"],["ambiguous","Ambiguous question"],["formatting","Incorrect formatting"],["missing_information","Missing information"],["broken_image","Broken image"],["other","Other"]];
const PL_REPORT_STATUS={new:["New","ft-pill-red"],under_review:["Under review","ft-pill-gold"],resolved:["Resolved","ft-pill-mint"],rejected:["Rejected","pill-muted"]};
const PL_INTEGRITY={none:["No events","pill-muted"],warning:["Warning","ft-pill-gold"],review_required:["Review required","ft-pill-red"],reviewed:["Reviewed","ft-pill-mint"]};
const PL_LIMIT_LABEL={bankDaily:"Question Bank answers / day",challengeDaily:"Challenging Questions / day",mockDaily:"Mock-test starts / day",mockWeekly:"Mock-test starts / week",vocabDaily:"Vocabulary quizzes / day"};
const plPill=(map,k)=>{ const [l,c]=map[k]||[k,"pill-muted"]; return `<span class="pill ${c}">${esc(l)}</span>`; };
const plWhen=v=>{ try{ return v?new Date(v).toLocaleString([], {dateStyle:"medium",timeStyle:"short"}):"—"; }catch{ return "—"; } };
const plJs=v=>JSON.stringify(v).replace(/"/g,"&quot;");
function plCsv(name,rows){
  const cell=v=>{ const s=String(v??""); return /[",\n]/.test(s)?`"${s.replace(/"/g,'""')}"`:s; };
  const blob=new Blob([rows.map(r=>r.map(cell).join(",")).join("\n")],{type:"text/csv;charset=utf-8"});
  const a=document.createElement("a"); a.href=URL.createObjectURL(blob); a.download=name; a.click(); setTimeout(()=>URL.revokeObjectURL(a.href),2000);
}

// ──────────────── inbox counters & notification bell ────────────────
function plBellHTML(){
  const n=PL.inbox.notifications||0;
  return `<button type="button" class="pl-bell" id="plBell" onclick="PL_openNotifications()" aria-label="Notifications${n?`, ${n} unread`:""}">${svg("info","ic-sm")}<span>Alerts</span>${n?`<b class="pl-count">${n>99?"99+":n}</b>`:""}</button>`;
}
function plNavCount(v){
  const n=v==="messages"?PL.inbox.messages:v==="qreports"?PL.inbox.reports:v==="announcements"?PL.inbox.announcements:0;
  return n?`<b class="pl-count">${n>99?"99+":n}</b>`:"";
}
async function plRefreshInbox(){
  if(!state.user||document.hidden) return;
  try{ PL.inbox=await api("inbox"); }catch{ return; }
  const bell=document.getElementById("plBell"); if(bell) bell.outerHTML=plBellHTML();
  document.querySelectorAll(".nav-item[data-v]").forEach(b=>{
    const old=b.querySelector(".pl-count"); if(old) old.remove();
    const html=plNavCount(b.dataset.v); if(html) b.insertAdjacentHTML("beforeend",html);
  });
}
function plStartInbox(){
  if(PL.timer) return;
  plRefreshInbox();
  PL.timer=setInterval(plRefreshInbox,60000);
}
async function PL_openNotifications(){
  let data={notifications:[],unread:0};
  try{ data=await api("notifications"); }catch(e){ toast(e.message); return; }
  const list=data.notifications.map(n=>`<button type="button" class="pl-note ${n.readAt?"":"unread"}" onclick="PL_openNotification(${n.id},${plJs(n.link||null)})">
      <b>${esc(n.title)}</b>${n.body?`<span>${esc(n.body)}</span>`:""}<small>${esc(plWhen(n.createdAt))}</small></button>`).join("");
  ftModal("Notifications",list||`<p class="umeta">You're all caught up.</p>`,{foot:data.unread?`<button class="btn btn-ghost btn-sm" onclick="PL_readAll()">${svg("check","ic-sm")} Mark all as read</button>`:""});
}
async function PL_readAll(){ try{ await api("notifications/read",{method:"POST",body:JSON.stringify({all:true})}); }catch{} ftCloseModal(); plRefreshInbox(); }
async function PL_openNotification(id,link){
  try{ await api("notifications/read",{method:"POST",body:JSON.stringify({ids:[id]})}); }catch{}
  ftCloseModal(); plRefreshInbox();
  if(!link?.view) return;
  const extra={};
  if(link.with) extra.chatWith=Number(link.with);
  if(link.reportId) extra.reportId=Number(link.reportId);
  if(link.attemptId) extra.integrityAttempt=Number(link.attemptId);
  if(link.view==="announcements") extra.announcementId=link.announcementId?Number(link.announcementId):null;
  go(link.view,extra);
}

// ──────────────── passwords ────────────────
function plPasswordFormHTML(forced){
  const social=!forced&&state.user?.profile?.provider!=="password";
  return `<div class="form-grid" style="max-width:460px">
    <div class="field"><label for="pwCur">${forced?"Temporary password":"Current password"}${social?" (leave blank if you have never set one)":""}</label><input id="pwCur" type="password" autocomplete="current-password"/></div>
    <div class="field"><label for="pwNew">New password</label><input id="pwNew" type="password" autocomplete="new-password"/></div>
    <div class="field"><label for="pwNew2">Repeat new password</label><input id="pwNew2" type="password" autocomplete="new-password" onkeydown="if(event.key==='Enter')PL_changePassword(${forced})"/></div>
    <p class="umeta">At least 8 characters with a letter and a number. Other devices are signed out.</p>
    <div class="auth-err" id="pwErr" style="color:var(--red);font-size:.85rem"></div>
    <div><button class="btn btn-primary" onclick="PL_changePassword(${forced})">${svg("lock","ic-sm")} Change password</button></div></div>`;
}
function plForcedPasswordHTML(){
  return `<div class="site fade"><main class="site-main"><div class="panel" style="max-width:520px;margin:8vh auto">
    <h2>${svg("lock","ic-sm")} Choose a new password</h2>
    <p class="umeta" style="margin-bottom:1rem">An administrator reset your password. Enter the temporary password you were given, then choose your own to continue.</p>
    ${plPasswordFormHTML(true)}
    <p style="margin-top:1rem"><button class="btn btn-ghost btn-sm" onclick="logout()">${svg("logout","ic-sm")} Log out</button></p></div></main></div>`;
}
async function PL_changePassword(forced){
  const v=id=>document.getElementById(id)?.value||"";
  const err=m=>{ const e=document.getElementById("pwErr"); if(e) e.textContent=m; };
  if(v("pwNew")!==v("pwNew2")) return err("The new passwords do not match.");
  try{
    await api("auth/change-password",{method:"POST",body:JSON.stringify({currentPassword:v("pwCur"),newPassword:v("pwNew")})});
    const p={...(state.user.profile||{}),mustChangePassword:false};
    localStorage.setItem(LS.user,JSON.stringify(p)); state.user=loadUser();
    toast("Password changed");
    if(forced) render(); else viewSettings();
  }catch(e){ err(e.message); }
}
async function PL_resetPassword(userId,name){
  if(!confirm(`Reset the password for ${name}?\n\nA temporary password is generated and shown once. ${name} is signed out everywhere and must choose a new password at the next sign-in.`)) return;
  try{
    const r=await api(`admin/users/${userId}/reset-password`,{method:"POST"});
    ftModal("Temporary password",`<p>Give this temporary password to <b>${esc(r.displayName)}</b> privately. It is shown only now and is not stored in readable form.</p>
      <div class="pl-secret"><code id="plTemp">${esc(r.temporaryPassword)}</code><button class="btn btn-primary btn-sm" onclick="PL_copy('plTemp')">${svg("save","ic-sm")} Copy</button></div>
      <p class="umeta">Sign-in: <b>${esc(r.loginHint)}</b> · they must change it after signing in. You can reset again at any time.</p>`);
  }catch(e){ toast(e.message); }
}
function PL_copy(id){
  const t=document.getElementById(id)?.textContent||"";
  (navigator.clipboard?.writeText(t)||Promise.reject()).then(()=>toast("Copied"),()=>{ const r=document.createRange(); const el=document.getElementById(id); r.selectNodeContents(el); getSelection().removeAllRanges(); getSelection().addRange(r); toast("Selected — press Ctrl+C to copy"); });
}

// ──────────────── report a question ────────────────
function plReportButtonHTML(questionId,source,attemptId){
  if(state.user?.role!=="student") return "";
  return `<button type="button" class="btn btn-ghost btn-sm pl-report" onclick="PL_reportQuestion(${questionId},'${source}',${attemptId||"null"})">${svg("flag","ic-sm")} Report question</button>`;
}
function PL_reportQuestion(questionId,source,attemptId){
  ftModal("Report a problem with this question",`<div class="form-grid">
    <div class="field"><label for="plRepReason">What's wrong?</label><select id="plRepReason">${PL_REASONS.map(([k,l])=>`<option value="${k}">${l}</option>`).join("")}</select></div>
    <div class="field"><label for="plRepComment">Details (optional)</label><textarea id="plRepComment" maxlength="1000" placeholder="Describe the problem"></textarea></div>
    <p class="umeta">Reports go to the content team. ${source==="mock"?"Your exam continues — reporting does not reveal any answers.":""}</p></div>`,
    {foot:`<button class="btn btn-ghost" onclick="ftCloseModal()">Cancel</button><button class="btn btn-primary" id="plRepSend" onclick="PL_sendReport(${questionId},'${source}',${attemptId||"null"})">${svg("flag","ic-sm")} Send report</button>`});
}
async function PL_sendReport(questionId,source,attemptId){
  const btn=document.getElementById("plRepSend"); if(btn) btn.disabled=true;
  try{
    await api("question-reports",{method:"POST",body:JSON.stringify({questionId,source,testAttemptId:attemptId,reason:document.getElementById("plRepReason").value,comment:document.getElementById("plRepComment").value})});
    ftCloseModal(); toast("Thanks — the report was sent");
  }catch(e){ if(btn) btn.disabled=false; toast(e.message); }
}

// ──────────────── usage limits (student dashboard) ────────────────
function plUsageHTML(u){
  if(!u?.limits) return "";
  const rows=Object.entries(u.limits).filter(([,v])=>v.limit!==null||v.used>0).map(([k,v])=>`<tr><td>${esc(PL_LIMIT_LABEL[k]||k)}</td><td>${v.used}</td><td>${v.limit===null?"Unlimited":v.limit}</td><td>${v.limit===null?"—":v.remaining}</td><td class="umeta">${esc(plWhen(v.resetsAt))}</td></tr>`).join("");
  return rows?`<table class="mini-table"><thead><tr><th>Allowance</th><th>Used</th><th>Limit</th><th>Left</th><th>Resets</th></tr></thead><tbody>${rows}</tbody></table>`
    :`<p class="umeta">Unlimited practice — no daily limits apply to your account.</p>`;
}

// ──────────────── messages ────────────────
async function viewMessages(){
  crumbs([{label:"Messages"}]); loading();
  let contacts=[]; try{ contacts=await api("messages/contacts"); }catch(e){ $c().innerHTML=`<div class="empty"><p>${esc(e.message)}</p></div>`; return; }
  const me=state.user.role;
  if(!contacts.length){ $c().innerHTML=`<div class="page-head fade"><h1>Messages</h1></div><div class="empty fade"><div class="ei">${svg("mail")}</div><p>${me==="student"?"Join a class to message your mentor.":"Students in your classes appear here."}</p></div>`; return; }
  const sel=state.chatWith&&contacts.some(c=>c.id===state.chatWith)?state.chatWith:contacts[0].id;
  $c().innerHTML=`<div class="page-head fade"><h1>Messages</h1><p>${me==="student"?"Talk with your mentors.":"Talk with the students in your classes."}</p></div>
    <div class="pl-chat fade"><aside class="pl-contacts">${contacts.map(c=>`<button type="button" class="pl-contact ${c.id===sel?"on":""}" onclick="PL_openChat(${c.id})"><b>${esc(c.displayName)}</b><span class="umeta">${esc(c.classNames.join(", "))}</span>${c.unread?`<b class="pl-count">${c.unread}</b>`:""}</button>`).join("")}</aside>
    <section class="pl-thread" id="plThread"><div class="spin"></div></section></div>`;
  PL_openChat(sel);
}
async function PL_openChat(id){
  state.chatWith=id;
  document.querySelectorAll(".pl-contact").forEach(b=>b.classList.toggle("on",b.getAttribute("onclick")===`PL_openChat(${id})`));
  clearInterval(PL.chat?.timer);
  PL.chat={with:id,last:0,messages:[],timer:null};
  const el=document.getElementById("plThread"); if(!el) return;
  el.innerHTML=`<div class="pl-msgs" id="plMsgs"><div class="spin"></div></div>
    <form class="pl-compose" onsubmit="event.preventDefault();PL_send()"><textarea id="plBody" maxlength="2000" rows="2" placeholder="Write a message…" onkeydown="if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();PL_send()}"></textarea><button class="btn btn-primary" id="plSendBtn">${svg("arr","ic-sm")} Send</button></form>`;
  await PL_pollChat(true);
  PL.chat.timer=setInterval(()=>{ if(state.view!=="messages"){ clearInterval(PL.chat?.timer); return; } if(!document.hidden) PL_pollChat(); },10000);
}
async function PL_pollChat(first){
  const c=PL.chat; if(!c) return;
  // Latest 200 messages each poll: new messages and read receipts in one request.
  let r; try{ r=await api(`messages/${c.with}`); }catch(e){ if(first){ const m=document.getElementById("plMsgs"); if(m) m.innerHTML=`<p class="umeta">${esc(e.message)}</p>`; } return; }
  if(PL.chat!==c) return;
  const changed=first||r.messages.length!==c.messages.length||r.messages.some((m,i)=>m.id!==c.messages[i]?.id||m.readAt!==c.messages[i]?.readAt);
  c.messages=r.messages;
  if(!changed) return;
  const me=state.user.profile?.id;
  const box=document.getElementById("plMsgs"); if(!box) return;
  const atBottom=box.scrollHeight-box.scrollTop-box.clientHeight<60;
  box.innerHTML=c.messages.length?c.messages.map(m=>`<div class="pl-msg ${m.senderId===me?"mine":""}"><div>${esc(m.body).replace(/\n/g,"<br>")}</div><small>${esc(plWhen(m.createdAt))}${m.senderId===me?` · ${m.readAt?"Read":"Sent"}`:""}</small></div>`).join("")
    :`<p class="umeta" style="text-align:center;margin-top:2rem">No messages yet — say hello.</p>`;
  if(first||atBottom) box.scrollTop=box.scrollHeight;
  if(first) plRefreshInbox();
}
async function PL_send(){
  const ta=document.getElementById("plBody"); const body=(ta?.value||"").trim(); if(!body||!PL.chat) return;
  const btn=document.getElementById("plSendBtn"); if(btn) btn.disabled=true;
  try{ await api(`messages/${PL.chat.with}`,{method:"POST",body:JSON.stringify({body})}); ta.value=""; await PL_pollChat(); }
  catch(e){ toast(e.message); }
  if(btn) btn.disabled=false; ta?.focus();
}

// ──────────────── leaderboards ────────────────
// Leaderboards live in features.js (usernames, privacy, search, export).

// ──────────────── achievements ────────────────
async function viewAchievements(){
  crumbs([{label:"Achievements"}]); loading();
  const sid=state.user.role==="student"?"":(state.achStudent||"");
  if(state.user.role!=="student"&&!sid){ $c().innerHTML=`<div class="empty"><p>Open a student's achievements from Student Performance.</p></div>`; return; }
  let d; try{ d=await api("achievements"+(sid?`?studentId=${sid}`:"")); }catch(e){ $c().innerHTML=`<div class="empty"><p>${esc(e.message)}</p></div>`; return; }
  const m=d.metrics||{};
  const groups=[...new Set(d.badges.map(b=>b.group))];
  const earned=d.badges.filter(b=>b.earned).length;
  $c().innerHTML=`<div class="page-head fade"><h1>Achievements</h1><p>${earned} of ${d.badges.length} badges earned. Badges are awarded automatically from verified activity.</p></div>
    <div class="stat-grid fade">
      <div class="stat-card"><div class="lbl">${svg("flame","ic-sm")} Current streak</div><div class="val" style="color:var(--gold)">${m.currentStreak||0}</div><div class="sub">best ${m.longestStreak||0} · ${m.qualifyingDays||0} qualifying days</div></div>
      <div class="stat-card"><div class="lbl">${svg("target","ic-sm")} Accuracy</div><div class="val">${m.eligibleAnswered?m.accuracy+"%":"—"}</div><div class="sub">${m.eligibleCorrect||0}/${m.eligibleAnswered||0} first answers</div></div>
      <div class="stat-card"><div class="lbl">${svg("check","ic-sm")} Answered</div><div class="val">${m.answered||0}</div><div class="sub">${m.mocks||0} full mocks</div></div>
      <div class="stat-card"><div class="lbl">${svg("vocab","ic-sm")} Words mastered</div><div class="val">${m.mastered||0}</div></div></div>
    ${groups.map(g=>`<div class="panel fade"><h2>${svg("trophy","ic-sm")} ${esc(g)}</h2><div class="pl-badges">${d.badges.filter(b=>b.group===g).map(b=>`
      <div class="pl-badge ${b.earned?"on":""}"><div class="badge-ic ${b.earned?"tone-gold":""}">${svg(b.earned?"trophy":"lock")}</div><b>${esc(b.title)}</b><span class="umeta">${esc(b.requirement)}</span>
        ${b.earned?`<small>Earned ${esc(plWhen(b.awardedAt))}</small>`:b.progress!=null?`<div class="q-progress"><i style="width:${Math.round(b.progress/b.target*100)}%"></i></div><small>${b.progress} / ${b.target}</small>`:`<small>Locked</small>`}</div>`).join("")}</div></div>`).join("")}`;
}

// ──────────────── performance reports ────────────────
const PL_PF={f:{studentId:"",classId:"",mentorId:"",testId:"",from:"",to:"",minScore:"",maxScore:""},data:null};
function plLineChart(points,{min,max,label}){
  if(points.length<2) return `<p class="umeta">Take at least two tests to see a trend.</p>`;
  const W=640,H=180,P=28, xs=i=>P+(i*(W-2*P))/(points.length-1), ys=v=>H-P-((v-min)/(max-min||1))*(H-2*P);
  const path=points.map((p,i)=>`${i?"L":"M"}${xs(i).toFixed(1)},${ys(p.v).toFixed(1)}`).join(" ");
  return `<svg class="pl-chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(label)}">
    <line x1="${P}" y1="${H-P}" x2="${W-P}" y2="${H-P}" class="ax"/><text x="${P-4}" y="${ys(max)+4}" text-anchor="end">${max}</text><text x="${P-4}" y="${ys(min)+4}" text-anchor="end">${min}</text>
    <path d="${path}" class="ln"/>${points.map((p,i)=>`<circle cx="${xs(i)}" cy="${ys(p.v)}" r="4"><title>${esc(p.t)}: ${p.v}</title></circle>`).join("")}</svg>`;
}
async function viewPerformance(){
  crumbs([{label:state.user.role==="student"?"My Performance":"Student Performance"}]); loading();
  const f=PL_PF.f, qs=Object.entries(f).filter(([,v])=>v!=="").map(([k,v])=>`${k}=${encodeURIComponent(v)}`).join("&");
  try{ PL_PF.data=await api("performance"+(qs?`?${qs}`:"")); }catch(e){ $c().innerHTML=`<div class="empty"><p>${esc(e.message)}</p></div>`; return; }
  const {rows,options}=PL_PF.data, staff=state.user.role!=="student";
  const sel=(k,label,list,lbl)=>`<div class="field"><label>${label}</label><select onchange="PL_PF.f.${k}=this.value;viewPerformance()"><option value="">All</option>${(list||[]).map(o=>`<option value="${o.id}" ${String(f[k])===String(o.id)?"selected":""}>${esc(o[lbl])}</option>`).join("")}</select></div>`;
  const inp=(k,label,type)=>`<div class="field"><label>${label}</label><input type="${type}" value="${esc(f[k])}" onchange="PL_PF.f.${k}=this.value;viewPerformance()"/></div>`;
  const scored=rows.filter(r=>r.totalScaled!=null);
  const avg=a=>a.length?Math.round(a.reduce((s,x)=>s+x,0)/a.length):null;
  const chronological=[...rows].reverse();
  const trend=staff&&!f.studentId?"":plLineChart(chronological.filter(r=>r.totalScaled!=null).map(r=>({v:r.totalScaled,t:`${r.testTitle} · ${plWhen(r.submittedAt)}`})),{min:400,max:1600,label:"Total score trend"})
    + (chronological.filter(r=>r.totalScaled!=null).length<2?plLineChart(chronological.map(r=>({v:r.accuracy,t:r.testTitle})),{min:0,max:100,label:"Accuracy trend"}):"");
  // Class summary from the same rows.
  const byClass=new Map();
  if(staff) for(const r of rows) for(const c of (r.classes.length?r.classes:[{id:0,name:"No class"}])){ const e=byClass.get(c.id)||{name:c.name,rows:[]}; e.rows.push(r); byClass.set(c.id,e); }
  const classTable=staff&&byClass.size?`<div class="panel fade"><h2>${svg("users","ic-sm")} Class summary</h2><div class="ft-table-wrap"><table class="ft-table"><thead><tr><th>Class</th><th class="ft-n">Sittings</th><th class="ft-n">Students</th><th class="ft-n">Avg total</th><th class="ft-n">Avg R&amp;W</th><th class="ft-n">Avg Math</th><th class="ft-n">Avg accuracy</th></tr></thead><tbody>
    ${[...byClass.values()].map(c=>`<tr><td>${esc(c.name)}</td><td class="ft-n">${c.rows.length}</td><td class="ft-n">${new Set(c.rows.map(r=>r.studentId)).size}</td><td class="ft-n">${avg(c.rows.filter(r=>r.totalScaled!=null).map(r=>r.totalScaled))??"—"}</td><td class="ft-n">${avg(c.rows.filter(r=>r.rwScaled!=null).map(r=>r.rwScaled))??"—"}</td><td class="ft-n">${avg(c.rows.filter(r=>r.mathScaled!=null).map(r=>r.mathScaled))??"—"}</td><td class="ft-n">${avg(c.rows.map(r=>r.accuracy))??0}%</td></tr>`).join("")}</tbody></table></div></div>`:"";
  const table=rows.length?`<div class="ft-table-wrap"><table class="ft-table"><thead><tr>${staff?"<th>Student</th>":""}<th>Mock test</th><th>Completed</th><th class="ft-n">Total</th><th class="ft-n">R&amp;W</th><th class="ft-n">Math</th><th class="ft-n">Correct</th><th class="ft-n">Incorrect</th><th class="ft-n">Blank</th><th class="ft-n">Accuracy</th><th class="ft-n">Time</th>${staff?"<th>Integrity</th>":""}<th></th></tr></thead><tbody>
    ${rows.map(r=>`<tr>${staff?`<td><b>${esc(r.studentName)}</b><div class="umeta">${esc(r.classes.map(c=>c.name).join(", ")||"No class")}</div></td>`:""}<td>${esc(r.testTitle)}<div class="umeta">${r.scope==="modules"?"Selected modules":"Full test"}${r.timed?"":" · untimed"}${r.examMode?" · exam mode":""}</div></td>
      <td class="umeta">${esc(plWhen(r.submittedAt))}</td><td class="ft-n"><b>${r.totalScaled??"—"}</b></td><td class="ft-n">${r.rwScaled??"—"}</td><td class="ft-n">${r.mathScaled??"—"}</td>
      <td class="ft-n">${r.correct}</td><td class="ft-n">${r.incorrect}</td><td class="ft-n">${r.unanswered}</td><td class="ft-n">${r.accuracy}%</td><td class="ft-n">${r.durationSeconds!=null?fmtTime(r.durationSeconds):"—"}</td>
      ${staff?`<td>${plPill(PL_INTEGRITY,r.integrity?.status||"none")}${r.integrity?.excluded?` <span class="pill pill-muted">Excluded</span>`:""}</td>`:""}
      <td><button class="btn btn-ghost btn-xs" onclick="PL_perfDetail(${r.attemptId})">${svg("book","ic-sm")} Report</button></td></tr>`).join("")}</tbody></table></div>`
    :`<div class="empty" style="padding:1.5rem"><p>No completed mock tests match these filters.</p></div>`;
  $c().innerHTML=`<div class="page-head fade"><h1>${staff?"Student Performance":"My Performance"}</h1><p>${staff?(state.user.role==="mentor"?"Mock-test results for the students in your classes.":"Mock-test results across the platform."):"Your mock-test scores, trends and question-level review."} Scores use the platform's existing estimated scaling.</p></div>
    ${staff?`<div class="panel fade"><div class="filter-bar">${sel("studentId","Student",options.students,"displayName")}${sel("classId","Class",options.classes,"name")}${state.user.role==="admin"?sel("mentorId","Mentor",options.mentors,"displayName"):""}${sel("testId","Mock test",options.tests,"title")}
      ${inp("from","Completed from","date")}${inp("to","Completed to","date")}${inp("minScore","Min total","number")}${inp("maxScore","Max total","number")}</div></div>`:""}
    <div class="stat-grid fade">
      <div class="stat-card"><div class="lbl">${svg("layers","ic-sm")} Completed mocks</div><div class="val">${rows.length}</div></div>
      <div class="stat-card"><div class="lbl">${svg("trophy","ic-sm")} Average total</div><div class="val">${avg(scored.map(r=>r.totalScaled))??"—"}</div><div class="sub">best ${scored.length?Math.max(...scored.map(r=>r.totalScaled)):"—"}</div></div>
      <div class="stat-card"><div class="lbl">${svg("target","ic-sm")} Average accuracy</div><div class="val">${avg(rows.map(r=>r.accuracy))??0}%</div></div>
      ${!staff&&chronological.length>1&&chronological[0].totalScaled!=null&&chronological.at(-1).totalScaled!=null?`<div class="stat-card"><div class="lbl">${svg("graph","ic-sm")} Improvement</div><div class="val">${chronological.at(-1).totalScaled-chronological[0].totalScaled>=0?"+":""}${chronological.at(-1).totalScaled-chronological[0].totalScaled}</div><div class="sub">first → latest total</div></div>`:""}</div>
    ${trend?`<div class="panel fade"><h2>${svg("graph","ic-sm")} Score trend</h2>${trend}</div>`:""}
    ${classTable}
    <div class="panel fade"><div class="ch-admin-head"><h2>${svg("layers","ic-sm")} Mock-test history</h2>${rows.length?`<button class="btn btn-ghost btn-sm" onclick="PL_perfCsv()">${svg("upload","ic-sm")} Export CSV</button>`:""}</div>${table}</div>`;
}
function PL_perfCsv(){
  const rows=PL_PF.data?.rows||[];
  plCsv("mock-test-results.csv",[["Student","Classes","Mock test","Completed","Total","Reading & Writing","Math","Correct","Incorrect","Unanswered","Accuracy %","Time (s)","Integrity"],
    ...rows.map(r=>[r.studentName,r.classes.map(c=>c.name).join("; "),r.testTitle,r.submittedAt,r.totalScaled??"",r.rwScaled??"",r.mathScaled??"",r.correct,r.incorrect,r.unanswered,r.accuracy,r.durationSeconds??"",r.integrity?.status??""])]);
}
const plBars=(list,key)=>list.map(x=>{ const p=x.total?Math.round(x.correct/x.total*100):0; const col=p>=70?"var(--mint)":p>=45?"var(--gold)":"var(--red)";
  return `<div class="bar-row"><div class="bn">${esc(x[key])}${x.domain&&key==="skill"?` <span style="color:var(--ink3)">· ${esc(x.domain)}</span>`:""}</div><div class="bar-track"><div class="bar-fill" style="width:${p}%;background:${col}"></div></div><div class="bar-pct">${x.correct}/${x.total}</div></div>`; }).join("");
async function PL_perfDetail(id){
  let d; try{ d=await api(`performance/attempt/${id}`); }catch(e){ toast(e.message); return; }
  const r=d.report||{}, staff=state.user.role!=="student";
  const trend=plLineChart(d.history.filter(h=>h.totalScaled!=null).map(h=>({v:h.totalScaled,t:plWhen(h.submittedAt)})),{min:400,max:1600,label:"Score history"});
  const qrows=d.questions.map(q=>`<tr class="${q.correct?"":"pl-miss"}"><td class="ft-num">${esc(q.module)} · ${q.number}</td><td>${esc(q.domain)}<div class="umeta">${esc(q.skill)}</div></td><td>${esc(q.difficulty)}</td><td>${q.unanswered?"—":mathText(q.given)}</td><td>${mathText(q.answer)}</td><td>${q.correct?`<span class="pill ft-pill-mint">Correct</span>`:q.unanswered?`<span class="pill pill-muted">Blank</span>`:`<span class="pill ft-pill-red">Incorrect</span>`}</td>
    <td><details><summary class="umeta">Question</summary>${fullQuestionHTML({...q,category:q.domain,subcategory:q.skill})}</details></td></tr>`).join("");
  ftModal(`${esc(d.student.displayName)} · ${esc(d.test?.title||"Mock test")}`,`
    <div class="stat-grid"><div class="stat-card"><div class="lbl">Total</div><div class="val">${r.totalScaled??"—"}</div></div><div class="stat-card"><div class="lbl">Reading &amp; Writing</div><div class="val">${r.rwScaled??"—"}</div></div><div class="stat-card"><div class="lbl">Math</div><div class="val">${r.mathScaled??"—"}</div></div><div class="stat-card"><div class="lbl">Correct</div><div class="val">${r.correctCount??0}<small style="font-size:1rem">/${r.totalCount??0}</small></div></div></div>
    <div class="fr-grid"><div class="panel"><h2>Domains</h2>${plBars(r.domains||[],"domain")}</div><div class="panel"><h2>Difficulty</h2>${plBars(d.difficulty,"label")}</div></div>
    <div class="panel"><h2>SAT skills</h2>${plBars(r.skills||[],"skill")}</div>
    <div class="panel"><h2>Score history</h2>${trend}</div>
    ${staff&&d.integrity?`<div class="panel"><h2>${svg("lock","ic-sm")} Exam integrity</h2>${plIntegrityHTML(d.integrity,id)}</div>`:""}
    <div class="panel"><h2>Question-level review</h2><div class="ft-table-wrap"><table class="ft-table"><thead><tr><th>#</th><th>Domain · skill</th><th>Difficulty</th><th>Answer</th><th>Key</th><th>Result</th><th></th></tr></thead><tbody>${qrows}</tbody></table></div></div>
    ${staff?`<p><button class="btn btn-ghost btn-sm" onclick="ftCloseModal();go('achievements',{achStudent:${d.student.id}})">${svg("trophy","ic-sm")} Achievements</button></p>`:""}`,{wide:true});
}

// ──────────────── exam integrity (staff) ────────────────
const PL_EVENT_LABEL={fullscreen_exit:"Left full screen",tab_hidden:"Switched tab / hid page",window_blur:"Window lost focus",navigation:"Tried to leave the page",copy:"Copy attempt",paste:"Paste attempt",fullscreen_unavailable:"Full screen unavailable",fullscreen_enter:"Entered full screen"};
function plIntegrityHTML(g,attemptId){
  const by={}; (g.events||[]).forEach(e=>by[e.type]=(by[e.type]||0)+1);
  return `<div class="pl-int-head">${plPill(PL_INTEGRITY,g.status)} <span>${g.violations||0} counted violation${g.violations===1?"":"s"} · ${by.fullscreen_exit||0} full-screen exits · ${by.tab_hidden||0} tab switches · ${by.window_blur||0} focus losses${by.copy||by.paste?` · ${(by.copy||0)+(by.paste||0)} copy/paste`:""}</span>${g.excluded?` <span class="pill pill-muted">Excluded from leaderboards</span>`:""}</div>
    <p class="umeta">Browser events are advisory evidence, not proof. Related events within a few seconds count once.</p>
    ${(g.events||[]).length?`<ol class="pl-timeline">${g.events.map(e=>`<li class="${e.counted?"counted":""}"><b>${esc(PL_EVENT_LABEL[e.type]||e.type)}</b> · ${esc(plWhen(e.occurredAt))}${e.durationMs!=null?` · ${Math.round(e.durationMs/1000)}s`:""} · module ${(e.moduleIndex??0)+1}${e.counted?" · counted":""}</li>`).join("")}</ol>`:`<p class="umeta">No events recorded.</p>`}
    ${g.note?`<p><b>Note:</b> ${esc(g.note)}</p>`:""}
    ${state.user.role==="admin"&&attemptId?`<div class="form-grid" style="margin-top:.6rem"><div class="field"><label>Review note</label><textarea id="plIntNote">${esc(g.note||"")}</textarea></div>
      <label class="umeta"><input type="checkbox" id="plIntExcl" ${g.excluded?"checked":""}/> Exclude this sitting from leaderboards and badges</label>
      <div style="display:flex;gap:.5rem;flex-wrap:wrap"><button class="btn btn-primary btn-sm" onclick="PL_reviewIntegrity(${attemptId},'reviewed')">${svg("check","ic-sm")} Mark reviewed</button>
      <button class="btn btn-ghost btn-sm" onclick="PL_reviewIntegrity(${attemptId},'dismiss')">Dismiss flag</button>
      <button class="btn btn-ghost btn-sm" onclick="PL_reviewIntegrity(${attemptId},'note')">Save note</button>
      ${g.status==="reviewed"?`<button class="btn btn-ghost btn-sm" onclick="PL_reviewIntegrity(${attemptId},'reopen')">Reopen</button>`:""}</div></div>`:""}`;
}
async function PL_reviewIntegrity(id,action){
  try{
    await api(`integrity/${id}`,{method:"PATCH",body:JSON.stringify({action,note:document.getElementById("plIntNote")?.value||"",competitionExcluded:action==="dismiss"?false:!!document.getElementById("plIntExcl")?.checked})});
    toast("Integrity review saved"); ftCloseModal(); if(state.view==="integrity") viewIntegrity();
  }catch(e){ toast(e.message); }
}
async function PL_openIntegrity(id){
  let g; try{ g=await api(`integrity/${id}`); }catch(e){ toast(e.message); return; }
  ftModal(`Exam integrity · ${esc(g.studentName)} · ${esc(g.testTitle)}`,plIntegrityHTML(g,id),{wide:true});
}
let PL_INT_FILTER="";
async function viewIntegrity(){
  crumbs([{label:"Exam Integrity"}]); loading();
  let rows=[]; try{ rows=await api("integrity"+(PL_INT_FILTER?`?status=${PL_INT_FILTER}`:"")); }catch(e){ $c().innerHTML=`<div class="empty"><p>${esc(e.message)}</p></div>`; return; }
  const admin=state.user.role==="admin";
  let settingsHTML="";
  if(admin){
    let s={}; try{ s=await api("exam-settings"); }catch{}
    const cb=(k,l)=>`<label class="umeta" style="display:flex;gap:.4rem;align-items:center"><input type="checkbox" id="es_${k}" ${s[k]?"checked":""}/> ${l}</label>`;
    const num=(k,l)=>`<div class="field"><label>${l}</label><input type="number" min="1" max="50" id="es_${k}" value="${s[k]??""}"/></div>`;
    settingsHTML=`<div class="panel fade"><h2>${svg("settings","ic-sm")} Exam Mode settings</h2><div class="form-grid">
      ${cb("examModeFullLength","Run full-length timed mocks in Exam Mode (full screen + monitoring)")}${cb("allowPracticeMode","Let students choose Practice Mode for self-started full tests")}
      ${cb("requireFullscreen","Require full screen during Exam Mode")}${cb("allowWithoutFullscreen","If the browser cannot enter full screen, allow the exam to continue (the event is logged)")}
      ${cb("monitoring","Record integrity events")}
      <div class="f-row">${num("warnAt","Warning at violation #")}${num("strongWarnAt","Strong warning at #")}${num("reviewAt","Review Required at #")}${num("dedupeSeconds","Merge events within (seconds)")}</div>
      <div><button class="btn btn-primary btn-sm" onclick="PL_saveExamSettings()">${svg("save","ic-sm")} Save settings</button></div></div></div>`;
  }
  $c().innerHTML=`<div class="page-head fade"><h1>Exam Integrity</h1><p>Exam Mode sittings with recorded browser events. Events never submit or invalidate an attempt on their own${admin?"; you decide after review":""}.</p></div>
    ${settingsHTML}
    <div class="panel fade"><div class="ch-admin-head"><h2>${svg("lock","ic-sm")} Flagged sittings</h2><div class="vb-seg">${[["","All with events"],["review_required","Review required"],["warning","Warning"],["reviewed","Reviewed"]].map(([k,l])=>`<button class="${PL_INT_FILTER===k?"on":""}" onclick="PL_INT_FILTER='${k}';viewIntegrity()">${l}</button>`).join("")}</div></div>
    ${rows.length?`<div class="ft-table-wrap"><table class="ft-table"><thead><tr><th>Student</th><th>Mock test</th><th>Started</th><th class="ft-n">Violations</th><th>Status</th><th></th></tr></thead><tbody>
      ${rows.map(r=>`<tr><td><b>${esc(r.studentName)}</b></td><td>${esc(r.testTitle)}<div class="umeta">${r.submittedAt?"Submitted":"In progress"}</div></td><td class="umeta">${esc(plWhen(r.startedAt))}</td><td class="ft-n">${r.violations}</td><td>${plPill(PL_INTEGRITY,r.status)}${r.excluded?` <span class="pill pill-muted">Excluded</span>`:""}</td>
        <td><button class="btn btn-ghost btn-xs" onclick="PL_openIntegrity(${r.attemptId})">${svg("book","ic-sm")} Open</button></td></tr>`).join("")}</tbody></table></div>`:`<div class="empty" style="padding:1.5rem"><p>No flagged sittings.</p></div>`}</div>`;
  if(state.integrityAttempt){ const a=state.integrityAttempt; state.integrityAttempt=null; PL_openIntegrity(a); }
}
async function PL_saveExamSettings(){
  const g=k=>document.getElementById("es_"+k);
  const b={}; ["examModeFullLength","allowPracticeMode","requireFullscreen","allowWithoutFullscreen","monitoring"].forEach(k=>b[k]=!!g(k)?.checked);
  ["warnAt","strongWarnAt","reviewAt","dedupeSeconds"].forEach(k=>b[k]=Number(g(k)?.value));
  try{ await api("exam-settings",{method:"PUT",body:JSON.stringify(b)}); PL.examSettings=null; toast("Exam settings saved"); viewIntegrity(); }catch(e){ toast(e.message); }
}

// ──────────────── question reports (admin) ────────────────
let PL_QR_FILTER="new";
async function viewQReports(){
  crumbs([{label:"Question Reports"}]); loading();
  let rows=[]; try{ rows=await api("admin/question-reports"+(PL_QR_FILTER?`?status=${PL_QR_FILTER}`:"")); }catch(e){ $c().innerHTML=`<div class="empty"><p>${esc(e.message)}</p></div>`; return; }
  $c().innerHTML=`<div class="page-head fade"><h1>Question Reports</h1><p>Problems students reported. Correcting a question changes it for future practice; past answers keep the grade they were given.</p></div>
    <div class="panel fade"><div class="vb-seg" style="margin-bottom:.8rem">${[["new","New"],["under_review","Under review"],["resolved","Resolved"],["rejected","Rejected"],["","All"]].map(([k,l])=>`<button class="${PL_QR_FILTER===k?"on":""}" onclick="PL_QR_FILTER='${k}';viewQReports()">${l}</button>`).join("")}</div>
    ${rows.length?`<div class="ft-table-wrap"><table class="ft-table"><thead><tr><th>Question</th><th>Reason</th><th>Reporter</th><th>Source</th><th class="ft-n">Reports</th><th>Status</th><th></th></tr></thead><tbody>
      ${rows.map(r=>`<tr><td><b>#${r.questionId}</b> <span class="umeta">${esc(r.question?`${SECTIONS[r.question.section]?.label||r.question.section} · ${r.question.category}`:"deleted")}</span><div class="ft-clip umeta">${esc(mathPlain(r.question?.prompt||"")).slice(0,120)}</div></td>
        <td>${esc((PL_REASONS.find(x=>x[0]===r.reason)||[,r.reason])[1])}${r.comment?`<div class="umeta">${esc(r.comment).slice(0,140)}</div>`:""}</td><td>${esc(r.reporterName)}<div class="umeta">${esc(plWhen(r.createdAt))}</div></td><td>${esc(r.source)}</td>
        <td class="ft-n">${r.duplicateCount}</td><td>${plPill(PL_REPORT_STATUS,r.status)}</td><td><button class="btn btn-ghost btn-xs" onclick="PL_openReport(${r.id})">${svg("book","ic-sm")} Open</button></td></tr>`).join("")}</tbody></table></div>`
      :`<div class="empty" style="padding:1.5rem"><p>No reports in this list.</p></div>`}</div>`;
  if(state.reportId){ const id=state.reportId; state.reportId=null; PL_openReport(id); }
}
async function PL_openReport(id){
  let d; try{ d=await api(`admin/question-reports/${id}`); }catch(e){ toast(e.message); return; }
  const r=d.report, q=d.question;
  ftModal(`Report · question #${r.questionId}`,`
    ${q?fullQuestionHTML(q,`scope ${esc(q.scope)}`):`<p class="umeta">The question was deleted.</p>`}
    <h4 style="margin-top:1rem">Reports for this question (${d.related.length})</h4>
    <ul class="pl-replist">${d.related.map(x=>`<li>${plPill(PL_REPORT_STATUS,x.status)} <b>${esc((PL_REASONS.find(y=>y[0]===x.reason)||[,x.reason])[1])}</b> · ${esc(x.reporterName)} · ${esc(plWhen(x.createdAt))} · ${esc(x.source)}${x.testAttemptId?` · sitting #${x.testAttemptId}`:""}${x.comment?`<div class="umeta">${esc(x.comment)}</div>`:""}${x.resolutionNote?`<div class="umeta">Resolution: ${esc(x.resolutionNote)}</div>`:""}</li>`).join("")}</ul>
    <div class="form-grid"><div class="f-row"><div class="field"><label>Status</label><select id="plQrStatus">${Object.entries(PL_REPORT_STATUS).map(([k,[l]])=>`<option value="${k}" ${r.status===k?"selected":""}>${l}</option>`).join("")}</select></div></div>
      <div class="field"><label>Resolution notes</label><textarea id="plQrNote">${esc(r.resolutionNote||"")}</textarea></div>
      <label class="umeta"><input type="checkbox" id="plQrAll" checked/> Apply to every open report on this question</label></div>`,
    {wide:true,foot:`${q&&q.scope==="BANK"?`<button class="btn btn-ghost" onclick="ftCloseModal();PL_editQuestion(${q.id})">${svg("edit","ic-sm")} Edit question</button>`:q?`<span class="umeta">${q.scope==="CHALLENGE"?"Challenging-set questions are corrected by re-importing their set file.":"Test questions are edited in the test builder."}</span>`:""}
      <button class="btn btn-primary" onclick="PL_saveReport(${r.id})">${svg("save","ic-sm")} Save</button>`});
}
async function PL_saveReport(id){
  try{ await api(`admin/question-reports/${id}`,{method:"PATCH",body:JSON.stringify({status:document.getElementById("plQrStatus").value,resolutionNote:document.getElementById("plQrNote").value,applyToDuplicates:document.getElementById("plQrAll").checked})});
    toast("Report updated"); ftCloseModal(); viewQReports(); plRefreshInbox(); }catch(e){ toast(e.message); }
}
function PL_editQuestion(id){ go("manage",{editQuestionId:id}); }

// ──────────────── classes & mentors (admin) ────────────────
let PL_CA={data:null,q:""};
async function viewClassesAdmin(){
  crumbs([{label:"Classes & Mentors"}]); loading();
  try{ PL_CA.data=await api("admin/classes"); }catch(e){ $c().innerHTML=`<div class="empty"><p>${esc(e.message)}</p></div>`; return; }
  const {classes:cls,mentors,students}=PL_CA.data;
  const mentorOpts=sel=>mentors.map(m=>`<option value="${m.id}" ${sel===m.id?"selected":""}>${esc(m.displayName)}${m.status!=="active"?` (${m.status})`:""}</option>`).join("");
  const name=id=>students.find(s=>s.id===id)?.displayName||`#${id}`;
  $c().innerHTML=`<div class="page-head fade"><h1>Classes &amp; Mentors</h1><p>Create classes, assign mentors and move students. Moving a student keeps every past result, badge and report; mentor access follows the move immediately. To remove a mentor account, use <b>User Management → Remove mentor…</b>, which transfers their classes first.</p></div>
    <div class="panel fade"><h2>${svg("plus","ic-sm")} New class</h2><div class="f-row"><div class="field"><label>Name</label><input id="caName"/></div><div class="field"><label>Mentor</label><select id="caMentor"><option value="">Choose…</option>${mentorOpts(null)}</select></div>
      <div class="field"><label>Description</label><input id="caDesc"/></div><div class="field" style="display:flex;align-items:flex-end"><button class="btn btn-primary" onclick="PL_createClass()">${svg("plus","ic-sm")} Create</button></div></div></div>
    ${cls.map(c=>`<div class="panel fade"><div class="ch-admin-head"><h2>${svg("users","ic-sm")} ${esc(c.name)} <span class="umeta">· ${c.studentIds.length} student${c.studentIds.length===1?"":"s"}</span></h2><button class="btn btn-danger btn-sm" onclick="AO_deleteClass(${c.id})">${svg("trash","ic-sm")} Delete class…</button></div>
      <div class="f-row"><div class="field"><label>Name</label><input id="caN${c.id}" value="${esc(c.name)}"/></div><div class="field"><label>Mentor</label><select id="caM${c.id}">${mentorOpts(c.mentorId)}</select></div>
        <div class="field"><label>Description</label><input id="caD${c.id}" value="${esc(c.description||"")}"/></div><div class="field" style="display:flex;align-items:flex-end"><button class="btn btn-ghost btn-sm" onclick="PL_saveClass(${c.id})">${svg("save","ic-sm")} Save</button></div></div>
      <div class="lesson-tags" style="margin:.6rem 0">${c.studentIds.map(id=>`<span class="pill pill-muted">${esc(name(id))} <button class="pl-x" title="Remove from class" onclick="PL_member(${c.id},${id},'remove')">×</button></span>`).join("")||`<span class="umeta">No students yet.</span>`}</div>
      <div class="f-row"><div class="field"><label>Add or transfer a student</label><select id="caS${c.id}"><option value="">Choose a student…</option>${students.filter(s=>!c.studentIds.includes(s.id)).map(s=>`<option value="${s.id}">${esc(s.displayName)} · ${esc(s.username||s.email||s.phone||"")}${s.classIds.length?` (in ${s.classIds.map(i=>cls.find(x=>x.id===i)?.name).filter(Boolean).join(", ")})`:""}</option>`).join("")}</select></div>
        <div class="field" style="display:flex;align-items:flex-end;gap:.4rem"><button class="btn btn-ghost btn-sm" onclick="PL_member(${c.id},Number(document.getElementById('caS${c.id}').value),'add')">Add</button><button class="btn btn-primary btn-sm" onclick="PL_member(${c.id},Number(document.getElementById('caS${c.id}').value),'transfer')">Transfer here</button></div></div>
      <p class="umeta">“Transfer here” removes the student from their other classes; “Add” keeps them in both.</p></div>`).join("")}`;
}
async function PL_createClass(){
  const v=id=>document.getElementById(id).value;
  try{ await api("admin/classes",{method:"POST",body:JSON.stringify({name:v("caName"),mentorId:Number(v("caMentor")),description:v("caDesc")})}); toast("Class created"); viewClassesAdmin(); }catch(e){ toast(e.message); }
}
async function PL_saveClass(id){
  const v=k=>document.getElementById(k+id).value;
  try{ await api(`admin/classes/${id}`,{method:"PATCH",body:JSON.stringify({name:v("caN"),mentorId:Number(v("caM")),description:v("caD")})}); toast("Class saved"); viewClassesAdmin(); }catch(e){ toast(e.message); }
}
async function PL_member(classId,studentId,action){
  if(!studentId){ toast("Choose a student"); return; }
  if(action==="remove"&&!confirm("Remove this student from the class? Their history is kept.")) return;
  try{ await api(`admin/classes/${classId}/members`,{method:"POST",body:JSON.stringify({studentId,action})}); toast(action==="remove"?"Student removed":action==="transfer"?"Student transferred":"Student added"); viewClassesAdmin(); }catch(e){ toast(e.message); }
}

// ──────────────── usage limits (admin) ────────────────
function plLimitInputs(prefix,vals,inherit){
  return `<div class="pl-limits">${Object.keys(PL_LIMIT_LABEL).map(k=>{ const v=vals?.[k];
    return `<div class="field"><label>${PL_LIMIT_LABEL[k]}</label><input id="${prefix}${k}" placeholder="${inherit?"inherit":"unlimited"}" value="${v===undefined||v===null?"":v===-1?"unlimited":v}"/></div>`; }).join("")}</div>`;
}
function plReadLimits(prefix){
  const out={};
  Object.keys(PL_LIMIT_LABEL).forEach(k=>{ const raw=(document.getElementById(prefix+k)?.value||"").trim().toLowerCase(); if(!raw) return; out[k]=raw==="unlimited"||raw==="∞"?-1:Number(raw); });
  return out;
}
async function viewLimits(){
  crumbs([{label:"Limits Management"}]); loading();
  let d,users=[]; try{ [d,users]=await Promise.all([api("admin/limits"),api("users")]); }catch(e){ $c().innerHTML=`<div class="empty"><p>${esc(e.message)}</p></div>`; return; }
  const students=users.filter(u=>u.role==="student");
  $c().innerHTML=`<div class="page-head fade"><h1>Limits &amp; Access</h1><p>Precedence: user override → class limit → platform default. Enter a number, <b>unlimited</b>, or leave blank to inherit. Limits are enforced on the server; changing them never alters past activity.</p></div>
    <div id="fxAccess"><div class="panel"><div class="spin"></div></div></div>
    <div class="panel fade"><h2>${svg("settings","ic-sm")} Platform defaults</h2>
      <h4>Students not in a class</h4>${plLimitInputs("pi_",d.platform.independent,false)}
      <h4 style="margin-top:.8rem">Class members</h4>${plLimitInputs("pm_",d.platform.member,false)}
      <div class="f-row"><div class="field"><label>Platform timezone (daily and weekly resets, streaks)</label><input id="plTz" value="${esc(d.timezone)}" placeholder="e.g. Asia/Tashkent"/></div>
      <div class="field" style="display:flex;align-items:flex-end"><button class="btn btn-primary" onclick="PL_savePlatformLimits()">${svg("save","ic-sm")} Save defaults</button></div></div></div>
    <div class="panel fade"><h2>${svg("users","ic-sm")} Class limits</h2>${d.classes.map(c=>`<details ${Object.keys(c.limits).length?"open":""}><summary><b>${esc(c.name)}</b> ${Object.keys(c.limits).length?`<span class="pill pill-sec">custom</span>`:`<span class="umeta">inherits platform default</span>`}</summary>
      ${plLimitInputs(`c${c.id}_`,c.limits,true)}<div style="display:flex;gap:.4rem"><button class="btn btn-ghost btn-sm" onclick="PL_saveLimits('class',${c.id},'c${c.id}_')">${svg("save","ic-sm")} Save</button>${Object.keys(c.limits).length?`<button class="btn btn-ghost btn-sm" onclick="PL_clearLimits('class',${c.id})">Remove override</button>`:""}</div></details>`).join("")||`<p class="umeta">No classes yet.</p>`}</div>
    <div class="panel fade"><h2>${svg("profile","ic-sm")} User overrides</h2>
      ${d.users.length?`<table class="mini-table"><thead><tr><th>Student</th><th>Overrides</th><th></th></tr></thead><tbody>${d.users.map(u=>`<tr><td>${esc(u.displayName)}</td><td class="umeta">${Object.entries(u.limits).map(([k,v])=>`${esc(PL_LIMIT_LABEL[k]||k)}: ${v===-1?"unlimited":v}`).join(" · ")}</td><td><button class="btn btn-ghost btn-xs" onclick="PL_userLimits(${u.id},${plJs(u.displayName)})">Edit</button> <button class="btn btn-ghost btn-xs" onclick="PL_clearLimits('user',${u.id})">Remove</button></td></tr>`).join("")}</tbody></table>`:`<p class="umeta">No user overrides.</p>`}
      <div class="f-row" style="margin-top:.8rem"><div class="field"><label>Add an override for</label><select id="plLimUser"><option value="">Choose a student…</option>${students.map(s=>`<option value="${s.id}">${esc(s.displayName)} · ${esc(s.username||s.email||s.phone||"")}</option>`).join("")}</select></div>
      <div class="field" style="display:flex;align-items:flex-end;gap:.4rem"><button class="btn btn-ghost" onclick="const s=document.getElementById('plLimUser');if(s.value)PL_userLimits(Number(s.value),s.options[s.selectedIndex].text)">Edit limits</button><button class="btn btn-ghost" onclick="const s=document.getElementById('plLimUser');if(s.value)FX_userAccess(Number(s.value))">Subject access</button></div></div></div>`;
  FX_renderAccess();
}
async function PL_savePlatformLimits(){
  try{ await api("admin/limits/platform",{method:"PUT",body:JSON.stringify({independent:plReadLimits("pi_"),member:plReadLimits("pm_"),timezone:document.getElementById("plTz").value.trim()})}); toast("Platform limits saved"); viewLimits(); }catch(e){ toast(e.message); }
}
async function PL_saveLimits(scope,id,prefix){
  try{ await api(`admin/limits/${scope}/${id}`,{method:"PUT",body:JSON.stringify({limits:plReadLimits(prefix)})}); toast("Limits saved"); ftCloseModal(); if(state.view==="limits") viewLimits(); }catch(e){ toast(e.message); }
}
async function PL_clearLimits(scope,id){
  if(!confirm("Remove this override? The next level's limit applies again.")) return;
  try{ await api(`admin/limits/${scope}/${id}`,{method:"DELETE"}); toast("Override removed"); ftCloseModal(); if(state.view==="limits") viewLimits(); }catch(e){ toast(e.message); }
}
async function PL_userLimits(id,name){
  let d; try{ d=await api(`admin/limits/user/${id}`); }catch(e){ toast(e.message); return; }
  ftModal(`Limits · ${esc(name)}`,`<p><button class="btn btn-ghost btn-sm" onclick="ftCloseModal();FX_userAccess(${id})">${svg("lock","ic-sm")} Subject access (Math / English)…</button></p><h4>Usage today</h4>${plUsageHTML(d.usage)}<h4 style="margin-top:1rem">Override (blank = inherit, “unlimited” = no limit, 0 = blocked)</h4>${plLimitInputs("u_",d.overrides,true)}`,
    {foot:`${Object.keys(d.overrides).length?`<button class="btn btn-ghost" onclick="PL_clearLimits('user',${id})">Remove override</button>`:""}<button class="btn btn-primary" onclick="PL_saveLimits('user',${id},'u_')">${svg("save","ic-sm")} Save</button>`});
}

// ──────────────── audit log (admin, on Users page) ────────────────
async function PL_showAudit(){
  let rows=[]; try{ rows=await api("admin/audit"); }catch(e){ toast(e.message); return; }
  ftModal("Audit log",rows.length?`<table class="mini-table"><thead><tr><th>When</th><th>Who</th><th>Action</th><th>Target</th></tr></thead><tbody>${rows.map(r=>`<tr><td class="umeta">${esc(plWhen(r.createdAt))}</td><td>${esc(r.actorName||"—")}</td><td>${esc(r.action)}</td><td class="umeta">${esc(r.targetType)} ${esc(r.targetId)}</td></tr>`).join("")}</tbody></table>`:`<p class="umeta">Nothing logged yet.</p>`,{wide:true});
}

// ════════════════ EXAM MODE (full screen + integrity monitoring) ════════════════
async function plExamSettings(){
  if(PL.examSettings&&Date.now()-PL.examSettings.at<60000) return PL.examSettings.v;
  try{ const v=await api("exam-settings"); PL.examSettings={at:Date.now(),v}; return v; }catch{ return {examModeFullLength:false}; }
}
const plFsSupported=()=>!!(document.documentElement.requestFullscreen||document.documentElement.webkitRequestFullscreen);
function plRequestFs(){
  const el=document.documentElement;
  try{ const p=(el.requestFullscreen||el.webkitRequestFullscreen).call(el); return p&&p.then?p.then(()=>true,()=>false):Promise.resolve(true); }
  catch{ return Promise.resolve(false); }
}
const plIsFs=()=>!!(document.fullscreenElement||document.webkitFullscreenElement);
// Shown before a full-length sitting starts; the clock starts only after the click.
async function plExamIntro({allowPractice,onStart}){
  const s=await plExamSettings();
  if(!s.examModeFullLength){ onStart(false); return; }
  PL.introStart=onStart;
  ftModal("Digital SAT · Exam Mode",`<ul class="bb-help">
      <li>The exam opens in <b>full screen</b>. Website navigation is hidden; the timer, question navigator, Mark for Review, answer eliminator, highlighter and Desmos calculator work as usual.</li>
      <li>Answers save automatically as you choose them. If you lose connection or refresh, you continue where you left off — the server keeps the official time, so the clock never restarts.</li>
      <li>This browser records when you <b>leave full screen</b>, <b>switch tabs or windows</b>, or try to leave the page. Recorded events are reviewed by your mentor or admin. The ${ordinal(s.warnAt)} event shows a warning, the ${ordinal(s.strongWarnAt)} a stronger warning, and the ${ordinal(s.reviewAt)} marks the sitting “Review Required”. Events never submit or cancel your exam automatically.</li>
      <li>No camera, microphone or screen recording is used.</li>
      <li>Explanations appear only after you submit.</li></ul>
    ${plFsSupported()?"":`<p class="vb-err">This browser does not support full screen. ${s.allowWithoutFullscreen?"You can still take the exam; this is noted in your report.":"Use a desktop browser such as Chrome, Edge, Firefox or Safari to take this exam."}</p>`}`,
    {foot:`${allowPractice&&s.allowPracticeMode?`<button class="btn btn-ghost" onclick="ftCloseModal();PL.introStart(false)">Practice Mode instead (no full screen)</button>`:""}
      ${plFsSupported()||s.allowWithoutFullscreen?`<button class="btn btn-primary" onclick="PL_startExam()">${svg("lock","ic-sm")} Start Full-Screen Exam</button>`:""}`});
  function ordinal(n){ return n+(n%10===1&&n!==11?"st":n%10===2&&n!==12?"nd":n%10===3&&n!==13?"rd":"th"); }
}
function PL_startExam(){
  // Called directly from the click so the browser allows full screen.
  const fs=plFsSupported()?plRequestFs():Promise.resolve(false);
  ftCloseModal();
  fs.then(ok=>{ PL.fsFailedAtStart=!ok; PL.introStart(true); });
}
function plExamActive(){ return !!(typeof T!=="undefined"&&T&&T.attempt?.examMode&&T.status==="active"&&state.view==="testsit"&&state.user?.role==="student"); }
function plExamStart(){
  if(!plExamActive()) return;
  plExamSettings().then(s=>{
    if(!plExamActive()) return;
    if(PL.exam?.id===T.id&&PL.exam.on) return;
    PL.exam={id:T.id,on:true,s,hiddenAt:null,blurAt:null,last:{},suppress:0,queue:[]};
    document.addEventListener("fullscreenchange",plOnFs); document.addEventListener("webkitfullscreenchange",plOnFs);
    document.addEventListener("visibilitychange",plOnVis); window.addEventListener("blur",plOnBlur); window.addEventListener("focus",plOnFocus);
    window.addEventListener("beforeunload",plOnUnload);
    ["copy","cut","paste"].forEach(t=>document.addEventListener(t,plOnClip,true));
    if(PL.fsFailedAtStart){ PL.fsFailedAtStart=false; plEvent("fullscreen_unavailable"); }
    if(s.requireFullscreen&&!plIsFs()) plFsGate();
  });
}
function plExamStop(){
  if(!PL.exam?.on) return;
  PL.exam.on=false;
  document.removeEventListener("fullscreenchange",plOnFs); document.removeEventListener("webkitfullscreenchange",plOnFs);
  document.removeEventListener("visibilitychange",plOnVis); window.removeEventListener("blur",plOnBlur); window.removeEventListener("focus",plOnFocus);
  window.removeEventListener("beforeunload",plOnUnload);
  ["copy","cut","paste"].forEach(t=>document.removeEventListener(t,plOnClip,true));
  document.getElementById("plFsGate")?.remove();
}
// Leaving the runner for good (submitted, exited): give the screen back.
function plExamEnd(){ plExamStop(); PL.exam=null; if(plIsFs()) (document.exitFullscreen||document.webkitExitFullscreen)?.call(document)?.catch?.(()=>{}); }
// Native confirm/alert dialogs steal focus; never count them.
(function(){ const c=window.confirm.bind(window), a=window.alert.bind(window);
  window.confirm=m=>{ if(PL.exam) PL.exam.suppress=Infinity; try{ return c(m); } finally{ if(PL.exam) PL.exam.suppress=Date.now()+800; } };
  window.alert=m=>{ if(PL.exam) PL.exam.suppress=Infinity; try{ return a(m); } finally{ if(PL.exam) PL.exam.suppress=Date.now()+800; } };
})();
function plEvent(type,extra={}){
  const e=PL.exam; if(!e?.on||!plExamActive()) return;
  if(Date.now()<e.suppress&&type!=="fullscreen_exit") return;
  const now=Date.now();
  if(e.last[type]&&now-e.last[type]<1000) return; // one browser action, one report
  e.last[type]=now;
  e.queue.push({type,at:extra.at||now,durationMs:extra.durationMs??null});
  plFlushEvents(extra.keepalive);
}
async function plFlushEvents(keepalive){
  const e=PL.exam; if(!e?.queue.length) return;
  const events=e.queue.splice(0);
  const body=JSON.stringify({attemptId:e.id,events});
  if(keepalive){
    const token=localStorage.getItem(LS.token);
    try{ fetch("/api/integrity/events",{method:"POST",keepalive:true,body,headers:{"content-type":"application/json",...(token?{authorization:"Bearer "+token}:{})}}); }catch{}
    return;
  }
  try{ const r=await api("integrity/events",{method:"POST",body}); if(r?.newViolation) plWarn(r); }
  catch(err){ if(!err.status) e.queue.unshift(...events); } // offline: retry with the next event
}
function plWarn(r){
  if(!plExamActive()) return;
  const msg=r.level==="review"
    ?`This sitting has been marked <b>Review Required</b> (${r.violationCount} recorded events). You can keep working — your mentor or admin will review the record.`
    :r.level==="strong"?`<b>Second warning.</b> Leaving the exam screen again marks this sitting for review. Stay in full screen until you submit.`
    :`<b>Warning:</b> leaving full screen or switching tabs is recorded during Exam Mode. Please stay on the exam screen.`;
  ftModal("Exam integrity",`<p>${msg}</p>`,{foot:`<button class="btn btn-primary" onclick="ftCloseModal();PL_reenterFs()">Return to the exam</button>`});
}
function plOnFs(){ if(!plIsFs()&&PL.exam?.on){ plEvent("fullscreen_exit"); if(PL.exam.s.requireFullscreen) plFsGate(); } else document.getElementById("plFsGate")?.remove(); }
function plOnVis(){
  const e=PL.exam; if(!e?.on) return;
  if(document.visibilityState==="hidden") e.hiddenAt=Date.now();
  else if(e.hiddenAt){ const at=e.hiddenAt; e.hiddenAt=null; e.blurAt=null; plEvent("tab_hidden",{at,durationMs:Date.now()-at}); }
}
function plOnBlur(){ const e=PL.exam; if(e?.on&&Date.now()>=e.suppress) e.blurAt=Date.now(); }
function plOnFocus(){
  const e=PL.exam; if(!e?.on||!e.blurAt) return;
  const at=e.blurAt; e.blurAt=null;
  if(Date.now()-at>=1500) plEvent("window_blur",{at,durationMs:Date.now()-at});
}
function plOnUnload(ev){ if(!plExamActive()) return; plEvent("navigation",{keepalive:true}); ev.preventDefault(); ev.returnValue=""; }
function plOnClip(ev){
  if(!plExamActive()) return;
  if(ev.target?.closest?.(".desmos-float,.dcg-container")) return; // calculator expressions stay usable
  if(ev.target?.closest?.(".spr-input,.bb-spr input,input[type=text]")&&ev.type==="paste") { ev.preventDefault(); plEvent("paste"); return; }
  ev.preventDefault(); plEvent(ev.type==="paste"?"paste":"copy");
}
function plFsGate(){
  if(document.getElementById("plFsGate")||!plExamActive()) return;
  const allow=PL.exam?.s?.allowWithoutFullscreen;
  const el=document.createElement("div"); el.id="plFsGate"; el.className="pause-overlay";
  el.innerHTML=`<div class="pause-card"><div class="badge-ic tone-gold" style="margin:0 auto;width:54px;height:54px">${svg("lock")}</div>
    <h2>Return to full screen</h2><p class="umeta" style="margin:.4rem 0 1rem">This exam runs in full screen. The clock keeps running on the server, so return now to continue.</p>
    <div class="pause-actions"><button class="btn btn-primary" onclick="PL_reenterFs()">${svg("lock","ic-sm")} Re-enter full screen</button>
    ${allow||!plFsSupported()?`<button class="btn btn-ghost" onclick="document.getElementById('plFsGate')?.remove()">Continue without full screen</button>`:""}</div></div>`;
  document.body.appendChild(el);
}
function PL_reenterFs(){ if(!plIsFs()&&plFsSupported()) plRequestFs().then(ok=>{ if(ok) document.getElementById("plFsGate")?.remove(); else if(!PL.exam?.s?.allowWithoutFullscreen) toast("Full screen was blocked by the browser."); }); else document.getElementById("plFsGate")?.remove(); }
