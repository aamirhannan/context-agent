create table if not exists users (
  id               text primary key,
  name             text not null,
  language         text not null,
  subscription     text not null,
  tone_preference  text not null,
  birth_date       date,
  birth_time       time,
  birth_place      text
);

create table if not exists kundli (
  user_id     text primary key references users(id) on delete cascade,
  lagna       text not null,
  moon_sign   text not null,
  mahadasha   text not null,
  antardasha  text not null
);

-- Supports all twelve houses; only 6, 7 and 10 are seeded, matching the brief.
create table if not exists kundli_houses (
  user_id   text not null references users(id) on delete cascade,
  house     int  not null check (house between 1 and 12),
  lord      text not null,
  strength  text not null,
  primary key (user_id, house)
);

create table if not exists horoscope (
  user_id       text not null references users(id) on delete cascade,
  for_date      date not null,
  career        text not null,
  finance       text not null,
  health        text not null,
  relationship  text not null,
  primary key (user_id, for_date)
);

-- No user_id: panchang is global for a given date.
create table if not exists panchang (
  for_date   date primary key,
  tithi      text not null,
  nakshatra  text not null,
  yoga       text not null,
  karana     text not null
);

create table if not exists requests (
  request_id        uuid primary key,
  user_id           text,
  question          text,
  intent            text,
  intent_method     text,
  intent_score      numeric,
  confidence        text,
  selected_context  text[],
  excluded_context  jsonb,
  available_tokens  int,
  prompt_tokens     int,
  reduction_pct     int,
  total_ms          int,
  llm_ms            int,
  sufficient        boolean,
  missing_info      text,
  degradations      text[],
  context_bundle    jsonb,
  prompt_text       text,
  trace             jsonb,
  created_at        timestamptz not null default now()
);

create index if not exists requests_user_created_idx on requests (user_id, created_at desc);
create index if not exists requests_intent_idx on requests (intent);
