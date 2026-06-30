import { afterEach, describe, expect, it, vi } from "vitest";
import {
  confirmUpload,
  createPost,
  getStoryConfigSummary,
  getStoryPlatformOverrides,
  isOutstandConfigurationError,
  OutstandError,
} from "../lib/outstand";

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.OUTSTAND_API_BASE_URL;
  delete process.env.OUTSTAND_API_KEY;
  delete process.env.OUTSTAND_ACCOUNTS;
  delete process.env.OUTSTAND_PUBLISH_AS_STORY;
  delete process.env.OUTSTAND_STORY_CHANNELS;
  delete process.env.OUTSTAND_STORY_CONFIG_JSON;
});

describe("createPost", () => {
  it("sends media URL objects and content for captionless Stories", async () => {
    process.env.OUTSTAND_API_BASE_URL = "https://api.outstand.test";
    process.env.OUTSTAND_API_KEY = "key";
    process.env.OUTSTAND_ACCOUNTS = "acct_1";

    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({ post: { id: "post_1" } }),
    } as Response);

    await expect(
      createPost({
        media: [{ url: "https://media.outstand.test/video.mp4", filename: "video.mp4" }],
        idempotencyKey: "log_1",
      }),
    ).resolves.toEqual({ providerPostId: "post_1" });

    const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    expect(body.containers[0]).toEqual({
      media: [{ url: "https://media.outstand.test/video.mp4", filename: "video.mp4" }],
      content: " ",
    });
    expect(body.accounts).toEqual(["acct_1"]);
    expect(body.instagram).toEqual({ publishAsStory: true });
  });

  it("adds Facebook story overrides when Facebook is a configured story channel", async () => {
    process.env.OUTSTAND_API_BASE_URL = "https://api.outstand.test";
    process.env.OUTSTAND_API_KEY = "key";
    process.env.OUTSTAND_ACCOUNTS = "ig_account fb_account";
    process.env.OUTSTAND_STORY_CHANNELS = "instagram,facebook";

    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({ post: { id: "post_1" } }),
    } as Response);

    await createPost({
      media: [{ url: "https://media.outstand.test/video.mp4", filename: "video.mp4" }],
      idempotencyKey: "log_1",
    });

    const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    expect(body.accounts).toEqual(["ig_account", "fb_account"]);
    expect(body.instagram).toEqual({ publishAsStory: true });
    expect(body.facebook).toEqual({ publishAsStory: true });
  });

  it("infers story channels from network account names", async () => {
    process.env.OUTSTAND_API_BASE_URL = "https://api.outstand.test";
    process.env.OUTSTAND_API_KEY = "key";
    process.env.OUTSTAND_ACCOUNTS = "instagram,facebook";

    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({ post: { id: "post_1" } }),
    } as Response);

    await createPost({
      media: [{ url: "https://media.outstand.test/video.mp4", filename: "video.mp4" }],
      idempotencyKey: "log_1",
    });

    const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    expect(body.accounts).toEqual(["instagram", "facebook"]);
    expect(body.instagram).toEqual({ publishAsStory: true });
    expect(body.facebook).toEqual({ publishAsStory: true });
  });

  it("infers story channels from prefixed opaque account selectors", async () => {
    process.env.OUTSTAND_API_BASE_URL = "https://api.outstand.test";
    process.env.OUTSTAND_API_KEY = "key";
    process.env.OUTSTAND_ACCOUNTS = "instagram:ig_account facebook:fb_account";

    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({ post: { id: "post_1" } }),
    } as Response);

    await createPost({
      media: [{ url: "https://media.outstand.test/video.mp4", filename: "video.mp4" }],
      idempotencyKey: "log_1",
    });

    const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    expect(body.accounts).toEqual(["ig_account", "fb_account"]);
    expect(body.instagram).toEqual({ publishAsStory: true });
    expect(body.facebook).toEqual({ publishAsStory: true });
  });

  it("allows custom story overrides for future story-capable channels", async () => {
    process.env.OUTSTAND_ACCOUNTS = "acct_1";
    process.env.OUTSTAND_STORY_CHANNELS = "instagram,custom";
    process.env.OUTSTAND_STORY_CONFIG_JSON = JSON.stringify({
      custom: { publishAsStory: true, placement: "story" },
    });

    expect(getStoryPlatformOverrides(["acct_1"])).toEqual({
      instagram: { publishAsStory: true },
      custom: { publishAsStory: true, placement: "story" },
    });
  });

  it("infers future story channels from prefixed selectors when a custom override exists", async () => {
    process.env.OUTSTAND_API_BASE_URL = "https://api.outstand.test";
    process.env.OUTSTAND_API_KEY = "key";
    process.env.OUTSTAND_ACCOUNTS = "custom:custom_account";
    process.env.OUTSTAND_STORY_CONFIG_JSON = JSON.stringify({
      custom: { publishAsStory: true, placement: "story" },
    });

    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({ post: { id: "post_1" } }),
    } as Response);

    await createPost({
      media: [{ url: "https://media.outstand.test/video.mp4", filename: "video.mp4" }],
      idempotencyKey: "log_1",
    });

    const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    expect(body.accounts).toEqual(["custom_account"]);
    expect(body.custom).toEqual({ publishAsStory: true, placement: "story" });
  });

  it("rejects future story channels without a configured override", async () => {
    process.env.OUTSTAND_ACCOUNTS = "acct_1";
    process.env.OUTSTAND_STORY_CHANNELS = "custom";

    expect(() => getStoryPlatformOverrides(["acct_1"])).toThrow(
      'No story override is configured for "custom". Add it to OUTSTAND_STORY_CONFIG_JSON.',
    );
  });

  it("omits story overrides when story publishing is disabled", async () => {
    process.env.OUTSTAND_API_BASE_URL = "https://api.outstand.test";
    process.env.OUTSTAND_API_KEY = "key";
    process.env.OUTSTAND_ACCOUNTS = "acct_1";
    process.env.OUTSTAND_PUBLISH_AS_STORY = "false";

    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({ post: { id: "post_1" } }),
    } as Response);

    await createPost({
      media: [{ url: "https://media.outstand.test/video.mp4", filename: "video.mp4" }],
      idempotencyKey: "log_1",
    });

    const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    expect(body.instagram).toBeUndefined();
    expect(body.facebook).toBeUndefined();
  });
});

