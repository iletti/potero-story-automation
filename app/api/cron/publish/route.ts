import { NextRequest, NextResponse } from "next/server";
import { publishNextStory, syncOutstandPostStatuses } from "@/lib/publish";

export const runtime = "nodejs";
export const maxDuration = 300; // streaming large videos Drive -> Outstand
export const dynamic = "force-dynamic";

function authorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return req.headers.get("authorization") === `Bearer ${secret}`;
}

async function run(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  await syncOutstandPostStatuses();
  // ?force=1 bypasses pacing/pause for a manual smoke test (still CRON_SECRET-gated).
  const force = new URL(req.url).searchParams.get("force") === "1";
  const result = await publishNextStory(new Date(), { force });
  return NextResponse.json(result, { status: result.status === "failed" ? 500 : 200 });
}

// Vercel Cron issues GET with `Authorization: Bearer $CRON_SECRET`.
export const GET = run;
export const POST = run;
