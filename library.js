// library.js — the Reading Library (student reader + admin authoring).
// Pieces are text-only (`body`) or an ordered list of content blocks:
// paragraphs, images and charts. `libRenderContent` is the one renderer used by
// the student view and by the editor's live preview. Admins can also import
// pieces from "fnf-library" JSON (see /docs/library-import/README.md).

// ──────────────── Rendering (shared by reader + editor preview) ────────────────
const LIB={q:"",topic:"",editing:null};
const LIB_MEDIA="/api/question-media/";
const LIB_FMT=new Intl.NumberFormat(undefined,{maximumFractionDigits:2});
function libSafeUrl(u){
  const s=String(u||"").trim();
  if(s.startsWith(LIB_MEDIA)) return /^[A-Za-z0-9._-]{1,120}$/.test(s.slice(LIB_MEDIA.length))?s:"";
  try{ const x=new URL(s); return x.protocol==="https:"&&!x.username&&!x.password?x.href:""; }catch{ return ""; }
}
function libParas(t){ return String(t??"").split(/\n{2,}/).map(p=>`<p>${esc(p).replace(/\n/g,"<br>")}</p>`).join(""); }
function libNice(min,max,count){
  if(min===max){ if(max===0) max=1; else if(max>0) min=0; else max=0; }
  const raw=(max-min)/count, mag=10**Math.floor(Math.log10(raw)), f=raw/mag;
  const step=(f<=1?1:f<=2?2:f<=2.5?2.5:f<=5?5:10)*mag;
  const lo=Math.floor(min/step+1e-9)*step, hi=Math.ceil(max/step-1e-9)*step, ticks=[];
  for(let v=lo; v<=hi+step/2; v+=step) ticks.push(+v.toFixed(10));
  return {lo,hi,ticks};
}
// Accessible inline SVG chart (bar | line) + a visually hidden data table.
function libChart(c,alt){
  c=c||{};
  const labels=(Array.isArray(c.labels)?c.labels:[]).map(l=>String(l??"")).slice(0,60);
  const series=(Array.isArray(c.series)?c.series:[]).slice(0,6).map((s,si)=>({name:String(s?.name??""),values:labels.map((_,i)=>{ const v=s?.values?.[i]; return typeof v==="number"&&isFinite(v)?v:null; })}));
  const all=series.flatMap(s=>s.values).filter(v=>v!==null);
  if(!labels.length||!all.length) return `<div class="lib-chart-empty">Add labels and values to draw the chart.</div>`;
  const line=c.kind==="line", multi=series.length>1;
  const W=560,H=320,L=c.yLabel?66:50,R=14,T=c.title?36:14,B=c.xLabel?64:44,pw=W-L-R,ph=H-T-B;
  let mn=Math.min(...all), mx=Math.max(...all);
  if(!line||mn>=0&&mn<=mx*0.5){ mn=Math.min(0,mn); mx=Math.max(0,mx); }
  const sc=libNice(mn,mx,5), y=v=>T+ph-(v-sc.lo)/(sc.hi-sc.lo||1)*ph, n=labels.length, band=pw/n;
  const fmt=v=>LIB_FMT.format(v), tip=(i,s,v)=>`${labels[i]}${multi?` — ${s.name}`:""}: ${v===null?"no data":fmt(v)}`;
  const grid=sc.ticks.map(t=>`<line class="lib-grid-l" x1="${L}" x2="${W-R}" y1="${y(t).toFixed(1)}" y2="${y(t).toFixed(1)}"/><text class="lib-tick" x="${L-6}" y="${(y(t)+4).toFixed(1)}" text-anchor="end">${esc(fmt(t))}</text>`).join("");
  const every=Math.max(1,Math.ceil(n/Math.max(1,Math.floor(pw/46))));
  const xl=labels.map((l,i)=>i%every?"":`<text class="lib-tick" x="${(L+band*(i+.5)).toFixed(1)}" y="${T+ph+18}" text-anchor="middle">${esc(l.length>11?l.slice(0,10)+"…":l)}</text>`).join("");
  let marks="";
  if(!line){
    const k=series.length, gap=2, inner=band*.72, bw=Math.max(2,(inner-gap*(k-1))/k), r=Math.min(4,bw/2), base=y(Math.max(sc.lo,Math.min(0,sc.hi)));
    series.forEach((s,si)=>s.values.forEach((v,i)=>{ if(v===null) return;
      const x=L+band*i+(band-inner)/2+si*(bw+gap), top=y(v), up=top<base, h=Math.abs(base-top), rr=Math.min(r,h);
      const d=up?`M${x},${base}V${top+rr}Q${x},${top} ${x+rr},${top}H${x+bw-rr}Q${x+bw},${top} ${x+bw},${top+rr}V${base}Z`
                :`M${x},${base}V${top-rr}Q${x},${top} ${x+rr},${top}H${x+bw-rr}Q${x+bw},${top} ${x+bw},${top-rr}V${base}Z`;
      marks+=`<path d="${d.replace(/-?\d+\.\d+/g,m=>(+m).toFixed(1))}" style="fill:var(--lib-c${si})"><title>${esc(tip(i,s,v))}</title></path>`; }));
    marks+=`<line class="lib-axis" x1="${L}" x2="${W-R}" y1="${base}" y2="${base}"/>`;
  }else{
    series.forEach((s,si)=>{
      let d="", pen=false;
      s.values.forEach((v,i)=>{ if(v===null){ pen=false; return; } d+=`${pen?"L":"M"}${(L+band*(i+.5)).toFixed(1)},${y(v).toFixed(1)}`; pen=true; });
      marks+=`<path d="${d}" class="lib-line" style="stroke:var(--lib-c${si})"/>`;
      s.values.forEach((v,i)=>{ if(v!==null) marks+=`<circle class="lib-mk" cx="${(L+band*(i+.5)).toFixed(1)}" cy="${y(v).toFixed(1)}" r="4" style="fill:var(--lib-c${si})"><title>${esc(tip(i,s,v))}</title></circle>`; });
    });
    marks+=`<line class="lib-axis" x1="${L}" x2="${W-R}" y1="${T+ph}" y2="${T+ph}"/>`;
  }
  const kindName=line?"Line chart":"Bar chart";
  const label=String(alt||"").trim()||`${kindName}${c.title?`: ${c.title}`:""}. The data table follows.`;
  const svgEl=`<svg class="lib-svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(label)}" preserveAspectRatio="xMidYMid meet">
    ${c.title?`<text class="lib-ctitle" x="${L}" y="22">${esc(c.title)}</text>`:""}${grid}${marks}${xl}
    ${c.xLabel?`<text class="lib-alabel" x="${L+pw/2}" y="${H-12}" text-anchor="middle">${esc(c.xLabel)}</text>`:""}
    ${c.yLabel?`<text class="lib-alabel" transform="translate(16 ${T+ph/2}) rotate(-90)" text-anchor="middle">${esc(c.yLabel)}</text>`:""}</svg>`;
  const legend=multi?`<ul class="lib-legend" aria-hidden="true">${series.map((s,si)=>`<li><span class="lib-sw${line?" ln":""}" style="background:var(--lib-c${si})"></span>${esc(s.name)}</li>`).join("")}</ul>`:"";
  const table=`<table class="sr-only"><caption>${esc(c.title||kindName)} — data</caption><thead><tr><th scope="col">${esc(c.xLabel||"Category")}</th>${series.map(s=>`<th scope="col">${esc(multi?s.name:(c.yLabel||s.name||"Value"))}</th>`).join("")}</tr></thead>
    <tbody>${labels.map((l,i)=>`<tr><th scope="row">${esc(l)}</th>${series.map(s=>`<td>${s.values[i]===null?"no data":esc(fmt(s.values[i]))}</td>`).join("")}</tr>`).join("")}</tbody></table>`;
  return svgEl+legend+table;
}
function libFigcap(b){
  const cap=b.caption?esc(b.caption):"", src=b.source?`<span class="lib-src">Source: ${esc(b.source)}</span>`:"";
  return cap||src?`<figcaption>${cap}${cap&&src?" ":""}${src}</figcaption>`:"";
}
function libRenderBlock(b){
  if(!b||typeof b!=="object") return "";
  if(b.type==="paragraph") return libParas(b.text);
  if(b.type==="image"||(b.type==="chart"&&!b.chart)){
    const u=libSafeUrl(b.url);
    return `<figure class="lib-fig${b.type==="chart"?" lib-fig-chart":""}">${u?`<img src="${esc(u)}" alt="${esc(b.alt||"")}" loading="lazy" decoding="async"/>`:`<div class="lib-fig-missing">No image uploaded yet</div>`}${libFigcap(b)}</figure>`;
  }
  if(b.type==="chart") return `<figure class="lib-fig lib-fig-chart">${libChart(b.chart,b.alt)}${libFigcap(b)}</figure>`;
  return "";
}
// Text-only pieces (no blocks) render exactly as before: `body` paragraphs.
function libRenderContent(a){
  return Array.isArray(a.blocks)&&a.blocks.length?a.blocks.map(libRenderBlock).join(""):libParas(a.body);
}

