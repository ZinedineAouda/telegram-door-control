import { getDb } from './database';
import bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';
import { Device, DeviceHeartbeat } from '../types';

const BCRYPT_ROUNDS = 10;

// ---------------------------------------------------------------------------
// Row mappers
// ---------------------------------------------------------------------------

function rowToDevice(row: Record<string, unknown>): Device {
  return {
    id: row.id as string,
    deviceName: row.device_name as string,
    isActive: (row.is_active as number) === 1,
    lastSeenAt: row.last_seen_at
      ? new Date(row.last_seen_at as string)
      : null,
    firmwareVersion: (row.firmware_version as string | null) ?? null,
    ipAddress: (row.ip_address as string | null) ?? null,
  };
}

function rowToHeartbeat(row: Record<string, unknown>): DeviceHeartbeat {
  return {
    id: row.id as number,
    deviceId: row.device_id as string,
    receivedAt: new Date(row.received_at as string),
    firmwareVersion: (row.firmware_version as string | null) ?? null,
    freeHeap: (row.free_heap as number | null) ?? null,
    uptimeSeconds: (row.uptime_seconds as number | null) ?? null,
    wifiRssi: (row.wifi_rssi as number | null) ?? null,
  };
}

// ---------------------------------------------------------------------------
// Repository
// ---------------------------------------------------------------------------

export const DeviceRepository = {
  /**
   * Authenticate a device by comparing the plaintext key against stored hashes.
   * Iterates active devices — acceptable because device count is always small.
   * Returns the Device on success or null on failure.
   */
  authenticate(plaintextKey: string): Device | null {
    const db = getDb();
    const rows = db
      .prepare(
        `SELECT id, device_key_hash, device_name, is_active,
                last_seen_at, firmware_version, ip_address
         FROM devices
         WHERE is_active = 1`
      )
      .all() as (Record<string, unknown> & { device_key_hash: string })[];

    for (const row of rows) {
      const match = bcrypt.compareSync(plaintextKey, row.device_key_hash);
      if (match) {
        return rowToDevice(row);
      }
    }
    return null;
  },

  /**
   * Find a device by its UUID primary key.
   */
  findById(id: string): Device | null {
    const db = getDb();
    const row = db
      .prepare(
        `SELECT id, device_name, is_active, last_seen_at, firmware_version, ip_address
         FROM devices
         WHERE id = ?`
      )
      .get(id) as Record<string, unknown> | undefined;

    return row ? rowToDevice(row) : null;
  },

  /**
   * Register a new device.
   * Generates a UUID, hashes the supplied plaintext key with bcrypt, and
   * inserts the record.  Returns both the Device object and the original
   * plaintext key so callers can display it once to the operator.
   */
  register(
    deviceName: string,
    plaintextKey: string
  ): { device: Device; plaintextKey: string } {
    const db = getDb();
    const id = uuidv4();
    const keyHash = bcrypt.hashSync(plaintextKey, BCRYPT_ROUNDS);

    db.prepare(
      `INSERT INTO devices (id, device_key_hash, device_name)
       VALUES (?, ?, ?)`
    ).run(id, keyHash, deviceName);

    const device = this.findById(id);
    if (!device) {
      throw new Error(`Failed to retrieve device after insert: ${id}`);
    }
    return { device, plaintextKey };
  },

  /**
   * Update last_seen_at and optionally firmware_version / ip_address.
   */
  updateLastSeen(
    deviceId: string,
    firmwareVersion?: string,
    ipAddress?: string
  ): void {
    const db = getDb();
    db.prepare(
      `UPDATE devices
       SET last_seen_at    = datetime('now'),
           updated_at      = datetime('now'),
           firmware_version = COALESCE(?, firmware_version),
           ip_address       = COALESCE(?, ip_address)
       WHERE id = ?`
    ).run(firmwareVersion ?? null, ipAddress ?? null, deviceId);
  },

  /**
   * Return the most recent heartbeat row for the given device, or null.
   */
  getLastHeartbeat(deviceId: string): DeviceHeartbeat | null {
    const db = getDb();
    const row = db
      .prepare(
        `SELECT id, device_id, received_at, firmware_version,
                free_heap, uptime_seconds, wifi_rssi
         FROM device_heartbeats
         WHERE device_id = ?
         ORDER BY received_at DESC
         LIMIT 1`
      )
      .get(deviceId) as Record<string, unknown> | undefined;

    return row ? rowToHeartbeat(row) : null;
  },

  /**
   * Insert a new heartbeat record.
   */
  recordHeartbeat(
    deviceId: string,
    data: Partial<DeviceHeartbeat>
  ): void {
    const db = getDb();
    db.prepare(
      `INSERT INTO device_heartbeats
         (device_id, firmware_version, free_heap, uptime_seconds, wifi_rssi)
       VALUES (?, ?, ?, ?, ?)`
    ).run(
      deviceId,
      data.firmwareVersion ?? null,
      data.freeHeap ?? null,
      data.uptimeSeconds ?? null,
      data.wifiRssi ?? null
    );
  },

  /**
   * Return all active devices ordered by name.
   */
  listActive(): Device[] {
    const db = getDb();
    const rows = db
      .prepare(
        `SELECT id, device_name, is_active, last_seen_at, firmware_version, ip_address
         FROM devices
         WHERE is_active = 1
         ORDER BY device_name ASC`
      )
      .all() as Record<string, unknown>[];

    return rows.map(rowToDevice);
  },
};
