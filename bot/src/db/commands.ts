import { getDb } from './database';
import { v4 as uuidv4 } from 'uuid';
import { Command, CommandType, CommandStatus, ExecutionResult } from '../types';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Seconds the user has to confirm a command before it auto-expires. */
const CONFIRMATION_TTL_SECONDS = 30;

/** Seconds after confirmation that the device must fetch & execute the command. */
const EXECUTION_TTL_SECONDS = 300; // 5 minutes

// ---------------------------------------------------------------------------
// Row mapper
// ---------------------------------------------------------------------------

function rowToCommand(row: Record<string, unknown>): Command {
  return {
    id: row.id as string,
    deviceId: row.device_id as string,
    requestedByUserId: row.requested_by_user_id as string,
    commandType: row.command_type as CommandType,
    status: row.status as CommandStatus,
    createdAt: new Date(row.created_at as string),
    expiresAt: new Date(row.expires_at as string),
    confirmedAt: row.confirmed_at ? new Date(row.confirmed_at as string) : null,
    deliveredAt: row.delivered_at ? new Date(row.delivered_at as string) : null,
    acknowledgedAt: row.acknowledged_at
      ? new Date(row.acknowledged_at as string)
      : null,
    cancelledAt: row.cancelled_at
      ? new Date(row.cancelled_at as string)
      : null,
    executionResult: (row.execution_result as ExecutionResult | null) ?? null,
    executionDetail: (row.execution_detail as string | null) ?? null,
    telegramChatId: (row.telegram_chat_id as string | null) ?? null,
    telegramMessageId: (row.telegram_message_id as string | null) ?? null,
    confirmationCallbackId:
      (row.confirmation_callback_id as string | null) ?? null,
    idempotencyKey: (row.idempotency_key as string | null) ?? null,
  };
}

// ---------------------------------------------------------------------------
// Shared column list
// ---------------------------------------------------------------------------

const ALL_COLS = `
  id, device_id, requested_by_user_id, command_type, status,
  created_at, expires_at, confirmed_at, delivered_at, acknowledged_at,
  cancelled_at, execution_result, execution_detail,
  telegram_chat_id, telegram_message_id,
  confirmation_callback_id, idempotency_key
`.trim();

// ---------------------------------------------------------------------------
// Repository
// ---------------------------------------------------------------------------