// ──────────────── Library list + reader ────────────────
async function viewLibrary(){
  if(state.articleId) return viewArticle(Number(state.articleId));
  crumbs([{label:"Reading Library"}]);
  if(state.user.role==="student"){ await loadAccess(); if(ACC.data&&!ACC.data.library){ $c().innerHTML=lockedHTML("The Reading Library"); return; } }
  if(!document.getElementById("libList")) loading();
  let d; try{ d=await api(`library?q=${encodeURIComponent(LIB.q)}&topic=${encodeURIComponent(LIB.topic)}`); }catch(e){ $c().innerHTML=e.data?.locked?lockedHTML("The Reading Library"):`<div class="empty"><p>${esc(e.message)}</p></div>`; return; }
  if(state.view!=="library"||state.articleId) return;
  const cards=d.articles.map(a=>`<li><button type="button" class="lib-card" onclick="go('library',{articleId:${a.id}})">
    <span class="lib-topic">${esc(a.topic||"Reading")}</span><span class="lib-title">${esc(a.title)}</span><span class="lib-prev">${esc(a.excerpt)}</span>
    <span class="umeta">${a.readingMinutes} min read${a.hasMedia?" · images and charts":""}${a.hasQuestion?" · comprehension question":""}${d.canEdit||state.user.role==="mentor"?` · ${a.status==="published"?"Published":"Draft"}`:""}</span></button></li>`).join("");
  const list=`<ul class="lib-grid" id="libList">${cards}</ul>${d.articles.length?"":`<div class="empty"><p>${LIB.q||LIB.topic?"Nothing matches your search.":"No pieces yet."}</p></div>`}`;
  if(document.getElementById("libList")&&document.getElementById("libWrap")){ document.getElementById("libWrap").innerHTML=list; return; }
  $c().innerHTML=`<div class="page-head fade"><h1>Reading Library</h1><p>Short original articles and excerpts to build reading stamina. Each piece shows its topic and an estimated reading time.</p>
      ${d.canEdit?`<div class="lib-admin-bar"><button class="btn btn-primary" onclick="FX_libEdit(null)">${svg("edit","ic-sm")} New piece</button>
        <button class="btn btn-ghost" onclick="FX_libImport()">${svg("upload","ic-sm")} Import JSON</button>
        <a class="btn btn-ghost" href="/docs/library-import/library-sample.json" download="library-sample.json">Download sample JSON</a>
        <button class="btn btn-ghost" onclick="FX_libPrompt()">Generate compatible JSON</button></div>`:""}</div>
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
  LIB.attemptKey=`lib-${a.id}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2,10)}`;
  $c().innerHTML=`<article class="reader fade"><p class="lib-topic">${esc(a.topic||"Reading")} · ${a.readingMinutes} min read</p><h1>${esc(a.title)}</h1>
    ${a.canEdit?`<div class="reader-admin"><span class="pill ${a.status==="published"?"pill-sec":"pill-muted"}">${a.status==="published"?"Published":"Draft"}</span>
      ${a.externalId?`<span class="umeta">Import id: <code>${esc(a.externalId)}</code></span>`:""}
      <button class="btn btn-ghost btn-xs" onclick="FX_libEdit(${a.id})">${svg("edit","ic-sm")} Edit</button>
      <button class="btn btn-ghost btn-xs" onclick="FX_libStatus(${a.id},'${a.status==="published"?"draft":"published"}')">${a.status==="published"?"Unpublish":"Publish"}</button></div>`:""}
    <div class="reader-body" id="readerBody">${libRenderContent(a)}</div>
    ${q?`<section class="reader-q" aria-labelledby="rqH"><h2 id="rqH">Check your understanding</h2><p class="q-prompt">${esc(q.prompt)}</p>
      <div class="choices" id="rqChoices" role="radiogroup">${Object.entries(q.choices).map(([k,v])=>`<button type="button" class="choice" role="radio" aria-checked="false" data-l="${k}" onclick="FX_libAnswer(${a.id},'${k}')"><span class="ltr">${k}</span><span class="ct">${esc(v)}</span></button>`).join("")}</div>
      ${typeof CR_costHTML==="function"?CR_costHTML():""}<div id="rqResult" aria-live="polite"></div></section>`:""}
    <div id="libEditor"></div>
    <button class="btn btn-ghost" style="margin-top:1.2rem" onclick="go('library',{articleId:null})">${svg("back","ic-sm")} Library</button></article>`;
}
async function FX_libAnswer(id,letter){
  document.querySelectorAll("#rqChoices .choice").forEach(c=>c.disabled=true);
  let r; try{ r=await api(`library/${id}/answer`,{method:"POST",body:JSON.stringify({selected:letter,attemptKey:LIB.attemptKey})}); }catch(e){
    if(e.data?.outOfCredits&&typeof CR_outOfCredits==="function") CR_outOfCredits(e.data); else toast(e.message);
    document.querySelectorAll("#rqChoices .choice").forEach(c=>c.disabled=false); return; }
  if(typeof CR_receipt==="function") CR_receipt(r.credit);
  document.querySelectorAll("#rqChoices .choice").forEach(c=>{ if(c.dataset.l===r.answer) c.classList.add("right"); else if(c.dataset.l===letter) c.classList.add("wrong"); c.setAttribute("aria-checked",String(c.dataset.l===letter)); });
  document.getElementById("rqResult").innerHTML=`<div class="explain ${r.correct?"":"bad"}"><h4>${r.correct?"Correct":"Correct answer: "+esc(r.answer)}</h4><p>${esc(r.explanation)}</p>${r.support?`<p class="umeta">Supporting sentence:</p><blockquote class="reader-support">${esc(r.support)}</blockquote>`:""}</div>`;
  // Point at the supporting sentence in the text.
  if(r.support){ const body=document.getElementById("readerBody"); const ps=[...body.querySelectorAll(":scope > p")]; const hit=ps.find(p=>p.textContent.includes(r.support.slice(0,40))); if(hit){ hit.classList.add("reader-hit"); } }
}
async function FX_libStatus(id,status){ try{ await api(`library/${id}/status`,{method:"POST",body:JSON.stringify({status})}); toast(status==="published"?"Published":"Unpublished"); viewArticle(id); }catch(e){ toast(e.message); } }
async function FX_libDelete(id){ if(!confirm("Delete this piece permanently?")) return; try{ await api(`library/${id}`,{method:"DELETE"}); ftCloseModal(); go("library",{articleId:null}); }catch(e){ toast(e.message); } }

// ──────────────── Editor (New piece / Edit piece) ────────────────
// LE.blocks is the editor model. Chart labels/values are kept as the raw text
// typed (_labels / _values) and parsed for preview and save.
let LE=null;
const LE_TYPES={paragraph:"Paragraph",image:"Image",chart:"Chart"};
function leNewBlock(type){
  if(type==="image") return {type,url:"",alt:"",caption:"",source:"",fileName:""};
  if(type==="chart") return {type,mode:"data",url:"",alt:"",caption:"",source:"",fileName:"",chart:{kind:"bar",title:"",xLabel:"",yLabel:"",_labels:"",series:[{name:"",_values:""}]}};
  return {type:"paragraph",text:""};
}
function leFromStored(b){
  if(b.type==="chart"&&b.chart) return {...leNewBlock("chart"),...b,mode:"data",chart:{kind:b.chart.kind||"bar",title:b.chart.title||"",xLabel:b.chart.xLabel||"",yLabel:b.chart.yLabel||"",
    _labels:(b.chart.labels||[]).join(", "),series:(b.chart.series||[]).map(s=>({name:s.name||"",_values:(s.values||[]).map(v=>v===null?"":v).join(", ")}))}};
  if(b.type==="chart") return {...leNewBlock("chart"),...b,mode:"image",chart:leNewBlock("chart").chart};
  if(b.type==="image") return {...leNewBlock("image"),...b};
  return {type:"paragraph",text:String(b.text||"")};
}
const leSplit=s=>String(s||"").split(",").map(x=>x.trim());
function leChartOut(c){
  const labels=leSplit(c._labels).filter((x,i,a)=>x||i<a.length-1);
  return {kind:c.kind,title:c.title,xLabel:c.xLabel,yLabel:c.yLabel,labels,
    series:c.series.map(s=>{ const vals=leSplit(s._values); while(vals.length>labels.length&&vals[vals.length-1]==="") vals.pop();
      return {name:s.name,values:vals.map(v=>v===""?null:(isFinite(Number(v))?Number(v):v))}; })};
}
function leBlocksOut(){
  return LE.blocks.map(b=>{
    if(b.type==="paragraph") return {type:"paragraph",text:b.text};
    const meta={alt:b.alt,caption:b.caption,source:b.source};
    if(b.type==="chart"&&b.mode==="data") return {type:"chart",chart:leChartOut(b.chart),...meta};
    return {type:b.type,url:b.url,...meta,...(b.fileName?{fileName:b.fileName}:{})};
  });
}
function leField(i,f,label,val,opts={}){
  const idf=`le${i}_${f}`;
  const input=opts.area?`<textarea id="${idf}" data-f="${f}" rows="${opts.rows||4}" oninput="leSet(${i},'${f}',this.value)">${esc(val)}</textarea>`
    :`<input id="${idf}" data-f="${f}" value="${esc(val)}" ${opts.ph?`placeholder="${esc(opts.ph)}"`:""} oninput="leSet(${i},'${f}',this.value)"/>`;
  return `<div class="field"><label for="${idf}">${label}</label>${input}${opts.hint?`<p class="umeta">${opts.hint}</p>`:""}</div>`;
}
function leMediaFields(i,b){
  const u=libSafeUrl(b.url);
  return `<div class="le-media">${u?`<img src="${esc(u)}" alt="" class="le-thumb"/>`:""}
    <div class="field"><label for="le${i}_file">${u?"Replace image":"Upload image"} (PNG, JPEG, GIF, WebP or SVG, up to 3 MB)</label><input type="file" id="le${i}_file" accept="image/png,image/jpeg,image/gif,image/webp,image/svg+xml" onchange="leUpload(${i},this)"/>
    ${b.fileName?`<p class="umeta">File: ${esc(b.fileName)}</p>`:""}</div></div>
    ${leField(i,"url","Or image URL (https)",b.url,{ph:"https://…"})}
    ${leField(i,"alt",`Alt text <span class="le-req">(required)</span>`,b.alt,{hint:b.type==="chart"?"Describe what the chart shows, including the main trend.":"Describe the image for readers who can't see it."})}`;
}
function leBlockHTML(b,i){
  const n=LE.blocks.length;
  let body="";
  if(b.type==="paragraph") body=leField(i,"text","Paragraph text",b.text,{area:true,rows:5});
  else if(b.type==="image") body=leMediaFields(i,b);
  else{
    const c=b.chart;
    body=`<fieldset class="le-mode"><legend class="sr-only">Chart source</legend>
      <label><input type="radio" name="le${i}_mode" ${b.mode==="data"?"checked":""} onchange="leSetMode(${i},'data')"/> Chart from data</label>
      <label><input type="radio" name="le${i}_mode" ${b.mode==="image"?"checked":""} onchange="leSetMode(${i},'image')"/> Chart image</label></fieldset>
      ${b.mode==="image"?leMediaFields(i,b):`
      <div class="f-row"><div class="field"><label for="le${i}_kind">Type</label><select id="le${i}_kind" onchange="leChart(${i},'kind',this.value)"><option value="bar" ${c.kind!=="line"?"selected":""}>Bar</option><option value="line" ${c.kind==="line"?"selected":""}>Line</option></select></div>
        <div class="field"><label for="le${i}_title">Chart title</label><input id="le${i}_title" value="${esc(c.title)}" oninput="leChart(${i},'title',this.value)"/></div></div>
      <div class="f-row"><div class="field"><label for="le${i}_xl">X-axis label</label><input id="le${i}_xl" value="${esc(c.xLabel)}" oninput="leChart(${i},'xLabel',this.value)"/></div>
        <div class="field"><label for="le${i}_yl">Y-axis label</label><input id="le${i}_yl" value="${esc(c.yLabel)}" oninput="leChart(${i},'yLabel',this.value)"/></div></div>
      <div class="field"><label for="le${i}_labels">Labels (separate with commas)</label><input id="le${i}_labels" data-f="labels" value="${esc(c._labels)}" placeholder="Jan, Feb, Mar" oninput="leChart(${i},'_labels',this.value)"/></div>
      ${c.series.map((s,si)=>`<div class="le-series"><div class="field"><label for="le${i}_s${si}n">Series ${si+1} name</label><input id="le${i}_s${si}n" value="${esc(s.name)}" oninput="leSeries(${i},${si},'name',this.value)"/></div>
        <div class="field"><label for="le${i}_s${si}v">Values (one per label, commas; leave blank for no data)</label><input id="le${i}_s${si}v" data-f="series${si}" value="${esc(s._values)}" placeholder="12, 18.5, 9" inputmode="decimal" oninput="leSeries(${i},${si},'_values',this.value)"/></div>
        ${c.series.length>1?`<button type="button" class="btn btn-ghost btn-xs" onclick="leSeriesDel(${i},${si})" aria-label="Remove series ${si+1}">${svg("x","ic-sm")}</button>`:""}</div>`).join("")}
      ${c.series.length<6?`<button type="button" class="btn btn-ghost btn-xs" onclick="leSeriesAdd(${i})">${svg("plus","ic-sm")} Add series</button>`:""}
      ${leField(i,"alt","Alt text (optional — a summary of what the chart shows)",b.alt)}`}`;
  }
  if(b.type!=="paragraph") body+=`<div class="f-row">${leField(i,"caption","Caption",b.caption)}${leField(i,"source","Source (optional)",b.source,{ph:"e.g. NOAA, 2023"})}</div>`;
  return `<li class="le-blk" data-i="${i}" aria-labelledby="le${i}_h">
    <div class="le-blk-head"><h4 id="le${i}_h" tabindex="-1">Block ${i+1} · ${LE_TYPES[b.type]}</h4>
      <div class="le-blk-tools">
        <button type="button" class="btn btn-ghost btn-xs le-up" onclick="leMove(${i},-1)" ${i===0?"disabled":""} aria-label="Move block ${i+1} up">↑ Up</button>
        <button type="button" class="btn btn-ghost btn-xs le-down" onclick="leMove(${i},1)" ${i===n-1?"disabled":""} aria-label="Move block ${i+1} down">↓ Down</button>
        <select class="le-ins" aria-label="Insert a block below block ${i+1}" onchange="if(this.value)leInsert(${i+1},this.value)"><option value="">Insert below…</option><option value="paragraph">Paragraph</option><option value="image">Image</option><option value="chart">Chart</option></select>
        <button type="button" class="btn btn-ghost btn-xs" onclick="leRemove(${i})" aria-label="Remove block ${i+1}">${svg("trash","ic-sm")} Remove</button></div></div>
    ${body}</li>`;
}
function leRender(focusSel){
  const el=document.getElementById("leBlocks"); if(!el) return;
  el.innerHTML=LE.blocks.map(leBlockHTML).join("")||`<li class="umeta le-empty">No content yet — add a paragraph, image or chart.</li>`;
  if(focusSel) (document.querySelector(focusSel)||document.getElementById("leAddRow"))?.focus();
  lePreviewNow();
}
function leSet(i,f,v){ LE.blocks[i][f]=v; lePreview(); }
function leChart(i,f,v){ LE.blocks[i].chart[f]=v; lePreview(); }
function leSeries(i,si,f,v){ LE.blocks[i].chart.series[si][f]=v; lePreview(); }
function leSeriesAdd(i){ LE.blocks[i].chart.series.push({name:"",_values:""}); leRender(`#le${i}_s${LE.blocks[i].chart.series.length-1}n`); }
function leSeriesDel(i,si){ LE.blocks[i].chart.series.splice(si,1); leRender(`#le${i}_s0n`); }
function leSetMode(i,m){ LE.blocks[i].mode=m; leRender(`[name="le${i}_mode"]:checked`); }
function leMove(i,d){
  const j=i+d; if(j<0||j>=LE.blocks.length) return;
  [LE.blocks[i],LE.blocks[j]]=[LE.blocks[j],LE.blocks[i]];
  // Keep focus on the same control so repeated Up/Down presses keep moving the block.
  const sel=`[data-i="${j}"] .le-${d<0?"up":"down"}`;
  leRender(sel);
  if(!document.activeElement?.matches?.(sel)) document.getElementById(`le${j}_h`)?.focus();
  document.getElementById("leLive").textContent=`Block moved to position ${j+1} of ${LE.blocks.length}.`;
}
function leRemove(i){
  const b=LE.blocks[i];
  const filled=b.type==="paragraph"?b.text.trim():(b.url||b.alt||b.caption||(b.chart&&b.chart._labels));
  if(filled&&!confirm(`Remove block ${i+1} (${LE_TYPES[b.type]})?`)) return;
  LE.blocks.splice(i,1);
  leRender(LE.blocks.length?`#le${Math.min(i,LE.blocks.length-1)}_h`:"#leAddRow button");
  document.getElementById("leLive").textContent=`Block ${i+1} removed.`;
}
function leInsert(i,type){ LE.blocks.splice(i,0,leNewBlock(type)); leRender(`#le${i}_h`); }
async function leUpload(i,input){
  const f=input.files?.[0]; if(!f) return;
  if(f.size>3_000_000){ toast("Images must be 3 MB or smaller."); input.value=""; return; }
  input.disabled=true;
  try{
    const r=await api("library/media",{method:"POST",headers:{"content-type":f.type||"application/octet-stream"},body:f});
    Object.assign(LE.blocks[i],{url:r.url,fileName:f.name}); leRender(`#le${i}_alt`); toast("Image uploaded");
  }catch(e){ toast(e.message); input.disabled=false; }
}
function lePreview(){ clearTimeout(window.__lePrev); window.__lePrev=setTimeout(lePreviewNow,180); }
function lePreviewNow(){
  const el=document.getElementById("lePreview"); if(!el||!LE) return;
  const v=k=>document.getElementById(k)?.value||"";
  el.innerHTML=`<article class="reader lib-prev-article"><p class="lib-topic">${esc(v("leTopic")||"Reading")}</p><h1>${esc(v("leTitle")||"Untitled")}</h1>
    <div class="reader-body">${libRenderContent({blocks:leBlocksOut(),body:""})}</div></article>`;
}
async function FX_libEdit(id){
  let a={title:"",topic:"",excerpt:"",body:"",blocks:null,status:"draft",question:null};
  if(id){ try{ a=await api(`library/${id}`); }catch(e){ toast(e.message); return; } }
  const q=a.question||{prompt:"",choices:{},answer:"",explanation:"",support:""};
  const stored=Array.isArray(a.blocks)&&a.blocks.length?a.blocks:String(a.body||"").split(/\n{2,}/).map(t=>t.trim()).filter(Boolean).map(text=>({type:"paragraph",text}));
  LE={id:id||null,blocks:stored.map(leFromStored)};
  if(!LE.blocks.length) LE.blocks.push(leNewBlock("paragraph"));
  ftModal(id?"Edit piece":"New piece",`<div class="le-grid"><div class="le-form">
    <div class="field"><label for="leTitle">Title</label><input id="leTitle" value="${esc(a.title)}" oninput="lePreview()"/></div>
    <div class="f-row"><div class="field"><label for="leTopic">Topic</label><input id="leTopic" value="${esc(a.topic)}" placeholder="e.g. Science" oninput="lePreview()"/></div><div class="field"><label for="leStatus">Status</label><select id="leStatus"><option value="draft" ${a.status!=="published"?"selected":""}>Draft</option><option value="published" ${a.status==="published"?"selected":""}>Published</option></select></div></div>
    <div class="field"><label for="leExcerpt">Preview (optional — first lines are used otherwise)</label><input id="leExcerpt" value="${esc(a.excerpt||"")}"/></div>
    <h4 class="le-sec">Content</h4><p class="umeta">Paragraphs, images and charts, in reading order. Use Up/Down to reorder.</p>
    <ol class="le-blocks" id="leBlocks"></ol>
    <div class="le-add" id="leAddRow"><span class="umeta">Add at end:</span>
      <button type="button" class="btn btn-ghost btn-xs" onclick="leInsert(LE.blocks.length,'paragraph')">${svg("plus","ic-sm")} Paragraph</button>
      <button type="button" class="btn btn-ghost btn-xs" onclick="leInsert(LE.blocks.length,'image')">${svg("image","ic-sm")} Image</button>
      <button type="button" class="btn btn-ghost btn-xs" onclick="leInsert(LE.blocks.length,'chart')">${svg("graph","ic-sm")} Chart</button></div>
    <p class="sr-only" id="leLive" aria-live="polite"></p>
    <details ${a.question?"open":""}><summary><b>Comprehension question (optional)</b></summary>
      <div class="field"><label for="leQ">Question</label><input id="leQ" value="${esc(q.prompt)}"/></div>
      ${["A","B","C","D"].map(k=>`<div class="field"><label for="leC${k}">Choice ${k}</label><input id="leC${k}" value="${esc(q.choices?.[k]||"")}"/></div>`).join("")}
      <div class="f-row"><div class="field"><label for="leAns">Correct letter</label><input id="leAns" maxlength="1" value="${esc(q.answer||"")}"/></div></div>
      <div class="field"><label for="leExp">Explanation</label><textarea id="leExp" rows="3">${esc(q.explanation||"")}</textarea></div>
      <div class="field"><label for="leSup">Supporting sentence or passage (quoted from the text)</label><textarea id="leSup" rows="2">${esc(q.support||"")}</textarea></div></details>
    </div>
    <aside class="le-preview-wrap" aria-label="Live preview"><div class="le-preview-head"><h4>Preview</h4>
      <label class="umeta"><input type="checkbox" onchange="document.getElementById('lePreview').classList.toggle('narrow',this.checked)"/> Phone width</label></div>
      <div id="lePreview" class="le-preview"></div></aside></div>`,
    {wide:true,foot:`${id?`<button class="btn btn-danger" onclick="FX_libDelete(${id})">Delete</button>`:""}<button class="btn btn-primary" onclick="FX_libSave(${id||"null"})">${svg("save","ic-sm")} Save</button>`});
  document.getElementById("ftModal")?.querySelector(".ft-modal")?.classList.add("le-modal");
  leRender();
}
async function FX_libSave(id){
  const v=k=>document.getElementById(k).value;
  const prompt=v("leQ").trim();
  const body={title:v("leTitle"),topic:v("leTopic"),excerpt:v("leExcerpt"),blocks:leBlocksOut(),status:v("leStatus"),
    question:prompt?{prompt,choices:Object.fromEntries(["A","B","C","D"].map(k=>[k,v("leC"+k)]).filter(([,x])=>x.trim())),answer:v("leAns").trim().toUpperCase(),explanation:v("leExp"),support:v("leSup")}:null};
  document.querySelectorAll(".le-modal .le-bad").forEach(x=>x.classList.remove("le-bad"));
  try{ const r=await api(id?`library/${id}`:"library",{method:id?"PUT":"POST",body:JSON.stringify(body)}); ftCloseModal(); LE=null; toast("Saved"); go("library",{articleId:r.id}); }
  catch(e){
    toast(e.message);
    // Point at the first field the server rejected (e.g. blocks[2].alt).
    const m=/^blocks\[(\d+)\](?:\.(\w+))?(?:\.(\w+))?(?:\[(\d+)\])?/.exec(e.data?.issues?.[0]?.path||"");
    if(m){ const sel=m[2]==="alt"?`#le${m[1]}_alt`:m[2]==="text"?`#le${m[1]}_text`:m[2]==="url"||m[2]==="media"?`#le${m[1]}_file`:m[3]==="labels"?`#le${m[1]}_labels`:m[3]==="series"&&m[4]!==undefined?`#le${m[1]}_s${m[4]}v`:`#le${m[1]}_h`;
      const f=document.querySelector(sel)||document.getElementById(`le${m[1]}_h`); if(f){ f.classList.add("le-bad"); f.focus(); } }
    else if(e.data?.issues?.[0]?.path==="title") document.getElementById("leTitle").focus();
  }
}

