// ════════════════════════════════════════════════════════════
//  SAT Vocabulary — bank, JSON upload, sets, tasks & practice engine
//  Loaded before the main studio script; it only defines functions and
//  state, and relies on the studio's shared helpers (api, svg, esc, go,
//  crumbs, toast, state…) at call time.
// ════════════════════════════════════════════════════════════

const VOCAB_SEED = [
  {"id":"vocab-001","word":"ambivalent","partOfSpeech":"adjective","definition":"Having mixed feelings or contradictory ideas about something or someone.","satContextSentence":"Although the urban planner praised the new transit line's efficiency, she remained _____ about its long-term financial sustainability for low-income commuters.","distractors":["resolute","indifferent","ostentatious"],"synonyms":["uncertain","conflicted","equivocal"],"antonyms":["decisive","certain","resolute"],"difficulty":"Foundation","tags":["Tone/Attitude","High-Frequency","Social Science"]},
  {"id":"vocab-002","word":"corroborate","partOfSpeech":"verb","definition":"To confirm or give support to a statement, theory, or finding.","satContextSentence":"Ice core samples extracted from the Antarctic shelf _____ the paleoclimatologist's hypothesis that atmospheric carbon levels spiked rapidly during the epoch.","distractors":["repudiate","fabricate","obfuscate"],"synonyms":["substantiate","validate","verify"],"antonyms":["contradict","refute","disprove"],"difficulty":"Foundation","tags":["Rhetoric","Science Context","High-Frequency"]},
  {"id":"vocab-003","word":"ephemeral","partOfSpeech":"adjective","definition":"Lasting for a very short time; transitory.","satContextSentence":"Unlike the enduring stone monuments of ancient Rome, the bamboo pavilions constructed for the festival were intentionally _____, designed to be dismantled within a week.","distractors":["perpetual","ubiquitous","immutable"],"synonyms":["fleeting","transient","short-lived"],"antonyms":["permanent","enduring","perpetual"],"difficulty":"Medium","tags":["High-Frequency","Humanities","Contrast"]},
  {"id":"vocab-004","word":"mitigate","partOfSpeech":"verb","definition":"To make less severe, serious, or painful.","satContextSentence":"Coastal wetlands act as natural buffers that _____ the destructive impact of storm surges on inland infrastructure.","distractors":["exacerbate","proliferate","engender"],"synonyms":["alleviate","attenuate","assuage"],"antonyms":["aggravate","exacerbate","intensify"],"difficulty":"Foundation","tags":["Science Context","High-Frequency","Cause/Effect"]},
  {"id":"vocab-005","word":"pragmatic","partOfSpeech":"adjective","definition":"Dealing with things sensibly and realistically in a way that is based on practical rather than theoretical considerations.","satContextSentence":"Faced with a tightening municipal budget, the council abandoned the grandiose architectural blueprint in favor of a more _____ renovation plan.","distractors":["idealistic","quixotic","esoteric"],"synonyms":["practical","realistic","utilitarian"],"antonyms":["idealistic","impractical","visionary"],"difficulty":"Foundation","tags":["Tone/Attitude","Social Science","High-Frequency"]},
  {"id":"vocab-006","word":"ubiquitous","partOfSpeech":"adjective","definition":"Present, appearing, or found everywhere.","satContextSentence":"Once considered a rare luxury reserved for research laboratories, microprocessors have become so _____ that they now regulate everything from toasters to traffic lights.","distractors":["scarce","anomalous","clandestine"],"synonyms":["omnipresent","pervasive","universal"],"antonyms":["rare","scarce","infrequent"],"difficulty":"Medium","tags":["High-Frequency","Science Context"]},
  {"id":"vocab-007","word":"tenuous","partOfSpeech":"adjective","definition":"Very weak or slight; lacking a strong basis or foundation.","satContextSentence":"Critics argued that the historian's claim rested on a _____ connection between two undated letters rather than verifiable archival evidence.","distractors":["robust","irrefutable","compelling"],"synonyms":["flimsy","fragile","dubious"],"antonyms":["strong","substantial","convincing"],"difficulty":"Medium","tags":["Rhetoric","Tone/Attitude","History"]},
  {"id":"vocab-008","word":"ameliorate","partOfSpeech":"verb","definition":"To make something bad or unsatisfactory better.","satContextSentence":"The introduction of drought-resistant crop varieties helped _____ the severe food shortages that had plagued the arid region for decades.","distractors":["compound","stagnate","preclude"],"synonyms":["improve","enhance","alleviate"],"antonyms":["worsen","deteriorate","exacerbate"],"difficulty":"Advanced","tags":["Social Science","High-Frequency"]},
  {"id":"vocab-009","word":"esoteric","partOfSpeech":"adjective","definition":"Intended for or likely to be understood by only a small number of people with a specialized knowledge or interest.","satContextSentence":"While the physicist's early textbooks were written in dense, _____ jargon aimed at fellow researchers, her later memoirs translated quantum mechanics into accessible everyday metaphors.","distractors":["pedestrian","lucid","superficial"],"synonyms":["abstruse","arcane","obscure"],"antonyms":["accessible","familiar","exoteric"],"difficulty":"Advanced","tags":["Humanities","Science Context","Contrast"]},
  {"id":"vocab-010","word":"repudiate","partOfSpeech":"verb","definition":"To refuse to accept or be associated with; to deny the truth or validity of.","satContextSentence":"In his landmark treatise, the astronomer sought to _____ the geocentric model of the universe, presenting mathematical proof that the planets revolve around the sun.","distractors":["vindicate","espouse","bolster"],"synonyms":["reject","renounce","refute"],"antonyms":["embrace","confirm","validate"],"difficulty":"Advanced","tags":["Rhetoric","Science Context"]},
  {"id":"vocab-011","word":"bolster","partOfSpeech":"verb","definition":"To support or strengthen; to prop up.","satContextSentence":"To _____ her argument that early amphibians adapted quickly to terrestrial environments, the paleontologist presented newly discovered fossilized footprints.","distractors":["undermine","subvert","curtail"],"synonyms":["reinforce","fortify","buttress"],"antonyms":["undermine","weaken","hinder"],"difficulty":"Foundation","tags":["Rhetoric","High-Frequency","Science Context"]},
  {"id":"vocab-012","word":"equivocal","partOfSpeech":"adjective","definition":"Open to more than one interpretation; ambiguous or uncertain in nature.","satContextSentence":"When pressed by reporters on whether he would veto the trade bill, the diplomat offered an intentionally _____ reply to avoid alienating either faction.","distractors":["unambiguous","categorical","trenchant"],"synonyms":["ambiguous","noncommittal","evasive"],"antonyms":["clear","definite","unequivocal"],"difficulty":"Advanced","tags":["Tone/Attitude","Rhetoric","Politics/History"]},
  {"id":"vocab-013","word":"proliferate","partOfSpeech":"verb","definition":"To increase rapidly in numbers; to multiply.","satContextSentence":"Following the invention of the movable-type printing press, independent pamphlets and scientific journals began to _____ across European urban centers.","distractors":["dwindle","wane","recede"],"synonyms":["multiply","mushroom","burgeon"],"antonyms":["decrease","diminish","dwindle"],"difficulty":"Medium","tags":["History","Science Context","High-Frequency"]},
  {"id":"vocab-014","word":"disparate","partOfSpeech":"adjective","definition":"Essentially different in kind; not allowing comparison.","satContextSentence":"The anthology brings together _____ literary traditions, weaving ancient Mesopotamian myths alongside contemporary cyberpunk fiction.","distractors":["homogeneous","analogous","uniform"],"synonyms":["contrasting","divergent","distinct"],"antonyms":["similar","homogeneous","alike"],"difficulty":"Medium","tags":["Humanities","Contrast","High-Frequency"]},
  {"id":"vocab-015","word":"circumspect","partOfSpeech":"adjective","definition":"Wary and unwilling to take risks; cautious and prudent.","satContextSentence":"Given the volatility of the emerging biotech sector, institutional investors remained _____ about committing capital before Phase III clinical trials concluded.","distractors":["audacious","rash","impetuous"],"synonyms":["cautious","prudent","guarded"],"antonyms":["reckless","audacious","unguarded"],"difficulty":"Advanced","tags":["Tone/Attitude","Social Science"]}
];

const VB_DIFFS = ["Foundation","Medium","Advanced"];
const VB_POS = ["noun","verb","adjective","adverb"];
const VB_MASTERY = ["New","Learning","Reviewing","Mastered"];
const VB_TASK_TYPES = {
  Flashcard_Review:{label:"Flashcard Review",mode:"flash"},
  Matching_Game:{label:"Speed Matching",mode:"match"},
  Context_Fill_In_Blank:{label:"SAT Context Cloze",mode:"cloze"},
  Multiple_Choice_Quiz:{label:"Definition Multiple Choice",mode:"define"},
  Mixed_Quiz:{label:"Mixed Quiz",mode:"mixed"},
};
const VP_MODES = {
  flash:{label:"3D Flashcards",icon:"layers"},
  match:{label:"Speed Matching",icon:"shuffle"},
  cloze:{label:"SAT Context Cloze",icon:"book"},
  define:{label:"Definition MC",icon:"target"},
  mixed:{label:"Mixed Quiz",icon:"rush"},
  translate:{label:"Translation Quiz",icon:"vocab"},
};
const VB_LANGS={uz:{label:"Uzbek",key:"uzbekTranslation",lang:"uz"},ru:{label:"Russian",key:"russianTranslation",lang:"ru"}};
const VB_LOCAL_KEY = "fnf_vocab_local";
const VB_PAGE = 150;

let VB = {
  loaded:false, words:[], mastery:{}, sets:[], tasks:[], targets:{classes:[],students:[]}, analytics:null,
  upload:null, uploadError:"",
  filters:{q:"",difficulty:[],pos:[],tags:[],mastery:[],deck:false,fresh:false},
  draft:[], editTaskId:null, editSetId:null, tab:null, limit:VB_PAGE,
  form:{setTitle:"",setDesc:"",setPublic:true,taskTitle:"",taskType:"Mixed_Quiz",passing:80,due:"",all:false,classIds:[],studentIds:[],studentQ:""},
};

// ---------- small helpers ----------
const vbJs = v => esc(JSON.stringify(v));
const vbRole = () => state.user?.role || "student";
const vbIsStaff = () => ["admin","mentor"].includes(vbRole());
const vbShuffle = arr => { const a=arr.slice(); for(let i=a.length-1;i>0;i--){ const j=Math.floor(Math.random()*(i+1)); [a[i],a[j]]=[a[j],a[i]]; } return a; };
const vbUid = () => (crypto.randomUUID ? crypto.randomUUID() : "v-"+Date.now().toString(36)+Math.random().toString(36).slice(2,10));
function vbDiffPill(d){ const cls=d==="Foundation"?"pill-easy":d==="Advanced"?"pill-hard":"pill-med"; return `<span class="pill ${cls}">${esc(d)}</span>`; }
function vbMasteryOf(id){ return VB.mastery[id]?.masteryLevel || "New"; }
function vbMasteryPill(id){ const m=vbMasteryOf(id); return `<span class="pill m-${m}">${m}</span>`; }

// ---------- normalisation (mirrors the server) ----------
function vbStr(v,max=2000){ return String(v??"").trim().slice(0,max); }
function vbList(v,max=20){
  const arr=Array.isArray(v)?v:typeof v==="string"?v.split(/[,;|]/):[];
  const out=[];
  for(const item of arr){ const s=vbStr(item,120); if(s && !out.some(o=>o.toLowerCase()===s.toLowerCase())) out.push(s); if(out.length>=max) break; }
  return out;
}
function vbNormDiff(v){
  const s=vbStr(v).toLowerCase();
  if(["foundation","easy","basic","1","2"].includes(s)) return "Foundation";
  if(["advanced","hard","difficult","4","5"].includes(s)) return "Advanced";
  return "Medium";
}
function vbNormPos(v){ const s=vbStr(v,40).toLowerCase().replace(/\.$/,""); return ({n:"noun",v:"verb",adj:"adjective",adv:"adverb"})[s]||s||"noun"; }
function vbNormSentence(s,word){
  s=s.replace(/_{2,}/g,"_____");
  if(!s.includes("_____") && word){
    const re=new RegExp(`\\b${word.replace(/[.*+?^${}()|[\]\\]/g,"\\$&")}\\w*\\b`,"i");
    if(re.test(s)) s=s.replace(re,"_____");
  }
  return s;
}
function vbNormalize(raw){
  if(!raw||typeof raw!=="object") return null;
  const word=vbStr(raw.word??raw.term??raw.name,80);
  const definition=vbStr(raw.definition??raw.meaning??raw.def,1000);
  if(!word||!definition) return null;
  return {
    id:vbStr(raw.id,80)||vbUid(), word,
    partOfSpeech:vbNormPos(raw.partOfSpeech??raw.part_of_speech??raw.pos),
    definition,
    uzbekTranslation:vbStr(raw.uzbekTranslation??raw.uzbek_translation??raw.uzbek,1000).normalize("NFC"),
    russianTranslation:vbStr(raw.russianTranslation??raw.russian_translation??raw.russian,1000).normalize("NFC"),
    satContextSentence:vbNormSentence(vbStr(raw.satContextSentence??raw.sat_context_sentence??raw.contextSentence??raw.sentence??raw.example,1500),word),
    distractors:vbList(raw.distractors,3).filter(d=>d.toLowerCase()!==word.toLowerCase()),
    synonyms:vbList(raw.synonyms), antonyms:vbList(raw.antonyms),
    difficulty:vbNormDiff(raw.difficulty??raw.level), tags:vbList(raw.tags,12),
  };
}
// Missing distractors → 3 random words of the same part of speech from the bank.
function vbFillDistractors(w,pool){
  if(w.distractors.length>=3) return w;
  const taken=new Set([w.word.toLowerCase(),...w.distractors.map(d=>d.toLowerCase())]);
  const pick=c=>{ for(const x of vbShuffle(c)){ if(w.distractors.length>=3) break; if(!taken.has(x.toLowerCase())){ w.distractors.push(x); taken.add(x.toLowerCase()); } } };
  pick(pool.filter(p=>p.partOfSpeech===w.partOfSpeech).map(p=>p.word));
  pick(pool.map(p=>p.word));
  return w;
}