export const CommandRepository = {
  /**
   * Create a new command in 'pending' status.
   *
   * expires_at is set to CONFIRMATION_TTL_SECONDS from now — once the user
   * confirms, markDelivered / acknowledge update the record but the original
   * expiry window is replaced by EXECUTION_TTL_SECONDS at confirm time.
   */
  create(params: {
    deviceId: string;
    requestedByUserId: string;
    commandType: CommandType;
    telegramChatId: string;
    idempotencyKey: string;
  }): Command {
    const db = getDb();
    const id = uuidv4();
    const callbackId = uuidv4();

    db.prepare(
      `INSERT INTO commands
         (id, device_id, requested_by_user_id, command_type,
          expires_at, telegram_chat_id,
          confirmation_callback_id, idempotency_key)
       VALUES
         (?, ?, ?, ?,
          datetime('now', ? || ' seconds'),
          ?, ?, ?)`
    ).run(
      id,
      params.deviceId,
      params.requestedByUserId,
      params.commandType,
      String(CONFIRMATION_TTL_SECONDS),
      params.telegramChatId,
      callbackId,
      params.idempotencyKey
    );

    return this.findById(id)!;
  },

  /** Find a command by its UUID. Returns null if not found. */
  findById(id: string): Command | null {
    const db = getDb();
    const row = db
      .prepare(`SELECT ${ALL_COLS} FROM commands WHERE id = ?`)
      .get(id) as Record<string, unknown> | undefined;

    return row ? rowToCommand(row) : null;
  },

  /** Find a command by the inline-keyboard callback UUID. */
  findByCallbackId(callbackId: string): Command | null {
    const db = getDb();
    const row = db
      .prepare(
        `SELECT ${ALL_COLS} FROM commands WHERE confirmation_callback_id = ?`
      )
      .get(callbackId) as Record<string, unknown> | undefined;

    return row ? rowToCommand(row) : null;
  },

  /**
   * Transition a command from 'pending' → 'confirmed'.
   * Resets expires_at to EXECUTION_TTL_SECONDS from now so the device has
   * a fresh window to pick up and execute the command.
   * Records the Telegram message ID of the confirmation message.
   */
  confirm(id: string, telegramMessageId: string): Command | null {
    const db = getDb();
    const result = db
      .prepare(
        `UPDATE commands
         SET status             = 'confirmed',
             confirmed_at       = datetime('now'),
             expires_at         = datetime('now', ? || ' seconds'),
             telegram_message_id = ?
         WHERE id = ? AND status = 'pending'`
      )
      .run(String(EXECUTION_TTL_SECONDS), telegramMessageId, id);

    if (result.changes === 0) return null;
    return this.findById(id);
  },

  /**
   * Transition a command to 'cancelled'.
   * Only valid from 'pending' or 'confirmed'.
   */
  cancel(id: string): Command | null {
    const db = getDb();
    const result = db
      .prepare(
        `UPDATE commands
         SET status      = 'cancelled',
             cancelled_at = datetime('now')
         WHERE id = ? AND status IN ('pending', 'confirmed')`
      )
      .run(id);

    if (result.changes === 0) return null;
    return this.findById(id);
  },

  /**
   * Return the oldest confirmed, non-expired, not-yet-delivered command for
   * the given device. The device polls this endpoint to pick up work.
   */
  getNextForDevice(deviceId: string): Command | null {
    const db = getDb();
    const row = db
      .prepare(
        `SELECT ${ALL_COLS}
         FROM commands
         WHERE device_id = ?
           AND status    = 'confirmed'
           AND expires_at > datetime('now')
         ORDER BY created_at ASC
         LIMIT 1`
      )
      .get(deviceId) as Record<string, unknown> | undefined;

    return row ? rowToCommand(row) : null;
  },

  /**
   * Transition a command from 'confirmed' → 'delivered'.
   * Called right after the device fetches the command so we know it was
   * received even if ACK never arrives.
   */
  markDelivered(id: string): void {
    const db = getDb();
    db.prepare(
      `UPDATE commands
       SET status      = 'delivered',
           delivered_at = datetime('now')
       WHERE id = ? AND status = 'confirmed'`
    ).run(id);
  },

  /**
   * Acknowledge command execution from the device.
   * Transitions 'delivered' → 'executed' | 'uncertain' | 'failed'.
   */
  acknowledge(
    id: string,
    result: ExecutionResult,
    detail?: string
  ): Command | null {
    const db = getDb();
    const finalStatus: CommandStatus =
      result === 'success' ? 'executed' : result === 'uncertain' ? 'uncertain' : 'failed';

    const info = db
      .prepare(
        `UPDATE commands
         SET status           = ?,
             acknowledged_at  = datetime('now'),
             execution_result = ?,
             execution_detail = ?
         WHERE id = ? AND status = 'delivered'`
      )
      .run(finalStatus, result, detail ?? null, id);

    if (info.changes === 0) return null;
    return this.findById(id);
  },

  /**
   * Mark all commands whose expires_at has passed and are still in an
   * unfinished state as 'expired'.
   * Returns the number of rows updated.
   */
  expireStale(): number {
    const db = getDb();
    const result = db
      .prepare(
        `UPDATE commands
         SET status = 'expired'
         WHERE status IN ('pending', 'confirmed', 'delivered')
           AND expires_at <= datetime('now')`
      )
      .run();

    return result.changes;
  },

  /**
   * Return the most recent commands for a given Telegram user.
   * Defaults to last 10.
   */
  getRecentForUser(telegramUserId: string, limit = 10): Command[] {
    const db = getDb();
    const rows = db
      .prepare(
        `SELECT ${ALL_COLS}
         FROM commands
         WHERE requested_by_user_id = ?
         ORDER BY created_at DESC
         LIMIT ?`
      )
      .all(telegramUserId, limit) as Record<string, unknown>[];

    return rows.map(rowToCommand);
  },

  /**
   * Return an existing command matching the idempotency key, or null.
   * Used to prevent duplicate commands when retrying from the Telegram layer.
   */
  findByIdempotencyKey(key: string): Command | null {
    const db = getDb();
    const row = db
      .prepare(`SELECT ${ALL_COLS} FROM commands WHERE idempotency_key = ?`)
      .get(key) as Record<string, unknown> | undefined;

    return row ? rowToCommand(row) : null;
  },

  /**
   * Find the most recent pending command for a user.
   */
  findPendingByUser(telegramUserId: string): Command | null {
    const db = getDb();
    const row = db
      .prepare(
        `SELECT ${ALL_COLS}
         FROM commands
         WHERE requested_by_user_id = ?
           AND status = 'pending'
           AND expires_at > datetime('now')
         ORDER BY created_at DESC
         LIMIT 1`
      )
      .get(telegramUserId) as Record<string, unknown> | undefined;

    return row ? rowToCommand(row) : null;
  },

  /**
   * Find any currently pending or confirmed command for a user.
   */
  findPendingOrConfirmedByUser(telegramUserId: string): Command | null {
    const db = getDb();
    const row = db
      .prepare(
        `SELECT ${ALL_COLS}
         FROM commands
         WHERE requested_by_user_id = ?
           AND status IN ('pending', 'confirmed')
           AND expires_at > datetime('now')
         ORDER BY created_at DESC
         LIMIT 1`
      )
      .get(telegramUserId) as Record<string, unknown> | undefined;

    return row ? rowToCommand(row) : null;
  },

  /**
   * Return the overall most recent command in the system (for status reporting).
   */
  getLastCommand(): Command | null {
    const db = getDb();
    const row = db
      .prepare(
        `SELECT ${ALL_COLS}
         FROM commands
         ORDER BY created_at DESC
         LIMIT 1`
      )
      .get() as Record<string, unknown> | undefined;

    return row ? rowToCommand(row) : null;
  },
};