describe("confirmUpload", () => {
  it("returns the confirmed media URL and filename", async () => {
    process.env.OUTSTAND_API_BASE_URL = "https://api.outstand.test";
    process.env.OUTSTAND_API_KEY = "key";

    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({
        data: {
          id: "media_1",
          url: "https://media.outstand.test/video.mp4",
          filename: "video.mp4",
        },
      }),
    } as Response);

    await expect(confirmUpload("media_1", 123)).resolves.toEqual({
      providerMediaId: "media_1",
      url: "https://media.outstand.test/video.mp4",
      filename: "video.mp4",
    });
  });
});

describe("isOutstandConfigurationError", () => {
  it("detects missing env and story override configuration errors", () => {
    expect(isOutstandConfigurationError(new OutstandError("OUTSTAND_API_KEY is not set."))).toBe(true);
    expect(
      isOutstandConfigurationError(
        new OutstandError('No story override is configured for "custom". Add it to OUTSTAND_STORY_CONFIG_JSON.'),
      ),
    ).toBe(true);
    expect(isOutstandConfigurationError(new OutstandError("OUTSTAND_STORY_CONFIG_JSON must be a JSON object."))).toBe(
      true,
    );
  });

  it("detects provider auth failures but not ordinary upload failures", () => {
    expect(isOutstandConfigurationError(new OutstandError("Outstand /v1/posts/ returned 401.", { status: 401 }))).toBe(
      true,
    );
    expect(isOutstandConfigurationError(new OutstandError("Outstand upload PUT returned 500.", { status: 500 }))).toBe(
      false,
    );
    expect(isOutstandConfigurationError(new Error("network failed"))).toBe(false);
  });
});

describe("getStoryConfigSummary", () => {
  it("summarizes account count and story channels without exposing account selectors", () => {
    process.env.OUTSTAND_ACCOUNTS = "instagram:ig_account facebook:fb_account";

    expect(getStoryConfigSummary()).toEqual({
      accountCount: 2,
      storyChannels: ["instagram", "facebook"],
      publishAsStory: true,
    });
  });
});
