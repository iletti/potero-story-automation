import { neon, type NeonQueryFunction } from "@neondatabase/serverless";

let cached: NeonQueryFunction<false, false> | null = null;

/**
 * Lazily-created Neon client. Initialised on first use (not at import time) so
 * `next build` does not fail when DATABASE_URL is absent in the build step.
 */
export function getSql(): NeonQueryFunction<false, false> {
  if (cached) return cached;
  const url = process.env.DATABASE_URL ?? process.env.POSTGRES_URL;
  if (!url) {
    throw new Error("DATABASE_URL is not set. Add a Neon/Postgres connection string.");
  }
  cached = neon(url);
  return cached;
}
