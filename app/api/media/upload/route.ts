import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { NextRequest, NextResponse } from "next/server";
import { checkBasicAuth } from "@/lib/auth";

export const runtime = "nodejs";

const MAX_BYTES = 500 * 1024 * 1024; // 500 MB

/**
 * Issues client-upload tokens so the browser uploads videos directly to Vercel
 * Blob (bypassing the 4.5 MB serverless body limit). The token request carries
 * the admin's Basic Auth header, which we verify before granting a token.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  const body = (await req.json()) as HandleUploadBody;

  try {
    const result = await handleUpload({
      body,
      request: req,
      onBeforeGenerateToken: async () => {
        if (!checkBasicAuth(req.headers.get("authorization"))) {
          throw new Error("Unauthorized.");
        }
        return {
          allowedContentTypes: ["video/mp4", "video/quicktime", "image/jpeg", "image/png"],
          maximumSizeInBytes: MAX_BYTES,
          addRandomSuffix: true,
        };
      },
      // The media row is inserted by the `addMedia` server action once the
      // client upload resolves, so nothing is needed here.
      onUploadCompleted: async () => {},
    });
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Upload failed." },
      { status: 400 },
    );
  }
}
