import { createHmac, timingSafeEqual } from "crypto";

/**
 * Minimal Outstand API client. Request/response shapes match the Outstand
 * publishing API: request an upload URL, stream the media to it, confirm, then
 * create the post.
 */

export class OutstandError extends Error {
  readonly status?: number;
  readonly body?: string;
  constructor(message: string, options: { status?: number; body?: string } = {}) {
    super(message);
    this.name = "OutstandError";
    this.status = options.status;
    this.body = options.body;
  }
}

function getConfig(): { baseUrl: string; apiKey: string } {
  const baseUrl = process.env.OUTSTAND_API_BASE_URL;
  const apiKey = process.env.OUTSTAND_API_KEY;
  if (!baseUrl) throw new OutstandError("OUTSTAND_API_BASE_URL is not set.");
  if (!apiKey) throw new OutstandError("OUTSTAND_API_KEY is not set.");
  return { baseUrl: baseUrl.replace(/\/+$/, ""), apiKey };
}

/** The connected Outstand social account(s) to publish to (comma-separated env). */
export function getSocialAccountIds(): string[] {
  const raw = process.env.OUTSTAND_SOCIAL_ACCOUNT_IDS ?? "";
  const ids = raw
    .split(/[,\s]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (ids.length === 0) {
    throw new OutstandError("OUTSTAND_SOCIAL_ACCOUNT_IDS is not set (the account(s) to post to).");
  }
  return ids;
}

async function postJson(path: string, body: unknown, extraHeaders: Record<string, string> = {}) {
  const { baseUrl, apiKey } = getConfig();
  let response: Response;
  try {
    response = await fetch(`${baseUrl}${path}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        ...extraHeaders,
      },
      body: JSON.stringify(body),
    });
  } catch (cause) {
    throw new OutstandError(`Outstand request to ${path} failed before a response.`, {
      body: cause instanceof Error ? cause.message : String(cause),
    });
  }
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new OutstandError(`Outstand ${path} returned ${response.status}.`, {
      status: response.status,
      body: text.slice(0, 500),
    });
  }
  return response.json();
}

export type UploadUrl = { uploadUrl: string; providerMediaId: string; expiresAt?: string };

export async function requestUploadUrl(input: {
  fileSizeBytes: number;
  contentType: string;
  idempotencyKey: string;
}): Promise<UploadUrl> {
  // NOTE: exact request/response field names for the upload-URL endpoint are not
  // yet confirmed against the Outstand docs. We send both camelCase and
  // snake_case keys, and read the response leniently, so it works either way.
  const data = await postJson("/v1/media/upload-url", {
    fileSizeBytes: input.fileSizeBytes,
    contentType: input.contentType,
    fileSize: input.fileSizeBytes,
    file_size_bytes: input.fileSizeBytes,
    content_type: input.contentType,
  });
  const uploadUrl = data.uploadUrl ?? data.upload_url ?? data.url;
  const providerMediaId = data.mediaId ?? data.media_id ?? data.id;
  if (!uploadUrl || !providerMediaId) {
    throw new OutstandError("Outstand upload-URL response missing uploadUrl/mediaId.", {
      body: JSON.stringify(data).slice(0, 500),
    });
  }
  return { uploadUrl, providerMediaId, expiresAt: data.expiresAt ?? data.expires_at };
}

/** Streams a media body straight to the Outstand upload URL without buffering it. */
export async function uploadMedia(input: {
  uploadUrl: string;
  body: ReadableStream<Uint8Array>;
  contentType: string;
  sizeBytes: number;
}): Promise<void> {
  // `duplex` is required for streaming request bodies but is not in the DOM lib types.
  const putInit: RequestInit & { duplex: "half" } = {
    method: "PUT",
    headers: {
      "Content-Type": input.contentType,
      "Content-Length": String(input.sizeBytes),
    },
    body: input.body,
    duplex: "half",
  };

  let response: Response;
  try {
    response = await fetch(input.uploadUrl, putInit);
  } catch (cause) {
    throw new OutstandError("Streaming upload to Outstand failed.", {
      body: cause instanceof Error ? cause.message : String(cause),
    });
  }
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new OutstandError(`Outstand upload PUT returned ${response.status}.`, {
      status: response.status,
      body: text.slice(0, 500),
    });
  }
}

export async function confirmUpload(providerMediaId: string): Promise<void> {
  await postJson(`/v1/media/${encodeURIComponent(providerMediaId)}/confirm`, {});
}

export async function createPost(input: {
  providerMediaIds: string[];
  caption?: string;
  idempotencyKey: string;
}): Promise<{ providerPostId: string }> {
  // Body shape matches Outstand's published POST /v1/posts example:
  //   { containers: [{ content, mediaIds }], socialAccountIds: [...] }
  // NOTE: how a Story (vs a feed post) is flagged is not yet confirmed against
  // the docs — see README. If Outstand needs an explicit type field, add it to
  // the container here.
  const data = await postJson(
    "/v1/posts",
    {
      containers: [{ content: input.caption ?? "", mediaIds: input.providerMediaIds }],
      socialAccountIds: getSocialAccountIds(),
    },
    { "Idempotency-Key": input.idempotencyKey },
  );
  const providerPostId = data.id ?? data.postId ?? data.post_id;
  if (!providerPostId) {
    throw new OutstandError("Outstand create-post response missing post id.", {
      body: JSON.stringify(data).slice(0, 500),
    });
  }
  return { providerPostId };
}

/**
 * Verifies an inbound Outstand webhook. Supports both an HMAC-SHA256 signature
 * (hex) of the raw body and a static shared-token delivery.
 */
export function verifyOutstandWebhook(rawBody: string, signatureOrToken: string): boolean {
  const secret = process.env.OUTSTAND_WEBHOOK_SECRET;
  if (!secret || !signatureOrToken) return false;

  const expectedHmac = createHmac("sha256", secret).update(rawBody).digest("hex");
  if (equal(expectedHmac, signatureOrToken)) return true;
  return equal(secret, signatureOrToken);
}

function equal(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}
