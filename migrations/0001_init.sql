-- Synced tables: every row carries id, user_id, updated_at, deleted, version.
-- updated_at is the client's edit time (epoch ms) and decides last-writer-wins.
-- version is assigned by the server on each accepted write and is the pull cursor,
-- so changes uploaded late by an offline device are still delivered to others.
-- Foreign keys are not enforced: parents and children may arrive in separate pushes.

CREATE TABLE trips (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  start_date TEXT,
  end_date TEXT,
  party_size INTEGER NOT NULL DEFAULT 1,
  time_zone TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted INTEGER NOT NULL DEFAULT 0,
  version INTEGER NOT NULL
);
CREATE INDEX trips_pull ON trips (user_id, version);

CREATE TABLE days (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  trip_id TEXT NOT NULL,
  date TEXT NOT NULL,
  depart_time TEXT NOT NULL DEFAULT '09:00',
  updated_at INTEGER NOT NULL,
  deleted INTEGER NOT NULL DEFAULT 0,
  version INTEGER NOT NULL
);
CREATE INDEX days_pull ON days (user_id, version);

CREATE TABLE stops (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  trip_id TEXT NOT NULL,
  day_id TEXT,
  position TEXT NOT NULL,
  place_id TEXT,
  name TEXT NOT NULL,
  address TEXT,
  lat REAL,
  lng REAL,
  place_fetched_at INTEGER,
  kind TEXT NOT NULL CHECK (kind IN ('sight', 'food', 'lodging', 'transport', 'other')),
  arrival_mode TEXT NOT NULL DEFAULT 'auto' CHECK (arrival_mode IN ('auto', 'fixed')),
  fixed_time TEXT,
  stay_minutes INTEGER NOT NULL,
  note TEXT,
  updated_at INTEGER NOT NULL,
  deleted INTEGER NOT NULL DEFAULT 0,
  version INTEGER NOT NULL,
  CHECK (arrival_mode = 'auto' OR fixed_time IS NOT NULL)
);
CREATE INDEX stops_pull ON stops (user_id, version);

CREATE TABLE legs (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  trip_id TEXT NOT NULL,
  from_stop_id TEXT NOT NULL,
  to_stop_id TEXT NOT NULL,
  mode TEXT NOT NULL CHECK (mode IN ('transit', 'drive', 'walk', 'bicycle')),
  minutes INTEGER,
  steps TEXT,
  polyline TEXT,
  source TEXT NOT NULL CHECK (source IN ('google', 'manual')),
  fetched_at INTEGER,
  query_depart_at INTEGER,
  updated_at INTEGER NOT NULL,
  deleted INTEGER NOT NULL DEFAULT 0,
  version INTEGER NOT NULL
);
CREATE INDEX legs_pull ON legs (user_id, version);
CREATE UNIQUE INDEX legs_pair ON legs (user_id, from_stop_id, to_stop_id) WHERE deleted = 0;

CREATE TABLE reservations (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  trip_id TEXT NOT NULL,
  stop_id TEXT NOT NULL,
  time TEXT,
  party_size INTEGER,
  code TEXT,
  url TEXT,
  status TEXT NOT NULL CHECK (status IN ('confirmed', 'pending', 'payment_due')),
  updated_at INTEGER NOT NULL,
  deleted INTEGER NOT NULL DEFAULT 0,
  version INTEGER NOT NULL
);
CREATE INDEX reservations_pull ON reservations (user_id, version);

CREATE TABLE attachments (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  reservation_id TEXT NOT NULL,
  r2_key TEXT NOT NULL,
  filename TEXT NOT NULL,
  content_type TEXT NOT NULL,
  size INTEGER NOT NULL,
  uploaded INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL,
  deleted INTEGER NOT NULL DEFAULT 0,
  version INTEGER NOT NULL
);
CREATE INDEX attachments_pull ON attachments (user_id, version);

-- Server-only tables (not synced)

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL
);

CREATE TABLE sync_counter (
  user_id TEXT PRIMARY KEY,
  value INTEGER NOT NULL
);

CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  user_agent TEXT
);
CREATE INDEX sessions_expiry ON sessions (expires_at);

CREATE TABLE login_attempts (
  key TEXT PRIMARY KEY,
  failures INTEGER NOT NULL,
  window_start INTEGER NOT NULL,
  locked_until INTEGER
);

CREATE TABLE route_cache (
  key TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  response TEXT NOT NULL,
  fetched_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX route_cache_expiry ON route_cache (expires_at);
