import { describe, expect, it } from "vitest";
import { validateMedia } from "../lib/constraints";

describe("validateMedia", () => {
  it("accepts a portrait MP4 within limits", () => {
    const v = validateMedia({ mimeType: "video/mp4", size: 20 * 1024 * 1024, width: 1080, height: 1920, durationMs: 15000 });
    expect(v.ok).toBe(true);
  });

  it("accepts a portrait JPEG", () => {
    const v = validateMedia({ mimeType: "image/jpeg", size: 2 * 1024 * 1024, width: 1080, height: 1920 });
    expect(v.ok).toBe(true);
  });

  it("rejects an unsupported type", () => {
    const v = validateMedia({ mimeType: "image/gif", size: 1000 });
    expect(v.ok).toBe(false);
  });

  it("rejects landscape orientation", () => {
    const v = validateMedia({ mimeType: "video/mp4", size: 1000, width: 1920, height: 1080, durationMs: 10000 });
    expect(v.ok).toBe(false);
  });

  it("rejects an oversized image", () => {
    const v = validateMedia({ mimeType: "image/png", size: 50 * 1024 * 1024, width: 1080, height: 1920 });
    expect(v.ok).toBe(false);
  });

  it("rejects a video that is too long", () => {
    const v = validateMedia({ mimeType: "video/mp4", size: 1000, width: 1080, height: 1920, durationMs: 120000 });
    expect(v.ok).toBe(false);
  });

  it("passes when dimensions are unknown (type + size only)", () => {
    const v = validateMedia({ mimeType: "video/mp4", size: 1000 });
    expect(v.ok).toBe(true);
  });
});
