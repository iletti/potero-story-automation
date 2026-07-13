import { beforeEach, describe, expect, it, vi } from "vitest";

type SqlCall = { query: string; values: unknown[] };
const calls: SqlCall[] = [];
let postedToday = 0;

const sqlMock = vi.fn(async (strings: TemplateStringsArray, ...values: unknown[]) => {
  const query = strings.join("?");
  calls.push({ query, values });
  if (query.includes("count(*)::int as n from media")) return [{ n: 120 }];
  if (query.includes("count(*)::int as n from post_log")) return [{ n: postedToday }];
  if (query.includes("select id, drive_file_id")) return [];
  return [];
});

vi.mock("../lib/db", () => ({ getSql: () => sqlMock }));
vi.mock("../lib/settings", () => ({
  DAILY_MAX: 10,
  getSettings: async () => ({
    paused: false,
    minReuseHours: 60 * 24,
    dailyMin: 0,
    dailyMax: 10,
    postType: "story",
    lastSyncedAt: null,
  }),
}));
vi.mock("../lib/google-drive", () => ({ downloadStream: vi.fn() }));
vi.mock("../lib/outstand", () => ({
  OutstandError: class OutstandError extends Error {},
  confirmUpload: vi.fn(),
  createPost: vi.fn(),
  getPostStatus: vi.fn(),
  isOutstandConfigurationError: vi.fn(() => false),
  requestUploadUrl: vi.fn(),
  uploadMedia: vi.fn(),
}));

import { publishNextStory } from "../lib/publish";

describe("publish safety policy", () => {
  beforeEach(() => {
    calls.length = 0;
    postedToday = 0;
    sqlMock.mockClear();
  });

  it("blocks recently accepted provider posts for the full 60-day window", async () => {
    await expect(publishNextStory(new Date("2026-07-13T22:00:00Z"))).resolves.toMatchObject({
      status: "skipped",
      reason: "no_media_due",
    });

    const candidateQuery = calls.find((call) => call.query.includes("select id, drive_file_id"));
    expect(candidateQuery?.query).toContain("not exists");
    expect(candidateQuery?.query).toContain("recent.provider_post_id is not null");
    expect(candidateQuery?.query).toContain("recent.published_at >= now()");
    expect(candidateQuery?.values.filter((value) => value === 60 * 24)).toHaveLength(2);
  });

  it("does not let force mode exceed 10 accepted provider posts per day", async () => {
    postedToday = 10;

    await expect(
      publishNextStory(new Date("2026-07-13T22:00:00Z"), { force: true }),
    ).resolves.toMatchObject({ status: "skipped", reason: "hard_daily_limit_reached" });
    expect(calls.some((call) => call.query.includes("select id, drive_file_id"))).toBe(false);
  });
});
