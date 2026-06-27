import { NextRequest, NextResponse } from "next/server";
import { getSql } from "@/lib/db";
import { parseWebhook, verifyOutstandWebhook } from "@/lib/outstand";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const WEBHOOK_RETRY_BACKOFF_MIN = 30;
const WEBHOOK_FAIL_LIMIT = 3;

/**
 * Optional: records Outstand's delivery outcome against the post_log row.
 * Outstand signs each delivery with `X-Outstand-Signature` (HMAC-SHA256, hex)
 * and sends `{ event, data: { postId, ... } }`. The system works without this;
 * it just upgrades a row to `confirmed` / `failed` after delivery.
 */
export async function POST(req: NextRequest) {
  const raw = await req.text();
  const signature = req.headers.get("x-outstand-signature") ?? "";

  if (!verifyOutstandWebhook(raw, signature)) {
    return NextResponse.json({ error: "invalid signature" }, { status: 401 });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const hook = parseWebhook(payload);
  if (hook?.postId && (hook.event === "post.published" || hook.event === "post.error")) {
    const sql = getSql();
    if (hook.event === "post.published") {
      await sql`update post_log set status = 'confirmed' where provider_post_id = ${hook.postId}`;
    } else {
      const message = hook.error ?? "Outstand reported post.error.";
      await sql`
        with failed_post as (
          update post_log
          set status = 'failed', error = ${message}
          where provider_post_id = ${hook.postId} and status <> 'failed'
          returning media_id
        )
        update media
        set
          fail_count = fail_count + 1,
          last_error = ${message},
          last_posted_at = null,
          retry_after = case when fail_count + 1 >= ${WEBHOOK_FAIL_LIMIT} then null
                             else now() + make_interval(mins => ${WEBHOOK_RETRY_BACKOFF_MIN}) end,
          enabled = case when fail_count + 1 >= ${WEBHOOK_FAIL_LIMIT} then false else enabled end
        where id in (select media_id from failed_post where media_id is not null)
      `;
    }
  }

  return NextResponse.json({ ok: true });
}
