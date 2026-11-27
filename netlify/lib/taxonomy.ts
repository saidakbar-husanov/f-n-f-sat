// netlify/lib/taxonomy.ts — the platform's SAT taxonomy and the confirmed
// legacy aliases that map older spellings onto it. Pure (no imports), shared
// by the practice filters (count and practice set use the same canonical
// values), the question importers and the unit tests.

export const TAXONOMY_DOMAINS: Record<"math" | "ebrw", string[]> = {
  math: ["Algebra", "Advanced Math", "Problem Solving and Data Analysis", "Geometry and Trigonometry"],
  ebrw: ["Information and Ideas", "Craft and Structure", "Expression of Ideas", "Standard English Conventions"],
};

export const TAXONOMY_SKILLS: Record<string, string[]> = {
  "Craft and Structure": ["Cross-text connection", "Text structure and purpose", "Words in context"],
  "Expression of Ideas": ["Rhetorical synthesis", "Transitions"],
  "Information and Ideas": ["Central ideas and details", "Command of evidence", "Inferences"],
  "Standard English Conventions": ["Boundaries", "Form, structure, and sense"],
  "Algebra": ["Linear equations in one variable", "Linear functions", "Linear equations in two variables", "Systems of two linear equations in two variables", "Linear inequalities in one or two variables"],
  "Advanced Math": ["Equivalent expressions", "Nonlinear equations in one variable and systems of equations in two variables", "Nonlinear functions"],
  "Problem Solving and Data Analysis": ["Ratios, rates, proportional relationships, and units", "Percentages", "One-variable data: Distributions and measures of center and spread", "Two-variable data: Models and scatterplots", "Probability and conditional probability", "Inference from sample statistics and margin of error", "Evaluating statistical claims: Observational studies and experiments"],
  "Geometry and Trigonometry": ["Area and volume", "Lines, angles, and triangles", "Right triangles and trigonometry", "Circles"],
};

