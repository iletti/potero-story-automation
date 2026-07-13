# Potero Story Automation

Publishes Stories on a schedule through the **Outstand** API, using a **Google
Drive folder as the only thing you manage**. Drop a video or image in the folder
→ it enters rotation. Remove it → it stops. That's the whole workflow.

One Next.js app on Vercel + one Postgres database. No queues, no workers, no
upload UI, no file storage to manage — Drive is the content store.

## Current production

- App: <https://potero-story-automation.vercel.app>
- Drive folder id: `15H2jnp-Jmg123_KNsUdhIjj-aYU5T6K8`
- Outstand base URL: `https://api.outstand.so`
- Story target: Instagram `poterostandard` (`NZOJa` in Outstand).
- Facebook is intentionally not targeted: Outstand's current Facebook path
  produced Reels and does not document a Facebook Story placement. TikTok is
  also not targeted because Outstand documents TikTok video posts, not TikTok
  Stories.
- Database: Vercel-connected Neon Postgres; `DATABASE_URL` is injected by the
  integration.
- Verified live Story smoke test before Facebook activation: Outstand post
  `AJb27` published to Instagram with one media item and is confirmed in
  `post_log`.

Do not commit or print secret-bearing local files: `.env.local`, `.vercel/`,
`sa.json`, or `.cron-secret.current`.

## Documentation discipline

Keep operational docs current with the system. Any change to routes, cron
schedules, env variables, Outstand payloads, account selectors, database status
semantics, deployment flow, or safety rules must update `README.md` and
`AGENTS.md` in the same change. Production-only configuration changes should be
documented in the next repo change. Use exact dates, deployment ids, commit ids,
endpoint names, and env names when useful, but never include secret values.

## How it works

```
You curate ─▶ Google Drive folder   (the only thing you touch)
                     │
   /api/cron/sync (every 30 min) mirrors the folder into Postgres
                     │     new file → checked against media rules → active / rejected
                     │     removed file → dropped from rotation
                     ▼
   /api/cron/publish (10 slots/day) posts the least-recently-used file,
                     │     streaming it straight from Drive → Outstand
                     ▼
              posted, logged, and put on cooldown
```

The DB never stores your media — it just tracks **what's in the folder, what's
eligible, and when each file was last posted** (for rotation + cooldown).

## Posting volume (auto-ramping 0 → 10/day)

Each day's target grows with your library and is capped so you never post more
than the cooldown can sustain:

```
target = min( 10 , floor(active_pool_size ÷ 60) )
```

There is no daily minimum. The reuse gap is fixed at 60 days:

| Files in folder | Posts/day |
|---:|---:|
| 0–59 | 0 |
| 60–119 | 1 |
| 120–179 | 2 |
| 300–359 | 5 |
| 600+ | 10 (capped) |

New valid files enter the pool automatically on the next 30-minute Drive sync.
As the pool crosses each 60-file threshold, the target rises by one Story/day,
up to 10. The 10 publish slots are **paced across the day** (≈07:00–23:00
Helsinki), so Stories do not all fire in the morning.

## Media rules (hard constraints)

Files that fail these are marked **rejected** during sync (with a reason shown
on the dashboard) and never posted. Defaults — change them in
[`lib/constraints.ts`](lib/constraints.ts):

| | Images | Videos |
|---|---|---|
| Formats | JPEG, PNG | MP4, MOV |
| Max size | 30 MB | 300 MB |
| Duration | — | 1–90 s |
| Orientation | portrait or square | portrait or square |
| Min shortest side | 320 px | 320 px |

Orientation/duration are checked from Drive's own metadata, so no download is
needed to reject a bad file.

## Reliability

- **Even rotation** — always posts the file that's gone longest without posting.
- **Hard 60-day reuse gap** — both `last_posted_at` and accepted Outstand
  attempts are checked, so a missing delivery webhook cannot make a file
  eligible early.