// ---------- data loading ----------
async function vbLoad(){
  const staff=vbIsStaff();
  const [words,mastery,sets,tasks,targets,analytics]=await Promise.all([
    api("vocab/words").catch(()=>null),
    staff?Promise.resolve([]):api("vocab/mastery").catch(()=>[]),
    api("vocab/sets").catch(()=>[]),
    api("vocab/tasks").catch(()=>[]),
    staff?api("vocab/targets").catch(()=>({classes:[],students:[]})):Promise.resolve({classes:[],students:[]}),
    staff?api("vocab/analytics").catch(()=>null):Promise.resolve(null),
  ]);
  // Fall back to the built-in starter bank if the API is unreachable, so the
  // module is always usable.
  VB.words=Array.isArray(words)?words:VOCAB_SEED.map(w=>({...w,_seedFallback:true}));
  VB.mastery=Object.fromEntries((mastery||[]).map(m=>[m.wordId,m]));
  VB.sets=sets||[]; VB.tasks=tasks||[]; VB.targets=targets||{classes:[],students:[]}; VB.analytics=analytics;
  VB.loaded=true;
  // Students read and practise the shared bank; they no longer import word
  // lists of their own, so drop any personal list a previous version stored.
  if(!staff){ VB.upload=null; try{ localStorage.removeItem(VB_LOCAL_KEY); }catch{} }
}
function vbRestoreLocal(){
  try{ const raw=localStorage.getItem(VB_LOCAL_KEY); if(raw) VB.upload=JSON.parse(raw); }catch{}
}
function vbPersistLocal(){
  if(vbIsStaff()) return;
  VB.upload=null;
  try{ VB.upload?localStorage.setItem(VB_LOCAL_KEY,JSON.stringify(VB.upload)):localStorage.removeItem(VB_LOCAL_KEY); }catch{}
}

// The live bank: saved words plus the included rows of an in-progress upload
// (merged over, or replacing, the saved bank). This is what every table,
// filter and practice mode reads, so an upload is playable instantly.
function vbBank(){
  const up=VB.upload;
  if(!up) return VB.words;
  const inc=up.items.filter(i=>i.include).map(i=>({...i.w,_fresh:i.status}));
  if(up.mode==="translations") return VB.words;
  if(up.mode==="replace") return inc.sort((a,b)=>a.word.localeCompare(b.word));
  const byId=new Map(VB.words.map(w=>[w.id,w]));
  inc.forEach(w=>byId.set(w.id,w));
  return [...byId.values()].sort((a,b)=>a.word.localeCompare(b.word));
}
function vbFind(id){ return vbBank().find(w=>w.id===id) || VB.words.find(w=>w.id===id) || VB.upload?.items.find(i=>i.w.id===id)?.w; }
function vbUnsavedIds(){ return new Set((VB.upload?.items||[]).filter(i=>i.include).map(i=>i.w.id)); }

// ---------- filters ----------
function vbFacetValues(){
  const bank=vbBank();
  const tags=new Map();
  bank.forEach(w=>(w.tags||[]).forEach(t=>tags.set(t,(tags.get(t)||0)+1)));
  const pos=[...new Set(bank.map(w=>w.partOfSpeech))].sort((a,b)=>(VB_POS.indexOf(a)+99*(VB_POS.indexOf(a)<0))-(VB_POS.indexOf(b)+99*(VB_POS.indexOf(b)<0)));
  const diffs=VB_DIFFS.filter(d=>bank.some(w=>w.difficulty===d));
  return { diffs, pos, tags:[...tags.entries()].sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0])).map(e=>e[0]) };
}
function vbFiltered(){
  const f=VB.filters, q=f.q.trim().toLowerCase();
  return vbBank().filter(w=>{
    if(q && !(w.word.toLowerCase().includes(q) || w.definition.toLowerCase().includes(q) || (w.synonyms||[]).some(s=>s.toLowerCase().includes(q)))) return false;
    if(f.difficulty.length && !f.difficulty.includes(w.difficulty)) return false;
    if(f.pos.length && !f.pos.includes(w.partOfSpeech)) return false;
    if(f.tags.length && !(w.tags||[]).some(t=>f.tags.includes(t))) return false;
    if(f.mastery.length && !f.mastery.includes(vbMasteryOf(w.id))) return false;
    if(f.deck && !VB.mastery[w.id]?.starred) return false;
    if(f.fresh && !w._fresh) return false;
    return true;
  });
}
function vbToggleFilter(key,val){
  const arr=VB.filters[key]; const i=arr.indexOf(val);
  i>=0?arr.splice(i,1):arr.push(val);
  VB.limit=VB_PAGE; vbRefreshBank();
}
function vbClearFilters(){ VB.filters={q:"",difficulty:[],pos:[],tags:[],mastery:[],deck:false,fresh:false}; VB.limit=VB_PAGE; const s=document.getElementById("vbQ"); if(s) s.value=""; vbRefreshBank(); }
function vbSearch(v){ VB.filters.q=v; VB.limit=VB_PAGE; vbRefreshBank(); }

function vbFiltersHTML(){
  const {diffs,pos,tags}=vbFacetValues(), f=VB.filters;
  const chip=(key,val,label)=>`<button class="vb-chip ${f[key].includes(val)?"on":""}" onclick="vbToggleFilter(${vbJs(key)},${vbJs(val)})">${esc(label??val)}</button>`;
  const any=f.difficulty.length||f.pos.length||f.tags.length||f.mastery.length||f.deck||f.fresh;
  return `<div class="vb-chipgroup"><span class="lbl">Difficulty</span>${diffs.map(d=>chip("difficulty",d)).join("")}</div>
    <div class="vb-chipgroup"><span class="lbl">Part of speech</span>${pos.map(p=>chip("pos",p)).join("")}</div>
    ${tags.length?`<div class="vb-chipgroup"><span class="lbl">Tags</span>${tags.map(t=>chip("tags",t)).join("")}</div>`:""}
    ${vbRole()==="student"?`<div class="vb-chipgroup"><span class="lbl">Mastery</span>${VB_MASTERY.map(m=>chip("mastery",m)).join("")}
      <button class="vb-chip ${f.deck?"on":""}" onclick="VB.filters.deck=!VB.filters.deck;vbRefreshBank()">${svg("save","ic-sm")} My Study Deck</button></div>`:""}
    <div class="vb-chipgroup">${VB.upload?`<button class="vb-chip ${f.fresh?"on":""}" onclick="VB.filters.fresh=!VB.filters.fresh;vbRefreshBank()">Uploaded batch only</button>`:""}
      ${any?`<button class="vb-chip clear" onclick="vbClearFilters()">Clear filters</button>`:""}</div>`;
}

// ---------- page ----------
async function viewVocab(){
  crumbs([{label:"Vocabulary"}]);
  if(!VB.loaded || !VB._fromPractice){ loading(); await vbLoad(); }
  VB._fromPractice=false;
  const role=vbRole();
  if(!VB.tab) VB.tab = role==="student" ? (VB.tasks.some(t=>t.status!=="Completed")?"tasks":"bank") : "bank";
  vbRenderPage();
}
function vbTab(t){ VB.tab=t; vbRenderPage(); window.scrollTo(0,0); }
function vbRenderPage(){
  const role=vbRole(), staff=vbIsStaff();
  const openTasks=VB.tasks.filter(t=>t.status!=="Completed").length;
  const tabs = staff
    ? [["bank","Bank & Task Builder",vbBank().length],["sets","Vocab Sets",VB.sets.length],["tasks",role==="admin"?"All Tasks":"Tasks & Progress",VB.tasks.length]]
    : [["tasks","My Vocab Tasks",openTasks],["bank","Vocabulary Bank",vbBank().length],["sets","Vocab Sets",VB.sets.length]];
  const head = role==="admin"
    ? `<h1>Vocabulary studio</h1><p>Upload JSON word lists, curate the master SAT vocabulary bank, and manage every vocab task on the platform.</p>`
    : role==="mentor"
    ? `<h1>Vocabulary</h1><p>Upload word lists, build sets, and assign vocab quizzes to your students — then track exactly which words they miss.</p>`
    : `<h1>SAT Vocabulary</h1><p>Search the bank, bookmark words into your study deck, and drill them in four interactive modes.</p>`;
  let body="";
  if(VB.tab==="sets") body=vbSetsHTML();
  else if(VB.tab==="tasks") body=staff?vbStaffTasksHTML():vbStudentTasksHTML();
  else body=vbBankTabHTML();
  $c().innerHTML=`<div class="page-head fade">${head}</div>
    ${staff&&VB.analytics?vbAnalyticsHTML():""}
    <div class="vb-tabs fade">${tabs.map(([k,l,n])=>`<button class="${VB.tab===k?"on":""}" onclick="vbTab('${k}')">${l} <span class="cnt">${n}</span></button>`).join("")}</div>
    <div class="fade">${body}</div>`;
  if(VB.tab==="bank") vbRefreshBank();
}

// ---------- analytics ----------
function vbAnalyticsHTML(){
  const a=VB.analytics, max=Math.max(1,...a.topMissed.map(m=>m.missed));
  const scope=vbRole()==="admin"?"across all students":"across your students";
  return `<div class="stat-grid fade">
      <div class="stat-card"><div class="lbl">${svg("book","ic-sm")} Words in bank</div><div class="val">${a.totalWords}</div><div class="sub">${a.totalSets} curated set${a.totalSets===1?"":"s"}</div></div>
      <div class="stat-card"><div class="lbl">${svg("pages","ic-sm")} Vocab tasks</div><div class="val">${a.totalTasks}</div><div class="sub">${a.assigned} student assignment${a.assigned===1?"":"s"}</div></div>
      <div class="stat-card"><div class="lbl">${svg("check","ic-sm")} Completion rate</div><div class="val">${a.completionRate}%</div><div class="sub">${a.completed} of ${a.assigned} completed</div></div>
      <div class="stat-card"><div class="lbl">${svg("trophy","ic-sm")} Words mastered</div><div class="val">${a.masteryBreakdown?.Mastered||0}</div><div class="sub">${a.masteryBreakdown?.Learning||0} learning · ${a.masteryBreakdown?.Reviewing||0} reviewing</div></div>
    </div>
    <div class="panel fade" style="margin-bottom:1.4rem"><h2>${svg("target","ic-sm")} Top 10 most-missed words <span class="umeta" style="font-family:var(--sans);font-size:.78rem;font-weight:500;color:var(--ink3)">${scope}</span></h2>
      ${a.topMissed.length?a.topMissed.map((m,i)=>`<div class="vb-miss"><span class="n">${i+1}</span><button class="w" style="text-align:left" onclick="vbOpenWord(${vbJs(m.wordId)})">${esc(m.word)}</button><div class="bar-track"><div class="bar-fill" style="width:${Math.round(m.missed/max*100)}%"></div></div><span class="bar-pct">${m.missed} miss${m.missed===1?"":"es"}</span></div>`).join("")
        :`<p class="umeta" style="color:var(--ink3);font-size:.86rem">No misses recorded yet — they appear as students practise.</p>`}
    </div>`;
}

// ---------- bank tab ----------
function vbBankTabHTML(){
  const staff=vbIsStaff();
  return `<div class="vb-layout ${staff?"":"solo"}">
    <div style="min-width:0">
      ${staff?vbUploaderHTML():""}
      <div id="vbUploadPanel">${staff?vbUploadPanelHTML():""}</div>
      <div class="vb-filters">
        <div class="vb-search">${svg("target","ic-sm")}<input id="vbQ" placeholder="Search words, definitions, or synonyms…" value="${esc(VB.filters.q)}" oninput="vbSearch(this.value)"/>
          ${staff?`<button class="btn btn-ghost btn-sm" onclick="vbEditWord(null)">${svg("plus","ic-sm")} New word</button>`:""}</div>
        <div id="vbChips"></div>
      </div>
      <div id="vbLaunch"></div>
      <div id="vbTable"></div>
    </div>
    ${staff?`<aside id="vbDraft">${vbDraftHTML()}</aside>`:""}
  </div>`;
}
function vbRefreshBank(){
  const chips=document.getElementById("vbChips"); if(!chips) return;
  chips.innerHTML=vbFiltersHTML();
  const rows=vbFiltered();
  document.getElementById("vbLaunch").innerHTML=`<div class="vb-launch"><b>Practice ${rows.length} word${rows.length===1?"":"s"}</b><span class="umeta">Uses the current search &amp; filters</span>
    ${Object.entries(VP_MODES).map(([k,m])=>`<button class="btn btn-ghost btn-sm" ${rows.length<(k==="match"?2:1)?"disabled":""} onclick="vbPracticeFiltered('${k}')">${svg(m.icon,"ic-sm")} ${m.label}</button>`).join("")}</div>`;
  document.getElementById("vbTable").innerHTML=vbTableHTML(rows);
  vbRefreshDraftList();
}
function vbPracticeFiltered(mode){ vbStartPractice(vbFiltered(),mode,{label:"Self-practice"}); }

