# Potero Story Automation

A deliberately small system that publishes Stories on a schedule through the
**Outstand** API. One Next.js app on Vercel, one Postgres table set, Vercel Blob
for video storage, and one cron route. No queues, no workers, no extra services.

## How it works

```
You —upload video—▶ Vercel Blob —┐
                                     │   (video pool, in Postgres)
Vercel Cron —×/day—▶ /api/cron/publish
                                     │
                 pick least-recently-posted active video
                                     │
        request upload URL → stream Blob → Outstand → confirm → POST /v1/posts
                                     │
                          record result in post_log
```

Each scheduled run publishes **one** video: the active video that was posted
longest ago (and is past its reuse cooldown). After a successful publish the
video's `last_posted_at` advances, so the pool rotates evenly.

## Stack

- **Next.js (App Router)** on Vercel — admin dashboard + API routes.
- **Neon / Vercel Postgres** — `media`, `post_log`, `settings` tables.
- **Vercel Blob** — stores uploaded videos; the browser uploads directly to it.
- **Vercel Cron** — fires `/api/cron/publish` at fixed daily slots.
- **Outstand API** — the actual publishing.

## Setup

1. **Create the app on Vercel** and import this repo.
2. **Add storage**: in the Vercel project, add a **Postgres** (Neon) database and
   a **Blob** store. Vercel injects `DATABASE_URL` and `BLOB_READ_WRITE_TOKEN`.
3. **Set environment variables** (Project → Settings → Environment Variables) —
   see [`.env.example`](.env.example):
   - `ADMIN_USERNAME`, `ADMIN_PASSWORD` — dashboard login.
   - `CRON_SECRET` — `openssl rand -hex 32`. Vercel sends it to the cron route.
   - `OUTSTAND_API_BASE_URL`, `OUTSTAND_API_KEY` — your Outstand credentials.
   - `OUTSTAND_WEBHOOK_SECRET` — only if you use the optional delivery webhook.
4. **Run migrations** once (locally, against the production DB):
   ```bash
   npm install
   DATABASE_URL="<your postgres url>" npm run db:migrate
   ```
5. **Deploy.** Open the app, log in, upload a few videos, hit **Publish next
   now** to smoke-test, then let the cron take over.

## Operating it

Everything is on the dashboard (`/`, behind Basic Auth):

- **Upload** — drag in a vertical `.mp4`; it goes straight to Vercel Blob.
- **Video pool** — enable/disable or delete each video.
- **Pause / Resume** — global kill switch; paused runs publish nothing.
- **Publish next now** — manually trigger one publish (same path as the cron).
- **Recent posts** — outcome of each attempt (`published`, `failed`, …).

## Schedule

Defined in [`vercel.json`](vercel.json) — 06:00 / 12:00 / 18:00 UTC by default.
Add or change the `crons` entries to publish more or fewer times per day; each
run publishes one video.

## Reuse cooldown

`settings.min_reuse_hours` (default **720 h = 30 days**) is the minimum time
before a video can repeat. A video is eligible only when it is enabled and its
last post is older than the cooldown. If nothing is eligible, the run is skipped
(`no_media_due`) and nothing is published.

## Optional: delivery webhook

Outstand can call `POST /api/webhooks/outstand` when a post finishes delivering.
Register that URL in Outstand with your `OUTSTAND_WEBHOOK_SECRET` and the
matching `post_log` row is updated to `confirmed` / `failed`. The system works
fine without it — a successful `POST /v1/posts` already marks a post published.

## Scripts

| Command | Purpose |
|---|---|
| `npm run dev` | Local dev server. |
| `npm run build` | Production build. |
| `npm run db:migrate` | Apply `lib/schema.sql` to `DATABASE_URL`. |
| `npm run typecheck` | TypeScript check. |
| `npm test` | Unit tests (auth + webhook verification). |
