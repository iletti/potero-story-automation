import { getSql } from "./db";
import { getSettings } from "./settings";
import {
  confirmUpload,
  createPost,
  requestUploadUrl,
  uploadMediaFromUrl,
  OutstandError,
} from "./outstand";

export type PublishResult =
  | { status: "skipped"; reason: string }
  | { status: "published"; mediaId: string; logId: string; providerPostId: string }
  | { status: "failed"; mediaId: string; logId: string; error: string };

type Candidate = {
  id: string;
  blob_url: string;
  content_type: string;
  size_bytes: string | number;
  caption: string;
  last_posted_at: string | null;
};

/**
 * Publishes the single least-recently-posted eligible video through Outstand.
 * Designed to be called once per scheduled slot (and from the admin "publish
 * now" button). Returns a structured result instead of throwing.
 */
export async function publishNextStory(): Promise<PublishResult> {
  const sql = getSql();
  const settings = await getSettings();

  if (settings.paused) {
    return { status: "skipped", reason: "paused" };
  }

  // Pick the least-recently-posted video that is enabled and past its cooldown.
  const candidates = (await sql`
    select id, blob_url, content_type, size_bytes, caption, last_posted_at
    from media
    where enabled = true
      and (
        last_posted_at is null
        or last_posted_at < now() - make_interval(hours => ${settings.minReuseHours})
      )
    order by last_posted_at asc nulls first, created_at asc
    limit 1
  `) as Candidate[];

  const candidate = candidates[0];
  if (!candidate) {
    return { status: "skipped", reason: "no_media_due" };
  }

  // Optimistically claim it: advancing last_posted_at marks it as in-use so an
  // overlapping run cannot pick the same video. The conditional WHERE makes the
  // claim atomic at the row level.
  const claimed = await sql`
    update media set last_posted_at = now()
    where id = ${candidate.id}
      and last_posted_at is not distinct from ${candidate.last_posted_at}
    returning id
  `;
  if (claimed.length === 0) {
    return { status: "skipped", reason: "already_claimed" };
  }

  const logRows = await sql`
    insert into post_log (media_id, status) values (${candidate.id}, 'pending')
    returning id
  `;
  const logId = String(logRows[0].id);
  const sizeBytes = Number(candidate.size_bytes);

  try {
    const upload = await requestUploadUrl({
      fileSizeBytes: sizeBytes,
      contentType: candidate.content_type,
      idempotencyKey: logId,
    });

    await uploadMediaFromUrl({
      sourceUrl: candidate.blob_url,
      uploadUrl: upload.uploadUrl,
      contentType: candidate.content_type,
      sizeBytes,
    });

    await confirmUpload(upload.providerMediaId);

    const post = await createPost({
      providerMediaId: upload.providerMediaId,
      postType: settings.postType,
      caption: candidate.caption || undefined,
      idempotencyKey: logId,
    });

    await sql`
      update post_log
      set status = 'published',
          provider_media_id = ${upload.providerMediaId},
          provider_post_id = ${post.providerPostId},
          published_at = now()
      where id = ${logId}
    `;

    return {
      status: "published",
      mediaId: candidate.id,
      logId,
      providerPostId: post.providerPostId,
    };
  } catch (err) {
    const message =
      err instanceof OutstandError
        ? `${err.message}${err.body ? ` (${err.body})` : ""}`
        : err instanceof Error
          ? err.message
          : String(err);

    await sql`update post_log set status = 'failed', error = ${message} where id = ${logId}`;
    // Release the claim so this video is retried on the next run.
    await sql`update media set last_posted_at = ${candidate.last_posted_at} where id = ${candidate.id}`;

    return { status: "failed", mediaId: candidate.id, logId, error: message };
  }
}
