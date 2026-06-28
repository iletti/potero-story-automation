import { getSql } from "./db";
import { getSettings } from "./settings";
import { dailyTarget, pacedAllowance } from "./schedule";
import { downloadStream } from "./google-drive";
import { confirmUpload, createPost, getPostStatus, requestUploadUrl, uploadMedia, OutstandError } from "./outstand";

const MAX_PUBLISH_ATTEMPTS = 3; // try a few candidates per run so one bad file can't waste the slot
const FAIL_LIMIT = 3; // disable a file after this many consecutive failures
const RETRY_BACKOFF_MIN = 30; // wait this long before retrying a failed file
const CLAIM_TTL_MIN = 10; // reservation window while a publish is in flight

export type DailyPlan = {
  librarySize: number;
  cooldownDays: number;
  target: number;
  allowance: number;
  postedToday: number;
};

export type PublishResult =
  | { status: "skipped"; reason: string; plan: DailyPlan }
  | { status: "published"; mediaId: string; logId: string; providerPostId: string; plan: DailyPlan }
  | { status: "failed"; mediaId: string; logId: string; error: string; plan: DailyPlan };

function startOfUtcDay(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

/** Current pool size, today's target, paced allowance, and posts already made today. */
export async function getDailyPlan(now: Date = new Date()): Promise<DailyPlan> {
  const sql = getSql();
  const settings = await getSettings();
  const cooldownDays = Math.max(1, Math.round(settings.minReuseHours / 24));

  const [{ n: librarySize }] = (await sql`
    select count(*)::int as n from media where status = 'active' and enabled = true
  `) as Array<{ n: number }>;

  const [{ n: postedToday }] = (await sql`
    select count(*)::int as n from post_log
    where status in ('published', 'confirmed') and published_at >= ${startOfUtcDay(now).toISOString()}
  `) as Array<{ n: number }>;

  const target = dailyTarget(librarySize, cooldownDays, settings.dailyMin, settings.dailyMax);
  const allowance = pacedAllowance(target, now);

  return { librarySize, cooldownDays, target, allowance, postedToday };
}

function errorMessage(err: unknown): string {
  if (err instanceof OutstandError) return `${err.message}${err.body ? ` (${err.body})` : ""}`;
  if (err instanceof Error) return err.message;
  return String(err);
}

async function markDeliveryFailed(logId: string, mediaId: string | null, message: string): Promise<void> {
  const sql = getSql();
  await sql`update post_log set status = 'failed', error = ${message} where id = ${logId}`;
  if (!mediaId) return;
  await sql`
    update media set
      fail_count = fail_count + 1,
      last_error = ${message},
      last_posted_at = null,
      retry_after = case when fail_count + 1 >= ${FAIL_LIMIT} then null
                         else now() + make_interval(mins => ${RETRY_BACKOFF_MIN}) end,
      enabled = case when fail_count + 1 >= ${FAIL_LIMIT} then false else enabled end
    where id = ${mediaId}
  `;
}

/**
 * Reconciles accepted Outstand posts with final delivery status. This keeps the
 * dashboard honest even if the optional webhook has not been configured.
 */
export async function syncOutstandPostStatuses(): Promise<void> {
  const sql = getSql();
  const rows = (await sql`
    select id, media_id, provider_post_id
    from post_log
    where status = 'published' and provider_post_id is not null
    order by created_at desc
    limit 20
  `) as Array<{ id: string; media_id: string | null; provider_post_id: string }>;

  for (const row of rows) {
    try {
      const status = await getPostStatus(row.provider_post_id);
      if (status.status === "published") {
        await sql`update post_log set status = 'confirmed' where id = ${row.id}`;
      } else if (status.status === "failed") {
        await markDeliveryFailed(row.id, row.media_id, status.error);
      }
    } catch (err) {
      console.warn(
        `Unable to reconcile Outstand post ${row.provider_post_id}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }
}

/**
 * Publishes at most one Story for this slot, if the paced daily target allows.
 * Picks the least-recently-posted eligible file and streams it from Drive to
 * Outstand. Tries a few candidates so a single failing file can't waste a slot,
 * and disables a file that fails repeatedly.
 */
export async function publishNextStory(
  now: Date = new Date(),
  opts: { force?: boolean } = {},
): Promise<PublishResult> {
  const sql = getSql();
  const settings = await getSettings();
  const plan = await getDailyPlan(now);

  // `force` (manual "Publish next now" / ?force=1) bypasses the pause + pacing
  // gates so an operator can post on demand. Cooldown/eligibility still apply.
  if (!opts.force) {
    if (settings.paused) {
      return { status: "skipped", reason: "paused", plan };
    }
    if (plan.postedToday >= plan.allowance) {
      const reason = plan.postedToday >= plan.target ? "daily_target_reached" : "paced_for_now";
      return { status: "skipped", reason, plan };
    }
  }

  let lastError: { mediaId: string; logId: string; message: string } | null = null;

  for (let attempt = 0; attempt < MAX_PUBLISH_ATTEMPTS; attempt++) {
    const candidates = (await sql`
      select id, drive_file_id, name, mime_type, size_bytes
      from media
      where status = 'active' and enabled = true
        and (last_posted_at is null or last_posted_at < now() - make_interval(hours => ${settings.minReuseHours}))
        and (retry_after is null or retry_after < now())
      order by last_posted_at asc nulls first, created_at asc
      limit 1
    `) as Array<{ id: string; drive_file_id: string; name: string; mime_type: string; size_bytes: string | number }>;

    const candidate = candidates[0];
    if (!candidate) {
      if (lastError) {
        return { status: "failed", mediaId: lastError.mediaId, logId: lastError.logId, error: lastError.message, plan };
      }
      return { status: "skipped", reason: "no_media_due", plan };
    }

    // Reserve the file. Using retry_after as the lock means a crash mid-publish
    // self-heals after CLAIM_TTL_MIN, and a transient failure only delays this
    // file (not the whole queue).
    const claimed = await sql`
      update media set retry_after = now() + make_interval(mins => ${CLAIM_TTL_MIN})
      where id = ${candidate.id} and (retry_after is null or retry_after < now())
      returning id
    `;
    if (claimed.length === 0) continue;

    const [log] = (await sql`
      insert into post_log (media_id, status) values (${candidate.id}, 'pending') returning id
    `) as Array<{ id: string }>;
    const logId = String(log.id);
    const sizeBytes = Number(candidate.size_bytes);

    try {
      const upload = await requestUploadUrl({
        filename: candidate.name,
        contentType: candidate.mime_type,
      });

      const body = await downloadStream(candidate.drive_file_id);
      await uploadMedia({ uploadUrl: upload.uploadUrl, body, contentType: candidate.mime_type, sizeBytes });
      const confirmedMedia = await confirmUpload(upload.providerMediaId, sizeBytes);

      const post = await createPost({
        media: [{ url: confirmedMedia.url, filename: confirmedMedia.filename }],
        idempotencyKey: logId,
      });

      await sql`
        update post_log
        set status = 'published', provider_media_id = ${upload.providerMediaId},
            provider_post_id = ${post.providerPostId}, published_at = now()
        where id = ${logId}
      `;
      await sql`
        update media set last_posted_at = now(), retry_after = null, fail_count = 0, last_error = null
        where id = ${candidate.id}
      `;

      return { status: "published", mediaId: candidate.id, logId, providerPostId: post.providerPostId, plan };
    } catch (err) {
      const message = errorMessage(err);
      await markDeliveryFailed(logId, candidate.id, message);
      lastError = { mediaId: candidate.id, logId, message };
      // fall through to try the next eligible candidate this run
    }
  }

  if (lastError) {
    return { status: "failed", mediaId: lastError.mediaId, logId: lastError.logId, error: lastError.message, plan };
  }
  return { status: "skipped", reason: "no_media_due", plan };
}
