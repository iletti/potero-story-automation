import { getSql } from "./db";
import { listFolder } from "./google-drive";
import { validateMedia } from "./constraints";
import { markSynced } from "./settings";

export type SyncSummary = {
  active: number;
  rejected: number;
  removed: number;
  total: number;
};

/**
 * Reconciles the media table with the Drive folder:
 *   new file        → inserted (active or rejected per constraints)
 *   existing file   → metadata + constraint verdict refreshed
 *   file gone        → marked `removed`
 * Never touches `enabled` / `fail_count` / `last_posted_at` (publish owns those),
 * so a file disabled for repeated publish failures stays disabled.
 */
export async function syncDrive(): Promise<SyncSummary> {
  const sql = getSql();
  const files = await listFolder();
  const seenIds: string[] = [];

  for (const file of files) {
    seenIds.push(file.id);
    const verdict = validateMedia({
      mimeType: file.mimeType,
      size: file.size,
      width: file.width,
      height: file.height,
      durationMs: file.durationMs,
    });
    const status = verdict.ok ? "active" : "rejected";
    const reason = verdict.ok ? null : verdict.reason;

    await sql`
      insert into media (drive_file_id, name, mime_type, size_bytes, width, height, duration_ms, status, reject_reason)
      values (
        ${file.id}, ${file.name}, ${file.mimeType}, ${file.size},
        ${file.width ?? null}, ${file.height ?? null}, ${file.durationMs ?? null},
        ${status}, ${reason}
      )
      on conflict (drive_file_id) do update set
        name = excluded.name,
        mime_type = excluded.mime_type,
        size_bytes = excluded.size_bytes,
        width = excluded.width,
        height = excluded.height,
        duration_ms = excluded.duration_ms,
        status = excluded.status,
        reject_reason = excluded.reject_reason,
        updated_at = now()
    `;
  }

  // Anything not seen this pass is no longer in the folder.
  if (seenIds.length > 0) {
    await sql`
      update media set status = 'removed', updated_at = now()
      where status <> 'removed' and not (drive_file_id = any(${seenIds}))
    `;
  } else {
    await sql`update media set status = 'removed', updated_at = now() where status <> 'removed'`;
  }

  await markSynced();

  const counts = (await sql`select status, count(*)::int as n from media group by status`) as Array<{
    status: string;
    n: number;
  }>;
  const by = (s: string) => counts.find((c) => c.status === s)?.n ?? 0;

  return {
    active: by("active"),
    rejected: by("rejected"),
    removed: by("removed"),
    total: counts.reduce((sum, c) => sum + c.n, 0),
  };
}
