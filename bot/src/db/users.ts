import { getDb } from './database';
import { AuthorizedUser } from '../types';

// ---------------------------------------------------------------------------
// Row mapper
// ---------------------------------------------------------------------------

function rowToUser(row: Record<string, unknown>): AuthorizedUser {
  return {
    id: row.id as number,
    telegramUserId: row.telegram_user_id as string,
    displayName: (row.display_name as string | null) ?? null,
    isActive: (row.is_active as number) === 1,
    createdAt: new Date(row.created_at as string),
    notes: (row.notes as string | null) ?? null,
  };
}

// ---------------------------------------------------------------------------
// Repository
// ---------------------------------------------------------------------------

export const UserRepository = {
  /**
   * Find a user by their Telegram user ID string.
   * Returns null if no matching record exists.
   */
  findByTelegramId(telegramUserId: string): AuthorizedUser | null {
    const db = getDb();
    const row = db
      .prepare(
        `SELECT id, telegram_user_id, display_name, is_active, created_at, notes
         FROM authorized_users
         WHERE telegram_user_id = ?`
      )
      .get(telegramUserId) as Record<string, unknown> | undefined;

    return row ? rowToUser(row) : null;
  },

  /**
   * Return true if the user exists and is currently active.
   */
  isAuthorized(telegramUserId: string): boolean {
    const db = getDb();
    const row = db
      .prepare(
        `SELECT 1 FROM authorized_users
         WHERE telegram_user_id = ? AND is_active = 1
         LIMIT 1`
      )
      .get(telegramUserId);

    return row !== undefined;
  },

  /**
   * Insert a new authorized user record.
   * Throws if the Telegram user ID is already registered.
   */
  addUser(
    telegramUserId: string,
    displayName: string | null,
    notes: string | null
  ): AuthorizedUser {
    const db = getDb();
    db.prepare(
      `INSERT INTO authorized_users (telegram_user_id, display_name, notes)
       VALUES (?, ?, ?)`
    ).run(telegramUserId, displayName, notes);

    const user = this.findByTelegramId(telegramUserId);
    if (!user) {
      throw new Error(
        `Failed to retrieve user after insert: ${telegramUserId}`
      );
    }
    return user;
  },

  /**
   * Deactivate a user so they can no longer issue commands.
   * Does nothing if the user does not exist.
   */
  deactivate(telegramUserId: string): void {
    const db = getDb();
    db.prepare(
      `UPDATE authorized_users SET is_active = 0 WHERE telegram_user_id = ?`
    ).run(telegramUserId);
  },

  /**
   * Return all users whose is_active flag is set.
   */
  listActive(): AuthorizedUser[] {
    const db = getDb();
    const rows = db
      .prepare(
        `SELECT id, telegram_user_id, display_name, is_active, created_at, notes
         FROM authorized_users
         WHERE is_active = 1
         ORDER BY created_at ASC`
      )
      .all() as Record<string, unknown>[];

    return rows.map(rowToUser);
  },
};
