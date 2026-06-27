import { afterEach, describe, expect, it, vi } from "vitest";
import { createPost } from "../lib/outstand";

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.OUTSTAND_API_BASE_URL;
  delete process.env.OUTSTAND_API_KEY;
  delete process.env.OUTSTAND_ACCOUNTS;
  delete process.env.OUTSTAND_PUBLISH_AS_STORY;
});

describe("createPost", () => {
  it("sends content as a string for captionless Stories", async () => {
    process.env.OUTSTAND_API_BASE_URL = "https://api.outstand.test";
    process.env.OUTSTAND_API_KEY = "key";
    process.env.OUTSTAND_ACCOUNTS = "acct_1";

    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({ post: { id: "post_1" } }),
    } as Response);

    await expect(
      createPost({
        providerMediaIds: ["media_1"],
        idempotencyKey: "log_1",
      }),
    ).resolves.toEqual({ providerPostId: "post_1" });

    const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    expect(body.containers[0]).toEqual({ mediaIds: ["media_1"], content: " " });
    expect(body.accounts).toEqual(["acct_1"]);
    expect(body.instagram).toEqual({ publishAsStory: true });
  });
});