// ──────────────── JSON import (admin) ────────────────
let LI=null;
function FX_libImport(){
  LI={data:null,files:[],preview:null};
  ftModal("Import Reading Library JSON",`<p class="umeta">One article or a batch in the <b>fnf-library</b> format. Articles are matched by their <code>id</code>: a new id creates a draft, a known id updates that piece. Published pieces are never overwritten unless you tick them below. Nothing is saved until you click Import. <a href="/docs/library-import/README.md" target="_blank" rel="noopener">Format guide</a></p>
    <div class="f-row"><div class="field"><label for="liJson">Article JSON file</label><input type="file" id="liJson" accept=".json,application/json" onchange="liChanged()"/></div>
    <div class="field"><label for="liMedia">Media files (images and chart images, matched by file name)</label><input type="file" id="liMedia" multiple accept="image/png,image/jpeg,image/gif,image/webp,image/svg+xml" onchange="liChanged()"/></div></div>
    <div id="liResult" aria-live="polite"></div>`,
    {wide:true,foot:`<button class="btn btn-ghost" id="liPrevBtn" onclick="liPreview()">Preview</button><button class="btn btn-primary" id="liGo" onclick="liCommit()" disabled>${svg("upload","ic-sm")} Import</button>`});
}
function liChanged(){ if(LI){ LI.preview=null; } const g=document.getElementById("liGo"); if(g) g.disabled=true; const r=document.getElementById("liResult"); if(r) r.innerHTML=""; }
async function liSha(file){
  const buf=await file.arrayBuffer(); const h=await crypto.subtle.digest("SHA-256",buf);
  return [...new Uint8Array(h)].map(b=>b.toString(16).padStart(2,"0")).join("");
}
const LI_ACTION={create:["New — will be created as a draft","pill-sec"],update:["Update — existing draft changes","pill-sec"],unchanged:["Unchanged","pill-muted"],blocked:["Published — not overwritten","pill-muted"],invalid:["Has problems — will be skipped","pill-muted"]};
function liIssueList(a){
  const li=[...a.errors.map(e=>`<li class="li-err"><b>Error</b> <code>${esc(e.path)}</code>: ${esc(e.message)}</li>`),
    ...a.unresolvedMedia.map(u=>`<li class="li-err"><b>Missing media</b> <code>${esc(u.path)}</code>: "${esc(u.ref)}" was not uploaded and isn't stored for this article — add the file under Media files</li>`),
    ...a.warnings.map(w=>`<li class="li-warn"><b>Warning</b> <code>${esc(w.path)}</code>: ${esc(w.message)}</li>`)];
  return li.length?`<ul class="li-issues">${li.join("")}</ul>`:"";
}
async function liPreview(){
  const jf=document.getElementById("liJson").files?.[0], out=document.getElementById("liResult");
  if(!jf){ out.innerHTML=`<p class="li-err">Choose the JSON file first.</p>`; return; }
  let data; try{ data=JSON.parse(await jf.text()); }catch(e){ out.innerHTML=`<p class="li-err">This file is not valid JSON: ${esc(e.message)}</p>`; return; }
  const media=[...(document.getElementById("liMedia").files||[])];
  const big=media.filter(f=>f.size>3_000_000);
  if(big.length){ out.innerHTML=`<p class="li-err">These media files are over 3 MB: ${big.map(f=>esc(f.name)).join(", ")}</p>`; return; }
  const btn=document.getElementById("liPrevBtn"); btn.disabled=true; out.innerHTML=`<div class="spin"></div>`;
  try{
    const files=[]; for(const f of media) files.push({name:f.name,size:f.size,type:f.type,sha256:await liSha(f)});
    const r=await api("library/import/preview",{method:"POST",body:JSON.stringify({data,files})});
    LI={data,files:media,preview:r};
    const c=r.counts;
    out.innerHTML=`${r.fileErrors.length?`<ul class="li-issues">${r.fileErrors.map(e=>`<li class="li-err"><b>File error</b> ${e.path?`<code>${esc(e.path)}</code>: `:""}${esc(e.message)}</li>`).join("")}</ul>`:""}
      <p class="li-sum"><b>${r.articles.length}</b> article${r.articles.length===1?"":"s"}: ${c.create} new · ${c.update} update${c.update===1?"":"s"} · ${c.unchanged} unchanged · ${c.blocked} published (not overwritten) · ${c.invalid} with problems${media.length?` · ${media.length} media file${media.length===1?"":"s"} selected`:""}</p>
      <ul class="li-list">${r.articles.map(a=>`<li class="panel li-art"><div class="li-art-head"><span class="pill ${LI_ACTION[a.action][1]}">${LI_ACTION[a.action][0]}</span>
        <b>${esc(a.title||"(no title)")}</b> <span class="umeta"><code>${esc(a.id||a.path)}</code> · ${a.blocks?`${a.blocks} blocks`:"text only"} · ${a.words} words${a.hasQuestion?" · question":""} · will be ${esc(a.status)}${a.existingId?` · piece #${a.existingId}`:""}</span></div>
        ${a.action==="blocked"?`<label class="umeta li-ow"><input type="checkbox" class="li-ow-box" value="${esc(a.id)}" onchange="liCount()"/> Overwrite this published piece (it stays published with the new content)</label>`:""}
        ${liIssueList(a)}</li>`).join("")}</ul>`;
    liCount();
  }catch(e){ out.innerHTML=`<p class="li-err">${esc(e.message)}</p>`; }
  btn.disabled=false;
}
function liCount(){
  const g=document.getElementById("liGo"); if(!g||!LI?.preview) return;
  const n=LI.preview.counts.create+LI.preview.counts.update+document.querySelectorAll(".li-ow-box:checked").length;
  g.disabled=!n||LI.preview.fileErrors.length>0;
  g.innerHTML=`${svg("upload","ic-sm")} Import ${n||""} article${n===1?"":"s"}`;
}
async function liCommit(){
  if(!LI?.preview) return;
  const g=document.getElementById("liGo"), out=document.getElementById("liResult"); g.disabled=true;
  const overwritePublished=[...document.querySelectorAll(".li-ow-box:checked")].map(x=>x.value);
  try{
    const media={};
    for(const [k,f] of LI.files.entries()){
      g.innerHTML=`Uploading media ${k+1}/${LI.files.length}…`;
      const r=await api("library/media",{method:"POST",headers:{"content-type":f.type||"application/octet-stream"},body:f}).catch(e=>{ throw new Error(`${f.name}: ${e.message}`); });
      media[f.name]=r.url;
    }
    g.innerHTML="Importing…";
    const r=await api("library/import/commit",{method:"POST",body:JSON.stringify({data:LI.data,media,overwritePublished})});
    out.innerHTML=`<p class="li-sum">Import finished.</p><ul class="li-issues">${r.results.map(x=>`<li class="${x.result==="failed"?"li-err":""}"><code>${esc(x.id||x.path)}</code>: ${esc(x.result)}${x.error?` — ${esc(x.error)}`:""}${x.articleId&&x.result!=="failed"?` · <a href="#" onclick="ftCloseModal();go('library',{articleId:${Number(x.articleId)}});return false">open</a>`:""}</li>`).join("")}</ul>`;
    g.innerHTML="Done"; LI.preview=null;
    const made=r.results.filter(x=>x.result==="created"||x.result==="updated").length;
    toast(`${made} article${made===1?"":"s"} imported`);
    if(state.view==="library"&&!state.articleId) viewLibrary();
  }catch(e){ out.insertAdjacentHTML("afterbegin",`<p class="li-err">${esc(e.message)}</p>`); g.disabled=false; g.innerHTML=`${svg("upload","ic-sm")} Retry import`; }
}

