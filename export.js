// export.js — the one "Download" action for question sets (staff only).
//
// EXP_buttonHTML(spec) renders a compact Download button. It opens a small
// dialog: PDF or JSON, the scope (Question Bank: entire bank or the current
// filters), "Include answer keys & explanations" when the server allows it,
// and the scope label + question count from GET /api/export/preview before the
// Download button is enabled. Every format comes from the same export service
// (netlify/lib/export.ts):
//   • JSON → GET /api/export?…&format=json, saved as the server's file name;
//   • PDF  → GET /api/export?…&format=print, rendered into a dedicated
//            printable document (KaTeX math, images, passages, tables), then
//            the browser's print dialog saves it as PDF.
// spec: {scope:"bank", filters: ()=>AQ.filter | {...} | null, key?}
//       {scope:"challenge", setId}   {scope:"test", testId}

const EXP={specs:[],keys:new Map(),cur:null,seq:0};
const EXP_ICON='<path d="M12 4v11M7 10l5 5 5-5"/><path d="M4 17v2a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-2"/>';
function EXP_icon(){ return `<svg class="ic ic-sm" viewBox="0 0 24 24">${EXP_ICON}</svg>`; }

function EXP_buttonHTML(spec,opts={}){
  const key=spec.key||JSON.stringify(spec,(k,v)=>typeof v==="function"?undefined:v);
  let i=EXP.keys.get(key);
  if(i===undefined){ i=EXP.specs.push(spec)-1; EXP.keys.set(key,i); } else EXP.specs[i]=spec;
  return `<button type="button" class="btn btn-ghost ${opts.size||"btn-sm"} exp-btn" onclick="EXP_open(${i})" title="Download as PDF or JSON" aria-label="Download as PDF or JSON">${EXP_icon()} Download <span class="exp-fmt">PDF · JSON</span></button>`;
}

// The staff question browsers' filter ({q,section,category,subcategory,difficulty,type})
// or an already-shaped {subjects,difficulties,levels,domains,skills,types,q}.
function EXP_filters(raw){
  const f=typeof raw==="function"?raw():raw;
  if(!f||typeof f!=="object") return null;
  const o={subjects:[],difficulties:[],levels:[],domains:[],skills:[],types:[],q:""};
  if(["subjects","difficulties","domains","skills"].some(k=>Array.isArray(f[k]))){
    for(const k of Object.keys(o)) if(k==="q") o.q=String(f.q||"").trim(); else o[k]=Array.isArray(f[k])?f[k].slice():[];
  }else{
    if(f.section) o.subjects=[f.section];
    if(f.category) o.domains=[f.category];
    if(f.subcategory) o.skills=[f.subcategory];
    const d=String(f.difficulty||"");
    if(["easy","medium","hard"].includes(d)) o.difficulties=[d]; else if(/^[1-5]$/.test(d)) o.levels=[Number(d)];
    if(f.type) o.types=[f.type];
    o.q=String(f.q||"").trim();
  }
  const any=o.q||Object.entries(o).some(([k,v])=>k!=="q"&&v.length);
  return any?o:null;
}

function EXP_query(st,extra={}){
  const p=new URLSearchParams();
  p.set("scope",st.spec.scope);
  if(st.spec.scope==="challenge") p.set("setId",String(st.spec.setId));
  if(st.spec.scope==="test") p.set("testId",String(st.spec.testId));
  if(st.spec.scope==="bank"){
    if(st.useFilters&&st.filters){
      const f=st.filters;
      ["subjects","difficulties","levels","domains","skills","types"].forEach(k=>(f[k]||[]).forEach(v=>p.append(k,String(v))));
      if(f.q) p.set("q",f.q);
    }else p.set("all","1");
  }
  if(st.solutions) p.set("solutions","1");
  for(const [k,v] of Object.entries(extra)) p.set(k,v);
  return p.toString();
}

function EXP_open(i){
  const spec=EXP.specs[i]; if(!spec) return;
  const filters=spec.scope==="bank"?EXP_filters(spec.filters):null;
  EXP.cur={spec,filters,useFilters:!!filters,format:"pdf",solutions:true,preview:null,loading:true,busy:false,error:null,token:0};
  ftModal(`${EXP_icon()} Download`,`<div id="expBody"></div>`,{foot:`<div id="expFoot" class="exp-foot"></div>`});
  document.getElementById("ftModal")?.classList.add("exp-modal");
  EXP_render(); EXP_refresh();
}

