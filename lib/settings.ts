import { getSql } from "./db";

export type Settings = {
  paused: boolean;
  minReuseHours: number;
  dailyMin: number;
  dailyMax: number;
  postType: string;
  lastSyncedAt: string | null;
};

const DEFAULTS: Settings = {
  paused: false,
  minReuseHours: 336,
  dailyMin: 3,
  dailyMax: 10,
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
    minReuseHours: Number(row.min_reuse_hours),
    dailyMin: Number(row.daily_min),
    dailyMax: Number(row.daily_max),
    postType: String(row.post_type),
    lastSyncedAt: row.last_synced_at ? String(row.last_synced_at) : null,
  };
}

export async function setPaused(paused: boolean): Promise<void> {
  const sql = getSql();
  await sql`update settings set paused = ${paused}, updated_at = now() where id = 1`;
}

export async function updateSettings(input: {
  minReuseHours: number;
  dailyMin: number;
  dailyMax: number;
}): Promise<void> {
  const sql = getSql();
  const reuse = Math.max(1, Math.round(input.minReuseHours));
  const min = Math.max(0, Math.round(input.dailyMin));
  const max = Math.max(min, Math.round(input.dailyMax));
  await sql`
    update settings
    set min_reuse_hours = ${reuse}, daily_min = ${min}, daily_max = ${max}, updated_at = now()
    where id = 1
  `;
}

export async function markSynced(): Promise<void> {
  const sql = getSql();
  await sql`update settings set last_synced_at = now() where id = 1`;
}
