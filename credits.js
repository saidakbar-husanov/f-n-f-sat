// credits.js — optional student credits.
//
// Students: nothing here renders unless the server says credit mode is on
// for this account (GET /api/credits returns {} while it is off, and every
// student response simply omits credit fields). So a student with the mode
// off never sees a balance, zero, price, reservation, warning or receipt.
// Super admin (/admin/limits?accessStudent=<id>): mode switch, grant, top-up,
// correction, ledger, and class grants with a preview.

const CR={data:{},at:0,p:null};
const crOn=()=>state.user?.role==="student"&&!!CR.data?.enabled;
const crN=n=>Number(n||0).toLocaleString();
async function CR_load(force){
  if(state.user?.role!=="student"){ CR.data={}; return CR.data; }
  if(!force&&Date.now()-CR.at<10000) return CR.data;
  if(!CR.p) CR.p=api("credits",{bg:true}).then(d=>{ CR.data=d||{}; CR.at=Date.now(); CR_paint(); return CR.data; }).catch(()=>CR.data).finally(()=>{ CR.p=null; });
  return CR.p;
}
// Apply the credit state that came back with a response (undefined = off).
function CR_receipt(credit){
  if(state.user?.role!=="student") return;
  if(!credit){ if(CR.data.enabled){ CR.data={}; CR_paint(); } return; }
  CR.data={...CR.data,enabled:true,balance:credit.balance,reserved:credit.reserved,available:credit.available}; CR.at=Date.now();
  CR_paint();
  if(credit.charged>0) CR_flash(`1 credit used · ${crN(credit.available)} available`);
  else if(credit.duplicate) CR_flash(`Already submitted — no extra credit used · ${crN(credit.available)} available`);
}
function CR_flash(msg){ const el=document.getElementById("crReceipt"); if(el){ el.textContent=msg; el.hidden=false; } }
// Repaint every credit element on the page (also hides them when the mode goes off).
function CR_paint(){
  document.querySelectorAll("[data-cr]").forEach(el=>{
    const kind=el.dataset.cr;
    el.innerHTML=crOn()?(kind==="dash"?CR_dashInner():kind==="cost"?CR_costInner(el.dataset.crq):""):"";
    el.hidden=!crOn();
  });
}
function CR_dashInner(){
  const d=CR.data;
  return `<div class="cr-dash panel fade" role="status"><div class="cr-dash-main"><span class="umeta">Available credits</span><b class="cr-big">${crN(d.available)}</b></div>
    ${d.reserved?`<div><span class="umeta">Reserved by an open test</span><b>${crN(d.reserved)}</b></div>`:""}
    <div><span class="umeta">Balance</span><b>${crN(d.balance)}</b></div>
    <p class="umeta cr-rule">Each submitted answer uses 1 credit, correct or not. Opening, reading, skipping, navigating and reviewing are free.${d.available<=0?` <b>You have no credits left — ask your administrator for more. Past results and reviews stay available.</b>`:""}</p></div>`;
}
function CR_costInner(q){
  const d=CR.data, n=Number(q)||0;
  if(n>0) return `<p class="cr-cost">${svg("info","ic-sm")} Module 1 has ${n} questions, so <b>${n} credits are reserved</b> before the timer starts. Only submitted answers are charged; unused credits return when each module is submitted. You have ${crN(d.available)} available.</p>`;
  return `<p class="cr-cost">${svg("info","ic-sm")} Cost: <b>1 credit per submitted answer</b> · ${crN(d.available)} available${d.reserved?` (${crN(d.reserved)} reserved)`:""}.</p>`;
}
// Placeholders the views drop in; they stay empty while the mode is off.
function CR_dashHTML(){ return `<div data-cr="dash" hidden></div>`; }
function CR_costHTML(questions){ return `<div data-cr="cost" data-crq="${questions||""}" hidden></div>`; }
// Practice footer: cost before checking, receipt after.
function CR_costNote(result){
  if(!crOn()) return "";
  return result?`<span class="umeta cr-note" id="crReceipt" hidden></span>`:`<span class="umeta cr-note" id="crReceipt">1 credit · ${crN(CR.data.available)} left</span>`;
}
function CR_outOfCredits(data){
  if(data?.credits) CR.data={...data.credits}; CR_paint();
  ftModal("Credit limit reached",`<p>${esc(data?.error||"You have no credits left.")}</p><p class="umeta" style="margin-top:.6rem">Nothing was charged for this attempt and your answer is still on the page. Your past results and reviews stay available.</p>`,
    {foot:`<button class="btn btn-ghost" onclick="ftCloseModal();go('review')">Open reviews</button><button class="btn btn-primary" onclick="ftCloseModal()">OK</button>`});
}