- **No jammed queue** — if a file fails to publish it's retried after 30 min,
  and a run tries the next eligible file so a single bad file never wastes a
  slot. After 3 consecutive failures the file is auto-disabled (visible on the
  dashboard; re-enable with one click).
- **Config errors don't burn media** — missing Outstand env, auth failures, or
  invalid story-channel config fail the publish run without incrementing the
  file's failure count.
- **No double-posting** — files are claimed atomically, so overlapping runs or a
  manual "Publish now" during a cron can't post the same file twice.
- **Delivery reconciliation** — Outstand may accept a post before Instagram
  finishes processing it. Recent accepted posts are reconciled to `confirmed` or
  `failed` on dashboard and publish runs, so downstream Instagram failures do
  not remain marked as successful.

---

# Setup

You need: a **Vercel** account (Pro — sub-daily crons), a **Postgres** database,
a **Google Cloud** project, and your **Outstand** API credentials.

### 1. Google: service account + share the folder  (~10 min, one-time)

1. Go to the [Google Cloud Console](https://console.cloud.google.com/) → create
   (or pick) a project.
2. **APIs & Services → Library →** enable the **Google Drive API**.
3. **APIs & Services → Credentials → Create credentials → Service account.**
   Give it a name (e.g. `potero`), create it.
4. Open the service account → **Keys → Add key → Create new key → JSON.** A
   `.json` file downloads — keep it safe.
5. Copy the service account's email (looks like
   `potero@your-project.iam.gserviceaccount.com`).
6. In **Google Drive**, create the folder for your Story content and **Share**
   it with that email as **Viewer**.
7. Open the folder; its URL is `…/folders/<FOLDER_ID>` — copy the `<FOLDER_ID>`.

### 2. Deploy to Vercel

1. Import this repo in Vercel.
2. **Storage → Create database → Postgres (Neon).** This injects `DATABASE_URL`.
3. **Settings → Environment Variables** — add the rest (see
   [`.env.example`](.env.example)):
   - `ADMIN_USERNAME`, `ADMIN_PASSWORD` — dashboard login.
   - `CRON_SECRET` — `openssl rand -hex 32`.
   - `GOOGLE_SERVICE_ACCOUNT_JSON` — paste the **entire** key file from step 1.4
     (as a single value; keep the `\n` inside `private_key` intact).
   - `GOOGLE_DRIVE_FOLDER_ID` — from step 1.7.
   - `OUTSTAND_API_BASE_URL` (`https://api.outstand.so`), `OUTSTAND_API_KEY` —
     your Outstand credentials.
   - `OUTSTAND_ACCOUNTS` — account(s) to post to (comma-separated; a network name
     like `instagram`/`facebook`, a username, or an account id). Prefix opaque
     selectors with the channel, for example `instagram:NZOJa`;
     the app sends only the part after `:` to Outstand. Required. Current
     production uses `instagram:NZOJa`.
   - `OUTSTAND_PUBLISH_AS_STORY` — `true` (default) posts story-type content;
     `false` posts a feed post.
   - `OUTSTAND_STORY_CHANNELS` — optional comma-separated platform override
     names. The app infers `instagram` from the current prefixed selector, so
     this variable is not needed in production.
   - `OUTSTAND_STORY_CONFIG_JSON` — optional JSON object for additional
     story-capable channels or provider-specific overrides, for example
     `{"custom":{"publishAsStory":true}}`. Required for any
     `OUTSTAND_STORY_CHANNELS` entry that does not have a built-in override.
     Custom JSON keys can also be used as `OUTSTAND_ACCOUNTS` prefixes, for
     example `custom:<id>`.
   - `OUTSTAND_WEBHOOK_SECRET` — only if you use the optional webhook (below).
4. Deploy.

### 3. Create the tables

Run once against the production database:

```bash
npm install
DATABASE_URL="<your postgres url>" npm run db:migrate
```

### 4. Go live

1. Drop a few videos/images into the Drive folder.
2. Open the app, log in, press **Sync Drive now** — files appear as *active* or
   *rejected*.
