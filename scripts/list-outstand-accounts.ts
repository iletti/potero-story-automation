/**
 * Read-only helper for finding Outstand account selectors.
 *
 * Usage:
 *   npm run outstand:accounts
 *
 * The script reads `.env.local` when present, without overriding shell env vars.
 * It prints connected account metadata only; it never prints API keys or env
 * values. Account ids are used as non-secret selectors by this app.
 */

import { loadLocalEnv } from "./env";

type SocialAccount = {
  id?: unknown;
  network?: unknown;
  username?: unknown;
  nickname?: unknown;
  status?: unknown;
};

function env(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set.`);
  return value;
}

function asRows(json: unknown): SocialAccount[] {
  if (Array.isArray(json)) return json as SocialAccount[];
  if (!json || typeof json !== "object") return [];
  const body = json as {
    socialAccounts?: unknown;
    accounts?: unknown;
    data?: unknown;
  };
  if (Array.isArray(body.socialAccounts)) return body.socialAccounts as SocialAccount[];
  if (Array.isArray(body.accounts)) return body.accounts as SocialAccount[];
  if (Array.isArray(body.data)) return body.data as SocialAccount[];
  return [];
}

function field(value: unknown): string {
  return typeof value === "string" && value ? value : "-";
}

async function main(): Promise<void> {
  loadLocalEnv();

  const baseUrl = (process.env.OUTSTAND_API_BASE_URL ?? "https://api.outstand.so").replace(/\/+$/, "");
  const apiKey = env("OUTSTAND_API_KEY");

  const response = await fetch(`${baseUrl}/v1/social-accounts`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`Outstand /v1/social-accounts returned ${response.status}: ${detail.slice(0, 200)}`);
  }

  const rows = asRows(await response.json());
  if (rows.length === 0) {
    console.log("No connected social accounts found in the recognized response shape.");
    return;
  }

  console.log(["network", "username", "nickname", "id", "status"].join("\t"));
  for (const row of rows) {
    console.log([field(row.network), field(row.username), field(row.nickname), field(row.id), field(row.status)].join("\t"));
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