function vbTableHTML(rows){
  if(!rows.length) return `<div class="vb-tablewrap"><div class="empty"><div class="ei">${svg("book")}</div><h3>No words match</h3><p>${vbIsStaff()?"Try clearing a filter or uploading a JSON word list.":"Try clearing a filter."}</p></div></div>`;
  const staff=vbIsStaff(), role=vbRole(), draft=new Set(VB.draft);
  const shown=rows.slice(0,VB.limit);
  const body=shown.map(w=>{
    const staged=draft.has(w.id);
    const fresh=w._fresh?`<span class="pill ${w._fresh==="new"?"pill-new":"pill-upd"}" title="From the uploaded file — not saved yet">${w._fresh==="new"?"NEW":"UPDATED"}</span>`:"";
    const canEdit=role==="admin" || (role==="mentor" && (w._fresh || w.createdBy===state.user.profile?.id));
    const lead = staff
      ? `<button class="vb-ib ${staged?"rem":"add"}" title="${staged?"Remove from draft":"Add to draft"}" onclick="vbToggleDraft(${vbJs(w.id)})">${svg(staged?"x":"plus")}</button>`
      : `<button class="vb-ib star ${VB.mastery[w.id]?.starred?"on":""}" title="${VB.mastery[w.id]?.starred?"Remove from my study deck":"Add to my study deck"}" onclick="vbToggleStar(${vbJs(w.id)})" ${w._fresh||w._seedFallback?"disabled":""}>${svg("save")}</button>`;
    return `<tr class="${staged?"staged":""} ${w._fresh?"fresh":""}">
      <td style="width:44px">${lead}</td>
      <td><button class="w" onclick="vbOpenWord(${vbJs(w.id)})">${esc(w.word)}</button> ${fresh}<div class="pos">${esc(w.partOfSpeech)}</div></td>
      <td>${vbDiffPill(w.difficulty)}</td>
      <td class="def">${esc(w.definition)}${vbUzHTML(w,"vb-uz vb-uz-sm")}</td>
      <td><div class="tags">${(w.tags||[]).map(t=>`<span>${esc(t)}</span>`).join("")}</div></td>
      ${role==="student"?`<td>${w._fresh?`<span class="pill pill-local">Local</span>`:vbMasteryPill(w.id)}</td>`:""}
      ${staff?`<td><div class="vb-rowbtns">${canEdit?`<button class="vb-ib" title="Edit" onclick="vbEditWord(${vbJs(w.id)})">${svg("edit")}</button><button class="vb-ib del" title="${w._fresh?"Exclude from upload":"Delete"}" onclick="vbDeleteWord(${vbJs(w.id)})">${svg("trash")}</button>`:""}</div></td>`:""}
    </tr>`;
  }).join("");
  return `<div class="vb-tablewrap"><table class="vb-table"><thead><tr><th>${staff?"Draft":"Deck"}</th><th>Word</th><th>Level</th><th>Definition</th><th>Tags</th>${role==="student"?"<th>Mastery</th>":""}${staff?"<th></th>":""}</tr></thead><tbody>${body}</tbody></table></div>
    ${rows.length>shown.length?`<button class="btn btn-ghost btn-sm vb-more" onclick="VB.limit+=${VB_PAGE};vbRefreshBank()">Show more (${rows.length-shown.length} left)</button>`:""}`;
}

// ---------- JSON uploader ----------
function vbUploaderHTML(){
  const staff=vbIsStaff();
  return `<div class="vb-drop" id="vbDrop" onclick="if(!event.target.closest('button'))document.getElementById('vbFile').click()"
      ondragover="event.preventDefault();this.classList.add('over')" ondragleave="this.classList.remove('over')"
      ondrop="event.preventDefault();this.classList.remove('over');vbHandleFiles(event.dataTransfer.files)">
    <span class="vb-drop-ic">${svg("plus")}</span>
    <div><h3>${staff?"Drop a vocabulary .json file":"Upload a personal study list (.json)"}</h3>
      <p>${staff?"Words appear in the bank instantly — review, include or exclude rows, then publish, save as a set, or assign as a task."
        :"Local preview mode — the words stay on this device and are instantly playable in every practice mode."}</p></div>
    <div class="vb-drop-actions">
      <button class="btn btn-primary btn-sm" onclick="document.getElementById('vbFile').click()">${svg("plus","ic-sm")} Choose file</button>
      ${staff?`<button class="btn btn-ghost btn-sm" onclick="vbExport()">${svg("save","ic-sm")} Download bank as JSON</button>`:""}
    </div>
    <input type="file" id="vbFile" accept=".json,application/json" onchange="vbHandleFiles(this.files);this.value=''"/>
  </div>${VB.uploadError?`<div class="vb-err">${esc(VB.uploadError)}</div>`:""}`;
}
async function vbHandleFiles(files){
  if(!vbIsStaff()){ toast("Only admins and mentors can manage vocabulary."); return; }
  const file=files?.[0]; if(!file) return;
  VB.uploadError="";
  let data;
  try{ data=JSON.parse(await file.text()); }
  catch(e){ VB.uploadError=`“${file.name}” is not valid JSON: ${e.message}`; vbRenderPage(); return; }
  const list=Array.isArray(data)?data:Array.isArray(data?.words)?data.words:Array.isArray(data?.vocab)?data.vocab:null;
  if(!list){ VB.uploadError="The file must contain a JSON array of word objects (or an object with a “words” array)."; vbRenderPage(); return; }
  const byWord=new Map(VB.words.map(w=>[w.word.toLowerCase(),w]));
  const byId=new Map(VB.words.map(w=>[w.id,w]));
  const items=[], seen=new Set(); let invalid=0;
  for(const raw of list){
    const w=vbNormalize(raw); if(!w){ invalid++; continue; }
    const twin=byWord.get(w.word.toLowerCase());
    if(twin && !byId.has(w.id)) w.id=twin.id;
    if(seen.has(w.id)) continue; seen.add(w.id);
    items.push({w,include:true,status:byId.has(w.id)?"updated":"new"});
  }
  if(!items.length){ VB.uploadError=`No valid words in “${file.name}” — each entry needs at least a “word” and a “definition”.`; vbRenderPage(); return; }
  const pool=[...items.map(i=>i.w),...VB.words];
  items.forEach(i=>vbFillDistractors(i.w,pool));
  // Re-importing a file that is already in the bank: default to only filling
  // missing Uzbek translations, so mentor edits on those entries are kept.
  const fillable=vbFillableCount(items);
  const reimport=items.every(i=>i.status==="updated");
  VB.upload={fileName:file.name,items,mode:reimport&&fillable?"translations":"merge",invalid,setTitle:file.name.replace(/\.json$/i,"")};
  VB.filters.fresh=false; VB.tab="bank";
  vbPersistLocal();
  vbRenderPage();
  toast(`Loaded ${items.length} word${items.length===1?"":"s"} from ${file.name}`);
}
function vbFillableCount(items){
  const byId=new Map(VB.words.map(w=>[w.id,w]));
  return items.filter(i=>{ const cur=byId.get(i.w.id); return cur&&((i.w.uzbekTranslation&&!String(cur.uzbekTranslation||"").trim())||(i.w.russianTranslation&&!String(cur.russianTranslation||"").trim())); }).length;
}
function vbUploadPanelHTML(){
  const up=VB.upload; if(!up) return "";
  const staff=vbIsStaff(), role=vbRole();
  const inc=up.items.filter(i=>i.include).length;
  const nNew=up.items.filter(i=>i.status==="new").length, nUpd=up.items.length-nNew;
  return `<div class="vb-upload">
    <div class="vb-upload-head">
      <div><h3>${svg("pages","ic-sm")} ${esc(up.fileName)}</h3>
        <div class="umeta">${up.items.length} word${up.items.length===1?"":"s"} parsed · ${nNew} new · ${nUpd} matching existing${up.invalid?` · ${up.invalid} skipped (missing word or definition)`:""} · <b>${inc} included</b>${staff?" · not saved yet":" · local preview"}</div></div>
      <div class="vb-seg" role="group" aria-label="Upload mode">
        <button class="${up.mode==="merge"?"on":""}" onclick="vbUploadMode('merge')">Merge with existing bank</button>
        <button class="${up.mode==="replace"?"on":""}" ${role==="mentor"?`disabled title="Only the Super Admin can replace the bank"`:""} onclick="vbUploadMode('replace')">Replace bank</button>
        ${staff?`<button class="${up.mode==="translations"?"on":""}" title="Only adds Uzbek / Russian translations to existing words that have none. Nothing else changes." onclick="vbUploadMode('translations')">Fill missing translations</button>`:""}
      </div>
    </div>
    ${staff?`<div class="umeta" style="margin:.2rem 0 .6rem">${vbFillableCount(up.items)} existing word${vbFillableCount(up.items)===1?"":"s"} can get a missing Uzbek or Russian translation from this file.${up.mode==="translations"?" Only those translations are saved — definitions, edits, new words and student progress are left as they are.":""}</div>`:""}
    <div class="vb-batch">${up.items.map((it,i)=>`<div class="vb-batch-row ${it.include?"":"off"}">
      <button class="vb-ib ${it.include?"rem":"add"}" title="${it.include?"Exclude this word":"Include this word"}" onclick="vbUploadToggle(${i})">${svg(it.include?"x":"plus")}</button>
      <span class="bw">${esc(it.w.word)}</span><span class="pos" style="font-family:var(--mono);font-size:.7rem;color:var(--ink3)">${esc(it.w.partOfSpeech)}</span>
      <span class="bd">${esc(it.w.definition)}${it.w.uzbekTranslation?` <span lang="uz" style="color:var(--ink3)">· ${esc(it.w.uzbekTranslation)}</span>`:""}${it.w.russianTranslation?` <span lang="ru" style="color:var(--ink3)">· ${esc(it.w.russianTranslation)}</span>`:""}</span>
      <span class="pill ${it.status==="new"?"pill-new":"pill-upd"}">${it.status==="new"?"NEW":"UPDATE"}</span></div>`).join("")}</div>
    <div class="vb-actions">
      <button class="btn btn-ghost btn-sm" onclick="vbUploadAll(true)">Include all</button>
      <button class="btn btn-ghost btn-sm" onclick="vbUploadAll(false)">Exclude all</button>
      <span style="flex:1"></span>
      ${Object.entries(VP_MODES).filter(([k])=>k!=="mixed").map(([k,m])=>`<button class="btn btn-ghost btn-sm" ${inc<(k==="match"?2:1)?"disabled":""} onclick="vbPracticeUpload('${k}')">${svg(m.icon,"ic-sm")} ${m.label}</button>`).join("")}
    </div>
    ${staff?`<div class="vb-actions">
      <button class="btn btn-primary btn-sm" ${inc?"":"disabled"} onclick="vbPublishUpload()">${svg("check","ic-sm")} ${up.mode==="translations"?"Save translations":`Publish ${inc} to bank`}</button>
      <button class="btn btn-mint btn-sm" ${inc?"":"disabled"} onclick="vbUploadToDraft()">${svg("pages","ic-sm")} Assign batch as task</button>
      <button class="btn btn-danger btn-sm" onclick="vbDiscardUpload()">${svg("x","ic-sm")} Discard upload</button>
    </div>
    <div class="vb-inline"><input id="vbUpSetTitle" placeholder="Name this batch as a Vocab Set" value="${esc(up.setTitle||"")}" oninput="VB.upload.setTitle=this.value"/>
      <button class="btn btn-ghost btn-sm" ${inc?"":"disabled"} onclick="vbUploadAsSet()">${svg("save","ic-sm")} Save batch as set</button></div>`
    :`<div class="vb-actions"><button class="btn btn-danger btn-sm" onclick="vbDiscardUpload()">${svg("x","ic-sm")} Remove study list</button></div>`}
  </div>`;
}
function vbRefreshUpload(){ const el=document.getElementById("vbUploadPanel"); if(el) el.innerHTML=vbUploadPanelHTML(); vbPersistLocal(); vbRefreshBank(); }
function vbUploadMode(m){
  if(m==="replace" && vbRole()==="mentor") return;
  VB.upload.mode=m; vbRenderPage();
}
function vbUploadToggle(i){ const it=VB.upload.items[i]; it.include=!it.include; if(!it.include) VB.draft=VB.draft.filter(id=>id!==it.w.id); vbRefreshUpload(); }
function vbUploadAll(on){ VB.upload.items.forEach(it=>it.include=on); if(!on){ const ids=new Set(VB.upload.items.map(i=>i.w.id)); VB.draft=VB.draft.filter(id=>!ids.has(id)); } vbRefreshUpload(); }
function vbDiscardUpload(){
  const ids=new Set((VB.upload?.items||[]).filter(i=>i.status==="new").map(i=>i.w.id));
  VB.draft=VB.draft.filter(id=>!ids.has(id));
  VB.upload=null; VB.filters.fresh=false; VB.uploadError=""; vbPersistLocal(); vbRenderPage();
}
function vbPracticeUpload(mode){ vbStartPractice(VB.upload.items.filter(i=>i.include).map(i=>i.w),mode,{label:VB.upload.fileName}); }

