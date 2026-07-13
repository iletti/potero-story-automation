# AGENTS.md — Potero Story Automation

## Project summary

This is a single-tenant Next.js App Router app deployed on Vercel:

- Production app: `https://potero-story-automation.vercel.app`
- Content source: Google Drive folder mirrored into Postgres.
- Publishing provider: Outstand API, publishing story-type content. Instagram
  Stories remain the default; Facebook Stories and future story-capable channels
  are configured through Outstand channel envs.
- Database: Vercel-connected Neon Postgres. Do not set `DATABASE_URL` manually in Vercel; the storage integration owns it.
- Admin UI: `/`, protected by HTTP Basic Auth.
- Cron routes: `/api/cron/sync`, `/api/cron/publish`, and `/api/cron/config`,
  protected by `CRON_SECRET`.

## Hard rules

- Never print secret values.
- Never commit `.env.local`, `.vercel/`, `sa.json`, `.cron-secret.current`, or any service account JSON.
- Do not paste `GOOGLE_SERVICE_ACCOUNT_JSON`, `OUTSTAND_API_KEY`, `ADMIN_PASSWORD`, `CRON_SECRET`, or database URLs into docs, commits, logs, or final responses.
- Treat Drive sync and publish checks as production actions. `publish?force=1`
  creates a real Story on every configured Outstand account.

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
- `OUTSTAND_STORY_CHANNELS` when `OUTSTAND_ACCOUNTS` uses account ids/usernames
  without `network:` prefixes and the app cannot infer channel names
- `DATABASE_URL` from the connected Neon integration

Known non-secret values:

- `GOOGLE_DRIVE_FOLDER_ID=15H2jnp-Jmg123_KNsUdhIjj-aYU5T6K8`
- `OUTSTAND_API_BASE_URL=https://api.outstand.so`
- `OUTSTAND_PUBLISH_AS_STORY=true`
- The active Instagram account is `poterostandard` on Outstand account id `NZOJa`.
- The active Facebook Page is `Potero Standard` on Outstand account id `HTPQ5`.
- Current multi-channel selector:
  `OUTSTAND_ACCOUNTS=instagram:NZOJa,facebook:HTPQ5`.
- `OUTSTAND_STORY_CHANNELS` is not needed with these prefixed selectors. Set
  `OUTSTAND_STORY_CHANNELS=instagram,facebook` only for unprefixed ids.

## Local environment

- `.env.local` is ignored and may contain real local/prod credentials. Never
  print it.
- `vercel env pull .env.local --environment=production --yes` can refresh
  non-sensitive integration values, but Vercel may write placeholders for
  sensitive app variables. After pulling, check names/presence only, never
  values.
- Current safe local defaults are:
  `GOOGLE_DRIVE_FOLDER_ID=15H2jnp-Jmg123_KNsUdhIjj-aYU5T6K8`,
  `OUTSTAND_API_BASE_URL=https://api.outstand.so`,
  `OUTSTAND_ACCOUNTS=instagram:NZOJa,facebook:HTPQ5`,
  `OUTSTAND_PUBLISH_AS_STORY=true`.
- Secret values still need to come from the operator, Vercel runtime, or an
  already-provisioned ignored local file: `ADMIN_PASSWORD`, `CRON_SECRET`,
  `GOOGLE_SERVICE_ACCOUNT_JSON`, `OUTSTAND_API_KEY`, and database URLs.

## Vercel CLI operations

Use the Vercel CLI when production deployment, env names, logs, or aliases need
to be checked or changed. Prefer the current CLI via `npx -y vercel@latest` when
the installed `vercel` command behaves differently from docs, especially for
sensitive env updates.

Safe commands:

- Inspect active production deployment:
  `vercel inspect https://potero-story-automation.vercel.app`
- List production env names only:
  `vercel env ls production`
- Pull local env placeholders/non-sensitive integration values:
  `vercel env pull .env.local --environment=production --yes`
- Check recent production errors:
  `vercel logs --environment production --level error --since 1h --no-follow --no-branch --expand`
- Deploy current checkout to production only when the user asks for production
  or production activation is the task:
  `npx -y vercel@latest deploy --prod -y`
