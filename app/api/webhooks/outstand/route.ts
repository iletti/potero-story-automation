import { NextRequest, NextResponse } from "next/server";
import { getSql } from "@/lib/db";
import { parseWebhook, verifyOutstandWebhook } from "@/lib/outstand";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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
    const status = hook.event === "post.published" ? "confirmed" : "failed";
    const sql = getSql();
    await sql`update post_log set status = ${status} where provider_post_id = ${hook.postId}`;
  }

  return NextResponse.json({ ok: true });
}