// Save the included upload rows to the bank. Returns the saved word ids.
async function vbPublishUpload(silent){
  const up=VB.upload; if(!up) return [];
  const words=up.items.filter(i=>i.include).map(i=>{ const {_fresh,...w}=i.w; return w; });
  if(!words.length) return [];
  if(up.mode==="replace" && !confirm(`Replace the whole bank with these ${words.length} words? Every other word (${VB.words.filter(w=>!words.some(x=>x.id===w.id)).length}) will be deleted.`)) return null;
  try{
    const r=await api("vocab/import",{method:"POST",body:JSON.stringify({words,mode:up.mode})});
    VB.words=r.words; VB.upload=null; VB.filters.fresh=false;
    if(!silent) toast(up.mode==="translations"
      ? `Translations added to ${r.updated} word${r.updated===1?"":"s"}${r.alreadySet?`, ${r.alreadySet} already had one`:""}${r.skipped?`, ${r.skipped} kept (owned by others)`:""}${r.unmatched?`, ${r.unmatched} not in the bank`:""}`
      : `Published: ${r.created} new, ${r.updated} updated${r.skipped?`, ${r.skipped} kept (owned by others)`:""}${r.removed?`, ${r.removed} removed`:""}`);
    VB.analytics=await api("vocab/analytics").catch(()=>VB.analytics);
    vbRenderPage();
    return r.wordIds;
  }catch(e){ toast(e.message); return null; }
}
async function vbUploadAsSet(){
  const title=(VB.upload.setTitle||"").trim(); if(!title){ toast("Name the set first"); document.getElementById("vbUpSetTitle")?.focus(); return; }
  const ids=await vbPublishUpload(true); if(!ids) return;
  try{
    await api("vocab/sets",{method:"POST",body:JSON.stringify({title,description:"Created from a JSON upload.",wordIds:ids,isPublic:true})});
    VB.sets=await api("vocab/sets").catch(()=>VB.sets);
    toast(`Saved “${title}” as a set of ${ids.length} words`); vbRenderPage();
  }catch(e){ toast(e.message); }
}
async function vbUploadToDraft(){
  const title=VB.upload.setTitle||VB.upload.fileName;
  const ids=await vbPublishUpload(true); if(!ids) return;
  VB.draft=[...ids]; VB.editTaskId=null; VB.form.taskTitle=VB.form.taskTitle||title;
  vbRenderPage(); toast(`${ids.length} words published and staged — set the task details to assign`);
  setTimeout(()=>document.getElementById("vbTaskSec")?.scrollIntoView({behavior:"smooth",block:"start"}),60);
}

function vbExport(){
  const data=VB.words.map(w=>({id:w.id,word:w.word,partOfSpeech:w.partOfSpeech,definition:w.definition,uzbekTranslation:w.uzbekTranslation||"",russianTranslation:w.russianTranslation||"",satContextSentence:w.satContextSentence,
    distractors:w.distractors,synonyms:w.synonyms,antonyms:w.antonyms,difficulty:w.difficulty,tags:w.tags}));
  const blob=new Blob([JSON.stringify(data,null,2)],{type:"application/json"});
  const a=document.createElement("a"); a.href=URL.createObjectURL(blob);
  a.download=`sat-vocab-bank-${new Date().toISOString().slice(0,10)}.json`; a.click();
  setTimeout(()=>URL.revokeObjectURL(a.href),1000);
}

// ---------- draft (task builder) ----------
function vbToggleDraft(id){
  const i=VB.draft.indexOf(id); i>=0?VB.draft.splice(i,1):VB.draft.push(id);
  vbRefreshBank();
}
function vbDraftAddFiltered(){ const set=new Set(VB.draft); vbFiltered().forEach(w=>set.add(w.id)); VB.draft=[...set]; vbRefreshBank(); }
function vbDraftClear(){ VB.draft=[]; vbRefreshBank(); }
function vbDraftLoadSet(id){
  const s=VB.sets.find(x=>x.id===id); if(!s) return;
  const set=new Set(VB.draft); s.wordIds.forEach(w=>set.add(w)); VB.draft=[...set]; vbRefreshBank();
  toast(`Added ${s.wordIds.length} words from “${s.title}”`);
}
function vbRefreshDraftList(){
  const el=document.getElementById("vbDraftList"); if(!el) return;
  const words=VB.draft.map(id=>vbFind(id)).filter(Boolean);
  document.getElementById("vbDraftCount").textContent=words.length;
  el.innerHTML=words.length?words.map(w=>`<div class="vb-draft-item"><b>${esc(w.word)}</b><span class="pos" style="font-family:var(--mono);font-size:.68rem;color:var(--ink3)">${esc(w.partOfSpeech)}</span><button class="vb-ib rem" title="Remove" onclick="vbToggleDraft(${vbJs(w.id)})">${svg("x")}</button></div>`).join("")
    :`<p style="font-size:.8rem;color:var(--ink3);padding:.6rem .5rem">Click <b>+</b> on any row to stage words here.</p>`;
}
function vbDraftHTML(){
  const f=VB.form, role=vbRole(), t=VB.targets;
  const editingTask=VB.editTaskId?VB.tasks.find(x=>x.id===VB.editTaskId):null;
  const editingSet=VB.editSetId?VB.sets.find(x=>x.id===VB.editSetId):null;
  const sq=f.studentQ.trim().toLowerCase();
  const students=t.students.filter(s=>!sq || `${s.displayName} ${s.username||""} ${s.email||""}`.toLowerCase().includes(sq));
  return `<div class="vb-draft">
    <div class="vb-draft-head"><h3>${svg("pages","ic-sm")} Draft <span class="count" id="vbDraftCount">${VB.draft.length}</span></h3><p>Stage words with + / −, then save them as a set or assign them as a task.</p></div>
    <div class="vb-draft-list" id="vbDraftList"></div>
    <div class="vb-draft-sec" style="display:flex;gap:.4rem;flex-wrap:wrap">
      <button class="btn btn-ghost btn-sm" onclick="vbDraftAddFiltered()">${svg("plus","ic-sm")} Add all filtered</button>
      <button class="btn btn-ghost btn-sm" onclick="vbDraftClear()">Clear</button>
      ${VB.sets.length?`<select class="btn btn-ghost btn-sm" style="max-width:100%" onchange="if(this.value)vbDraftLoadSet(this.value);this.value=''"><option value="">+ Add a set…</option>${VB.sets.map(s=>`<option value="${esc(s.id)}">${esc(s.title)} (${s.wordIds.length})</option>`).join("")}</select>`:""}
    </div>
    <div class="vb-draft-sec">
      <h4>Save as Vocab Set</h4>
      ${editingSet?`<div class="vb-editing">Editing set “${esc(editingSet.title)}”<button onclick="vbCancelEdit()">${svg("x","ic-sm")}</button></div>`:""}
      <div class="field"><label>Title</label><input value="${esc(f.setTitle)}" oninput="VB.form.setTitle=this.value" placeholder="Week 3 — Tone words"/></div>
      <div class="field"><label>Description</label><textarea oninput="VB.form.setDesc=this.value" placeholder="Optional">${esc(f.setDesc)}</textarea></div>
      <label class="vb-check"><input type="checkbox" ${f.setPublic?"checked":""} onchange="VB.form.setPublic=this.checked"/> Visible to students</label>
      <button class="btn btn-ghost btn-sm btn-block" style="margin-top:.5rem" onclick="vbSaveSet()">${svg("save","ic-sm")} ${editingSet?"Update set":"Save set"}</button>
    </div>
    <div class="vb-draft-sec" id="vbTaskSec">
      <h4>Assign as Vocab Task</h4>
      ${editingTask?`<div class="vb-editing">Editing “${esc(editingTask.title)}”<button onclick="vbCancelEdit()">${svg("x","ic-sm")}</button></div>`:""}
      <div class="field"><label>Title</label><input value="${esc(f.taskTitle)}" oninput="VB.form.taskTitle=this.value" placeholder="Tone & attitude quiz"/></div>
      <div class="field"><label>Task type</label><select onchange="VB.form.taskType=this.value">${Object.entries(VB_TASK_TYPES).map(([k,v])=>`<option value="${k}" ${f.taskType===k?"selected":""}>${v.label}</option>`).join("")}</select></div>
      <div class="f-row" style="gap:.5rem">
        <div class="field"><label>Pass %</label><input type="number" min="0" max="100" value="${esc(f.passing)}" oninput="VB.form.passing=this.value"/></div>
        <div class="field"><label>Due</label><input type="datetime-local" value="${esc(f.due)}" oninput="VB.form.due=this.value"/></div>
      </div>
      <div class="field"><label>Assign to</label>
        ${role==="admin"?`<label class="vb-check"><input type="checkbox" ${f.all?"checked":""} onchange="VB.form.all=this.checked;vbRerenderDraft()"/> <b>All students</b> on the platform</label>`:""}
        ${f.all?"":`<div class="vb-targets">
          ${t.classes.length?`<div class="sub">Classes</div>${t.classes.map(c=>`<label class="vb-check"><input type="checkbox" ${f.classIds.includes(c.id)?"checked":""} onchange="vbToggleTarget('classIds',${c.id},this.checked)"/> ${esc(c.name)} <span class="umeta" style="color:var(--ink3);font-size:.74rem">(${c.studentIds.length})</span></label>`).join("")}`:""}
          <div class="sub">Students</div>
          ${t.students.length>8?`<input placeholder="Filter students…" value="${esc(f.studentQ)}" oninput="VB.form.studentQ=this.value;vbRerenderDraft(true)" style="width:100%;padding:.35rem .55rem;margin:.2rem 0;background:var(--panel);border:1px solid var(--border);border-radius:7px;color:var(--ink);font-size:.8rem"/>`:""}
          ${students.map(s=>`<label class="vb-check"><input type="checkbox" ${f.studentIds.includes(s.id)?"checked":""} onchange="vbToggleTarget('studentIds',${s.id},this.checked)"/> ${esc(s.displayName)}</label>`).join("")||`<p style="font-size:.78rem;color:var(--ink3)">${role==="mentor"?"Students who join your classes appear here.":"No students yet."}</p>`}
        </div>`}
      </div>
      <button class="btn btn-primary btn-sm btn-block" onclick="vbPublishTask()">${svg("check","ic-sm")} ${editingTask?"Update task":"Publish task"}</button>
    </div>
  </div>`;
}
function vbRerenderDraft(keepFocus){
  const el=document.getElementById("vbDraft"); if(!el) return;
  const pos=keepFocus?document.activeElement?.selectionStart:null;
  el.innerHTML=vbDraftHTML(); vbRefreshDraftList();
  if(keepFocus){ const inp=el.querySelector('.vb-targets input:not([type])'); if(inp){ inp.focus(); try{inp.setSelectionRange(pos,pos);}catch{} } }
}
function vbToggleTarget(key,id,on){ const a=VB.form[key]; const i=a.indexOf(id); if(on&&i<0) a.push(id); if(!on&&i>=0) a.splice(i,1); }
function vbCancelEdit(){ VB.editTaskId=null; VB.editSetId=null; vbResetForm(); vbRerenderDraft(); }
function vbResetForm(){ VB.form={...VB.form,setTitle:"",setDesc:"",setPublic:true,taskTitle:"",taskType:"Mixed_Quiz",passing:80,due:"",all:false,classIds:[],studentIds:[],studentQ:""}; }
function vbLocalInput(d){ const x=new Date(d); x.setMinutes(x.getMinutes()-x.getTimezoneOffset()); return x.toISOString().slice(0,16); }

