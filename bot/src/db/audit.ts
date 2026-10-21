import { getDb } from './database';
import { AuditEvent } from '../types';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Maximum number of commands a single user may issue per 60-second window. */
const RATE_LIMIT_MAX = 5;
/** Rolling window length in seconds. */
const RATE_LIMIT_WINDOW_SECONDS = 60;
/** Age threshold for pruning rate-limit event rows (1 hour). */
const RATE_LIMIT_PRUNE_SECONDS = 3600;

// ---------------------------------------------------------------------------
// Row mapper
// ---------------------------------------------------------------------------

function rowToAuditEvent(row: Record<string, unknown>): AuditEvent {
  let details: Record<string, unknown> | null = null;
  if (row.details && typeof row.details === 'string') {
    try {
      details = JSON.parse(row.details) as Record<string, unknown>;
    } catch {
      details = { raw: row.details };
    }
  }

  return {
    id: row.id as number,
    eventType: row.event_type as string,
    telegramUserId: (row.telegram_user_id as string | null) ?? null,
    deviceId: (row.device_id as string | null) ?? null,
    commandId: (row.command_id as string | null) ?? null,
    occurredAt: new Date(row.occurred_at as string),
    details,
    ipAddress: (row.ip_address as string | null) ?? null,
  };
}

// ---------------------------------------------------------------------------
// Audit Repository
// ---------------------------------------------------------------------------

export const AuditRepository = {
  /**
   * Insert an audit event.  All fields except eventType are optional.
   * details is serialised to JSON before storage.
   */
  log(params: {
    eventType: string;
    telegramUserId?: string;
    deviceId?: string;
    commandId?: string;
    details?: Record<string, unknown>;
    ipAddress?: string;
  }): void {
    const db = getDb();
    db.prepare(
      `INSERT INTO audit_events
         (event_type, telegram_user_id, device_id, command_id, details, ip_address)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(
      params.eventType,
      params.telegramUserId ?? null,
      params.deviceId ?? null,
      params.commandId ?? null,
      params.details != null ? JSON.stringify(params.details) : null,
      params.ipAddress ?? null
    );
  },

  /**
   * Return the most recent audit events across all users / devices.
   * Defaults to the last 50 events.
   */
  getRecent(limit = 50): AuditEvent[] {
    const db = getDb();
    const rows = db
      .prepare(
        `SELECT id, event_type, telegram_user_id, device_id, command_id,
                occurred_at, details, ip_address
         FROM audit_events
         ORDER BY occurred_at DESC
         LIMIT ?`
      )
      .all(limit) as Record<string, unknown>[];

    return rows.map(rowToAuditEvent);
  },

  /**
   * Return audit events for a specific Telegram user.
   * Defaults to the last 50.
   */
  getForUser(telegramUserId: string, limit = 50): AuditEvent[] {
    const db = getDb();
    const rows = db
      .prepare(
        `SELECT id, event_type, telegram_user_id, device_id, command_id,
                occurred_at, details, ip_address
         FROM audit_events
         WHERE telegram_user_id = ?
         ORDER BY occurred_at DESC
         LIMIT ?`
      )
      .all(telegramUserId, limit) as Record<string, unknown>[];

    return rows.map(rowToAuditEvent);
  },

  /**
   * Delete rate_limit_events rows older than RATE_LIMIT_PRUNE_SECONDS.
   * Should be called periodically (e.g. every hour) to keep the table small.
   */
  pruneRateLimitEvents(): void {
    const db = getDb();
    db.prepare(
      `DELETE FROM rate_limit_events
       WHERE occurred_at <= datetime('now', ? || ' seconds')`
    ).run(String(-RATE_LIMIT_PRUNE_SECONDS));
  },
};

// ---------------------------------------------------------------------------
// Rate Limiter
// ---------------------------------------------------------------------------

export const RateLimiter = {
  /**
   * Return true if the user is UNDER the rate limit and may proceed.
   * Return false if they have hit or exceeded RATE_LIMIT_MAX events in the
   * rolling RATE_LIMIT_WINDOW_SECONDS window.
   */
  check(telegramUserId: string, commandType: string): boolean {
    const db = getDb();
    const row = db
      .prepare(
        `SELECT COUNT(*) AS cnt
         FROM rate_limit_events
         WHERE telegram_user_id = ?
           AND command_type     = ?
           AND occurred_at      > datetime('now', ? || ' seconds')`
      )
      .get(
        telegramUserId,
        commandType,
        String(-RATE_LIMIT_WINDOW_SECONDS)
      ) as { cnt: number };

    return row.cnt < RATE_LIMIT_MAX;
  },

  /**
   * Record that the user issued a command of the given type right now.
   * Call this only after check() returns true.
   */
  record(telegramUserId: string, commandType: string): void {
    const db = getDb();
    db.prepare(
      `INSERT INTO rate_limit_events (telegram_user_id, command_type)
       VALUES (?, ?)`
    ).run(telegramUserId, commandType);
  },
};
