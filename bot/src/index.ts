import 'dotenv/config';
import TelegramBot from 'node-telegram-bot-api';
import { initDatabase } from './db/database';
import { setupHandlers } from './bot/handlers';
import { setBotInstance } from './bot/notifications';
import { createApiServer } from './api/server';
import { CommandRepository } from './db/commands';
import { AuditRepository } from './db/audit';
import { seedAuthorizedUsers } from './db/seed';
import path from 'path';
import fs from 'fs';

// Validate required environment variables
function validateEnv(): void {
  const required = ['BOT_TOKEN', 'ALLOWED_TELEGRAM_USER_IDS', 'DEVICE_KEY'];
  const missing = required.filter((k) => !process.env[k]);
  if (missing.length > 0) {
    console.error(`[Startup] Missing required environment variables: ${missing.join(', ')}`);
    console.error('[Startup] Check your .env file or refer to .env.example');
    process.exit(1);
  }
}

async function main(): Promise<void> {
  console.log('==================================================');
  console.log('   Door Control Bot & Device HTTPS API Service    ');
  console.log('==================================================');

  validateEnv();

  // Initialize SQLite database
  const dbPath = process.env.DB_PATH || path.join(process.cwd(), 'data', 'door.db');
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  initDatabase(dbPath);

  // Seed authorized users and device from environment
  seedAuthorizedUsers();

  // Start the HTTPS API Server for ESP8266 communication
  createApiServer();

  // Start Telegram bot with long polling (no webhook / public domain needed for Telegram)
  const token = process.env.BOT_TOKEN!;
  const bot = new TelegramBot(token, { polling: true });
  setBotInstance(bot);
  setupHandlers(bot);

  console.log('[Bot] Telegram long-polling listener started successfully.');

  // Periodic maintenance timer: expire stale commands every 30 seconds
  const cleanupInterval = setInterval(() => {
    try {
      const expired = CommandRepository.expireStale();
      if (expired > 0) {
        console.log(`[Maintenance] Expired ${expired} stale command(s).`);
      }
      AuditRepository.pruneRateLimitEvents();
    } catch (err) {
      console.error('[Maintenance] Error during periodic maintenance:', err);
    }
  }, 30_000);

  // Graceful shutdown handling
  const shutdown = (signal: string) => {
    console.log(`\n[Shutdown] Received ${signal}. Shutting down cleanly...`);
    clearInterval(cleanupInterval);
    bot.stopPolling().then(() => {
      console.log('[Shutdown] Telegram polling stopped.');
      process.exit(0);
    }).catch(() => process.exit(0));
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((err) => {
  console.error('[Fatal] Uncaught exception at top level:', err);
  process.exit(1);
});
