-- Potero Story Automation — full schema. Safe to run repeatedly.

create extension if not exists pgcrypto;

-- Uploaded videos available for publishing.
create table if not exists media (
  id             uuid primary key default gen_random_uuid(),
  blob_url       text not null,
  pathname       text not null,
  content_type   text not null,
  size_bytes     bigint not null,
  caption        text not null default '',
  enabled        boolean not null default true,
  last_posted_at timestamptz,
  created_at     timestamptz not null default now()
);

create index if not exists media_eligible_idx on media (enabled, last_posted_at);

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

create index if not exists post_log_created_at_idx on post_log (created_at desc);

-- Single-row settings table.
create table if not exists settings (
  id              integer primary key default 1,
  paused          boolean not null default false,
  min_reuse_hours integer not null default 720, -- 30 days before a video may repeat
  post_type       text not null default 'story',
  updated_at      timestamptz not null default now(),
  constraint settings_singleton check (id = 1)
);

insert into settings (id) values (1) on conflict (id) do nothing;
