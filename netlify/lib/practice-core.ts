// netlify/lib/practice-core.ts — pure practice filter logic (no imports), shared
// by the API and the unit tests.
//
// Filters: subject, difficulty, domain, topic/skill and (Question Bank only)
// answer status. Several values inside one category are OR-ed; categories are
// AND-ed. An empty category does not narrow the pool. Subjects are always
// limited to the ones the student may open, so a filter can never reach a
// switched-off subject.

export type Band = "easy" | "medium" | "hard";
export type Status = "incorrect" | "unanswered";
export type PracticeFilters = { subjects: string[]; difficulties: Band[]; domains: string[]; skills: string[]; status: Status[] };
export type PoolItem = { id: number; section: string; category: string; subcategory: string; difficulty: number };

const BANDS: Band[] = ["easy", "medium", "hard"];
const STATUSES: Status[] = ["incorrect", "unanswered"];

export function difficultyBand(d: number): Band {
  return d <= 2 ? "easy" : d === 3 ? "medium" : "hard";
}

const list = (v: unknown, max = 40): string[] => {
  const raw = Array.isArray(v) ? v : typeof v === "string" ? v.split(",") : [];
  return [...new Set(raw.map((x) => String(x ?? "").trim().slice(0, 160)).filter(Boolean))].slice(0, max);
};

export function normalizeFilters(raw: unknown): PracticeFilters {
  const r = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  return {
    subjects: list(r.subjects).filter((s) => s === "math" || s === "ebrw"),
    difficulties: list(r.difficulties).map((s) => s.toLowerCase()).filter((s): s is Band => BANDS.includes(s as Band)),
    domains: list(r.domains),
    skills: list(r.skills, 80),
    status: list(r.status).filter((s): s is Status => STATUSES.includes(s as Status)),
  };
}

// Read filters from URL search params (?subjects=math,ebrw&difficulties=hard…).
export function filtersFromParams(p: URLSearchParams): PracticeFilters {
  const get = (k: string) => p.getAll(k).flatMap((v) => v.split(","));
  return normalizeFilters({ subjects: get("subjects"), difficulties: get("difficulties"), domains: get("domains"), skills: get("skills"), status: get("status") });
}

// The subjects a filter may actually reach.
export function effectiveSubjects(f: PracticeFilters, allowed: string[]) {
  return f.subjects.length ? f.subjects.filter((s) => allowed.includes(s)) : [...allowed];
}

// statusOf: the student's latest result per question ("correct" | "incorrect");
// a question absent from the map is unanswered.
export function matchesFilter(q: PoolItem, f: PracticeFilters, allowed: string[], statusOf?: Map<number, "correct" | "incorrect">) {
  const subjects = effectiveSubjects(f, allowed);
  if (!subjects.includes(q.section)) return false;
  if (f.difficulties.length && !f.difficulties.includes(difficultyBand(q.difficulty))) return false;
  if (f.domains.length && !f.domains.includes(q.category)) return false;
  if (f.skills.length && !f.skills.includes(q.subcategory)) return false;
  if (f.status.length) {
    const s = statusOf?.get(q.id);
    const st: Status | "correct" = s === undefined ? "unanswered" : s;
    if (!f.status.includes(st as Status)) return false;
  }
  return true;
}

export function filterPool<T extends PoolItem>(items: T[], f: PracticeFilters, allowed: string[], statusOf?: Map<number, "correct" | "incorrect">) {
  return items.filter((q) => matchesFilter(q, f, allowed, statusOf));
}

export function hasFilters(f: PracticeFilters) {
  return !!(f.subjects.length || f.difficulties.length || f.domains.length || f.skills.length || f.status.length);
}

// Stable order for a practice set: domain order, then skill order, difficulty, id.
export function stableOrder<T extends PoolItem>(items: T[], domainOrder: string[], skillOrder: Record<string, string[]>) {
  const di = (d: string) => { const i = domainOrder.indexOf(d); return i < 0 ? 99 : i; };
  const si = (d: string, s: string) => { const i = (skillOrder[d] || []).indexOf(s); return i < 0 ? 99 : i; };
  return [...items].sort((a, b) => di(a.category) - di(b.category) || si(a.category, a.subcategory) - si(b.category, b.subcategory) || a.difficulty - b.difficulty || a.id - b.id);
}

// Deterministic shuffle so a session's order can be reproduced from its seed.
export function seededShuffle<T>(items: T[], seed: number) {
  const out = [...items];
  let s = seed >>> 0 || 1;
  for (let i = out.length - 1; i > 0; i--) {
    s = (s * 1664525 + 1013904223) >>> 0;
    const j = s % (i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

// ── Session answer bookkeeping ──
// answers[qid] = { selected, seq, submitted, correct, attemptId, at }
export type AnswerEntry = { selected?: string; seq?: number; submitted?: boolean; correct?: boolean; attemptId?: number; answer?: string; at?: string };

// A selection update is applied only if it is newer than the stored one and
// the question has not been submitted (a submitted answer is final).
export function applySelection(cur: AnswerEntry | undefined, value: string, seq: number): AnswerEntry | null {
  if (cur?.submitted) return null;
  if (cur?.seq !== undefined && seq <= cur.seq) return null;
  return { ...(cur || {}), selected: value, seq };
}

// The first submission of a question is the only one that is graded and
// counted. A repeat (revisit, retry after a timeout, second tab) gets the
// stored result back and never creates a second attempt.
export function shouldGrade(cur: AnswerEntry | undefined) {
  return !cur?.submitted;
}