3. Press **Publish next now** to smoke-test one post end-to-end.
4. Leave it. Sync runs every 30 min and publishing runs on its slots.

That's it — from now on you only touch the Drive folder.

## Operating it (dashboard at `/`)

- **Sync Drive now / Publish next now / Pause** — manual controls.
- **Settings** — displays the fixed 60-day / 0–10-per-day policy.
- **Drive folder** — every file with its state (active / rejected + reason /
  disabled / removed) and last-posted time. Disable/enable individual files.
- **Recent posts** — outcome of each publish attempt.

## Outstand API mapping (verified in production)

`lib/outstand.ts` implements the documented Outstand flow:

| Step | Call |
|---|---|
| Get upload URL | `POST /v1/media/upload` `{ filename, content_type }` → `data.upload_url`, `data.id` |
| Upload bytes | `PUT <upload_url>` (streamed from Drive) |
| Confirm | `POST /v1/media/{id}/confirm` `{ size }` |
| Publish | `POST /v1/posts/` `{ containers:[{ media:[{ url, filename }], content }], accounts, instagram:{ publishAsStory:true } }` → `post.id` |

Auth is `Authorization: Bearer <OUTSTAND_API_KEY>`. Story publishing is enabled
with platform-specific overrides. By default the app sends
`instagram.publishAsStory = true`. Instagram is the only built-in Story channel.
An unknown channel listed in `OUTSTAND_STORY_CHANNELS` must have an explicitly
verified JSON override, otherwise publishing fails before a post is created.
For future channels with opaque account selectors, define the JSON override and
use the same key as an account prefix, for example
`OUTSTAND_ACCOUNTS=custom:<id>` with
`OUTSTAND_STORY_CONFIG_JSON={"custom":{"publishAsStory":true}}`.
For captionless Stories the app sends a single-space `content` value because
Outstand requires a non-empty string.
Important: post creation must use the confirmed media `url` and `filename`.
Sending only the uploaded media id creates a post with no attached media, and
Instagram rejects it.
The optional webhook verifies the `X-Outstand-Signature` HMAC-SHA256 header and
reacts to `post.published` / `post.error` events (`data.postId`).

## Production checks

Run these without printing secret values:

| Check | Expected |
|---|---|
| `vercel inspect https://potero-story-automation.vercel.app` | latest production deployment is `Ready` |
| unauthenticated `GET /` | `401` |
| authenticated `GET /` | `200` |
| unauthenticated `POST /api/cron/sync` | `401` |
| authorized `POST /api/cron/config` | `{"status":"ok","accountCount":N,"storyChannels":["instagram",...],"publishAsStory":true}` |
| authorized `POST /api/cron/sync` | `{"status":"ok","active":N,"rejected":N,"removed":N,"total":N}` |
| recent Vercel `500` logs | none |

Routine production reviews should not call
`/api/cron/publish?force=1` unless another real Story is intended.

## Vercel CLI quick reference

Use Vercel CLI for deployment, env-name checks, alias inspection, and logs. The
production alias is always the live target:
`https://potero-story-automation.vercel.app`.

| Task | Command |
|---|---|
| Inspect live deployment | `vercel inspect https://potero-story-automation.vercel.app` |
| List production env names | `vercel env ls production` |
| Pull local env placeholders/non-sensitive values | `vercel env pull .env.local --environment=production --yes` |
| Check recent production errors | `vercel logs --environment production --level error --since 1h --no-follow --no-branch --expand` |
| Deploy current checkout to production | `npx -y vercel@latest deploy --prod -y` |
| Update a sensitive production env | `printf '%s' '<value>' \| npx -y vercel@latest env update NAME production --sensitive --yes` |

Important Vercel notes:

- `vercel env pull` can leave protected app secrets as placeholders. Check only
  names or presence; never print values.
- Production env changes require a new deployment before serverless functions
  see the updated values.
- Use `npx -y vercel@latest` if the globally installed `vercel` CLI cannot
  update sensitive env vars correctly.