// Words staged from an unsaved upload are published first so a set or task
// can reference them.
async function vbEnsurePublished(){
  const unsaved=vbUnsavedIds();
  if(VB.draft.some(id=>unsaved.has(id))){
    const ids=await vbPublishUpload(true);
    if(ids===null) return false;
  }
  return true;
}
async function vbSaveSet(){
  const f=VB.form;
  if(!f.setTitle.trim()){ toast("Name the set"); return; }
  if(!VB.draft.length){ toast("Stage at least one word"); return; }
  if(!(await vbEnsurePublished())) return;
  const body=JSON.stringify({title:f.setTitle,description:f.setDesc,isPublic:f.setPublic,wordIds:VB.draft});
  try{
    if(VB.editSetId) await api(`vocab/sets/${encodeURIComponent(VB.editSetId)}`,{method:"PUT",body});
    else await api("vocab/sets",{method:"POST",body});
    toast(VB.editSetId?"Set updated":`Saved set “${f.setTitle}”`);
    VB.editSetId=null; f.setTitle=""; f.setDesc="";
    VB.sets=await api("vocab/sets").catch(()=>VB.sets);
    vbRenderPage();
  }catch(e){ toast(e.message); }
}
async function vbPublishTask(){
  const f=VB.form;
  if(!f.taskTitle.trim()){ toast("Give the task a title"); return; }
  if(!VB.draft.length){ toast("Stage at least one word"); return; }
  if(!f.due){ toast("Choose a due date"); return; }
  if(!f.all && !f.classIds.length && !f.studentIds.length){ toast("Choose who to assign it to"); return; }
  if(!(await vbEnsurePublished())) return;
  const body=JSON.stringify({title:f.taskTitle,taskType:f.taskType,passingScore:Number(f.passing),dueDate:new Date(f.due).toISOString(),
    wordIds:VB.draft,allStudents:f.all,classIds:f.classIds,assignedTo:f.studentIds});
  try{
    if(VB.editTaskId) await api(`vocab/tasks/${encodeURIComponent(VB.editTaskId)}`,{method:"PUT",body});
    else await api("vocab/tasks",{method:"POST",body});
    toast(VB.editTaskId?"Task updated":`Assigned “${f.taskTitle}”`);
    VB.editTaskId=null; vbResetForm(); VB.draft=[];
    [VB.tasks,VB.analytics]=await Promise.all([api("vocab/tasks").catch(()=>VB.tasks),api("vocab/analytics").catch(()=>VB.analytics)]);
    VB.tab="tasks"; vbRenderPage();
  }catch(e){ toast(e.message); }
}

// ---------- word CRUD ----------
function vbEditWord(id){
  if(!vbIsStaff()){ toast("Only admins and mentors can manage vocabulary."); return; }
  const w=id?vbFind(id):{word:"",partOfSpeech:"adjective",definition:"",uzbekTranslation:"",russianTranslation:"",satContextSentence:"",distractors:[],synonyms:[],antonyms:[],difficulty:"Medium",tags:[]};
  if(!w) return;
  const list=a=>esc((a||[]).join(", "));
  vbDrawer(id?`Edit “${w.word}”`:"New word", w._fresh?"Changes apply to the uploaded batch until you publish it.":"Comma-separate lists. Missing distractors are filled with random words of the same part of speech.",
    `<div class="form-grid">
      <div class="f-row"><div class="field"><label>Word</label><input id="vwWord" value="${esc(w.word)}"/></div>
        <div class="field"><label>Part of speech</label><select id="vwPos">${[...new Set([...VB_POS,w.partOfSpeech])].map(p=>`<option ${p===w.partOfSpeech?"selected":""}>${esc(p)}</option>`).join("")}</select></div></div>
      <div class="field"><label>Definition</label><textarea id="vwDef">${esc(w.definition)}</textarea></div>
      <div class="f-row"><div class="field"><label>Uzbek translation (optional)</label><input id="vwUz" lang="uz" value="${esc(w.uzbekTranslation||"")}"/></div>
        <div class="field"><label>Russian translation (optional)</label><input id="vwRu" lang="ru" value="${esc(w.russianTranslation||"")}"/></div></div>
      <div class="field"><label>SAT context sentence (use _____ for the blank)</label><textarea id="vwSent">${esc(w.satContextSentence)}</textarea></div>
      <div class="field"><label>Distractors (3 incorrect options)</label><input id="vwDis" value="${list(w.distractors)}"/></div>
      <div class="f-row"><div class="field"><label>Synonyms</label><input id="vwSyn" value="${list(w.synonyms)}"/></div>
        <div class="field"><label>Antonyms</label><input id="vwAnt" value="${list(w.antonyms)}"/></div></div>
      <div class="f-row"><div class="field"><label>Difficulty</label><select id="vwDiff">${VB_DIFFS.map(d=>`<option ${d===w.difficulty?"selected":""}>${d}</option>`).join("")}</select></div>
        <div class="field"><label>Tags</label><input id="vwTags" value="${list(w.tags)}"/></div></div>
    </div>`,
    `<button class="btn btn-ghost" onclick="vbCloseDrawer()">Cancel</button><button class="btn btn-primary" onclick="vbSaveWord(${id?vbJs(id):"null"})">${svg("save","ic-sm")} Save word</button>`);
}
async function vbSaveWord(id){
  if(!vbIsStaff()){ toast("Only admins and mentors can manage vocabulary."); return; }
  const v=k=>document.getElementById(k).value;
  const raw={word:v("vwWord"),partOfSpeech:v("vwPos"),definition:v("vwDef"),uzbekTranslation:v("vwUz"),russianTranslation:v("vwRu"),satContextSentence:v("vwSent"),distractors:v("vwDis"),synonyms:v("vwSyn"),antonyms:v("vwAnt"),difficulty:v("vwDiff"),tags:v("vwTags")};
  const item=id?VB.upload?.items.find(i=>i.w.id===id):null;
  if(item){
    const w=vbNormalize({...raw,id}); if(!w){ toast("A word needs a word and a definition"); return; }
    item.w=vbFillDistractors(w,[...VB.words,...VB.upload.items.map(i=>i.w)]); vbCloseDrawer(); vbRefreshUpload(); return;
  }
  try{
    const row=id?await api(`vocab/words/${encodeURIComponent(id)}`,{method:"PUT",body:JSON.stringify(raw)}):await api("vocab/words",{method:"POST",body:JSON.stringify(raw)});
    const i=VB.words.findIndex(w=>w.id===row.id);
    if(i>=0) VB.words[i]={...VB.words[i],...row}; else VB.words.push(row);
    VB.words.sort((a,b)=>a.word.localeCompare(b.word));
    vbCloseDrawer(); toast(id?"Word updated":`Added “${row.word}”`); vbRenderPage();
  }catch(e){ toast(e.message); }
}
async function vbDeleteWord(id){
  if(!vbIsStaff()){ toast("Only admins and mentors can manage vocabulary."); return; }
  const item=VB.upload?.items.find(i=>i.w.id===id);
  if(item && item.include){ item.include=false; VB.draft=VB.draft.filter(x=>x!==id); vbRefreshUpload(); return; }
  const w=VB.words.find(x=>x.id===id); if(!w) return;
  if(!confirm(`Delete “${w.word}” from the bank? It is also removed from student progress.`)) return;
  try{ await api(`vocab/words/${encodeURIComponent(id)}`,{method:"DELETE"}); VB.words=VB.words.filter(x=>x.id!==id); VB.draft=VB.draft.filter(x=>x!==id); vbCloseDrawer(); toast("Word deleted"); vbRenderPage(); }
  catch(e){ toast(e.message); }
}

// ---------- personal deck ----------
async function vbToggleStar(id){
  const cur=VB.mastery[id]?.starred;
  VB.mastery[id]={...(VB.mastery[id]||{wordId:id,masteryLevel:"New",correctCount:0,incorrectCount:0}),starred:!cur};
  if(document.getElementById("vbTable")) vbRefreshBank();
  if(document.getElementById("vbDrawerStar")) vbOpenWord(id);
  try{ const row=await api(`vocab/deck/${encodeURIComponent(id)}`,{method:"PUT",body:JSON.stringify({starred:!cur})}); VB.mastery[id]=row; toast(!cur?"Added to your study deck":"Removed from your study deck"); }
  catch(e){ VB.mastery[id].starred=cur; toast(e.message); if(document.getElementById("vbTable")) vbRefreshBank(); }
}

// ---------- drawer ----------
function vbDrawer(title,sub,body,actions){
  vbCloseDrawer();
  const back=document.createElement("div");
  back.className="tq-back"; back.id="vbDrawerBack";
  back.onclick=e=>{ if(e.target===back) vbCloseDrawer(); };
  back.innerHTML=`<div class="tq-drawer" role="dialog" aria-modal="true" aria-labelledby="vbDrawerTitle" style="width:min(620px,100%)">
    <div class="tq-head"><div style="flex:1;min-width:0"><h3 id="vbDrawerTitle">${esc(title)}</h3>${sub?`<p>${esc(sub)}</p>`:""}</div><button class="vb-ib" onclick="vbCloseDrawer()" aria-label="Close">${svg("x")}</button></div>
    <div class="tq-body vb-drawer-body">${body}</div>
    ${actions?`<div class="tq-actions">${actions}</div>`:""}</div>`;
  document.body.appendChild(back);
}
function vbCloseDrawer(){ document.getElementById("vbDrawerBack")?.remove(); }
// "Uzbek translation" block shown right under the English definition; omitted
// entirely (no label, no gap) for entries without one.
function vbUzHTML(w,cls="vb-uz"){
  const uz=String(w?.uzbekTranslation||"").trim(), ru=String(w?.russianTranslation||"").trim();
  return (uz?`<div class="${cls}" lang="uz"><span class="vb-uz-k">Uzbek translation</span><span class="vb-uz-v">${esc(uz)}</span></div>`:"")
    +(ru?`<div class="${cls}" lang="ru"><span class="vb-uz-k">Russian translation</span><span class="vb-uz-v">${esc(ru)}</span></div>`:"");
}
function vbSentenceHTML(w,blank){
  const s=w.satContextSentence||"";
  if(!s) return `<span style="color:var(--ink3)">No context sentence provided.</span>`;
  return esc(s).replace(/_____/g, blank?`<span class="vb-blank"></span>`:`<mark class="vb-hl">${esc(w.word)}</mark>`);
}
function vbOpenWord(id){
  const w=vbFind(id); if(!w){ toast("That word is no longer in the bank"); return; }
  const role=vbRole(), m=VB.mastery[id]||{};
  const canEdit=role==="admin"||(role==="mentor"&&(w._fresh||w.createdBy===state.user.profile?.id));
  const author=w._fresh?"From uploaded file (unsaved)":w.author?`${w.author.role==="admin"?"Super Admin":"Mentor"} · ${w.author.displayName}`:"Starter bank";
  const body=`<div style="display:flex;gap:.6rem;align-items:center;flex-wrap:wrap"><span class="vb-word">${esc(w.word)}</span>
      <span class="pos" style="font-family:var(--mono);font-size:.8rem;color:var(--ink3)">${esc(w.partOfSpeech)}</span>${vbDiffPill(w.difficulty)}${role==="student"&&!w._fresh?vbMasteryPill(id):""}</div>
    <div class="vb-sec"><h4>Definition</h4><p style="font-size:1.05rem;line-height:1.55">${esc(w.definition)}</p>${vbUzHTML(w)}</div>
    <div class="vb-sec"><h4>In SAT context</h4><div class="vb-sentence">${vbSentenceHTML(w,false)}</div></div>
    <div class="f-row vb-sec"><div><h4>Synonyms</h4><div class="vb-wordlist">${(w.synonyms||[]).map(s=>`<span>${esc(s)}</span>`).join("")||"—"}</div></div>
      <div><h4>Antonyms</h4><div class="vb-wordlist ant">${(w.antonyms||[]).map(s=>`<span>${esc(s)}</span>`).join("")||"—"}</div></div></div>
    ${(w.tags||[]).length?`<div class="vb-sec"><h4>Tags</h4><div style="display:flex;gap:.3rem;flex-wrap:wrap">${w.tags.map(t=>`<span class="pill pill-muted">${esc(t)}</span>`).join("")}</div></div>`:""}
    ${role==="student"&&!w._fresh?`<div class="vb-sec"><h4>My mastery</h4><div class="vb-stats"><div><b>${m.correctCount||0}</b><span>Correct</span></div><div><b>${m.incorrectCount||0}</b><span>Missed</span></div><div><b style="font-size:.95rem;padding:.35rem 0">${m.lastReviewedAt?new Date(m.lastReviewedAt).toLocaleDateString():"Never"}</b><span>Last review</span></div></div></div>`:""}
    ${vbIsStaff()?`<div class="vb-sec"><h4>Distractors</h4><div class="vb-wordlist ant">${(w.distractors||[]).map(s=>`<span>${esc(s)}</span>`).join("")}</div></div>`:""}
    <p class="umeta" style="margin-top:1.4rem;font-size:.76rem;color:var(--ink3)">Added by: ${esc(author)}</p>`;
  const staged=VB.draft.includes(id);
  const actions = role==="student"
    ? `<button class="btn btn-ghost" id="vbDrawerStar" ${w._fresh||w._seedFallback?"disabled":""} onclick="vbToggleStar(${vbJs(id)})">${svg("save","ic-sm")} ${m.starred?"In my study deck ✓":"Add to study deck"}</button><button class="btn btn-primary" onclick="vbCloseDrawer();vbStartPractice([vbFind(${vbJs(id)})],'flash',{label:${vbJs(w.word)}})">${svg("layers","ic-sm")} Flashcard</button>`
    : `${canEdit?`<button class="btn btn-ghost" onclick="vbEditWord(${vbJs(id)})">${svg("edit","ic-sm")} Edit</button>`:""}<button class="btn ${staged?"btn-ghost":"btn-primary"}" onclick="vbToggleDraft(${vbJs(id)});vbOpenWord(${vbJs(id)})">${svg(staged?"x":"plus","ic-sm")} ${staged?"Remove from draft":"Add to draft"}</button>`;
  vbDrawer(w.word,"",body,actions);
}

