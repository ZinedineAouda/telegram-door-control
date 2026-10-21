#!/usr/bin/env ts-node
/**
 * register_device.ts
 * =============================================================================
 * Standalone utility to register an ESP8266 door controller device in the
 * persistent SQLite database and generate/hash its secure deviceKey.
 *
 * Usage:
 *   npx ts-node scripts/register_device.ts [deviceName] [deviceKey]
 * =============================================================================
 */

import 'dotenv/config';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { initDatabase } from '../bot/src/db/database';
import { DeviceRepository } from '../bot/src/db/devices';

async function main() {
  const dbPath = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'door.db');
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  initDatabase(dbPath);

  const deviceName = process.argv[2] || process.env.DEVICE_NAME || 'Door-ESP8266-Main';
  const plaintextKey =
    process.argv[3] || process.env.DEVICE_KEY || crypto.randomBytes(24).toString('hex');

  console.log('========================================================');
  console.log('          ESP8266 Device Registration Utility           ');
  console.log('========================================================');
  console.log(`Database Path : ${dbPath}`);
  console.log(`Device Name   : ${deviceName}`);
  console.log('--------------------------------------------------------');

  const { device } = DeviceRepository.register(deviceName, plaintextKey);

  console.log('[SUCCESS] Device registered successfully!');
  console.log(`Assigned Device UUID : ${device.id}`);
  console.log(`Device Plaintext Key : ${plaintextKey}`);
  console.log('--------------------------------------------------------');
  console.log('ACTION REQUIRED:');
  console.log('1. Copy the Plaintext Key above into your .env as:');
  console.log(`   DEVICE_KEY=${plaintextKey}`);
  console.log('2. In your firmware/door_controller/door_controller_config.h, set:');
  console.log(`   #define DEVICE_KEY "${plaintextKey}"`);
  console.log('========================================================');
}

main().catch((err) => {
  console.error('[Error]', err);
  process.exit(1);
});
