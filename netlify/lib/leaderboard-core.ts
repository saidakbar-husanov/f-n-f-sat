// netlify/lib/leaderboard-core.ts — pure leaderboard privacy and ranking
// (no imports), shared by the API and the unit tests.
//
// Visibility is applied before ranking, counting, searching, paginating or
// exporting: a viewer who is not the verified super admin never receives a
// hidden entry, and ranks are computed as if hidden entries did not exist.
// The super admin receives the complete board with hidden entries marked.

export type ScoreRow = { studentId: number; value: number; extra: Record<string, number>; sort: number[] };
export type Person = { id: number; username: string | null; visible: boolean };
export type Entry = Omit<ScoreRow, "sort"> & { rank: number; username: string; hidden: boolean };

// Never fall back to a real name or email: a missing username shows a neutral handle.
export function displayHandle(p: Pick<Person, "id" | "username">) {
  return p.username && p.username.trim() ? p.username : `learner-${(p.id * 2654435761 >>> 0).toString(36)}`;
}

export function rankRows<T extends { sort: number[] }>(rows: T[]) {
  const sorted = [...rows].sort((a, b) => { for (let i = 0; i < a.sort.length; i++) if (b.sort[i] !== a.sort[i]) return b.sort[i] - a.sort[i]; return 0; });
  let rank = 0;
  return sorted.map((r, i) => {
    if (i === 0 || r.sort.some((v, k) => v !== sorted[i - 1].sort[k])) rank = i + 1;
    return { ...r, rank };
  });
}

export function buildBoard(scores: ScoreRow[], people: Person[], opts: { superAdmin: boolean; search?: string; page?: number; pageSize?: number; limit?: number }) {
  const byId = new Map(people.map((p) => [p.id, p]));
  // 1. Visibility first.
  const eligible = scores.filter((s) => { const p = byId.get(s.studentId); return !!p && (opts.superAdmin || p.visible); });
  // 2. Rank only what this viewer may see.
  const ranked = rankRows(eligible).slice(0, opts.limit ?? 500).map(({ sort, ...r }) => {
    const p = byId.get(r.studentId)!;
    return { ...r, username: displayHandle(p), hidden: !p.visible } as Entry;
  });
  // 3. Search and paginate the visible, ranked list.
  const q = (opts.search || "").trim().toLowerCase();
  const matched = q ? ranked.filter((r) => r.username.toLowerCase().includes(q)) : ranked;
  const pageSize = Math.min(200, Math.max(1, opts.pageSize ?? 50));
  const page = Math.max(0, opts.page ?? 0);
  return { total: matched.length, hiddenCount: opts.superAdmin ? ranked.filter((r) => r.hidden).length : 0, page, pageSize, rows: matched.slice(page * pageSize, (page + 1) * pageSize), all: matched };
}

export function boardCsv(rows: Entry[], unit: string, superAdmin: boolean) {
  const cell = (v: unknown) => { const s = String(v ?? ""); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const head = ["Rank", "Username", `Score (${unit})`, ...(superAdmin ? ["Hidden"] : [])];
  return [head, ...rows.map((r) => [r.rank, r.username, r.value, ...(superAdmin ? [r.hidden ? "yes" : "no"] : [])])].map((r) => r.map(cell).join(",")).join("\n");
}
