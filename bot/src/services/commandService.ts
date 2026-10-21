import { CommandRepository } from '../db/commands';
import { DeviceRepository } from '../db/devices';
import { AuditRepository, RateLimiter } from '../db/audit';
import { UserRepository } from '../db/users';
import { Command, CommandType } from '../types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Return the first active device, or null if none registered. */
function getActiveDevice() {
  const devices = DeviceRepository.listActive();
  return devices.length > 0 ? devices[0] : null;
}

/** Return true when the device last checked in within the past 2 minutes. */
function isDeviceOnline(device: { lastSeenAt: Date | null }): boolean {
  if (!device.lastSeenAt) return false;
  return Date.now() - device.lastSeenAt.getTime() < 2 * 60 * 1000;
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export const CommandService = {
  /**
   * Step 1: User requests a command. Creates pending command and returns it.
   * Checks authorization, rate limiting, device online status.
   * Returns { command, deviceOnline, error? }
   */
  async requestCommand(params: {
    telegramUserId: string;
    commandType: CommandType;
    telegramChatId: string;
    updateId: number;
  }): Promise<{ command: Command | null; deviceOnline: boolean; error?: string }> {
    const { telegramUserId, commandType, telegramChatId, updateId } = params;

    // Authorization
    const user = UserRepository.findByTelegramId(telegramUserId);
    if (!user || !user.isActive) {
      return { command: null, deviceOnline: false, error: 'unauthorized' };
    }

    // Rate limiting — max 5 commands per minute per user per command type
    const allowed = RateLimiter.check(telegramUserId, commandType);
    if (!allowed) {
      return { command: null, deviceOnline: false, error: 'rate_limited' };
    }

    // Check for an already-pending command for this user
    const existingPending = CommandRepository.findPendingByUser(telegramUserId);
    if (existingPending) {
      return { command: null, deviceOnline: false, error: 'already_pending' };
    }

    // Resolve the device
    const device = getActiveDevice();
    const deviceOnline = device ? isDeviceOnline(device) : false;

    // Idempotency key derived from the Telegram update ID
    const idempotencyKey = `tg-update-${updateId}`;
    const existing = CommandRepository.findByIdempotencyKey(idempotencyKey);
    if (existing) {
      return { command: existing, deviceOnline };
    }

    if (!device) {
      return { command: null, deviceOnline: false, error: 'no_device' };
    }

    // Create the command
    const command = CommandRepository.create({
      deviceId: device.id,
      requestedByUserId: telegramUserId,
      commandType,
      telegramChatId,
      idempotencyKey,
    });

    AuditRepository.log({
      eventType: 'command_requested',
      telegramUserId,
      commandId: command.id,
      details: { commandType },
    });

    RateLimiter.record(telegramUserId, commandType);

    return { command, deviceOnline };
  },

  /**
   * Step 2: User confirmed the command via inline button.
   * Sets status to 'confirmed'. Returns updated command or null.
   */
  async confirmCommand(
    callbackId: string,
    telegramMessageId: string,
  ): Promise<Command | null> {
    const command = CommandRepository.findByCallbackId(callbackId);
    if (!command) return null;
    if (command.status !== 'pending') return null;

    const confirmed = CommandRepository.confirm(command.id, telegramMessageId);
    if (confirmed) {
      AuditRepository.log({
        eventType: 'command_confirmed',
        telegramUserId: command.requestedByUserId,
        commandId: command.id,
        details: { telegramMessageId },
      });
    }
    return confirmed;
  },

  /**
   * Step 3: User cancelled.
   */
  async cancelCommand(commandId: string): Promise<Command | null> {
    const command = CommandRepository.findById(commandId);
    if (!command) return null;
    if (!['pending', 'confirmed'].includes(command.status)) return null;

    const cancelled = CommandRepository.cancel(command.id);
    if (cancelled) {
      AuditRepository.log({
        eventType: 'command_cancelled',
        telegramUserId: command.requestedByUserId,
        commandId: command.id,
        details: {},
      });
    }
    return cancelled;
  },

  /**
   * Get status info for /status command.
   */
  getStatus(): {
    deviceOnline: boolean;
    lastHeartbeat: Date | null;
    lastCommand: (Command & { updatedAt?: Date }) | null;
    deviceName: string | null;
  } {
    const device = getActiveDevice();
    const lastHeartbeat = device?.lastSeenAt ?? null;
    const deviceOnline = device ? isDeviceOnline(device) : false;

    // Get the most recent command across all users
    const lastCommand = CommandRepository.getRecentForUser('', 1)[0] ?? null;

    return {
      deviceOnline,
      lastHeartbeat,
      lastCommand,
      deviceName: device?.deviceName ?? null,
    };
  },

  /**
   * Get recent commands for /history command (last 10 for user).
   */
  getHistory(telegramUserId: string): Command[] {
    return CommandRepository.getRecentForUser(telegramUserId, 10);
  },
};
