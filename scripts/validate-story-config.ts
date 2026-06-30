/**
 * Dry-run validator for Outstand story-channel configuration.
 *
 * Usage:
 *   npm run outstand:story-config
 *
 * This does not call Outstand and does not publish anything. It loads
 * `.env.local` when present, resolves the configured account selectors and
 * platform story overrides, then prints only counts/channel names.
 */

import { getStoryConfigSummary } from "../lib/outstand";
import { loadLocalEnv } from "./env";

function main(): void {
  loadLocalEnv();

  const summary = getStoryConfigSummary();

  console.log(`accounts: ${summary.accountCount}`);
  console.log(`story channels: ${summary.storyChannels.length > 0 ? summary.storyChannels.join(",") : "none"}`);
  console.log("story config: ok");
}

try {
  main();
} catch (err) {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
}
