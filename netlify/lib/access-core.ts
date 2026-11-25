// netlify/lib/access-core.ts — pure subject-access rules (no database, no
// imports) so the resolution logic is shared by the API and the unit tests.
//
// Every student has two subject master switches (SAT Math, SAT English —
// Reading & Writing) and, under each, separate switches for the practice areas.
// A subject switched off disables all of its areas but keeps their individual
// values, so switching it back on restores the previous choices.

export const SUBJECTS = ["math", "ebrw"] as const;
export const AREAS = ["bank", "challenge", "lessons", "rush"] as const;
export type Subject = (typeof SUBJECTS)[number];
export type Area = (typeof AREAS)[number];
export type SubjectRules = { enabled: boolean } & Record<Area, boolean>;
export type Rules = Record<Subject, SubjectRules>;
export type Preset = "english" | "math" | "both" | "custom";

export const FULL_ACCESS: Rules = Object.freeze({
  math: Object.freeze({ enabled: true, bank: true, challenge: true, lessons: true, rush: true }),
  ebrw: Object.freeze({ enabled: true, bank: true, challenge: true, lessons: true, rush: true }),
}) as Rules;

const bool = (v: unknown, d: boolean) => (typeof v === "boolean" ? v : d);

// Fill in any missing switch (missing = on, the behaviour before this feature).
export function normalizeRules(raw: unknown, base: Rules = FULL_ACCESS): Rules {
  const src = raw && typeof raw === "object" ? (raw as Record<string, any>) : {};
  const out = {} as Rules;
  for (const s of SUBJECTS) {
    const r = src[s] && typeof src[s] === "object" ? src[s] : {};
    out[s] = { enabled: bool(r.enabled, base[s].enabled) } as SubjectRules;
    for (const a of AREAS) out[s][a] = bool(r[a], base[s][a]);
  }
  return out;
}

// Class presets only flip the master switches; area choices stay on.
export function presetRules(preset: Preset, custom?: unknown): Rules {
  if (preset === "english") return normalizeRules({ math: { enabled: false } });
  if (preset === "math") return normalizeRules({ ebrw: { enabled: false } });
  if (preset === "both") return normalizeRules({});
  return normalizeRules(custom);
}
export function isPreset(v: unknown): v is Preset {
  return v === "english" || v === "math" || v === "both" || v === "custom";
}

// Compares what a student can actually open (areas under a switched-off
// subject count as off), so two settings with the same effect never conflict.
export function rulesKey(r: Rules) {
  return SUBJECTS.map((s) => [s, r[s].enabled ? 1 : 0, ...AREAS.map((a) => (r[s].enabled && r[s][a] ? 1 : 0))].join("")).join("|");
}
export function sameRules(a: Rules, b: Rules) { return rulesKey(a) === rulesKey(b); }

export type ClassRule = { classId: number; name?: string; preset: Preset; rules: Rules };
export type Resolution = {
  rules: Rules;
  source: "user" | "class" | "default" | "conflict";
  classIds: number[];
  conflict: null | { classes: { classId: number; name?: string; preset: Preset }[]; keptFrom: "snapshot" | "default" };
};

// Precedence: individual override → class settings (when every class with
// settings agrees) → full access. Conflicting classes without an override keep
// the student's last conflict-free access (the snapshot) until an admin resolves it.
export function resolveAccess(input: { user: Rules | null; classes: ClassRule[]; snapshot: Rules | null }): Resolution {
  if (input.user) return { rules: normalizeRules(input.user), source: "user", classIds: [], conflict: null };
  const classes = input.classes.map((c) => ({ ...c, rules: normalizeRules(c.rules) }));
  if (!classes.length) return { rules: normalizeRules({}), source: "default", classIds: [], conflict: null };
  const keys = new Set(classes.map((c) => rulesKey(c.rules)));
  if (keys.size === 1) return { rules: classes[0].rules, source: "class", classIds: classes.map((c) => c.classId), conflict: null };
  return {
    rules: input.snapshot ? normalizeRules(input.snapshot) : normalizeRules({}),
    source: "conflict",
    classIds: classes.map((c) => c.classId),
    conflict: { classes: classes.map((c) => ({ classId: c.classId, name: c.name, preset: c.preset })), keptFrom: input.snapshot ? "snapshot" : "default" },
  };
}

// Is one practice area of one subject open?
export function allows(rules: Rules, subject: string, area: Area | "any"): boolean {
  if (subject !== "math" && subject !== "ebrw") return false;
  const s = rules[subject];
  if (!s.enabled) return false;
  return area === "any" ? true : s[area];
}
export function allowedSubjects(rules: Rules, area: Area | "any"): string[] {
  return SUBJECTS.filter((s) => allows(rules, s, area));
}
// The Reading Library follows the English master switch.
export function libraryAllowed(rules: Rules) { return rules.ebrw.enabled; }
// Saved / missed review and class tasks replay questions of a subject only
// while that subject is switched on.
export function subjectOpen(rules: Rules, subject: string) { return allows(rules, subject, "any"); }

export function describePreset(rules: Rules): Preset {
  const k = rulesKey(rules);
  if (k === rulesKey(presetRules("both"))) return "both";
  if (k === rulesKey(presetRules("english"))) return "english";
  if (k === rulesKey(presetRules("math"))) return "math";
  return "custom";
}
