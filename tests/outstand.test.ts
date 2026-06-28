import { afterEach, describe, expect, it, vi } from "vitest";
import { confirmUpload, createPost } from "../lib/outstand";

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.OUTSTAND_API_BASE_URL;
  delete process.env.OUTSTAND_API_KEY;
  delete process.env.OUTSTAND_ACCOUNTS;
  delete process.env.OUTSTAND_PUBLISH_AS_STORY;
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
