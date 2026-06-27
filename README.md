# Potero Story Automation

Publishes Stories on a schedule through the **Outstand** API, using a **Google
Drive folder as the only thing you manage**. Drop a video or image in the folder
→ it enters rotation. Remove it → it stops. That's the whole workflow.

One Next.js app on Vercel + one Postgres database. No queues, no workers, no
upload UI, no file storage to manage — Drive is the content store.

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

## Posting volume (auto-ramping 3 → 10/day)

Each day's target grows with your library and is capped so you never post more
than the cooldown can sustain:

```
target = clamp( daily_min , daily_max , floor(pool_size ÷ cooldown_days) )
```

With the defaults (**min 3, max 10, cooldown 14 days**):

| Files in folder | Posts/day |
|---:|---:|
| up to 42 | 3 (minimum) |
| 84 | 6 |
| 112 | 8 |
| 140+ | 10 (capped) |

Below the level needed for the minimum, it still aims for 3/day and simply
skips slots when nothing is eligible — add more content and it fills in. The 10
daily publish slots are **paced evenly across the day** (≈07:00–23:00 Helsinki),
so Stories don't all fire in the morning. All knobs are editable on the
dashboard.

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
- **Cooldown** — a file can't repeat until `cooldown_days` have passed.
- **No jammed queue** — if a file fails to publish it's retried after 30 min,
  and a run tries the next eligible file so a single bad file never wastes a
  slot. After 3 consecutive failures the file is auto-disabled (visible on the
  dashboard; re-enable with one click).
- **No double-posting** — files are claimed atomically, so overlapping runs or a
  manual "Publish now" during a cron can't post the same file twice.

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
     like `instagram`, a username, or an account id). Required.
   - `OUTSTAND_PUBLISH_AS_STORY` — `true` (default) posts an Instagram Story;
     `false` posts a feed post.
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
- **Settings** — cooldown days, min/day, max/day.
- **Drive folder** — every file with its state (active / rejected + reason /
  disabled / removed) and last-posted time. Disable/enable individual files.
- **Recent posts** — outcome of each publish attempt.

## Outstand API mapping (verified against the docs)

`lib/outstand.ts` implements the documented Outstand flow:

| Step | Call |
|---|---|
| Get upload URL | `POST /v1/media/upload` `{ filename, content_type }` → `data.upload_url`, `data.id` |
| Upload bytes | `PUT <upload_url>` (streamed from Drive) |
| Confirm | `POST /v1/media/{id}/confirm` `{ size }` |
| Publish | `POST /v1/posts/` `{ containers:[{ mediaIds, content }], accounts, instagram:{ publishAsStory } }` → `post.id` |

Auth is `Authorization: Bearer <OUTSTAND_API_KEY>`. A Story is published by
setting `instagram.publishAsStory = true` (controlled by `OUTSTAND_PUBLISH_AS_STORY`).
For captionless Stories the app sends a single-space `content` value because
Outstand requires a non-empty string.
The optional webhook verifies the `X-Outstand-Signature` HMAC-SHA256 header and
reacts to `post.published` / `post.error` events (`data.postId`).

## Optional: delivery webhook

Outstand can call `POST /api/webhooks/outstand` when a post finishes delivering.
Register that URL in Outstand with your `OUTSTAND_WEBHOOK_SECRET` and the matching
`post_log` row is updated to `confirmed` / `failed`. Delivery failures also put
the media back into retry handling so a failed delivery does not stay on
cooldown as if it had succeeded. The system works fine without it.

## Scripts

| Command | Purpose |
|---|---|
| `npm run dev` | Local dev server. |
| `npm run build` | Production build. |
| `npm run db:migrate` | Apply `lib/schema.sql` to `DATABASE_URL`. |
| `npm run typecheck` | TypeScript check. |
| `npm test` | Unit tests (constraints, scheduling, auth, webhook). |
