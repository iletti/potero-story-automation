import { NextRequest, NextResponse } from "next/server";
import { syncDrive } from "@/lib/sync";

export const runtime = "nodejs";
export const maxDuration = 60;
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
  try {
    const summary = await syncDrive();
    return NextResponse.json({ status: "ok", ...summary });
  } catch (err) {
    return NextResponse.json(
      { status: "error", error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}

export const GET = run;
export const POST = run;