// ──────────────── "Generate compatible JSON" prompt ────────────────
const LIB_PROMPT=`You are writing reading passages for an SAT Reading and Writing practice library. Output ONE JSON file and nothing else (no commentary, no Markdown fences), in exactly this format:

{
  "format": "fnf-library",
  "version": "1.0",
  "articles": [ ARTICLE, ... ]
}

Each ARTICLE is an object with these fields:
- "id" (required, string): a stable, unique id, 1-80 characters, only letters, digits, ".", "-" or "_", starting with a letter or digit, e.g. "ocean-tides-01". Never reuse an id for a different article.
- "title" (required, string, max 200 characters).
- "topic" (string, max 80), e.g. "Science", "History", "Literature", "Social Science".
- "excerpt" (optional string, max 400): a one- or two-sentence teaser.
- "status" (optional): "draft" or "published". Leave it out (the platform imports as draft).
- "blocks" (required, array, in reading order, max 200). Each block is one of:
  1. Paragraph: { "type": "paragraph", "text": "plain text, no HTML or Markdown" }
  2. Image: { "type": "image", "media": "file-name.png", "alt": "required description of the image", "caption": "optional", "source": "optional attribution" }
     "media" is either the exact file name of an image the editor will upload with the JSON (PNG, JPEG, GIF, WebP or SVG, max 3 MB) or an https:// URL.
  3. Data chart: { "type": "chart", "chart": { "kind": "bar" or "line", "title": "...", "xLabel": "...", "yLabel": "...", "labels": ["...", ...], "series": [ { "name": "...", "values": [number, ...] } ] }, "alt": "summary of what the chart shows", "caption": "optional", "source": "optional" }
     Rules: 1-60 labels (max 60 characters each); 1-6 series; every series has exactly one value per label, in the same order; values are plain JSON numbers (no units, no thousands separators, null for missing data); a line chart needs at least 2 labels.
  4. Chart image: { "type": "chart", "media": "chart-file.png", "alt": "required description including the main trend", "caption": "optional", "source": "optional" } — never give both "chart" and "media" in one block.
- "question" (optional): one comprehension question about the passage:
  { "prompt": "...", "choices": { "A": "...", "B": "...", "C": "...", "D": "..." }, "answer": "A" | "B" | "C" | "D", "explanation": "why the answer is right and the others wrong", "support": "a sentence quoted exactly from one paragraph that supports the answer" }

Writing rules: original text only (do not copy published works); 300-700 words per article across its paragraphs; SAT-level vocabulary and tone; every number shown in a chart must be consistent with the text; any figure data that is invented must be described as illustrative in its "source" field.

Now write [NUMBER] articles about [TOPIC].`;
function FX_libPrompt(){
  ftModal("Generate compatible JSON",`<p class="umeta">Copy this prompt into ChatGPT (or another assistant), replace <b>[NUMBER]</b> and <b>[TOPIC]</b>, save the answer as a <code>.json</code> file and import it with <b>Import JSON</b>. Upload any images it names in the same dialog.</p>
    <div class="field"><label for="libPromptTxt">Prompt</label><textarea id="libPromptTxt" rows="16" readonly>${esc(LIB_PROMPT)}</textarea></div>`,
    {wide:true,foot:`<a class="btn btn-ghost" href="/docs/library-import/library-sample.json" download="library-sample.json">Download sample JSON</a><button class="btn btn-primary" onclick="FX_libCopyPrompt()">Copy prompt</button>`});
}
async function FX_libCopyPrompt(){
  const t=document.getElementById("libPromptTxt");
  try{ await navigator.clipboard.writeText(LIB_PROMPT); toast("Prompt copied"); }
  catch{ t.select(); document.execCommand("copy"); toast("Prompt copied"); }
}
