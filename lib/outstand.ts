import { createHmac, timingSafeEqual } from "crypto";

/**
 * Outstand API client (https://api.outstand.so). Verified against the Outstand
 * docs: request an upload URL, PUT the bytes, confirm, then create the post.
 *   - Media:  POST /v1/media/upload  -> PUT upload_url -> POST /v1/media/{id}/confirm
 *   - Post:   POST /v1/posts/  { containers, accounts, <platform overrides> }
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

export function isOutstandConfigurationError(err: unknown): boolean {
  if (!(err instanceof OutstandError)) return false;
  if (err.status === 401 || err.status === 403) return true;
  return (
    err.message.startsWith("OUTSTAND_") ||
    err.message.includes("story override is configured") ||
    err.message.includes("OUTSTAND_STORY_CONFIG_JSON")
  );
}

function getConfig(): { baseUrl: string; apiKey: string } {
  const baseUrl = process.env.OUTSTAND_API_BASE_URL;
  const apiKey = process.env.OUTSTAND_API_KEY;
  if (!baseUrl) throw new OutstandError("OUTSTAND_API_BASE_URL is not set.");
  if (!apiKey) throw new OutstandError("OUTSTAND_API_KEY is not set.");
  return { baseUrl: baseUrl.replace(/\/+$/, ""), apiKey };
}

const DEFAULT_STORY_CHANNEL = "instagram";
const BUILT_IN_STORY_OVERRIDES: Record<string, Record<string, unknown>> = {
  instagram: { publishAsStory: true },
  facebook: { publishAsStory: true },
};
const KNOWN_CHANNELS = new Set([
  "facebook",
  "instagram",
  "linkedin",
  "pinterest",
  "threads",
  "tiktok",
  "twitter",
  "x",
  "youtube",
]);

function splitEnvList(raw: string): string[] {
  return raw
    .split(/[,\s]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function channelName(value: string, extraChannels: Set<string> = new Set()): string | null {
  const normalized = value.trim().toLowerCase();
  if (!normalized) return null;
  const [prefix] = normalized.split(":", 1);
  if (KNOWN_CHANNELS.has(prefix) || extraChannels.has(prefix)) return prefix;
  if (KNOWN_CHANNELS.has(normalized) || extraChannels.has(normalized)) return normalized;
  return null;
}

function customStoryChannelNames(): Set<string> {
  const raw = process.env.OUTSTAND_STORY_CONFIG_JSON;
  if (!raw) return new Set();

  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return new Set();
    return new Set(
      Object.keys(parsed)
        .map((key) => key.trim().toLowerCase())
        .filter(Boolean),
    );
  } catch {
    return new Set();
  }
}

function parseAccountSelector(
  value: string,
  extraChannels: Set<string> = customStoryChannelNames(),
): { account: string; channel: string | null } | null {
  const trimmed = value.trim();
  if (!trimmed) return null;

  const colon = trimmed.indexOf(":");
  if (colon > 0) {
    const maybeChannel = channelName(trimmed.slice(0, colon), extraChannels);
    const account = trimmed.slice(colon + 1).trim();
    if (maybeChannel && account) return { account, channel: maybeChannel };
  }

  return { account: trimmed, channel: channelName(trimmed, extraChannels) };
}

function getConfiguredAccountSelectors(): Array<{ account: string; channel: string | null }> {
  const raw = process.env.OUTSTAND_ACCOUNTS ?? process.env.OUTSTAND_SOCIAL_ACCOUNT_IDS ?? "";
  const extraChannels = customStoryChannelNames();
  const accounts = splitEnvList(raw)
    .map((value) => parseAccountSelector(value, extraChannels))
    .filter((value): value is { account: string; channel: string | null } => Boolean(value));
  if (accounts.length === 0) {
    throw new OutstandError("OUTSTAND_ACCOUNTS is not set (the account(s) to post to).");
  }
  return accounts;
}

/**
 * The connected account(s) to publish to (comma-separated env). Each value may
 * be a network name (e.g. "instagram"), a username, or an account id. Prefix an
 * opaque selector with `network:` (e.g. `facebook:abc123`) to infer the story
 * channel while sending only `abc123` to Outstand.
 */
export function getAccounts(): string[] {
  return getConfiguredAccountSelectors().map((selector) => selector.account);
}

/** Whether to publish as story-type content (default true). */
function publishAsStory(): boolean {
  return (process.env.OUTSTAND_PUBLISH_AS_STORY ?? "true").toLowerCase() !== "false";
}

function configuredStoryChannels(accounts: string[]): string[] {
  const raw = process.env.OUTSTAND_STORY_CHANNELS;
  const extraChannels = customStoryChannelNames();
  const channels = raw
    ? splitEnvList(raw)
        .map((value) => channelName(value, extraChannels) ?? value.trim().toLowerCase())
        .filter(Boolean)
    : getConfiguredAccountSelectors()
        .filter((selector) => accounts.includes(selector.account))
        .map((selector) => selector.channel)
        .filter((value): value is string => Boolean(value));

  const unique = Array.from(new Set(channels));
  return unique.length > 0 ? unique : [DEFAULT_STORY_CHANNEL];
}