// ---------- sets tab ----------
function vbSetsHTML(){
  if(!VB.sets.length) return `<div class="empty"><div class="ei">${svg("layers")}</div><h3>No sets yet</h3><p>${vbIsStaff()?"Stage words in the Bank tab and save them as a set — or save an uploaded JSON file directly.":"Your mentors' public word lists appear here."}</p></div>`;
  const role=vbRole(), me=state.user.profile?.id;
  return `<div class="tile-grid tg-2">${VB.sets.map(s=>{
    const mine=role==="admin"||s.createdBy===me;
    return `<div class="tile" style="cursor:default"><span class="count">${s.wordIds.length} words</span>
      <div class="badge-ic tone-ebrw">${svg("layers")}</div><h3>${esc(s.title)}</h3><p>${esc(s.description||"")}</p>
      <div class="umeta" style="font-size:.76rem;color:var(--ink3);margin-top:.5rem">${s.author?`${s.author.role==="admin"?"Super Admin":"Mentor"} · ${esc(s.author.displayName)}`:""}${vbIsStaff()?` · ${s.isPublic?"Public":"Private"}`:""}</div>
      <div class="vb-actions">${Object.entries(VP_MODES).map(([k,m])=>`<button class="vb-ib" title="${m.label}" onclick="vbPracticeSet(${vbJs(s.id)},'${k}')">${svg(m.icon)}</button>`).join("")}
        ${vbIsStaff()?`<span style="flex:1"></span><button class="btn btn-ghost btn-sm" onclick="vbSetToDraft(${vbJs(s.id)},false)">${svg("plus","ic-sm")} To draft</button>
          ${mine?`<button class="vb-ib" title="Edit set" onclick="vbSetToDraft(${vbJs(s.id)},true)">${svg("edit")}</button><button class="vb-ib del" title="Delete set" onclick="vbDeleteSet(${vbJs(s.id)})">${svg("trash")}</button>`:""}`:""}</div></div>`;
  }).join("")}</div>`;
}
function vbPracticeSet(id,mode){
  const s=VB.sets.find(x=>x.id===id); if(!s) return;
  vbStartPractice(s.wordIds.map(vbFind).filter(Boolean),mode,{label:s.title});
}
function vbSetToDraft(id,edit){
  const s=VB.sets.find(x=>x.id===id); if(!s) return;
  VB.draft=[...s.wordIds];
  if(edit){ VB.editSetId=id; VB.editTaskId=null; Object.assign(VB.form,{setTitle:s.title,setDesc:s.description,setPublic:s.isPublic}); }
  VB.tab="bank"; vbRenderPage(); toast(edit?`Editing “${s.title}” — change words, then Update set`:`Staged ${s.wordIds.length} words`);
}
async function vbDeleteSet(id){
  const s=VB.sets.find(x=>x.id===id); if(!s||!confirm(`Delete the set “${s.title}”? Words stay in the bank.`)) return;
  try{ await api(`vocab/sets/${encodeURIComponent(id)}`,{method:"DELETE"}); VB.sets=VB.sets.filter(x=>x.id!==id); toast("Set deleted"); vbRenderPage(); }
  catch(e){ toast(e.message); }
}

// ---------- tasks ----------
const vbStatusLabel = s => s.replace("_"," ");
function vbDueBadge(d,status){
  const ms=new Date(d).getTime()-Date.now();
  const cls=status==="Completed"?"":ms<0?"late":ms<48*3600e3?"soon":"";
  return `<span class="vb-due ${cls}">${esc(deadlineText(d))}</span>`;
}
function vbTaskMeta(t){
  return `<div class="meta"><span class="pill st-${t.status}">${vbStatusLabel(t.status)}</span>${vbDueBadge(t.dueDate,t.status)}
    <span class="pill pill-muted">${esc(VB_TASK_TYPES[t.taskType]?.label||t.taskType)}</span><span class="pill pill-muted">${t.wordIds.length} words</span><span class="pill pill-sec">Pass ≥ ${t.passingScore}%</span></div>`;
}
function vbStudentTaskCard(t){
  const r=t.result, done=t.status==="Completed";
  return `<div class="vb-task ${done?"":"hot"}"><div class="vb-task-top"><div><h3>${esc(t.title)}</h3>${vbTaskMeta(t)}
      <div class="umeta" style="font-size:.78rem;color:var(--ink3);margin-top:.45rem">${t.assigner?`Assigned by ${esc(t.assigner.displayName)}`:""}${r?` · Best score ${r.bestScore}% · ${r.attemptCount} attempt${r.attemptCount===1?"":"s"}`:""}</div></div>
    <button class="btn ${done?"btn-ghost":"btn-primary"} btn-sm" onclick="vbStartTask(${vbJs(t.id)})">${svg(done?"shuffle":"play","ic-sm")} ${done?"Practice again":r?"Continue task":"Start task"}</button></div></div>`;
}
function vbStudentTasksHTML(){
  if(!VB.tasks.length) return `<div class="empty"><div class="ei">${svg("pages")}</div><h3>No vocab tasks assigned</h3><p>When a mentor assigns a vocabulary quiz it appears here.</p><button class="btn btn-primary btn-sm" onclick="vbTab('bank')">Browse the bank</button></div>`;
  const order={Overdue:0,Pending:1,In_Progress:1,Completed:2};
  return VB.tasks.slice().sort((a,b)=>order[a.status]-order[b.status]||new Date(a.dueDate)-new Date(b.dueDate)).map(vbStudentTaskCard).join("");
}
function vbStaffTasksHTML(){
  if(!VB.tasks.length) return `<div class="empty"><div class="ei">${svg("pages")}</div><h3>No vocab tasks yet</h3><p>Stage words in the Bank tab and publish a task from the Draft sidebar.</p><button class="btn btn-primary btn-sm" onclick="vbTab('bank')">Open task builder</button></div>`;
  const role=vbRole(), me=state.user.profile?.id;
  return VB.tasks.map(t=>{
    const manage=role==="admin"||t.assignedBy===me;
    const target=t.allStudents?"All students":[...(t.classIds||[]).map(id=>VB.targets.classes.find(c=>c.id===id)?.name).filter(Boolean),t.assignedTo.length?`${t.assignedTo.length} individual student${t.assignedTo.length===1?"":"s"}`:""].filter(Boolean).join(" · ");
    const rows=t.progress.map(p=>`<tr><td class="uname">${esc(p.student.displayName)}</td><td><span class="pill st-${p.status}">${vbStatusLabel(p.status)}</span></td>
      <td style="font-family:var(--mono)">${p.bestScore==null?"—":p.bestScore+"%"}</td><td style="font-family:var(--mono)">${p.attempts}</td>
      <td><div class="missed">${p.missedWordIds.map(id=>{ const w=VB.words.find(x=>x.id===id); return w?`<span>${esc(w.word)}</span>`:""; }).join("")||'<span style="background:none;color:var(--ink3)">—</span>'}</div></td></tr>`).join("");
    return `<div class="vb-task"><div class="vb-task-top"><div><h3>${esc(t.title)}</h3>${vbTaskMeta(t)}
        <div class="umeta" style="font-size:.78rem;color:var(--ink3);margin-top:.45rem">${role==="admin"&&t.assigner?`By ${t.assigner.role==="admin"?"Super Admin":"Mentor"} ${esc(t.assigner.displayName)} · `:""}${esc(target||"No students")} · ${t.completedCount}/${t.progress.length} completed</div></div>
      <div style="display:flex;gap:.35rem"><button class="vb-ib" title="Preview" onclick="vbStartTask(${vbJs(t.id)})">${svg("play")}</button>
        ${manage?`<button class="vb-ib" title="Edit / reassign" onclick="vbEditTask(${vbJs(t.id)})">${svg("edit")}</button><button class="vb-ib del" title="Delete" onclick="vbDeleteTask(${vbJs(t.id)})">${svg("trash")}</button>`:""}</div></div>
      <div class="vb-progress utable-wrap">${t.progress.length?`<table class="utable"><thead><tr><th>Student</th><th>Status</th><th>Best</th><th>Attempts</th><th>Missed words (last attempt)</th></tr></thead><tbody>${rows}</tbody></table>`:`<p class="umeta" style="color:var(--ink3);font-size:.84rem">No students in this task's audience yet.</p>`}</div></div>`;
  }).join("");
}
function vbEditTask(id){
  const t=VB.tasks.find(x=>x.id===id); if(!t) return;
  VB.editTaskId=id; VB.editSetId=null; VB.draft=[...t.wordIds];
  Object.assign(VB.form,{taskTitle:t.title,taskType:t.taskType,passing:t.passingScore,due:vbLocalInput(t.dueDate),all:t.allStudents,classIds:[...t.classIds],studentIds:[...t.assignedTo]});
  VB.tab="bank"; vbRenderPage();
  setTimeout(()=>document.getElementById("vbTaskSec")?.scrollIntoView({behavior:"smooth",block:"start"}),60);
}
async function vbDeleteTask(id){
  const t=VB.tasks.find(x=>x.id===id); if(!t||!confirm(`Delete the task “${t.title}” and all student results for it?`)) return;
  try{ await api(`vocab/tasks/${encodeURIComponent(id)}`,{method:"DELETE"}); VB.tasks=VB.tasks.filter(x=>x.id!==id); toast("Task deleted"); vbRenderPage(); }
  catch(e){ toast(e.message); }
}
async function vbStartTask(id){
  if(!VB.loaded) await vbLoad();
  let t=VB.tasks.find(x=>x.id===id);
  if(!t){ VB.tasks=await api("vocab/tasks").catch(()=>[]); t=VB.tasks.find(x=>x.id===id); }
  if(!t){ toast("Task not found"); return; }
  const words=t.wordIds.map(w=>VB.words.find(x=>x.id===w)).filter(Boolean);
  if(!words.length){ toast("This task's words were removed from the bank"); return; }
  if(vbRole()==="student") api(`vocab/tasks/${encodeURIComponent(id)}/start`,{method:"POST",body:"{}"}).catch(()=>{});
  vbStartPractice(words,VB_TASK_TYPES[t.taskType]?.mode||"mixed",{label:t.title,task:t,locked:true});
}

// Dashboard card for students (rendered by the main student dashboard).
function vbDashboardHTML(tasks){
  const open=(tasks||[]).filter(t=>t.status!=="Completed").sort((a,b)=>new Date(a.dueDate)-new Date(b.dueDate));
  if(!open.length) return "";
  return `<div class="panel" style="margin-bottom:1.2rem;border-color:var(--accent)"><h2>${svg("book","ic-sm")} My Assigned Vocab Tasks <span class="pill pill-sec">${open.length} pending</span></h2>
    ${open.slice(0,4).map(t=>`<div style="display:flex;justify-content:space-between;gap:1rem;align-items:center;flex-wrap:wrap;padding:.7rem 0;border-top:1px solid var(--border)">
      <div><b>${esc(t.title)}</b>${vbTaskMeta(t)}</div>
      <button class="btn btn-primary btn-sm" onclick="vbStartTask(${vbJs(t.id)})">${svg("play","ic-sm")} ${t.result?"Continue":"Start Task"}</button></div>`).join("")}
    ${open.length>4?`<button class="btn btn-ghost btn-sm" style="margin-top:.6rem" onclick="VB.tab='tasks';go('vocab')">See all ${open.length} vocab tasks</button>`:""}</div>`;
}

// ════════════════════════════════════════════════════════════
//  <VocabPracticeEngine /> — flashcards, matching, cloze, definition MC
// ════════════════════════════════════════════════════════════
let VP=null, VP_TIMER=null;

