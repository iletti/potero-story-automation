import { NextRequest, NextResponse } from "next/server";
import { publishNextStory } from "@/lib/publish";

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
  const result = await publishNextStory();
  return NextResponse.json(result, { status: result.status === "failed" ? 500 : 200 });
}

// Vercel Cron issues GET with `Authorization: Bearer $CRON_SECRET`.
export const GET = run;
export const POST = run;
