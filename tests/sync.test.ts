import { beforeEach, describe, expect, it, vi } from "vitest";

type SqlCall = { query: string; values: unknown[] };
const calls: SqlCall[] = [];

const sqlMock = vi.fn(async (strings: TemplateStringsArray, ...values: unknown[]) => {
  const query = strings.join("?");
  calls.push({ query, values });
  if (query.includes("select status, count(*)::int")) return [{ status: "active", n: 1 }];
  return [];
});

vi.mock("../lib/db", () => ({ getSql: () => sqlMock }));
vi.mock("../lib/google-drive", () => ({
  listFolder: async () => [
    {
      id: "drive-new-1",
      name: "new-story.mp4",
      mimeType: "video/mp4",
      size: 1_000_000,
      width: 1080,
      height: 1920,
      durationMs: 15_000,
    },
  ],
}));
vi.mock("../lib/settings", () => ({ markSynced: vi.fn() }));

import { syncDrive } from "../lib/sync";

describe("Drive auto-onboarding", () => {
  beforeEach(() => {
    calls.length = 0;
    sqlMock.mockClear();
  });

  it("adds a new valid Drive file directly to the active pool", async () => {
    await expect(syncDrive()).resolves.toMatchObject({ active: 1 });

    const insert = calls.find((call) => call.query.includes("insert into media"));
    expect(insert?.query).toContain("on conflict (drive_file_id) do update");
    expect(insert?.values).toContain("drive-new-1");
    expect(insert?.values).toContain("active");
  });
});
