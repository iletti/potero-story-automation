-- Potero Story Automation — full schema. Safe to run repeatedly.

create extension if not exists pgcrypto;

-- Mirror of the Google Drive folder. One row per file.
--   status: active   = passes constraints, eligible to publish
--           rejected = fails a hard media constraint (see reject_reason)
--           removed  = no longer in the Drive folder
create table if not exists media (
  id             uuid primary key default gen_random_uuid(),
  drive_file_id  text unique not null,
  name           text not null,
  mime_type      text not null,
  size_bytes     bigint not null,
  width          integer,
  height         integer,
  duration_ms    integer,
  status         text not null default 'active',
  reject_reason  text,
  enabled        boolean not null default true,
  fail_count     integer not null default 0,
  last_error     text,
  last_posted_at timestamptz,
  retry_after    timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index if not exists media_pool_idx on media (status, enabled, last_posted_at);

-- One row per publish attempt.
create table if not exists post_log (
  id                uuid primary key default gen_random_uuid(),
  media_id          uuid references media (id) on delete set null,
  provider_media_id text,
  provider_post_id  text,
  status            text not null default 'pending', -- pending | published | confirmed | failed
  error             text,
  created_at        timestamptz not null default now(),
  published_at      timestamptz
);

create index if not exists post_log_published_idx on post_log (published_at desc);

-- Single-row settings table.
create table if not exists settings (
  id              integer primary key default 1,
  paused          boolean not null default false,
  min_reuse_hours integer not null default 336, -- 14 days before a file may repeat
  daily_min       integer not null default 3,
  daily_max       integer not null default 10,
  post_type       text not null default 'story',
  last_synced_at  timestamptz,
  updated_at      timestamptz not null default now(),
  constraint settings_singleton check (id = 1)
);

insert into settings (id) values (1) on conflict (id) do nothing;
