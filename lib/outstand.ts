import { createHmac, timingSafeEqual } from "crypto";

/**
 * Outstand API client (https://api.outstand.so). Verified against the Outstand
 * docs: request an upload URL, PUT the bytes, confirm, then create the post.
 *   - Media:  POST /v1/media/upload  -> PUT upload_url -> POST /v1/media/{id}/confirm
 *   - Post:   POST /v1/posts/  { containers, accounts, instagram }
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

/**
 * The connected account(s) to publish to (comma-separated env). Each value may
 * be a network name (e.g. "instagram"), a username, or an account id — Outstand
 * resolves it against the org's connected accounts.
 */
export function getAccounts(): string[] {
  const raw = process.env.OUTSTAND_ACCOUNTS ?? process.env.OUTSTAND_SOCIAL_ACCOUNT_IDS ?? "";
  const accounts = raw
    .split(/[,\s]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (accounts.length === 0) {
    throw new OutstandError("OUTSTAND_ACCOUNTS is not set (the account(s) to post to).");
  }
  return accounts;
}

/** Whether to publish as an Instagram Story (default true). */
function publishAsStory(): boolean {
  return (process.env.OUTSTAND_PUBLISH_AS_STORY ?? "true").toLowerCase() !== "false";
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

export type UploadUrl = { uploadUrl: string; providerMediaId: string };

/** POST /v1/media/upload — returns a presigned PUT URL (valid 1h) and the media id. */
export async function requestUploadUrl(input: {
  filename: string;
  contentType: string;
}): Promise<UploadUrl> {
  const json = await postJson("/v1/media/upload", {
    filename: input.filename,
    content_type: input.contentType,
  });
  const data = json?.data ?? {};
  const uploadUrl = data.upload_url;
  const providerMediaId = data.id;
  if (!uploadUrl || !providerMediaId) {
    throw new OutstandError("Outstand upload response missing data.upload_url / data.id.", {
      body: JSON.stringify(json).slice(0, 500),
    });
  }
  return { uploadUrl, providerMediaId: String(providerMediaId) };
}

/** Streams a media body straight to the presigned URL without buffering it. */
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

/** POST /v1/media/{id}/confirm — marks the uploaded file active. */
export async function confirmUpload(providerMediaId: string, sizeBytes: number): Promise<void> {
  await postJson(`/v1/media/${encodeURIComponent(providerMediaId)}/confirm`, { size: sizeBytes });
}

/** POST /v1/posts/ — publishes the media immediately to the configured accounts. */
export async function createPost(input: {
  providerMediaIds: string[];
  caption?: string;
  idempotencyKey: string;
}): Promise<{ providerPostId: string }> {
  const container: Record<string, unknown> = { mediaIds: input.providerMediaIds };
  if (input.caption) container.content = input.caption;

  const body: Record<string, unknown> = {
    containers: [container],
    accounts: getAccounts(),
  };
  // Instagram-specific override: publish as a Story rather than a feed post.
  if (publishAsStory()) {
    body.instagram = { publishAsStory: true };
  }

  const json = await postJson("/v1/posts/", body, { "Idempotency-Key": input.idempotencyKey });
  const providerPostId = json?.post?.id ?? json?.id;
  if (!providerPostId) {
    throw new OutstandError("Outstand create-post response missing post.id.", {
      body: JSON.stringify(json).slice(0, 500),
    });
  }
  return { providerPostId: String(providerPostId) };
}

export type OutstandWebhook = { event: string; postId: string | null };

/** Parses an Outstand webhook body: { event, data: { postId, ... } }. */
export function parseWebhook(body: unknown): OutstandWebhook | null {
  if (!body || typeof body !== "object") return null;
  const b = body as { event?: unknown; data?: { postId?: unknown } };
  if (typeof b.event !== "string") return null;
  const postId = typeof b.data?.postId === "string" ? b.data.postId : null;
  return { event: b.event, postId };
}

/** Verifies the X-Outstand-Signature header: HMAC-SHA256(secret, rawBody) in hex. */
export function verifyOutstandWebhook(rawBody: string, signature: string): boolean {
  const secret = process.env.OUTSTAND_WEBHOOK_SECRET;
  if (!secret || !signature) return false;
  const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
