import { getSql } from "./db";

export type Settings = {
  paused: boolean;
  minReuseHours: number;
  dailyMin: number;
  dailyMax: number;
  postType: string;
  lastSyncedAt: string | null;
};

export const MIN_REUSE_HOURS = 60 * 24;
export const DAILY_MIN = 0;
export const DAILY_MAX = 10;

const DEFAULTS: Settings = {
  paused: false,
  minReuseHours: MIN_REUSE_HOURS,
  dailyMin: DAILY_MIN,
  dailyMax: DAILY_MAX,
  postType: "story",
  lastSyncedAt: null,
};

export async function getSettings(): Promise<Settings> {
  const sql = getSql();
  const rows = await sql`
    select paused, min_reuse_hours, daily_min, daily_max, post_type, last_synced_at
    from settings where id = 1
  `;
  const row = rows[0];
  if (!row) return DEFAULTS;
  return {
    paused: Boolean(row.paused),
    // These are policy invariants, not operator-tunable settings. Keeping the
    // legacy columns readable avoids a destructive migration while enforcing
    // the current policy immediately on every deployment.
    minReuseHours: MIN_REUSE_HOURS,
    dailyMin: DAILY_MIN,
    dailyMax: DAILY_MAX,
    postType: String(row.post_type),
    lastSyncedAt: row.last_synced_at ? String(row.last_synced_at) : null,
  };
}

export async function setPaused(paused: boolean): Promise<void> {
  const sql = getSql();
  await sql`update settings set paused = ${paused}, updated_at = now() where id = 1`;
}

export async function markSynced(): Promise<void> {
  const sql = getSql();
  await sql`update settings set last_synced_at = now() where id = 1`;
}
