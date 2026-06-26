import { NextRequest, NextResponse } from "next/server";
import { getSql } from "@/lib/db";
import { verifyOutstandWebhook } from "@/lib/outstand";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Optional: records Outstand's final delivery outcome against the post_log row.
 * The system works without it (a successful POST /v1/posts already marks a post
 * published); this just records confirmed/failed delivery to the social account.
 */
export async function POST(req: NextRequest) {
  const raw = await req.text();
  const signature =
    req.headers.get("x-outstand-signature") ??
    req.headers.get("x-webhook-token") ??
    req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ??
    "";

  if (!verifyOutstandWebhook(raw, signature)) {
    return NextResponse.json({ error: "invalid signature" }, { status: 401 });
  }

  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const postId = (payload.postId ?? payload.post_id) as string | undefined;
  const outcome = String(payload.outcome ?? payload.status ?? "");
  const error = (payload.error as string | undefined) ?? null;

  if (postId) {
    const status = outcome === "success" || outcome === "published" ? "confirmed" : "failed";
    const sql = getSql();
    await sql`
      update post_log
      set status = ${status}, error = ${error}
      where provider_post_id = ${postId}
    `;
  }

  return NextResponse.json({ ok: true });
}
