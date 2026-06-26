import { readFileSync } from "node:fs";
import { join } from "node:path";
import { neon } from "@neondatabase/serverless";

/** Applies lib/schema.sql against DATABASE_URL. Idempotent. */
async function main() {
  const url = process.env.DATABASE_URL ?? process.env.POSTGRES_URL;
  if (!url) {
    throw new Error("DATABASE_URL is not set.");
  }
  const sql = neon(url);
  const ddl = readFileSync(join(process.cwd(), "lib", "schema.sql"), "utf8");

  const statements = ddl
    .split(";")
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && !s.startsWith("--"));

  for (const statement of statements) {
    await sql.query(statement);
  }

  console.log(`Applied ${statements.length} statements.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
