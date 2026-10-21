import TelegramBot from 'node-telegram-bot-api';
import { Command } from '../types';

let botInstance: TelegramBot | null = null;

/**
 * Store a reference to the bot instance so this module can send messages
 * without requiring the bot to be passed to every function call.
 */
export function setBotInstance(bot: TelegramBot): void {
  botInstance = bot;
}

/**
 * After the device acknowledges a command, call this to notify the originating
 * Telegram user with the execution outcome.
 */
export async function notifyCommandResult(command: Command): Promise<void> {
  if (!botInstance) {
    console.warn('[Notifications] Bot instance not set — cannot notify user.');
    return;
  }

  if (!command.telegramChatId) {
    console.warn(`[Notifications] Command ${command.id} has no telegramChatId — skipping notification.`);
    return;
  }

  let message: string;

  switch (command.executionResult) {
    case 'success':
      message =
        '✅ Button press executed. The controller should have received one press. ' +
        'Actual door position is NOT verified.';
      break;

    case 'uncertain':
      message =
        "⚠️ Execution status is uncertain. Do NOT retry automatically — another press may reverse the door's current state. " +
        'Issue a new /press command only after you verify the door\'s position.';
      break;

    case 'failed':
      message =
        '❌ Command failed. The device reported that the relay pulse could not be executed. ' +
        'No door state change has been confirmed.';
      break;

    default:
      // executionResult is null or an unknown value — nothing to notify
      console.warn(
        `[Notifications] Command ${command.id} has unexpected executionResult: ${command.executionResult} — skipping.`,
      );
      return;
  }

  try {
    await botInstance.sendMessage(command.telegramChatId, message);
    console.log(
      `[Notifications] Sent result notification for command ${command.id} ` +
        `(result: ${command.executionResult}) to chat ${command.telegramChatId}.`,
    );
  } catch (err) {
    console.error(
      `[Notifications] Failed to send notification for command ${command.id}:`,
      err,
    );
  }
}
