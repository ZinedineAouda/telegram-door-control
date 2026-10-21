import { UserRepository } from './users';
import { DeviceRepository } from './devices';

/**
 * Seeds authorized users from the ALLOWED_TELEGRAM_USER_IDS environment variable
 * and registers the default device if one is configured in DEVICE_KEY.
 */
export function seedAuthorizedUsers(): void {
  const raw = process.env.ALLOWED_TELEGRAM_USER_IDS || '';
  const ids = raw.split(',').map((s) => s.trim()).filter(Boolean);

  for (const id of ids) {
    const existing = UserRepository.findByTelegramId(id);
    if (!existing) {
      UserRepository.addUser(id, `Admin ${id}`, 'Seeded from ALLOWED_TELEGRAM_USER_IDS');
      console.log(`[Seed] Seeded authorized Telegram user: ${id}`);
    }
  }

  if (ids.length === 0) {
    console.warn('[Seed] WARNING: ALLOWED_TELEGRAM_USER_IDS is empty. No users will be authorized.');
  }

  // Seed default device if DEVICE_KEY is configured and no devices exist yet
  const deviceKey = process.env.DEVICE_KEY;
  if (deviceKey) {
    const devices = DeviceRepository.listActive();
    if (devices.length === 0) {
      const deviceName = process.env.DEVICE_NAME || 'Door-ESP8266-Main';
      const created = DeviceRepository.register(deviceName, deviceKey);
      console.log(`[Seed] Seeded initial device "${deviceName}" (ID: ${created.device.id})`);
    }
  }
}