- Do not put real secret values in commands that will be pasted into docs,
  commits, or final reports. Use stdin or ignored local files.

## Facebook and TikTok placement limitation

Current production deliberately targets Instagram Stories only:

```text
OUTSTAND_ACCOUNTS=instagram:NZOJa
OUTSTAND_PUBLISH_AS_STORY=true
```

As checked on July 13, 2026, Outstand documents Instagram's
`publishAsStory` override. Its Facebook schema documents Page-post options but
not a Story placement; video delivery was observed as a Reel. Its TikTok schema
supports ordinary video upload modes and privacy/interaction settings, but not
a Story placement. Facebook and TikTok must stay out of `OUTSTAND_ACCOUNTS`
until Outstand documents and verifies true Story-only payloads. A TikTok managed
OAuth key is not itself a connected TikTok social account.

## Future account expansion notes

The app is not being scaled to more accounts yet. These notes preserve what is
already known so a future expansion starts from the right model:

- Today, one eligible Drive media item is selected and published as one Outstand
  post to every selector in `OUTSTAND_ACCOUNTS`.
- The app has one Google Drive content folder, one media pool, one global
  settings row, and one global schedule. There is no per-account content library
  or per-account schedule yet.
- `post_log` stores one provider post id per publish attempt. If future work
  needs provider-specific delivery reporting, add an explicit per-account or
  per-channel delivery model instead of encoding multiple outcomes into one
  status.
- Prefer prefixed selectors for any opaque Outstand id or username:
  `channel:outstandSelector`. The prefix selects the story override, and only
  the selector after `:` is sent to Outstand.
- A built-in Story override exists only for `instagram`. Future
  story-capable channels can be configured without code only when
  `OUTSTAND_STORY_CONFIG_JSON` defines the provider-specific override.
- Known connected Outstand accounts from the July 1, 2026 inventory:

| Network | Username | Outstand selector | Type | Current use |
|---|---|---|---|---|
| Instagram | `poterostandard` | `NZOJa` | personal | active Story target |
| Facebook | `Potero Standard` | `HTPQ5` | page | disabled; video became Reel |
| Threads | `poterostandard` | `vBUEg` | personal | not configured |
| YouTube | `@poterostandard` | `I96WX` | personal | not configured |
| LinkedIn | `potero-standard` | `cMfKL` | organization | not configured |

Before adding a new network, confirm in Outstand whether it supports the desired
Story-style publishing payload. Do not assume a feed post, short-form video, and
Story use the same account selector or platform override.

## Local env setup

`.env.local` is ignored. Pulling from Vercel can refresh non-sensitive
integration variables, but protected app secrets may still be written as
placeholders:

```bash
vercel env pull .env.local --environment=production --yes
```

After pulling, check only variable names or presence. Do not print values.
Known safe defaults for local setup:

```bash
GOOGLE_DRIVE_FOLDER_ID=15H2jnp-Jmg123_KNsUdhIjj-aYU5T6K8
OUTSTAND_API_BASE_URL=https://api.outstand.so
OUTSTAND_ACCOUNTS=instagram:NZOJa
OUTSTAND_PUBLISH_AS_STORY=true
```

The remaining secret values must come from the operator, Vercel runtime, or an
already-provisioned ignored local file.

## Optional: delivery webhook

Outstand can call `POST /api/webhooks/outstand` when a post finishes delivering.
Register that URL in Outstand with your `OUTSTAND_WEBHOOK_SECRET` and the matching
`post_log` row is updated to `confirmed` / `failed`. Accepted provider attempts
remain part of the 60-day reuse safety check even if delivery later fails. The
system also reconciles delivery status without the webhook.

## Scripts

| Command | Purpose |
|---|---|
| `npm run dev` | Local dev server. |
| `npm run build` | Production build. |
| `npm run db:migrate` | Apply `lib/schema.sql` to `DATABASE_URL`. |
| `npm run typecheck` | TypeScript check. |
| `npm test` | Unit tests (constraints, scheduling, auth, webhook). |