// Comparison key: case, punctuation and spacing never decide a match.
export const tagKey = (v: unknown) => String(v ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

// Confirmed legacy spellings (found in stored full-test, challenge and older
// bank records) → the canonical name. Keys are tagKey() values.
export const DOMAIN_ALIASES: Record<string, string> = {
  "problem solving and data analysis": "Problem Solving and Data Analysis", // "Problem-Solving and Data Analysis"
  "psda": "Problem Solving and Data Analysis",
  "sec": "Standard English Conventions",
  "standard english": "Standard English Conventions",
  "conventions": "Standard English Conventions",
  "geometry and trig": "Geometry and Trigonometry",
  "geometry": "Geometry and Trigonometry",
};
export const SKILL_ALIASES: Record<string, Record<string, string>> = {
  "Craft and Structure": {
    "cross text connections": "Cross-text connection",
    "words in context": "Words in context",
  },
  "Information and Ideas": {
    "command of evidence textual": "Command of evidence",
    "command of evidence quantitative": "Command of evidence",
    "central idea and details": "Central ideas and details",
    "inference": "Inferences",
  },
  "Standard English Conventions": {
    "sentence boundaries": "Boundaries",
    "boundary": "Boundaries",
    "form structure sense": "Form, structure, and sense",
  },
  "Advanced Math": {
    "nonlinear equations in one variable": "Nonlinear equations in one variable and systems of equations in two variables",
    "systems of equations in two variables": "Nonlinear equations in one variable and systems of equations in two variables",
    "nonlinear equations and systems": "Nonlinear equations in one variable and systems of equations in two variables",
  },
  "Algebra": {
    "systems of linear equations": "Systems of two linear equations in two variables",
    "linear inequalities": "Linear inequalities in one or two variables",
  },
  "Problem Solving and Data Analysis": {
    "ratios rates proportional relationships and units": "Ratios, rates, proportional relationships, and units",
    "percentage": "Percentages",
    "probability": "Probability and conditional probability",
  },
};
// Known-ambiguous legacy tags: they span several skills, so they are flagged
// for correction rather than mapped silently.
export const AMBIGUOUS_SKILLS = new Set(["linear equations and functions", "nonlinear equations and functions", "quantitative reasoning", "geometry and trigonometry"]);

export type TagResolution = { value: string | null; via: "exact" | "alias" | null; ambiguous?: boolean };

export function resolveDomain(section: string | null | undefined, v: unknown): TagResolution {
  const k = tagKey(v);
  if (!k) return { value: null, via: null };
  const sections: ("math" | "ebrw")[] = section === "math" || section === "ebrw" ? [section] : ["math", "ebrw"];
  for (const s of sections) {
    const hit = TAXONOMY_DOMAINS[s].find((d) => tagKey(d) === k);
    if (hit) return { value: hit, via: "exact" };
  }
  const alias = DOMAIN_ALIASES[k];
  if (alias && sections.some((s) => TAXONOMY_DOMAINS[s].includes(alias))) return { value: alias, via: "alias" };
  return { value: null, via: null };
}

export function resolveSkill(domain: string | null | undefined, v: unknown): TagResolution {
  const k = tagKey(v);
  if (!k || !domain) return { value: null, via: null };
  const hit = (TAXONOMY_SKILLS[domain] || []).find((s) => tagKey(s) === k);
  if (hit) return { value: hit, via: "exact" };
  const alias = SKILL_ALIASES[domain]?.[k];
  if (alias) return { value: alias, via: "alias" };
  return { value: null, via: null, ambiguous: AMBIGUOUS_SKILLS.has(k) };
}

export const sectionOfDomainName = (domain: string) =>
  (Object.keys(TAXONOMY_DOMAINS) as ("math" | "ebrw")[]).find((s) => TAXONOMY_DOMAINS[s].includes(domain)) ?? null;

// Canonical (category, subcategory) for a stored record — unknown values are
// kept as they are, so nothing is hidden, only legacy spellings are unified.
export function canonicalTags(section: string, category: string, subcategory: string) {
  const d = resolveDomain(section, category).value ?? category;
  const s = subcategory ? resolveSkill(d, subcategory).value ?? subcategory : "";
  return { category: d, subcategory: s };
}

// ───────────── importer checks (pure; used by netlify/lib/collections.ts) ─────────────

export type SectionId = "math" | "ebrw";
export type Difficulty = "Easy" | "Medium" | "Hard";
export const SECTION_NAMES: Record<SectionId, string> = { math: "Math", ebrw: "Reading and Writing" };

// Strict difficulty: Easy / Medium / Hard (any case) or the legacy 1–5 scale.
export function strictDifficulty(v: unknown): Difficulty | null | "invalid" {
  const t = String(v ?? "").trim().toLowerCase();
  if (!t) return null;
  if (t === "easy" || t === "1" || t === "2") return "Easy";
  if (t === "medium" || t === "3") return "Medium";
  if (t === "hard" || t === "4" || t === "5") return "Hard";
  return "invalid";
}

// A question's own "section": the ids "math" / "ebrw", or the platform's
// labels "Math" / "Reading and Writing".
export function resolveSection(v: unknown): { value: SectionId | null; via: "exact" | "alias" | null } {
  const k = tagKey(v);
  if (k === "math" || k === "ebrw") return { value: k, via: "exact" };
  if (k === tagKey(SECTION_NAMES.ebrw)) return { value: "ebrw", via: "alias" };
  return { value: null, via: null };
}

// Every domain in which a tag resolves to a skill (exactly or by alias).
export const domainsOfSkill = (v: unknown) => Object.keys(TAXONOMY_SKILLS).filter((d) => resolveSkill(d, v).value);

// Closest skill of a domain by shared words — only offered as a suggestion,
// never applied.
export function suggestSkill(domain: string, v: unknown): string | null {
  const words = new Set(tagKey(v).split(" ").filter((w) => w.length > 2 && w !== "and"));
  if (!words.size) return null;
  let best: string | null = null, score = 0;
  for (const s of TAXONOMY_SKILLS[domain] || []) {
    const sw = new Set(tagKey(s).split(" ").filter((w) => w.length > 2 && w !== "and"));
    const common = [...words].filter((w) => sw.has(w) || sw.has(w.replace(/s$/, "")) || sw.has(`${w}s`)).length;
    const j = common / (words.size + sw.size - common);
    if (j > score) { score = j; best = s; }
  }
  return score >= 0.34 ? best : null;
}

export type TagField = "section" | "domain" | "skill" | "difficulty";
export type TagProblem = "unknown" | "incompatible" | "ambiguous" | "mismatch" | "invalid" | "missing";
export interface TagFlag { questionId: string; field: TagField; value: string; problem: TagProblem; message: string; suggestion?: string }
export interface TagNotice { questionId: string; field: TagField; from: string; to: string; via: "exact" | "alias"; message: string }
export interface TagInput {
  questionId: string;
  destination: { type: "questionBankDomain" | "challengeSet"; section: SectionId; domain?: string | null };
  // Raw values, already in precedence order (preview correction > question).
  section?: unknown; domain?: unknown; skill?: unknown; difficulty?: unknown;
  // Batch defaults chosen on the page (already canonical).
  defaultSkill?: string | null; defaultDifficulty?: Difficulty | null;
}
export interface TagResult { domain: string | null; skill: string | null; difficulty: Difficulty | null; flags: TagFlag[]; notices: TagNotice[] }

const present = (v: unknown) => v !== undefined && v !== null && String(v).trim() !== "";
const raw = (v: unknown) => (present(v) ? String(v).trim().slice(0, 200) : "");
const listOf = (xs: string[]) => xs.map((x) => `"${x}"`).join(", ");

/**
 * Check one question's section / domain / skill / difficulty against the
 * destination. Confirmed legacy spellings are mapped (and reported as
 * notices); everything that cannot be mapped safely is flagged by field.
 * A question with any flag must not be saved.
 */
export function checkQuestionTags(input: TagInput): TagResult {
  const { questionId, destination: dest } = input;
  const sec = dest.section;
  const flags: TagFlag[] = [];
  const notices: TagNotice[] = [];
  const flag = (field: TagField, value: string, problem: TagProblem, message: string, suggestion?: string) =>
    flags.push({ questionId, field, value, problem, message, ...(suggestion ? { suggestion } : {}) });
  const note = (field: TagField, from: string, to: string, via: "exact" | "alias") => {
    if (from !== to) notices.push({ questionId, field, from, to, via, message: `${questionId} · ${field}: "${from}" → "${to}"` });
  };

  // ── section ──
  const rawSec = raw(input.section);
  if (rawSec) {
    const r = resolveSection(rawSec);
    if (!r.value) flag("section", rawSec, "unknown", `"${rawSec}" is not a section`, `use "${sec}" (${SECTION_NAMES[sec]})`);
    else if (r.value !== sec) flag("section", rawSec, "mismatch", `"${rawSec}" does not match the file's destination section "${sec}" (${SECTION_NAMES[sec]})`, `move the question to a ${SECTION_NAMES[r.value]} file, or set "section" to "${sec}"`);
    else note("section", rawSec, r.value, r.via!);
  }

  // ── domain ──
  const secDomains = TAXONOMY_DOMAINS[sec];
  const otherSectionDomain = (v: string) => {
    const d = resolveDomain(null, v).value;
    return d && sectionOfDomainName(d) !== sec ? d : null;
  };
  const rawDom = raw(input.domain);
  let domain: string | null = null;
  if (dest.type === "questionBankDomain") {
    domain = dest.domain ?? null;
    if (rawDom) {
      const r = resolveDomain(sec, rawDom);
      if (r.value && r.value === domain) note("domain", rawDom, r.value, r.via!);
      else if (r.value) flag("domain", rawDom, "mismatch", `"${rawDom}" does not match the file's destination domain "${domain}"`, `move the question to a ${r.value} file, or remove its "domain"`);
      else {
        const other = otherSectionDomain(rawDom);
        if (other) flag("domain", rawDom, "mismatch", `"${rawDom}" is a ${SECTION_NAMES[sectionOfDomainName(other)!]} domain, not ${SECTION_NAMES[sec]}`, `move the question to a ${other} file, or remove its "domain"`);
        else flag("domain", rawDom, "unknown", `"${rawDom}" is not a SAT domain`, `use "${domain}" or remove the field`);
      }
    }
  } else if (!rawDom) {
    flag("domain", "", "missing", "is missing — Challenging Questions keep each question's domain", `use one of: ${listOf(secDomains)}`);
  } else {
    const r = resolveDomain(sec, rawDom);
    if (r.value) { domain = r.value; note("domain", rawDom, r.value, r.via!); }
    else {
      const other = otherSectionDomain(rawDom);
      if (other) flag("domain", rawDom, "mismatch", `"${rawDom}" is a ${SECTION_NAMES[sectionOfDomainName(other)!]} domain, not a ${SECTION_NAMES[sec]} domain`, `use one of: ${listOf(secDomains)}`);
      else flag("domain", rawDom, "unknown", `"${rawDom}" is not a ${SECTION_NAMES[sec]} domain`, `use one of: ${listOf(secDomains)}`);
    }
  }

  // ── skill ──
  const rawSkill = raw(input.skill);
  let skill: string | null = null;
  if (rawSkill) {
    if (domain) {
      const skills = TAXONOMY_SKILLS[domain] || [];
      const r = resolveSkill(domain, rawSkill);
      if (r.value) { skill = r.value; note("skill", rawSkill, r.value, r.via!); }
      else if (r.ambiguous) flag("skill", rawSkill, "ambiguous", `"${rawSkill}" is a legacy tag that spans several skills, so it is not mapped automatically`, `choose one of: ${listOf(skills)}`);
      else {
        const homes = domainsOfSkill(rawSkill);
        if (homes.length) {
          const home = homes[0];
          const sameSection = sectionOfDomainName(home) === sec;
          flag("skill", rawSkill, "incompatible", `"${rawSkill}" is a skill of ${home}, not of ${domain}`,
            dest.type === "challengeSet" && sameSection
              ? `set the question's domain to "${home}", or choose one of: ${listOf(skills)}`
              : `choose one of: ${listOf(skills)}${dest.type === "questionBankDomain" ? `, or move the question to a ${home} file` : ""}`);
        } else {
          const guess = suggestSkill(domain, rawSkill);
          flag("skill", rawSkill, "unknown", `"${rawSkill}" is not a ${domain} skill`, guess ? `did you mean "${guess}"? Otherwise use one of: ${listOf(skills)}` : `use one of: ${listOf(skills)}`);
        }
      }
    } else if (AMBIGUOUS_SKILLS.has(tagKey(rawSkill))) {
      flag("skill", rawSkill, "ambiguous", `"${rawSkill}" is a legacy tag that spans several skills, so it is not mapped automatically`, "fix the domain, then choose one of its skills");
    } else if (!domainsOfSkill(rawSkill).length) {
      flag("skill", rawSkill, "unknown", `"${rawSkill}" is not a SAT skill`, "fix the domain, then choose one of its skills");
    }
  } else if (domain) {
    const def = input.defaultSkill ? resolveSkill(domain, input.defaultSkill).value : null;
    if (def) skill = def;
    else flag("skill", "", "missing", "is missing — set \"skill\" on the question or choose a default skill for the batch", `use one of: ${listOf(TAXONOMY_SKILLS[domain] || [])}`);
  }

  // ── difficulty ──
  const rawDiff = raw(input.difficulty);
  let difficulty: Difficulty | null = null;
  if (rawDiff) {
    const d = strictDifficulty(rawDiff);
    if (d === "invalid") flag("difficulty", rawDiff, "invalid", `"${rawDiff.slice(0, 40)}" must be Easy, Medium or Hard`, "use Easy, Medium or Hard (or the legacy 1–5 scale)");
    else if (d) { difficulty = d; note("difficulty", rawDiff, d, d.toLowerCase() === rawDiff.toLowerCase() ? "exact" : "alias"); }
  } else if (input.defaultDifficulty) difficulty = input.defaultDifficulty;
  else flag("difficulty", "", "missing", "is missing — set \"difficulty\" on the question or choose a batch difficulty", "use Easy, Medium or Hard");

  return { domain, skill, difficulty, flags, notices };
}

// ───────────── preview summary: subject → domain → skill ─────────────

export type ItemStatus = "new" | "changed" | "unchanged";
export interface GroupCounts { total: number; new: number; changed: number; unchanged: number; invalid: number }
export interface SkillGroup extends GroupCounts { skill: string; known: boolean }
export interface DomainGroup extends GroupCounts { domain: string; known: boolean; skills: SkillGroup[] }
export interface SubjectGroup extends GroupCounts { section: string; label: string; domains: DomainGroup[] }
export interface GroupItem { section: string; domain: string; skill: string; status: ItemStatus; valid: boolean }

const zero = (): GroupCounts => ({ total: 0, new: 0, changed: 0, unchanged: 0, invalid: 0 });
const bump = (g: GroupCounts, it: GroupItem) => { g.total += 1; g[it.status] += 1; if (!it.valid) g.invalid += 1; };
const order = (list: string[], v: string) => { const i = list.indexOf(v); return i < 0 ? list.length : i; };

/**
 * Nested counts for the preview, in taxonomy order (subjects, then domains,
 * then skills); tags outside the taxonomy sort last and are marked unknown.
 * Status counts include invalid questions; `invalid` says how many of them
 * would be blocked.
 */
export function groupBySubject(items: GroupItem[]): SubjectGroup[] {
  const subjects = new Map<string, SubjectGroup>();
  for (const it of items) {
    let s = subjects.get(it.section);
    if (!s) subjects.set(it.section, s = { section: it.section, label: SECTION_NAMES[it.section as SectionId] ?? it.section, ...zero(), domains: [] });
    bump(s, it);
    const domName = it.domain || "(no domain)";
    let d = s.domains.find((x) => x.domain === domName);
    if (!d) s.domains.push(d = { domain: domName, known: !!TAXONOMY_SKILLS[domName], ...zero(), skills: [] });
    bump(d, it);
    const skName = it.skill || "(no skill)";
    let k = d.skills.find((x) => x.skill === skName);
    if (!k) d.skills.push(k = { skill: skName, known: (TAXONOMY_SKILLS[domName] || []).includes(skName), ...zero() });
    bump(k, it);
  }
  const secOrder = Object.keys(TAXONOMY_DOMAINS);
  const out = [...subjects.values()].sort((a, b) => order(secOrder, a.section) - order(secOrder, b.section) || a.section.localeCompare(b.section));
  for (const s of out) {
    const doms = TAXONOMY_DOMAINS[s.section as SectionId] || [];
    s.domains.sort((a, b) => order(doms, a.domain) - order(doms, b.domain) || a.domain.localeCompare(b.domain));
    for (const d of s.domains) {
      const sks = TAXONOMY_SKILLS[d.domain] || [];
      d.skills.sort((a, b) => order(sks, a.skill) - order(sks, b.skill) || a.skill.localeCompare(b.skill));
    }
  }
  return out;
}