async function EXP_refresh(){
  const st=EXP.cur; if(!st) return;
  const token=++st.token;
  st.loading=true; st.error=null; EXP_render();
  try{
    const pv=await api("export/preview?"+EXP_query(st));
    if(EXP.cur!==st||token!==st.token) return;
    st.preview=pv;
    if(!pv.solutionsAllowed) st.solutions=false;
  }catch(e){
    if(EXP.cur!==st||token!==st.token) return;
    st.preview=null; st.error=e.message||"The export could not be prepared.";
  }
  st.loading=false; EXP_render();
}

function EXP_set(key,value){
  const st=EXP.cur; if(!st) return;
  st[key]=value;
  if(key==="useFilters"||key==="solutions") EXP_refresh(); else EXP_render();
}

function EXP_render(){
  const st=EXP.cur; const body=document.getElementById("expBody"), foot=document.getElementById("expFoot");
  if(!st||!body||!foot) return;
  const pv=st.preview;
  const radio=(name,val,cur,label,hint,disabled)=>`<label class="exp-opt ${cur===val?"on":""} ${disabled?"off":""}">
    <input type="radio" name="${name}" ${cur===val?"checked":""} ${disabled?"disabled":""} onchange="EXP_set('${name}',${typeof val==="string"?`'${val}'`:val})"/>
    <span><b>${esc(label)}</b>${hint?`<small>${esc(hint)}</small>`:""}</span></label>`;
  const scopeBlock=st.spec.scope==="bank"?`<div class="exp-group"><div class="exp-label">Scope</div><div class="exp-opts">
      ${radio("useFilters",false,st.useFilters,"Entire bank","Every Question Bank question")}
      ${radio("useFilters",true,st.useFilters,"Current filters",st.filters?"The questions matching this page's filters":"Set a filter on this page first",!st.filters)}
    </div></div>`:"";
  const keysBlock=pv?.solutionsAllowed?`<label class="exp-check"><input type="checkbox" ${st.solutions?"checked":""} onchange="EXP_set('solutions',this.checked)"/> Include answer keys &amp; explanations</label>`:"";
  let summary;
  if(st.loading) summary=`<div class="exp-summary"><span class="spin exp-spin"></span> Counting questions…</div>`;
  else if(st.error) summary=`<div class="exp-summary err">${esc(st.error)}</div>`;
  else if(pv){
    const n=pv.questionCount;
    const jsonNote=st.format==="json"
      ?(st.solutions&&pv.importable?`Re-importable${pv.jsonNote?` · ${esc(pv.jsonNote)}`:""}`:"Questions only — not re-importable without answer keys")
      :(st.solutions?"Answer key and explanations in an appendix":"Questions only — no answer key");
    summary=`<div class="exp-summary"><div class="exp-scope">${esc(pv.label)}</div>
      <div class="exp-count"><b>${n.toLocaleString()}</b> question${n===1?"":"s"}${pv.modules?` · ${pv.modules} module${pv.modules===1?"":"s"}`:""}</div>
      <div class="umeta">${st.solutions?"Answer keys included":"Answer keys not included"} · ${jsonNote}</div>
      ${pv.unclassified?`<div class="umeta">${pv.unclassified} question(s) outside the platform domains are listed but not importable.</div>`:""}</div>`;
  }else summary="";
  body.innerHTML=`<div class="exp-group"><div class="exp-label">Format</div><div class="exp-opts">
      ${radio("format","pdf",st.format,"PDF","Print-ready: math, images, passages, tables")}
      ${radio("format","json",st.format,"JSON","Versioned file for the matching importer")}
    </div></div>${scopeBlock}${keysBlock}${summary}`;
  const ready=!st.loading&&!st.busy&&pv&&pv.questionCount>0;
  foot.innerHTML=`<button class="btn btn-ghost btn-sm" onclick="ftCloseModal()">Cancel</button>
    <button class="btn btn-primary btn-sm" id="expGo" ${ready?"":"disabled"} onclick="EXP_download()">${EXP_icon()} ${st.busy?"Preparing…":`Download ${st.format==="pdf"?"PDF":"JSON"}`}</button>`;
}

