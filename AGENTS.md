# AGENTS.md — Potero Story Automation

## Project summary

This is a single-tenant Next.js App Router app deployed on Vercel:

- Production app: `https://potero-story-automation.vercel.app`
- Content source: Google Drive folder mirrored into Postgres.
- Publishing provider: Outstand API, publishing Instagram Stories by default.
- Database: Vercel-connected Neon Postgres. Do not set `DATABASE_URL` manually in Vercel; the storage integration owns it.
- Admin UI: `/`, protected by HTTP Basic Auth.
- Cron routes: `/api/cron/sync` and `/api/cron/publish`, protected by `CRON_SECRET`.

## Hard rules

- Never print secret values.
- Never commit `.env.local`, `.vercel/`, `sa.json`, `.cron-secret.current`, or any service account JSON.
- Do not paste `GOOGLE_SERVICE_ACCOUNT_JSON`, `OUTSTAND_API_KEY`, `ADMIN_PASSWORD`, `CRON_SECRET`, or database URLs into docs, commits, logs, or final responses.
- Treat Drive sync and publish checks as production actions. `publish?force=1` creates a real Instagram Story.

## Current production configuration

Required Production env names:

- `ADMIN_USERNAME`
- `ADMIN_PASSWORD`
- `CRON_SECRET`
- `GOOGLE_DRIVE_FOLDER_ID`
- `GOOGLE_SERVICE_ACCOUNT_JSON`
- `OUTSTAND_API_BASE_URL`
- `OUTSTAND_API_KEY`
- `OUTSTAND_ACCOUNTS`
- `OUTSTAND_PUBLISH_AS_STORY`
- `DATABASE_URL` from the connected Neon integration

Known non-secret values:

- `GOOGLE_DRIVE_FOLDER_ID=15H2jnp-Jmg123_KNsUdhIjj-aYU5T6K8`
- `OUTSTAND_API_BASE_URL=https://api.outstand.so`
- `OUTSTAND_PUBLISH_AS_STORY=true`
- The active Instagram account is `poterostandard` on Outstand account id `NZOJa`.

## Verification checklist

Use the production alias unless a task explicitly targets a preview deployment.

1. Confirm deployment is ready:
   `vercel inspect https://potero-story-automation.vercel.app`
2. Confirm env names exist, names only:
   `vercel env ls production`
3. Confirm unauthenticated dashboard is blocked:
   `curl -s -o /dev/null -w "%{http_code}" https://potero-story-automation.vercel.app/`
4. Confirm authenticated dashboard returns `200` using the admin credentials without printing them.
5. Confirm cron auth rejects missing secrets:
   `curl -s -X POST https://potero-story-automation.vercel.app/api/cron/sync`
6. Confirm Drive sync with `CRON_SECRET` returns `{"status":"ok",...}`.
7. Confirm latest Outstand post status through the API or dashboard. The successful smoke-test post is `AJb27`, published to Instagram with one media item.
8. Check recent production errors:
   `vercel logs --environment production --level error --since 1h --no-follow --no-branch --expand`

Avoid forced publish during routine checks unless the user explicitly wants another real Story posted.

## Implementation notes

- The Outstand publish payload must use confirmed media URL objects:
  `containers:[{ media:[{ url, filename }], content:" " }]`.
- Do not send only Outstand media ids in the post payload; that creates a post with no attached media and Instagram rejects it.
- Captionless Stories still need non-empty `content`; the app sends a single space.
- `post_log.status='published'` means Outstand accepted the post. The app then reconciles it to `confirmed` or `failed` using Outstand post status, with the optional webhook as another confirmation path.
- If Outstand reports delivery failure, the media is put back into retry handling. After three consecutive failures the media is disabled.

## Local commands

- `npm test`
- `npm run typecheck`
- `npm run build`
- `DATABASE_URL="<production-or-local-url>" npm run db:migrate`

Run `npm run typecheck` and `npm run build` sequentially. Running them in parallel can race on `.next/types`.