- Update sensitive production env via stdin so the value is not printed:
  `printf '%s' '<value>' | npx -y vercel@latest env update NAME production --sensitive --yes`

Vercel caveats:

- `vercel env pull` may write placeholders for sensitive app variables. Do not
  assume it retrieved `CRON_SECRET`, `OUTSTAND_API_KEY`, `ADMIN_PASSWORD`, or
  `GOOGLE_SERVICE_ACCOUNT_JSON`.
- Vercel env changes require a new deployment before production functions use
  the new values.
- The production alias is the source of truth for live checks:
  `https://potero-story-automation.vercel.app`.
- Never pass secret values in shell commands that will be shown in the final
  response. If a command must use a secret, read it from an ignored file or
  stdin and report only the result.

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
7. Confirm story-channel config with `CRON_SECRET` returns `{"status":"ok",...}`.
8. Confirm latest Outstand post status through the API or dashboard. The older
   successful smoke-test post is `AJb27`, published to Instagram with one media
   item before Facebook was enabled.
9. Check recent production errors:
   `vercel logs --environment production --level error --since 1h --no-follow --no-branch --expand`

Avoid forced publish during routine checks unless the user explicitly wants another real Story posted.

## Documentation discipline

Keep docs in the same change as behavior or configuration updates. If you touch
any route, cron schedule, env variable, provider payload, account selector,
database status meaning, deployment flow, or safety rule, update `AGENTS.md`
and the relevant `README.md` section before finishing. If production env changes
without a code diff, still update the docs in the next repo change. Prefer exact
dates, deployment ids, commit ids, endpoint names, and env names; never include
secret values.

## Implementation notes

- The Outstand publish payload must use confirmed media URL objects and
  platform-specific story overrides:
  `containers:[{ media:[{ url, filename }], content:" " }]` plus
  `instagram:{ publishAsStory:true }` / `facebook:{ publishAsStory:true }`.
- Do not send only Outstand media ids in the post payload; that creates a post with no attached media and Instagram rejects it.
- Captionless Stories still need non-empty `content`; the app sends a single space.
- `post_log.status='published'` means Outstand accepted the post. The app then reconciles it to `confirmed` or `failed` using Outstand post status, with the optional webhook as another confirmation path.
- If Outstand reports delivery failure, the media is put back into retry handling. After three consecutive failures the media is disabled.

## Future expansion facts

This app is intentionally still single-tenant and single-library. Do not convert
it to a multi-tenant system without an explicit design task. Known facts that
will matter for future expansion:

- Current publish behavior selects one eligible Drive media item and creates one
  Outstand post targeting all selectors in `OUTSTAND_ACCOUNTS`.
- Current content scope is one Google Drive folder mirrored into one `media`
  pool. There is no per-account content partitioning yet.
- Current settings are global: pause, cooldown, daily min/max, and post type
  apply to all configured accounts together.
- Current `post_log` records one provider post id per publish attempt. If future
  requirements need per-network delivery accounting, model provider account or
  channel status explicitly instead of overloading the current status field.
- Prefixed selectors are the preferred expansion shape:
  `channel:outstandSelector`. The app sends only `outstandSelector` to Outstand
  and uses `channel` to infer story overrides.
- Built-in story overrides currently exist for `instagram` and `facebook`.
  Future story-capable channels can be added without code only when
  `OUTSTAND_STORY_CONFIG_JSON` contains the provider-specific override for that
  channel.
- Known connected Outstand accounts from the July 1, 2026 account inventory:
  Instagram `poterostandard` = `NZOJa`, Facebook Page `Potero Standard` =
  `HTPQ5`, Threads `poterostandard` = `vBUEg`, YouTube `@poterostandard` =
  `I96WX`, LinkedIn organization `potero-standard` = `cMfKL`.
- Before adding an account, verify whether Outstand supports Story-style
  publishing for that network. Do not assume feed, short-form video, and story
  payloads use the same override.

## Local commands

- `npm test`
- `npm run typecheck`
- `npm run build`
- `DATABASE_URL="<production-or-local-url>" npm run db:migrate`

Run `npm run typecheck` and `npm run build` sequentially. Running them in parallel can race on `.next/types`.