async function vbStartPractice(words,mode,opts={}){
  words=(words||[]).filter(Boolean);
  if(!words.length){ toast("No words to practise"); return; }
  if(mode==="match" && words.length<2){ toast("Matching needs at least 2 words"); return; }
  // Each quiz session counts toward the student's daily vocabulary allowance (server-enforced).
  if(vbRole()==="student"){
    try{ await api("usage/vocab-quiz",{method:"POST"}); }
    catch(e){ if(e.status===429){ toast(e.message); return; } }
  }
  const prefs=state.user?.profile?.preferences||{};
  VP={words:vbShuffle(words),mode,label:opts.label||"Practice",task:opts.task||null,locked:!!opts.locked,
      promptKind:"definition",pairKind:"definition",lang:prefs.vocabLang==="ru"?"ru":"uz",dir:prefs.vocabDir==="x2en"?"x2en":"en2x"};
  vbSetupMode();
  go("vocabpractice");
}
// Translation quiz language pair & direction; remembered on the account.
function vbSetLang(lang,dir){
  if(lang) VP.lang=lang; if(dir) VP.dir=dir;
  const prefs={...(state.user?.profile?.preferences||{}),vocabLang:VP.lang,vocabDir:VP.dir};
  if(state.user?.profile){ state.user.profile.preferences=prefs; try{ localStorage.setItem(LS.user,JSON.stringify(state.user.profile)); }catch{} }
  api("auth/preferences",{method:"PUT",body:JSON.stringify({vocabLang:VP.lang,vocabDir:VP.dir})}).catch(()=>{});
  vbSetupMode(); viewVocabPractice();
}
const vbTr=(w,lang)=>String(w?.[VB_LANGS[lang]?.key]||"").trim();
// English <-> Uzbek / Russian. Words without a translation in the chosen
// language are left out; options are distinct translations (or words).
function vbBuildTranslateItem(w,lang,dir){
  const norm=x=>x.toLowerCase().normalize("NFC");
  const answerText=dir==="en2x"?vbTr(w,lang):w.word;
  const pool=vbShuffle(vbPool().filter(x=>x.id!==w.id&&vbTr(x,lang)));
  const wrong=[];
  for(const x of [...pool.filter(x=>x.partOfSpeech===w.partOfSpeech),...pool]){
    if(wrong.length>=3) break;
    const t=dir==="en2x"?vbTr(x,lang):x.word;
    if(t&&norm(t)!==norm(answerText)&&!wrong.some(y=>norm(y)===norm(t))) wrong.push(t);
  }
  const options=vbShuffle([answerText,...wrong]);
  return {wordId:w.id,kind:"translate",lang,dir,prompt:dir==="en2x"?w.word:vbTr(w,lang),options,answer:options.indexOf(answerText),chosen:null};
}
function vbSwitchMode(mode){
  if(VP.locked) return;
  if(mode==="match" && VP.words.length<2){ toast("Matching needs at least 2 words"); return; }
  VP.mode=mode; vbSetupMode(); viewVocabPractice();
}
function vbSetupMode(){
  clearInterval(VP_TIMER); VP_TIMER=null;
  Object.assign(VP,{done:false,results:[],missed:new Set(),startedAt:Date.now(),submitted:null});
  if(VP.mode==="flash"){
    VP.queue=VP.words.map(w=>w.id); VP.flipped=false; VP.firstPass=new Map(); VP.reviews=0;
  } else if(VP.mode==="match"){
    const n=VP.words.length, rounds=Math.ceil(n/8), size=Math.ceil(n/rounds);
    VP.rounds=[]; for(let i=0;i<n;i+=size) VP.rounds.push(VP.words.slice(i,i+size));
    // Fold a tiny trailing round into the previous one.
    if(VP.rounds.length>1 && VP.rounds[VP.rounds.length-1].length<2){ const last=VP.rounds.pop(); VP.rounds[VP.rounds.length-1].push(...last); }
    VP.round=0; VP.matches=0; VP.misses=0; vbSetupRound();
  } else if(VP.mode==="translate"){
    const eligible=VP.words.filter(w=>vbTr(w,VP.lang));
    VP.skipped=VP.words.length-eligible.length;
    VP.items=eligible.map(w=>vbBuildTranslateItem(w,VP.lang,VP.dir)).filter(it=>it.options.length>=2);
    VP.idx=0;
  } else {
    VP.items=VP.words.map(w=>vbBuildItem(w,VP.mode==="mixed"?(w.satContextSentence&&Math.random()<.5?"cloze":"define"):VP.mode));
    VP.idx=0;
  }
}
function vbPool(){ const m=new Map(); [...VB.words,...vbBank(),...VP.words].forEach(w=>m.set(w.id,w)); return [...m.values()]; }
function vbBuildItem(w,kind){
  if(kind==="cloze" && !w.satContextSentence) kind="define";
  const pool=vbPool().filter(x=>x.id!==w.id && x.word.toLowerCase()!==w.word.toLowerCase());
  let wrong=[];
  const add=list=>{ for(const x of list){ if(wrong.length>=3) break; if(x && x.toLowerCase()!==w.word.toLowerCase() && !wrong.some(y=>y.toLowerCase()===x.toLowerCase())) wrong.push(x); } };
  if(kind==="cloze"){ add(w.distractors||[]); add(vbShuffle(pool.filter(x=>x.partOfSpeech===w.partOfSpeech)).map(x=>x.word)); }
  else { add(vbShuffle(pool.filter(x=>x.partOfSpeech===w.partOfSpeech)).map(x=>x.word)); add(w.distractors||[]); }
  add(vbShuffle(pool).map(x=>x.word));
  const options=vbShuffle([w.word,...wrong.slice(0,3)]);
  return {wordId:w.id,kind,options,answer:options.indexOf(w.word),chosen:null};
}
function vbSetupRound(){
  const words=VP.rounds[VP.round];
  const right=w=>VP.pairKind==="synonym"&&(w.synonyms||[]).length?w.synonyms.slice(0,2).join(", "):w.definition;
  VP.left=vbShuffle(words.map(w=>({id:w.id,text:w.word})));
  VP.right=vbShuffle(words.map(w=>({id:w.id,text:right(w)})));
  VP.matched=new Set(); VP.selL=null; VP.selR=null;
  if(VP.round===0) VP.startedAt=Date.now();
  vbStartTimer();
}
function vbStartTimer(){
  clearInterval(VP_TIMER);
  VP_TIMER=setInterval(()=>{
    if(state.view!=="vocabpractice"||!VP||VP.mode!=="match"||VP.done){ clearInterval(VP_TIMER); VP_TIMER=null; return; }
    const el=document.getElementById("vpTimer"); if(el) el.textContent=vbFmt(Date.now()-VP.startedAt);
  },200);
}
const vbFmt = ms => { const s=Math.floor(ms/1000); return `${Math.floor(s/60)}:${String(s%60).padStart(2,"0")}`; };
const vbWord = id => VP.words.find(w=>w.id===id) || vbFind(id);

// Mastery: each graded answer updates the student's level for that word.
function vbRecord(wordId,correct){
  VP.results.push({wordId,correct});
  if(!correct) VP.missed.add(wordId);
  if(vbRole()!=="student") return;
  const w=vbWord(wordId); if(!w || w._fresh || w._seedFallback) return;
  api("vocab/mastery",{method:"POST",body:JSON.stringify({results:[{wordId,correct}]})})
    .then(rows=>(rows||[]).forEach(r=>VB.mastery[r.wordId]=r)).catch(()=>{});
}

function viewVocabPractice(){
  if(!VP){ go("vocab"); return; }
  crumbs([{label:"Vocabulary",onclick:"vbBackToBank()"},{label:VP.label}]);
  const modes=VP.locked?"":`<div class="vp-modes">${Object.entries(VP_MODES).map(([k,m])=>`<button class="${VP.mode===k?"on":""}" onclick="vbSwitchMode('${k}')">${svg(m.icon,"ic-sm")} ${m.label}</button>`).join("")}</div>`;
  let body;
  if(VP.done) body=vbResultHTML();
  else if(VP.mode==="flash") body=vbFlashHTML();
  else if(VP.mode==="match") body=vbMatchHTML();
  else body=vbQuestionHTML();
  $c().innerHTML=`<div class="vp fade">
    <div class="vp-top"><h2>${esc(VP.label)}</h2>${VP.task?`<span class="pill pill-sec">Task · pass ≥ ${VP.task.passingScore}%</span>`:""}
      <button class="btn btn-ghost btn-sm" onclick="vbBackToBank()">${svg("back","ic-sm")} Exit</button></div>
    ${modes}${body}</div>`;
  if(VP.mode==="match"&&!VP.done) vbStartTimer();
  document.getElementById("vpFlip")?.focus({preventScroll:true});
}
function vbBackToBank(){
  clearInterval(VP_TIMER); VP_TIMER=null;
  VB._fromPractice=!!VB.loaded && !(VP?.submitted);
  if(VP?.task) VB.tab="tasks";
  go("vocab");
}

// ── 1. 3D flashcards ──
function vbFlashHTML(){
  const total=VP.words.length, known=total-new Set(VP.queue).size;
  const w=vbWord(VP.queue[0]);
  const ctx=w.satContextSentence?esc(w.satContextSentence).replace(/_____/g,`<b>${esc(w.word)}</b>`):"";
  return `<div class="vp-hud">
      <div class="vp-stat"><span class="l">Mastered</span><span class="v">${known}/${total}</span></div>
      <div class="vp-stat"><span class="l">In queue</span><span class="v">${VP.queue.length}</span></div>
      <div class="vp-stat"><span class="l">Re-queued</span><span class="v">${VP.reviews}</span></div>
      <div class="q-progress" style="margin-left:.4rem"><i style="width:${Math.round(known/total*100)}%"></i></div></div>
    <div class="vp-flip ${VP.flipped?"flipped":""}" id="vpFlip" tabindex="0" onclick="vbFlip()" aria-label="Flashcard — press Space to flip">
      <div class="vp-flip-inner">
        <div class="vp-face front"><div class="big">${esc(w.word)}</div>${ctx?`<div class="ctx">${ctx}</div>`:""}<div class="hint">Click or press Space to flip</div></div>
        <div class="vp-face back"><div style="display:flex;gap:.5rem;align-items:center;margin-bottom:.7rem"><b style="font-family:var(--disp);font-size:1.3rem">${esc(w.word)}</b><span class="pos" style="font-family:var(--mono);font-size:.78rem;color:var(--ink3)">${esc(w.partOfSpeech)}</span>${vbDiffPill(w.difficulty)}</div>
          <div class="defn">${esc(w.definition)}</div>${vbUzHTML(w)}
          <div class="row"><div><div class="vb-sec" style="margin-top:0"><h4>Synonyms</h4><div class="vb-wordlist">${(w.synonyms||[]).map(s=>`<span>${esc(s)}</span>`).join("")||"—"}</div></div></div>
            <div><div class="vb-sec" style="margin-top:0"><h4>Antonyms</h4><div class="vb-wordlist ant">${(w.antonyms||[]).map(s=>`<span>${esc(s)}</span>`).join("")||"—"}</div></div></div></div></div>
      </div></div>
    <div class="vp-grade"><button class="no" ${VP.flipped?"":"disabled"} onclick="vbGrade(false)">${svg("back","ic-sm")} Still Learning</button>
      <button class="ok" ${VP.flipped?"":"disabled"} onclick="vbGrade(true)">Got It ${svg("check","ic-sm")}</button></div>
    <div class="vp-keys"><kbd>Space</kbd> flip · <kbd>→</kbd> / <kbd>1</kbd> got it · <kbd>←</kbd> / <kbd>2</kbd> still learning · missed cards come back until you know them</div>`;
}
function vbFlip(){ VP.flipped=!VP.flipped; document.getElementById("vpFlip")?.classList.toggle("flipped",VP.flipped); document.querySelectorAll(".vp-grade button").forEach(b=>b.disabled=!VP.flipped); }
function vbGrade(ok){
  if(!VP.flipped) return;
  const id=VP.queue.shift();
  if(!VP.firstPass.has(id)) VP.firstPass.set(id,ok);
  vbRecord(id,ok);
  if(!ok){ VP.queue.push(id); VP.reviews++; }
  VP.flipped=false;
  if(!VP.queue.length) return vbFinish([...VP.firstPass.values()].filter(Boolean).length/VP.words.length);
  viewVocabPractice();
}

// ── 2. speed matching ──
function vbMatchHTML(){
  const acc=VP.matches+VP.misses?Math.round(VP.matches/(VP.matches+VP.misses)*100):100;
  const total=VP.words.length;
  const tile=(t,side)=>{ const done=VP.matched.has(t.id); const sel=(side==="L"?VP.selL:VP.selR)===t.id;
    return `<button class="vp-tile ${side==="L"?"word":""} ${done?"ok":""} ${sel?"sel":""}" ${done?"disabled":""} data-side="${side}" data-id="${esc(t.id)}" onclick="vbPick('${side}',${vbJs(t.id)})">${esc(t.text)}</button>`; };
  return `<div class="vp-hud">
      <div class="vp-stat"><span class="l">Time</span><span class="v" id="vpTimer">${vbFmt(Date.now()-VP.startedAt)}</span></div>
      <div class="vp-stat"><span class="l">Matched</span><span class="v">${VP.matches}/${total}</span></div>
      <div class="vp-stat"><span class="l">Accuracy</span><span class="v">${acc}%</span></div>
      ${VP.rounds.length>1?`<div class="vp-stat"><span class="l">Round</span><span class="v">${VP.round+1}/${VP.rounds.length}</span></div>`:""}
      <span style="flex:1"></span>
      ${VP.locked?"":`<div class="vb-seg"><button class="${VP.pairKind==="definition"?"on":""}" onclick="VP.pairKind='definition';vbSetupMode();viewVocabPractice()">Definitions</button><button class="${VP.pairKind==="synonym"?"on":""}" onclick="VP.pairKind='synonym';vbSetupMode();viewVocabPractice()">Synonyms</button></div>`}</div>
    <div class="vp-match"><div class="vp-col">${VP.left.map(t=>tile(t,"L")).join("")}</div><div class="vp-col">${VP.right.map(t=>tile(t,"R")).join("")}</div></div>
    <div class="vp-keys">Pick a word, then its ${VP.pairKind==="synonym"?"synonym":"definition"}. Wrong pairs cost accuracy.</div>`;
}
function vbPick(side,id){
  if(VP.matched.has(id)) return;
  if(side==="L") VP.selL=VP.selL===id?null:id; else VP.selR=VP.selR===id?null:id;
  if(VP.selL && VP.selR){
    const l=VP.selL, r=VP.selR; VP.selL=VP.selR=null;
    if(l===r){
      VP.matched.add(l); VP.matches++; vbRecord(l,!VP.missed.has(l));
      if(VP.matched.size===VP.rounds[VP.round].length){
        if(VP.round<VP.rounds.length-1){ VP.round++; vbSetupRound(); toast(`Round ${VP.round} cleared!`); }
        else { clearInterval(VP_TIMER); VP.elapsed=Date.now()-VP.startedAt; return vbFinish(VP.matches/(VP.matches+VP.misses)); }
      }
    } else {
      VP.misses++; VP.missed.add(l);
      viewVocabPractice();
      document.querySelectorAll(`.vp-tile[data-side="L"][data-id="${CSS.escape(l)}"],.vp-tile[data-side="R"][data-id="${CSS.escape(r)}"]`).forEach(el=>el.classList.add("bad"));
      return;
    }
  }
  viewVocabPractice();
}

