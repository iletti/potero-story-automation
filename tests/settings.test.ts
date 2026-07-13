import { describe, expect, it, vi } from "vitest";

const sqlMock = vi.fn(async () => [
  {
    paused: false,
    min_reuse_hours: 336,
    daily_min: 3,
    daily_max: 99,
    post_type: "story",
    last_synced_at: null,
  },
]);

vi.mock("../lib/db", () => ({ getSql: () => sqlMock }));

import { DAILY_MAX, DAILY_MIN, getSettings, MIN_REUSE_HOURS } from "../lib/settings";

describe("story policy settings", () => {
  it("enforces 60-day reuse, no minimum, and a hard maximum of 10", async () => {
    expect(MIN_REUSE_HOURS).toBe(60 * 24);
    expect(DAILY_MIN).toBe(0);
    expect(DAILY_MAX).toBe(10);

    await expect(getSettings()).resolves.toMatchObject({
      minReuseHours: 60 * 24,
      dailyMin: 0,
      dailyMax: 10,
    });
  });
});
