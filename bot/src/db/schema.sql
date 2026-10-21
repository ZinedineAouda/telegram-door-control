-- Enable WAL mode for better concurrent read/write
PRAGMA journal_mode=WAL;
PRAGMA foreign_keys=ON;

-- Authorized Telegram users
CREATE TABLE IF NOT EXISTS authorized_users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  telegram_user_id TEXT UNIQUE NOT NULL,  -- stored as TEXT to avoid JS bigint issues
  display_name TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,   -- SQLite boolean
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  notes TEXT
);

CREATE INDEX IF NOT EXISTS idx_authorized_users_active
  ON authorized_users(telegram_user_id, is_active);

-- Registered devices
CREATE TABLE IF NOT EXISTS devices (
  id TEXT PRIMARY KEY,                    -- UUID
  device_key_hash TEXT UNIQUE NOT NULL,   -- bcrypt hash of plaintext key
  device_name TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_seen_at TEXT,
  firmware_version TEXT,
  ip_address TEXT
);

-- Device heartbeats
CREATE TABLE IF NOT EXISTS device_heartbeats (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  device_id TEXT NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  received_at TEXT NOT NULL DEFAULT (datetime('now')),
  firmware_version TEXT,
  free_heap INTEGER,
  uptime_seconds INTEGER,
  wifi_rssi INTEGER
);

CREATE INDEX IF NOT EXISTS idx_heartbeats_device_time
  ON device_heartbeats(device_id, received_at DESC);

-- Commands
CREATE TABLE IF NOT EXISTS commands (
  id TEXT PRIMARY KEY,                    -- UUID
  device_id TEXT NOT NULL REFERENCES devices(id),
  requested_by_user_id TEXT NOT NULL REFERENCES authorized_users(telegram_user_id),
  command_type TEXT NOT NULL CHECK(command_type IN ('press','open','close')),
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK(status IN ('pending','confirmed','delivered','executed','acknowledged','cancelled','expired','uncertain','failed')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL,
  confirmed_at TEXT,
  delivered_at TEXT,
  acknowledged_at TEXT,
  cancelled_at TEXT,
  execution_result TEXT CHECK(execution_result IN ('success','uncertain','failed') OR execution_result IS NULL),
  execution_detail TEXT,
  telegram_chat_id TEXT,
  telegram_message_id TEXT,
  confirmation_callback_id TEXT UNIQUE,
  idempotency_key TEXT UNIQUE
);

CREATE INDEX IF NOT EXISTS idx_commands_status ON commands(status);
CREATE INDEX IF NOT EXISTS idx_commands_device ON commands(device_id);
CREATE INDEX IF NOT EXISTS idx_commands_user ON commands(requested_by_user_id);
CREATE INDEX IF NOT EXISTS idx_commands_expires ON commands(expires_at);
CREATE INDEX IF NOT EXISTS idx_commands_created ON commands(created_at DESC);

-- Audit events
CREATE TABLE IF NOT EXISTS audit_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_type TEXT NOT NULL,
  telegram_user_id TEXT,
  device_id TEXT REFERENCES devices(id),
  command_id TEXT REFERENCES commands(id),
  occurred_at TEXT NOT NULL DEFAULT (datetime('now')),
  details TEXT,                           -- JSON string
  ip_address TEXT
);

CREATE INDEX IF NOT EXISTS idx_audit_type_time ON audit_events(event_type, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_user_time ON audit_events(telegram_user_id, occurred_at DESC);

-- Rate limiting events (pruned periodically)
CREATE TABLE IF NOT EXISTS rate_limit_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  telegram_user_id TEXT NOT NULL,
  command_type TEXT NOT NULL,
  occurred_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_rate_limit_user_time
  ON rate_limit_events(telegram_user_id, occurred_at DESC);