async function EXP_download(){
  const st=EXP.cur; if(!st||st.busy||!st.preview) return;
  // The print window must be opened inside the click, or it is blocked.
  const win=st.format==="pdf"?window.open("","_blank"):null;
  if(win){ try{ win.document.write(`<!doctype html><title>Preparing…</title><p style="font:16px system-ui;padding:2rem">Preparing the printable document…</p>`); }catch{} }
  st.busy=true; EXP_render();
  try{
    if(st.format==="json") await EXP_saveJSON(st);
    else await EXP_print(st,win);
    if(EXP.cur===st) ftCloseModal();
  }catch(e){
    try{ win?.close(); }catch{}
    toast(e.message||"The download failed.");
    st.busy=false; EXP_render();
  }
}

async function EXP_saveJSON(st){
  const token=localStorage.getItem(LS.token);
  const r=await fetch("/api/export?"+EXP_query(st,{format:"json"}),{headers:token?{authorization:"Bearer "+token}:{}});
  if(!r.ok){ let m="The export failed."; try{ m=(await r.json()).error||m; }catch{} throw new Error(m); }
  const blob=await r.blob();
  const cd=r.headers.get("content-disposition")||"";
  const name=(cd.match(/filename="?([^";]+)"?/)||[])[1]||"export.json";
  const a=document.createElement("a"); a.href=URL.createObjectURL(blob); a.download=name;
  document.body.appendChild(a); a.click(); setTimeout(()=>{ URL.revokeObjectURL(a.href); a.remove(); },1000);
  toast(`Downloaded ${name}`);
}

// ──────────────── printable document ────────────────
function EXP_rich(v){
  // mathText sanitises rich HTML and typesets LaTeX; printed images must load eagerly.
  return mathText(v||"").replace(/\sloading="lazy"/g,' loading="eager"').replace(/\sdata-zoom="1"/g,"");
}
function EXP_img(src,alt,cls){ return src?`<img class="${cls}" src="${esc(src)}" alt="${esc(alt)}" loading="eager"/>`:""; }

function EXP_questionHTML(q){
  const meta=[q.domain,q.skill,q.difficulty,q.type==="SPR"?"Grid-in":"Multiple choice"].filter(Boolean).map(esc).join(" · ");
  const choices=q.type==="SPR"
    ?`<div class="p-spr">Answer: <span class="p-line"></span></div>`
    :`<ol class="p-choices">${q.choices.map(c=>`<li><span class="p-letter">${esc(c.id)}</span><div class="p-ctext">${EXP_rich(c.text)}${EXP_img(c.image,`Answer choice ${c.id}`,"p-cimg")}</div></li>`).join("")}</ol>`;
  return `<article class="p-q"><div class="p-qhead"><span class="p-n">${q.n}</span><span class="p-meta">${meta}<span class="p-id">${esc(q.id)}</span></span></div>
    ${q.passage?`<div class="p-passage">${EXP_rich(q.passage)}</div>`:""}
    ${EXP_img(q.image,"Question figure","p-img")}
    ${q.prompt?`<div class="p-prompt">${EXP_rich(q.prompt)}</div>`:""}
    ${choices}</article>`;
}