function configuredStoryOverrides(): Record<string, Record<string, unknown>> {
  const raw = process.env.OUTSTAND_STORY_CONFIG_JSON;
  if (!raw) return {};

  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("expected a JSON object");
    }

    const overrides: Record<string, Record<string, unknown>> = {};
    for (const [key, value] of Object.entries(parsed)) {
      const channel = channelName(key) ?? key.trim().toLowerCase();
      if (!channel) continue;
      if (!value || typeof value !== "object" || Array.isArray(value)) {
        throw new Error(`expected ${key} to be a JSON object`);
      }
      overrides[channel] = value as Record<string, unknown>;
    }
    return overrides;
  } catch (cause) {
    throw new OutstandError("OUTSTAND_STORY_CONFIG_JSON must be a JSON object of channel overrides.", {
      body: cause instanceof Error ? cause.message : String(cause),
    });
  }
}

export function getStoryChannels(): string[] {
  if (!publishAsStory()) return [];
  return Object.keys(getStoryPlatformOverrides(getAccounts()));
}

export function getStoryPlatformOverrides(accounts: string[] = getAccounts()): Record<string, Record<string, unknown>> {
  if (!publishAsStory()) return {};

  const customOverrides = configuredStoryOverrides();
  const overrides: Record<string, Record<string, unknown>> = {};
  for (const channel of configuredStoryChannels(accounts)) {
    const override = customOverrides[channel] ?? BUILT_IN_STORY_OVERRIDES[channel];
    if (!override) {
      throw new OutstandError(
        `No story override is configured for "${channel}". Add it to OUTSTAND_STORY_CONFIG_JSON.`,
      );
    }
    overrides[channel] = override;
  }
  for (const [channel, override] of Object.entries(customOverrides)) {
    overrides[channel] = override;
  }
  return overrides;
}

export function getStoryConfigSummary(): { accountCount: number; storyChannels: string[]; publishAsStory: boolean } {
  const accounts = getAccounts();
  return {
    accountCount: accounts.length,
    storyChannels: Object.keys(getStoryPlatformOverrides(accounts)),
    publishAsStory: publishAsStory(),
  };
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

async function getJson(path: string) {
  const { baseUrl, apiKey } = getConfig();
  let response: Response;
  try {
    response = await fetch(`${baseUrl}${path}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
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
export type ConfirmedMedia = { providerMediaId: string; url: string; filename: string };

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

/** POST /v1/media/{id}/confirm — marks the uploaded file active and returns its public URL. */
export async function confirmUpload(providerMediaId: string, sizeBytes: number): Promise<ConfirmedMedia> {
  const json = await postJson(`/v1/media/${encodeURIComponent(providerMediaId)}/confirm`, { size: sizeBytes });
  const data = json?.data ?? json?.media ?? {};
  const url = data.url;
  const filename = data.filename;
  if (!url || !filename) {
    throw new OutstandError("Outstand confirm response missing data.url / data.filename.", {
      body: JSON.stringify(json).slice(0, 500),
    });
  }
  return { providerMediaId, url: String(url), filename: String(filename) };
}

/** POST /v1/posts/ — publishes the media immediately to the configured accounts. */
export async function createPost(input: {
  media: Array<{ url: string; filename: string }>;
  caption?: string;
  idempotencyKey: string;
}): Promise<{ providerPostId: string }> {
  const container: Record<string, unknown> = {
    media: input.media,
    // Outstand requires non-empty `content` even for captionless Stories.
    // A single space keeps the Story effectively captionless.
    content: input.caption ?? " ",
  };

  const accounts = getAccounts();
  const body: Record<string, unknown> = {
    containers: [container],
    accounts,
  };
  for (const [channel, override] of Object.entries(getStoryPlatformOverrides(accounts))) {
    body[channel] = override;
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

export type ProviderPostStatus =
  | { status: "pending" }
  | { status: "published"; platformPostId: string | null; publishedAt: string | null }
  | { status: "failed"; error: string };

export async function getPostStatus(providerPostId: string): Promise<ProviderPostStatus> {
  const json = await getJson(`/v1/posts/${encodeURIComponent(providerPostId)}`);
  const post = json?.post ?? {};
  const accounts = Array.isArray(post.socialAccounts) ? post.socialAccounts : [];
  const failed = accounts.find((account: { status?: unknown }) => account.status === "failed");
  if (failed) {
    const error = typeof failed.error === "string" ? failed.error : "Outstand reported account publish failure.";
    return { status: "failed", error };
  }

  const pending = accounts.find((account: { status?: unknown }) => account.status === "pending");
  if (pending || !post.publishedAt) return { status: "pending" };

  const published = accounts.find((account: { status?: unknown }) => account.status === "published") ?? {};
  return {
    status: "published",
    platformPostId: typeof published.platformPostId === "string" ? published.platformPostId : null,
    publishedAt: typeof published.publishedAt === "string" ? published.publishedAt : typeof post.publishedAt === "string" ? post.publishedAt : null,
  };
}

export type OutstandWebhook = { event: string; postId: string | null; error: string | null };

/** Parses an Outstand webhook body: { event, data: { postId, ... } }. */
export function parseWebhook(body: unknown): OutstandWebhook | null {
  if (!body || typeof body !== "object") return null;
  const b = body as {
    event?: unknown;
    data?: { postId?: unknown; error?: unknown; message?: unknown };
    error?: unknown;
    message?: unknown;
  };
  if (typeof b.event !== "string") return null;
  const postId = typeof b.data?.postId === "string" ? b.data.postId : null;
  const error = [b.data?.error, b.data?.message, b.error, b.message].find((value) => typeof value === "string");
  return { event: b.event, postId, error: error ? String(error) : null };
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
