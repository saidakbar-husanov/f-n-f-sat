// netlify/functions/league-finalize.ts — once a day, award the championship
// badges for the weekly and monthly points leagues that have just ended. The
// work is idempotent (each period is claimed once), so the leaderboard API may
// also trigger it lazily without double-awarding.
import type { Config } from "@netlify/functions";
import { finalizeLeagues } from "../lib/platform.js";

export default async () => {
  try {
    await finalizeLeagues();
  } catch (err) {
    console.error("League finalization failed", err);
  }
};

export const config: Config = { schedule: "15 0 * * *" };