function EXP_printHTML(d){
  const site=(typeof SITE!=="undefined"&&SITE.name)||"F&F SAT";
  const date=new Date(d.generatedAt||Date.now()).toISOString().slice(0,10);
  const title=`${site} - ${d.title}${d.solutions?" (with answers)":""} - ${date}`;
  const groups=d.groups.map(g=>`<section class="p-group ${g.breakBefore?"p-break":""}">
      <header class="p-ghead"><h2>${esc(g.heading)}</h2>${g.subheading&&g.subheading!==g.heading?`<div class="p-sub">${esc(g.subheading)}</div>`:""}
        ${g.meta?.length?`<div class="p-gmeta">${g.meta.map(esc).join(" · ")}</div>`:""}</header>
      ${g.questions.map(EXP_questionHTML).join("")}</section>`).join("");
  let key="";
  if(d.solutions){
    const multi=d.groups.length>1;
    key=`<section class="p-group p-break p-key"><header class="p-ghead"><h2>Answer key</h2></header>
      ${d.groups.map(g=>`${multi?`<h3>${esc(g.heading)}</h3>`:""}<table class="p-keytab"><thead><tr><th>#</th><th>Answer</th><th>Also accepted</th><th>Id</th></tr></thead><tbody>
        ${g.questions.map(q=>`<tr><td>${q.n}</td><td><b>${EXP_rich(q.answer)}</b></td><td>${(q.acceptableAnswers||[]).map(a=>EXP_rich(a)).join(", ")||"—"}</td><td class="p-id">${esc(q.id)}</td></tr>`).join("")}</tbody></table>`).join("")}</section>
      <section class="p-group p-break p-expl"><header class="p-ghead"><h2>Explanations</h2></header>
      ${d.groups.map(g=>`${multi?`<h3>${esc(g.heading)}</h3>`:""}${g.questions.map(q=>`<div class="p-ex"><div class="p-exhead"><b>${q.n}.</b> Answer: <b>${EXP_rich(q.answer)}</b>${q.acceptableAnswers?.length?` (also ${q.acceptableAnswers.map(a=>EXP_rich(a)).join(", ")})`:""}</div>
        <div class="p-extext">${q.explanation?EXP_rich(q.explanation):"<i>No explanation added.</i>"}</div></div>`).join("")}`).join("")}</section>`;
  }
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"/><base href="${esc(location.origin)}/"/>
<title>${esc(title)}</title>
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@${KATEX_VERSION}/dist/katex.min.css" crossorigin="anonymous"/>
<style>${EXP_PRINT_CSS}</style></head><body>
<div class="p-bar"><span>${esc(title)}</span><button onclick="window.print()">Print / Save as PDF</button></div>
<header class="p-doc"><div class="p-brand">${esc(site)}</div><h1>${esc(d.title)}</h1>
  <div class="p-docmeta">${esc(d.scopeLabel)} · ${Number(d.questionCount||0).toLocaleString()} question${d.questionCount===1?"":"s"} · ${d.solutions?"answer key and explanations at the end":"questions only, no answer key"} · ${esc(date)}</div>
  ${d.intro?.length?`<ul class="p-intro">${d.intro.map(t=>`<li>${esc(t)}</li>`).join("")}</ul>`:""}</header>
${groups}${key}</body></html>`;
}

const EXP_PRINT_CSS=`
@page{size:auto;margin:16mm 15mm 18mm}
*{box-sizing:border-box}
html{-webkit-print-color-adjust:exact;print-color-adjust:exact}
body{margin:0;font:11pt/1.5 Georgia,"Times New Roman",serif;color:#111;background:#fff}
.p-bar{position:sticky;top:0;display:flex;justify-content:space-between;align-items:center;gap:1rem;padding:.6rem 1rem;background:#141319;color:#eee;font:13px system-ui,sans-serif;z-index:2}
.p-bar button{font:600 13px system-ui,sans-serif;padding:.45rem 1rem;border-radius:99px;border:0;background:#FF6A3D;color:#1A0E07;cursor:pointer}
.p-doc,.p-group{max-width:760px;margin:0 auto;padding:0 1rem}
.p-doc{padding-top:1.5rem;padding-bottom:.5rem;border-bottom:2px solid #111;margin-bottom:1rem}
.p-brand{font:600 9pt system-ui,sans-serif;letter-spacing:.08em;text-transform:uppercase;color:#555}
h1{font:700 20pt/1.2 system-ui,sans-serif;margin:.2rem 0 .3rem}
h2{font:700 14pt/1.25 system-ui,sans-serif;margin:0}
h3{font:700 11pt system-ui,sans-serif;margin:1rem 0 .4rem}
.p-docmeta,.p-gmeta,.p-sub{font:9.5pt system-ui,sans-serif;color:#444}
.p-intro{font:9.5pt/1.45 system-ui,sans-serif;color:#333;margin:.6rem 0 0;padding-left:1.1rem}
.p-ghead{padding:.4rem 0 .5rem;border-bottom:1px solid #999;margin:1rem 0 .6rem;break-after:avoid}
.p-break{break-before:page;page-break-before:always}
.p-q{break-inside:avoid;page-break-inside:avoid;padding:.55rem 0 .75rem;border-bottom:1px solid #ddd}
.p-qhead{display:flex;gap:.6rem;align-items:baseline;margin-bottom:.35rem}
.p-n{font:700 11pt system-ui,sans-serif;min-width:1.8rem;height:1.6rem;display:inline-grid;place-items:center;border:1.5px solid #111;border-radius:4px;padding:0 .3rem}
.p-meta{font:8.5pt system-ui,sans-serif;color:#555}
.p-id{font:8pt ui-monospace,monospace;color:#777;margin-left:.5rem}
.p-passage{border-left:3px solid #bbb;padding:.1rem 0 .1rem .75rem;margin:.3rem 0 .55rem}
.p-passage p,.p-prompt p,.p-ctext p,.p-extext p{margin:.25rem 0}
.p-prompt{margin:.4rem 0}
.p-choices{list-style:none;margin:.35rem 0 0;padding:0}
.p-choices li{display:flex;gap:.55rem;align-items:flex-start;margin:.22rem 0;break-inside:avoid}
.p-letter{font:700 9.5pt system-ui,sans-serif;flex:none;width:1.45rem;height:1.45rem;border:1.2px solid #333;border-radius:50%;display:grid;place-items:center}
.p-ctext{flex:1;min-width:0}
.p-spr{margin-top:.5rem;font:10pt system-ui,sans-serif}
.p-line{display:inline-block;width:9rem;border-bottom:1px solid #111;height:1.1rem;vertical-align:bottom}
img{max-width:100%;height:auto}
.p-img,.p-passage img,.p-prompt img{display:block;max-height:9cm;margin:.4rem 0}
.p-cimg,.p-ctext img{display:block;max-height:4.5cm;margin:.2rem 0}
table{border-collapse:collapse;margin:.45rem 0;font-size:10pt}
th,td{border:1px solid #888;padding:.22rem .45rem;text-align:left;vertical-align:top}
th{background:#f0f0f0}
.p-keytab{width:100%}
.p-keytab tr{break-inside:avoid}
.p-ex{break-inside:avoid;padding:.4rem 0;border-bottom:1px solid #e3e3e3}
.p-exhead{font:10pt system-ui,sans-serif;margin-bottom:.15rem}
.katex{font-size:1.05em}
.mathseg-block{display:block;text-align:center;margin:.3rem 0}
[data-ink="light"]{color:#111!important}
[data-bg="white"]{background:transparent!important}
@media print{.p-bar{display:none}.p-doc,.p-group{max-width:none;padding:0}}
`;

// Wait until every image has loaded (or failed) and the KaTeX fonts are in.
function EXP_whenReady(win){
  const d=win.document;
  const imgs=[...d.images].map(img=>img.complete?null:new Promise(r=>{ img.addEventListener("load",r,{once:true}); img.addEventListener("error",r,{once:true}); }));
  const css=[...d.querySelectorAll('link[rel="stylesheet"]')].map(l=>l.sheet?null:new Promise(r=>{ l.addEventListener("load",r,{once:true}); l.addEventListener("error",r,{once:true}); }));
  // Fonts start loading once the stylesheet applies; give layout a moment, then wait for them.
  const all=Promise.all([...imgs,...css]).then(()=>new Promise(r=>setTimeout(r,250))).then(()=>d.fonts?.ready).catch(()=>{});
  return Promise.race([all,new Promise(r=>setTimeout(r,30000))]);
}

async function EXP_print(st,win){
  const [data]=await Promise.all([api("export?"+EXP_query(st,{format:"print"})),loadKatex().catch(()=>false)]);
  const html=EXP_printHTML(data);
  if(win&&!win.closed){
    win.document.open(); win.document.write(html); win.document.close();
    await EXP_whenReady(win);
    win.focus(); win.print();
    return;
  }
  // Pop-up blocked: print from a hidden frame. The page title names the saved file.
  const frame=document.createElement("iframe");
  frame.className="exp-frame"; frame.setAttribute("aria-hidden","true");
  document.body.appendChild(frame);
  const fw=frame.contentWindow;
  fw.document.open(); fw.document.write(html); fw.document.close();
  await EXP_whenReady(fw);
  const prev=document.title;
  document.title=fw.document.title;
  try{ fw.focus(); fw.print(); }
  finally{ setTimeout(()=>{ document.title=prev; frame.remove(); },1500); }
}