// ──────────────── super admin: credits on the Limitations screen ────────────────
const CRA={student:null,data:null,classes:null};
function crKey(){ return (crypto.randomUUID?crypto.randomUUID():Date.now().toString(36)+Math.random().toString(36).slice(2)).replace(/[^A-Za-z0-9_-]/g,""); }
async function CRA_render(){
  const host=document.getElementById("crAdmin"); if(!host) return;
  if(!state.user?.profile?.superAdmin){ host.innerHTML=""; return; }
  const sid=Number(state.accessStudent)||null;
  host.innerHTML=`<div class="panel fade"><h2>${svg("target","ic-sm")} Student credits <span class="pill pill-muted">super admin</span></h2>
    <p class="umeta">Credit mode is off for every student until you turn it on for them. While it is off the student sees nothing about credits and practice is never charged. Grants never turn the mode on. Credits are separate from leaderboard points and from subject, section and class access.</p>
    <div id="crStudent">${sid?`<div class="spin"></div>`:`<p class="umeta">Choose a student in Subject access above (or below) to manage their credits.</p>`}</div>
    <h3 style="margin-top:1.2rem">Class grant</h3><div id="crClass"><div class="spin"></div></div></div>`;
  CRA_renderClass();
  if(sid) CRA_loadStudent(sid);
}
async function CRA_loadStudent(id){
  let d; try{ d=await api(`admin/credits/${id}`); }catch(e){ const el=document.getElementById("crStudent"); if(el) el.innerHTML=`<p class="umeta">${esc(e.message)}</p>`; return; }
  if(Number(state.accessStudent)!==id) return;
  CRA.data=d;
  const el=document.getElementById("crStudent"); if(!el) return;
  const kindLabel={grant:"Grant",topup:"Top-up",correction:"Correction",debit:"Answer",settle:"Mock settlement"};
  el.innerHTML=`<div class="cr-admin-head"><div><b>${esc(d.student.displayName)}</b> ${d.student.username?`<span class="umeta">@${esc(d.student.username)}</span>`:""}</div>
      <label class="cr-switch"><input type="checkbox" ${d.enabled?"checked":""} onchange="CRA_mode(${id},this.checked,this)"/> <span>Credit mode ${d.enabled?"<b>on</b>":"<b>off</b>"}</span></label></div>
    <div class="stat-grid"><div class="stat-card"><div class="lbl">Balance</div><div class="val">${crN(d.balance)}</div></div><div class="stat-card"><div class="lbl">Reserved</div><div class="val">${crN(d.reserved)}</div></div><div class="stat-card"><div class="lbl">Available</div><div class="val">${crN(d.available)}</div></div></div>
    ${d.enabled?"":`<p class="st-note">${svg("info","ic-sm")} Mode is off: this student sees no credit information and is never charged. The stored balance and history are kept.</p>`}
    <div class="f-row" style="margin-top:.8rem">
      <div class="field"><label>Change</label><select id="crKind" onchange="document.getElementById('crAmtLbl').textContent=this.value==='correction'?'Corrected balance':'Credits to add'"><option value="grant">Grant</option><option value="topup">Top-up</option><option value="correction">Correct balance</option></select></div>
      <div class="field"><label id="crAmtLbl">Credits to add</label><input id="crAmt" type="number" min="0" step="1" inputmode="numeric" placeholder="e.g. 3000"/></div>
      <div class="field" style="flex:2"><label>Reason (stored with the change)</label><input id="crReason" maxlength="300" placeholder="e.g. Term 1 allowance"/></div>
      <div class="field" style="display:flex;align-items:flex-end"><button class="btn btn-primary" id="crApply" onclick="CRA_adjust(${id})">${svg("save","ic-sm")} Apply</button></div></div>
    <details style="margin-top:.8rem" ${d.ledger.length?"open":""}><summary class="umeta">History (${d.ledger.length})</summary>
      ${d.ledger.length?`<div class="ft-table-wrap"><table class="mini-table"><thead><tr><th>When</th><th>Change</th><th>Balance after</th><th>Type</th><th>Reason</th><th>By</th><th>Related</th></tr></thead><tbody>
      ${d.ledger.map(l=>`<tr><td class="umeta">${esc(new Date(l.createdAt).toLocaleString())}</td><td><b class="${l.delta<0?"cr-neg":"cr-pos"}">${l.delta>0?"+":""}${crN(l.delta)}</b></td><td>${crN(l.balanceAfter)}</td><td>${esc(kindLabel[l.kind]||l.kind)}</td><td>${esc(l.reason)}</td><td>${esc(l.actor||"—")}</td><td class="umeta">${l.attemptId?`attempt #${l.attemptId}`:l.batchId?`batch ${esc(l.batchId.slice(0,8))}`:esc(l.ref||"")}</td></tr>`).join("")}</tbody></table></div>`:`<p class="umeta">No credit activity yet.</p>`}</details>`;
}
async function CRA_mode(id,on,box){
  if(!confirm(on?"Turn credit mode ON for this student? They will see their balance and each submitted answer will use 1 credit.":"Turn credit mode OFF? All credit information disappears for the student immediately and credits reserved by an open test are released. The balance and history are kept.")){ box.checked=!on; return; }
  box.disabled=true;
  try{ const r=await api(`admin/credits/${id}/mode`,{method:"POST",body:JSON.stringify({enabled:on})}); toast(on?"Credit mode on":`Credit mode off${r.released?` · ${r.released} reservation released`:""}`); }catch(e){ toast(e.message); }
  CRA_loadStudent(id);
}
async function CRA_adjust(id){
  const kind=document.getElementById("crKind").value, v=document.getElementById("crAmt").value.trim(), reason=document.getElementById("crReason").value.trim();
  if(!v||!/^\d+$/.test(v)){ toast("Enter a whole number."); return; }
  if(!reason){ toast("Enter a reason."); return; }
  const btn=document.getElementById("crApply"); btn.disabled=true;
  // One id per click: a retried request applies the change once.
  const key=btn.dataset.key||(btn.dataset.key=crKey());
  try{
    const r=await api(`admin/credits/${id}/adjust`,{method:"POST",body:JSON.stringify(kind==="correction"?{kind,target:Number(v),reason,key}:{kind,amount:Number(v),reason,key})});
    toast(r.duplicate?"Already applied":`Saved · balance ${crN(r.balance)}${r.enabled?"":" (mode is off — the student sees nothing)"}`);
    CRA_loadStudent(id);
  }catch(e){ toast(e.message); btn.disabled=false; }
}
async function CRA_renderClass(){
  const el=document.getElementById("crClass"); if(!el) return;
  if(!CRA.classes){ try{ CRA.classes=(await api("admin/classes")).classes||[]; }catch{ CRA.classes=[]; } }
  el.innerHTML=`<div class="f-row"><div class="field"><label>Class</label><select id="crgClass"><option value="">Choose a class…</option>${CRA.classes.map(c=>`<option value="${c.id}">${esc(c.name)}</option>`).join("")}</select></div>
    <div class="field"><label>Credits per student</label><input id="crgAmt" type="number" min="1" step="1" inputmode="numeric"/></div>
    <div class="field" style="flex:2"><label>Reason</label><input id="crgReason" maxlength="300" placeholder="e.g. Class allowance"/></div>
    <div class="field" style="display:flex;align-items:flex-end"><button class="btn btn-ghost" onclick="CRA_classPreview()">Preview grant</button></div></div>
    <label class="umeta"><input type="checkbox" id="crgOff"/> Also grant to students whose credit mode is off (their mode stays off and they see nothing)</label>
    <div id="crgPrev"></div>`;
}
async function CRA_classPreview(){
  const classId=Number(document.getElementById("crgClass").value), amount=Number(document.getElementById("crgAmt").value), includeOff=document.getElementById("crgOff").checked;
  const out=document.getElementById("crgPrev");
  let p; try{ p=await api("admin/credits/class-grant/preview",{method:"POST",body:JSON.stringify({classId,amount,includeOff})}); }catch(e){ out.innerHTML=`<p class="umeta">${esc(e.message)}</p>`; return; }
  CRA.batch={batchId:crKey(),classId,amount,includeOff,reason:document.getElementById("crgReason").value.trim()};
  out.innerHTML=`<div class="cr-preview"><p><b>${esc(p.className)}</b>: ${p.members} active student${p.members===1?"":"s"} · <b>${p.recipients}</b> recipient${p.recipients===1?"":"s"} × <b>${crN(p.amountPerStudent)}</b> = <b>${crN(p.total)}</b> credits.</p>
    ${p.modeOff.length?`<p class="umeta">Credit mode is off for ${p.modeOff.length}: ${p.modeOff.map(m=>esc(m.displayName)).join(", ")}. ${includeOff?"They receive the credits but still see nothing; the mode is not turned on.":"They are skipped."}</p>`:`<p class="umeta">Every member has credit mode on.</p>`}
    <button class="btn btn-primary btn-sm" ${p.recipients?"":"disabled"} onclick="CRA_classGrant(this)">${svg("check","ic-sm")} Grant ${crN(p.total)} credits</button></div>`;
}
async function CRA_classGrant(btn){
  const b=CRA.batch; if(!b) return; btn.disabled=true;
  try{ const r=await api("admin/credits/class-grant",{method:"POST",body:JSON.stringify(b)});
    document.getElementById("crgPrev").innerHTML=`<p class="st-note">${svg("check","ic-sm")} Granted ${crN(r.amountPerStudent)} to ${r.granted} student${r.granted===1?"":"s"}${r.alreadyGranted?` · ${r.alreadyGranted} already had this batch (not granted twice)`:""}.</p>`;
    if(Number(state.accessStudent)) CRA_loadStudent(Number(state.accessStudent));
  }catch(e){ toast(e.message+" — retrying uses the same batch, so nobody is granted twice."); btn.disabled=false; }
}
