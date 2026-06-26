import { getSql } from "./db";

export type Settings = {
  paused: boolean;
  minReuseHours: number;
  postType: string;
};

const DEFAULTS: Settings = { paused: false, minReuseHours: 720, postType: "story" };

export async function getSettings(): Promise<Settings> {
  const sql = getSql();
  const rows = await sql`select paused, min_reuse_hours, post_type from settings where id = 1`;
  const row = rows[0];
  if (!row) return DEFAULTS;
  return {
    paused: Boolean(row.paused),
    minReuseHours: Number(row.min_reuse_hours),
    postType: String(row.post_type),
  };
}

export async function setPaused(paused: boolean): Promise<void> {
  const sql = getSql();
  await sql`update settings set paused = ${paused}, updated_at = now() where id = 1`;
}
