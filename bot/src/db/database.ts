import { DatabaseSync, StatementSync } from 'node:sqlite';
import fs from 'fs';
import path from 'path';

let db: DatabaseSync | null = null;

/**
 * Initialize the SQLite database at the given path using native Node.js SQLite (DatabaseSync).
 * Applies WAL mode, foreign keys, and runs the schema SQL.
 * Returns the opened Database instance (also stored as singleton).
 */
export function initDatabase(dbPath: string): DatabaseSync {
  db = new DatabaseSync(dbPath);

  // Performance and safety pragmas
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec('PRAGMA synchronous = NORMAL;');
  if (dbPath !== ':memory:') {
    try {
      db.exec('PRAGMA journal_mode = WAL;');
    } catch {
      // Ignore if in-memory or WAL unsupported on specific volume
    }
  }

  // Run schema from database directory (check candidate locations)
  const candidatePaths = [
    path.join(__dirname, 'schema.sql'),
    path.join(__dirname, '../schema.sql'),
    path.join(__dirname, '../../../database/schema.sql'),
    path.join(__dirname, '../../database/schema.sql'),
    path.join(process.cwd(), 'database/schema.sql'),
    path.join(process.cwd(), '../database/schema.sql'),
    path.join(process.cwd(), 'schema.sql'),
  ];
  let schema = '';
  for (const p of candidatePaths) {
    if (fs.existsSync(p)) {
      schema = fs.readFileSync(p, 'utf-8');
      break;
    }
  }
  if (!schema) {
    throw new Error('Could not locate database/schema.sql in any standard path');
  }
  db.exec(schema);

  console.log(`[DB] Initialized at ${dbPath}`);
  return db;
}

/**
 * Return the singleton Database instance.
 * Throws if initDatabase() has not been called yet.
 */
export function getDb(): DatabaseSync {
  if (!db) {
    throw new Error('Database not initialized. Call initDatabase() first.');
  }
  return db;
}

/**
 * Close the database connection and reset the singleton.
 * Useful for graceful shutdown or test teardown.
 */
export function closeDb(): void {
  if (db) {
    db.close();
    db = null;
    console.log('[DB] Connection closed.');
  }
}

export { DatabaseSync, StatementSync };