// ── 3 & 4. SAT context cloze + definition multiple choice ──
function vbLangBarHTML(){
  if(VP.mode!=="translate"||VP.locked) return "";
  const L=VB_LANGS[VP.lang].label;
  return `<div class="vp-hud" style="flex-wrap:wrap;gap:.5rem"><div class="vb-seg">${Object.entries(VB_LANGS).map(([k,v])=>`<button class="${VP.lang===k?"on":""}" onclick="vbSetLang('${k}')">${v.label} ↔ English</button>`).join("")}</div>
    <div class="vb-seg"><button class="${VP.dir==="en2x"?"on":""}" onclick="vbSetLang(null,'en2x')">English → ${L}</button><button class="${VP.dir==="x2en"?"on":""}" onclick="vbSetLang(null,'x2en')">${L} → English</button></div>
    ${VP.skipped?`<span class="umeta">${VP.skipped} word${VP.skipped===1?"":"s"} without a ${L} translation left out</span>`:""}</div>`;
}
function vbQuestionHTML(){
  if(VP.mode==="translate"&&!VP.items.length) return `${vbLangBarHTML()}<div class="empty"><p>None of these words has a ${VB_LANGS[VP.lang].label} translation with enough distinct answer options yet. Choose the other language or another word list.</p></div>`;
  const it=VP.items[VP.idx], w=vbWord(it.wordId), n=VP.items.length;
  const answered=it.chosen!=null, right=answered&&it.chosen===it.answer;
  const correct=VP.items.filter(i=>i.chosen!=null&&i.chosen===i.answer).length, done=VP.items.filter(i=>i.chosen!=null).length;
  const L="ABCD";
  const opts=`<div class="choices">${it.options.map((o,i)=>{
    let cls=""; if(answered){ if(i===it.answer) cls="right"; else if(i===it.chosen) cls="wrong"; }
    return `<button class="choice ${cls}" ${answered?"disabled":""} onclick="vbAnswer(${i})"><span class="ltr">${L[i]}</span><span class="ct">${esc(o)}</span></button>`; }).join("")}</div>`;
  let card;
  if(it.kind==="translate"){
    const L=VB_LANGS[it.lang];
    card=`<div class="vp-sat"><div class="vp-sat-bar"><span class="qn">${VP.idx+1}</span> ${it.dir==="en2x"?`English → ${L.label}`:`${L.label} → English`}<span class="sp">${VP.idx+1} of ${n}</span></div>
      <div class="vp-defprompt"><span class="k">${it.dir==="en2x"?`Choose the ${L.label} translation of`:"Choose the English word for"}</span><span ${it.dir==="x2en"?`lang="${L.lang}"`:""}>${esc(it.prompt)}</span></div>
      <div class="vp-sat-q">${opts}${answered?`<div class="vp-why ${right?"":"bad"}"><h4>${right?"Correct":`Answer: ${esc(it.options[it.answer])}`}</h4><p>“${esc(w.word)}” (${esc(w.partOfSpeech)}) — ${esc(w.definition)}</p>${vbUzHTML(w)}</div>`:""}</div></div>`;
  } else if(it.kind==="cloze"){
    card=`<div class="vp-sat"><div class="vp-sat-bar"><span class="qn">${VP.idx+1}</span> Reading and Writing · Words in Context<span class="sp">${VP.idx+1} of ${n}</span></div>
      <div class="vp-sat-body"><div class="vp-sat-pass">${answered?vbSentenceHTML(w,false):vbSentenceHTML(w,true)}</div>
        <div class="vp-sat-q"><p class="stem">Which choice completes the text with the most logical and precise word or phrase?</p>${opts}${answered?vbWhyHTML(it,w,right):""}</div></div></div>`;
  } else {
    const useSyn=VP.promptKind==="synonyms"&&(w.synonyms||[]).length;
    card=`<div class="vp-sat"><div class="vp-sat-bar"><span class="qn">${VP.idx+1}</span> Definition → Word<span class="sp">${VP.idx+1} of ${n}</span></div>
      <div class="vp-defprompt"><span class="k">${useSyn?"Which word is closest in meaning to these synonyms?":`Which ${esc(w.partOfSpeech)} matches this definition?`}</span>${useSyn?esc(w.synonyms.join(" · ")):esc(w.definition)}</div>
      <div class="vp-sat-q">${opts}${answered?vbWhyHTML(it,w,right):""}</div></div>`;
  }
  const showToggle=!VP.locked&&VP.mode==="define";
  return `${vbLangBarHTML()}<div class="vp-hud">
      <div class="vp-stat"><span class="l">Score</span><span class="v">${correct}/${done}</span></div>
      <div class="vp-stat"><span class="l">Question</span><span class="v">${VP.idx+1}/${n}</span></div>
      <div class="q-progress" style="margin-left:.4rem"><i style="width:${Math.round(done/n*100)}%"></i></div>
      ${showToggle?`<div class="vb-seg"><button class="${VP.promptKind==="definition"?"on":""}" onclick="VP.promptKind='definition';viewVocabPractice()">Definition</button><button class="${VP.promptKind==="synonyms"?"on":""}" onclick="VP.promptKind='synonyms';viewVocabPractice()">Synonyms</button></div>`:""}</div>
    ${card}
    <div class="vp-nav"><button class="btn btn-ghost btn-sm" ${VP.idx?"":"disabled"} onclick="vbNav(-1)">${svg("back","ic-sm")} Previous</button><span class="spacer"></span>
      ${answered?`<span class="feedback-tag ${right?"ok":"no"}">${svg(right?"check":"x","ic-sm")} ${right?"Correct":"Not quite"}</span>`:""}
      <button class="btn btn-primary btn-sm" ${answered?"":"disabled"} onclick="vbNav(1)">${VP.idx===n-1?"Finish":"Next"} ${svg("arr","ic-sm")}</button></div>
    <div class="vp-keys"><kbd>1</kbd>–<kbd>4</kbd> choose · <kbd>→</kbd> / <kbd>Space</kbd> / <kbd>Enter</kbd> next · <kbd>←</kbd> previous</div>`;
}
function vbWhyHTML(it,w,right){
  const lines=it.options.filter((_,i)=>i!==it.answer).map(o=>{
    const other=vbPool().find(x=>x.word.toLowerCase()===o.toLowerCase());
    const ant=(w.antonyms||[]).some(a=>a.toLowerCase()===o.toLowerCase());
    const meaning=other?other.definition:ant?`roughly the opposite of “${w.word}.”`:"an SAT-level word whose meaning does not fit this context.";
    return `<li><b>${esc(o)}</b>${other?` (${esc(other.partOfSpeech)})`:""} — ${esc(meaning)}${ant&&other?" (an antonym of the answer)":""}</li>`;
  }).join("");
  const why=it.kind==="cloze"
    ? `“${esc(w.word)}” means <i>${esc(w.definition.replace(/\.$/,""))}</i> — exactly what the sentence's logic calls for.`
    : `“${esc(w.word)}” (${esc(w.partOfSpeech)}) means <i>${esc(w.definition.replace(/\.$/,""))}</i>.`;
  return `<div class="vp-why ${right?"":"bad"}"><h4>${right?"Why it fits":`Answer: ${esc(w.word)}`}</h4><p>${why}</p><ul>${lines}</ul></div>`;
}
function vbAnswer(i){
  const it=VP.items[VP.idx]; if(it.chosen!=null) return;
  it.chosen=i; vbRecord(it.wordId,i===it.answer); viewVocabPractice();
}
function vbNav(d){
  const it=VP.items[VP.idx];
  if(d>0 && it.chosen==null) return;
  if(d>0 && VP.idx===VP.items.length-1){
    if(VP.items.every(i=>i.chosen!=null)) return vbFinish(VP.items.filter(i=>i.chosen===i.answer).length/VP.items.length);
    VP.idx=VP.items.findIndex(i=>i.chosen==null); return viewVocabPractice();
  }
  VP.idx=Math.max(0,Math.min(VP.items.length-1,VP.idx+d)); viewVocabPractice();
}

// ── results ──
async function vbFinish(ratio){
  VP.done=true; VP.score=Math.round((ratio||0)*100);
  clearInterval(VP_TIMER); VP_TIMER=null;
  VP.submitted=null;
  viewVocabPractice();
  if(VP.task && vbRole()==="student"){
    try{
      const r=await api(`vocab/tasks/${encodeURIComponent(VP.task.id)}/submit`,{method:"POST",body:JSON.stringify({score:VP.score,missedWordIds:[...VP.missed]})});
      VP.submitted=r;
      VB.tasks=await api("vocab/tasks").catch(()=>VB.tasks);
      if(r.passed) toast("Task completed!");
    }catch(e){ VP.submitted={error:e.message}; }
    if(state.view==="vocabpractice") viewVocabPractice();
  }
}
function vbResultHTML(){
  const task=VP.task, pass=task?VP.score>=task.passingScore:VP.score>=70;
  const missed=[...VP.missed].map(vbWord).filter(Boolean);
  const extra=VP.mode==="match"?` · ${vbFmt(VP.elapsed||0)} · ${VP.misses} wrong pair${VP.misses===1?"":"s"}`:VP.mode==="flash"?` · first-try recall · ${VP.reviews} card${VP.reviews===1?"":"s"} re-queued`:"";
  let verdict;
  if(task && vbRole()==="student"){
    verdict = VP.submitted==null ? "Saving your result…"
      : VP.submitted.error ? `Couldn't save your result: ${esc(VP.submitted.error)}`
      : VP.submitted.passed ? `Passed — task marked Completed (needed ${task.passingScore}%).`
      : VP.submitted.status==="Completed" ? `Below ${task.passingScore}% this time, but the task is already completed.`
      : `You need ${task.passingScore}% to complete this task. Review the missed words and try again.`;
  } else verdict = task ? `Preview — students need ${task.passingScore}% to pass.` : pass?"Strong work!":"Keep drilling — missed words are listed below.";
  return `<div class="vp-result"><div class="umeta" style="text-transform:uppercase;letter-spacing:.1em;font-size:.7rem;color:var(--ink3)">${esc(VP_MODES[VP.mode].label)}${extra}</div>
    <div class="score ${pass?"pass":"fail"}">${VP.score}%</div><div class="verdict">${verdict}</div>
    <div class="vb-actions" style="justify-content:center"><button class="btn btn-primary btn-sm" onclick="vbSetupMode();viewVocabPractice()">${svg("shuffle","ic-sm")} Try again</button>
      ${missed.length&&!VP.locked?`<button class="btn btn-ghost btn-sm" onclick="vbStartPractice(${vbJs([...VP.missed])}.map(vbWord),'flash',{label:'Missed words'})">${svg("layers","ic-sm")} Flashcards for missed words</button>`:""}
      <button class="btn btn-ghost btn-sm" onclick="vbBackToBank()">${svg("back","ic-sm")} ${task?"Back to tasks":"Back to bank"}</button></div>
    ${missed.length?`<div class="missed"><h4 style="font-size:.7rem;letter-spacing:.1em;text-transform:uppercase;color:var(--ink3)">Missed words (${missed.length})</h4>${missed.map(w=>`<div><b>${esc(w.word)}</b> <span class="pos" style="font-family:var(--mono);font-size:.72rem;color:var(--ink3)">${esc(w.partOfSpeech)}</span> — ${esc(w.definition)}</div>`).join("")}</div>`:""}
  </div>`;
}

// ── keyboard shortcuts ──
document.addEventListener("keydown",e=>{
  if(e.key==="Escape" && document.getElementById("vbDrawerBack")){ vbCloseDrawer(); return; }
  if(typeof state==="undefined"||state.view!=="vocabpractice"||!VP||VP.done) return;
  if(e.target.closest?.("input,textarea,select,[contenteditable]")||e.metaKey||e.ctrlKey||e.altKey) return;
  if(document.getElementById("vbDrawerBack")) return;
  const k=e.key;
  if(VP.mode==="flash"){
    if(k===" "||k==="Spacebar"){ e.preventDefault(); vbFlip(); }
    else if((k==="ArrowRight"||k==="1")&&VP.flipped){ e.preventDefault(); vbGrade(true); }
    else if((k==="ArrowLeft"||k==="2")&&VP.flipped){ e.preventDefault(); vbGrade(false); }
  } else if(VP.mode!=="match"){
    const it=VP.items[VP.idx];
    if(/^[1-4]$/.test(k) && it.chosen==null && Number(k)<=it.options.length){ e.preventDefault(); vbAnswer(Number(k)-1); }
    else if(k==="ArrowRight"||k==="Enter"||k===" "){ if(it.chosen!=null){ e.preventDefault(); vbNav(1); } }
    else if(k==="ArrowLeft"){ e.preventDefault(); vbNav(-1); }
  }
});
