import { NextRequest, NextResponse } from "next/server";
import { checkBasicAuth } from "@/lib/auth";

/**
 * Protects the admin UI and admin server actions with HTTP Basic Auth.
 * Excluded paths (see matcher) carry their own auth: the cron routes use
 * CRON_SECRET and the webhook uses the Outstand signature.
 */
export function proxy(req: NextRequest) {
  if (checkBasicAuth(req.headers.get("authorization"))) {
    return NextResponse.next();
  }
  return new NextResponse("Authentication required.", {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="Potero Admin"' },
  });
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|api/cron|api/webhooks).*)"],
};
