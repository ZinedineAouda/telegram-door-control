import TelegramBot from 'node-telegram-bot-api';
import { UserRepository } from '../db/users';
import { CommandRepository } from '../db/commands';
import { AuditRepository } from '../db/audit';
import { CommandService } from '../services/commandService';
import { CommandType } from '../types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Format a Date (or date string) for human-readable display. */
function formatDate(d: Date | null | string): string {
  if (!d) return 'Never';
  const date = d instanceof Date ? d : new Date(d);
  if (isNaN(date.getTime())) return 'Unknown';
  return date.toLocaleString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
}

/** Return a human-readable "X seconds/minutes ago" string. */
function timeAgo(d: Date | null | string): string {
  if (!d) return 'Never';
  const date = d instanceof Date ? d : new Date(d);
  const diffMs = Date.now() - date.getTime();
  if (diffMs < 0) return 'just now';
  const secs = Math.floor(diffMs / 1000);
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return formatDate(date);
}

/** Build the Confirm / Cancel inline keyboard for a command confirmation message. */
function confirmKeyboard(callbackId: string): TelegramBot.InlineKeyboardMarkup {
  return {
    inline_keyboard: [
      [
        { text: '✅ Confirm', callback_data: `confirm:${callbackId}` },
        { text: '❌ Cancel', callback_data: `cancel:${callbackId}` },
      ],
    ],
  };
}

/** Check whether a Telegram user is authorized. */
function isAuthorized(telegramUserId: string): boolean {
  return UserRepository.isAuthorized(telegramUserId);
}

// ---------------------------------------------------------------------------
// Shared command-request flow (used by /press, /open, /close)
// ---------------------------------------------------------------------------

async function handleCommandRequest(
  bot: TelegramBot,
  msg: TelegramBot.Message,
  commandType: CommandType,
  extraWarning: string = '',
): Promise<void> {
  const chatId = msg.chat.id;
  const telegramUserId = String(msg.from?.id ?? '');
  const telegramChatId = String(chatId);

  if (!telegramUserId) {
    await bot.sendMessage(chatId, '⛔ Could not determine your user ID.');
    return;
  }

  // Authorization check
  if (!isAuthorized(telegramUserId)) {
    await bot.sendMessage(chatId, '⛔ You are not authorized to control this device.');
    return;
  }

  // Log the incoming command attempt
  AuditRepository.log({
    eventType: 'command_attempt',
    telegramUserId,
    details: { commandType, messageId: msg.message_id },
  });

  const { command, deviceOnline, error } = await CommandService.requestCommand({
    telegramUserId,
    commandType,
    telegramChatId,
    updateId: msg.message_id,
  });

  if (error === 'unauthorized') {
    await bot.sendMessage(chatId, '⛔ You are not authorized to control this device.');
    return;
  }

  if (error === 'rate_limited') {
    await bot.sendMessage(chatId, '⏱ Too many requests. Please wait before sending another command.');
    return;
  }

  if (error === 'already_pending') {
    await bot.sendMessage(
      chatId,
      '⚠️ A command is already pending confirmation. Use /cancel to cancel it first.',
    );
    return;
  }

  if (error === 'no_device') {
    await bot.sendMessage(chatId, '⚠️ No door controller device is registered in the system.');
    return;
  }

  if (!command) {
    await bot.sendMessage(chatId, '❌ Failed to create command. Please try again.');
    return;
  }

  if (!deviceOnline) {
    // Warn immediately
    await bot.sendMessage(chatId, '⚠️ Door controller is offline. No command has been sent.');
    // Cancel the command since the device is offline
    await CommandService.cancelCommand(command.id);
    return;
  }

  // Build confirmation message
  const baseText =
    '🚪 Send one button press to the door controller?\n\n' +
    '⚠️ This simulates pressing the physical button. The door will toggle its current state.';

  const fullText = extraWarning ? `${baseText}${extraWarning}` : baseText;

  await bot.sendMessage(chatId, fullText, {
    reply_markup: confirmKeyboard(command.id),
  });
}

// ---------------------------------------------------------------------------
// Main setup
// ---------------------------------------------------------------------------

export function setupHandlers(bot: TelegramBot): void {
  // -------------------------------------------------------------------------
  // /start
  // -------------------------------------------------------------------------
  bot.onText(/\/start/, async (msg) => {
    const chatId = msg.chat.id;
    const telegramUserId = String(msg.from?.id ?? '');

    if (!telegramUserId || !isAuthorized(telegramUserId)) {
      await bot.sendMessage(chatId, '⛔ You are not authorized to control this device.');
      return;
    }

    const firstName = msg.from?.first_name ?? 'there';
    const welcomeText =
      `👋 Hello, ${firstName}! Welcome to the Door Control Bot.\n\n` +
      `*Available commands:*\n` +
      `/press — Send a button press (door toggles)\n` +
      `/open — Send a button press (with open warning)\n` +
      `/close — Send a button press (with close warning)\n` +
      `/status — Show device status\n` +
      `/history — Show your last 10 commands\n` +
      `/cancel — Cancel your pending command\n` +
      `/help — Show help information\n\n` +
      `⚠️ *Important:* This bot simulates pressing the physical button. It does NOT verify the actual door position.`;

    await bot.sendMessage(chatId, welcomeText, { parse_mode: 'Markdown' });
  });

  // -------------------------------------------------------------------------
  // /help
  // -------------------------------------------------------------------------
  bot.onText(/\/help/, async (msg) => {
    const chatId = msg.chat.id;
    const telegramUserId = String(msg.from?.id ?? '');

    if (!telegramUserId || !isAuthorized(telegramUserId)) {
      await bot.sendMessage(chatId, '⛔ You are not authorized to control this device.');
      return;
    }

    const helpText =
      `🚪 *Door Control Bot — Help*\n\n` +
      `*Commands:*\n` +
      `/press — Simulate one button press. The door will toggle its current state.\n` +
      `/open — Same as /press, but reminds you it cannot guarantee the door will open.\n` +
      `/close — Same as /press, but reminds you it cannot guarantee the door will close.\n` +
      `/status — Show device online status and last heartbeat.\n` +
      `/history — Show your last 10 commands and their outcomes.\n` +
      `/cancel — Cancel a pending (unconfirmed) command.\n\n` +
      `*⚠️ Safety warnings:*\n` +
      `• /open and /close are *BUTTON PRESS SIMULATIONS only*. They do NOT directly control the door direction.\n` +
      `• The controller receives one relay pulse — equivalent to pressing the physical button.\n` +
      `• The door will *toggle* its current state — if it is open, it will close, and vice versa.\n` +
      `• *Actual door position is NOT verified.* There is no position sensor.\n` +
      `• If execution status is uncertain, do NOT retry automatically — a second press may reverse the door unexpectedly.\n` +
      `• Always visually verify the door position before issuing another command.`;

    await bot.sendMessage(chatId, helpText, { parse_mode: 'Markdown' });
  });

  // -------------------------------------------------------------------------
  // /press
  // -------------------------------------------------------------------------
  bot.onText(/\/press/, async (msg) => {
    await handleCommandRequest(bot, msg, 'press');
  });

  // -------------------------------------------------------------------------
  // /open
  // -------------------------------------------------------------------------
  bot.onText(/\/open/, async (msg) => {
    await handleCommandRequest(
      bot,
      msg,
      'open',
      '\n\n⚠️ WARNING: /open only sends a button press — it cannot guarantee the door will open.',
    );
  });

  // -------------------------------------------------------------------------
  // /close
  // -------------------------------------------------------------------------
  bot.onText(/\/close/, async (msg) => {
    await handleCommandRequest(
      bot,
      msg,
      'close',
      '\n\n⚠️ WARNING: /close only sends a button press — it cannot guarantee the door will close.',
    );
  });

  // -------------------------------------------------------------------------
  // /status
  // -------------------------------------------------------------------------
  bot.onText(/\/status/, async (msg) => {
    const chatId = msg.chat.id;
    const telegramUserId = String(msg.from?.id ?? '');

    if (!telegramUserId || !isAuthorized(telegramUserId)) {
      await bot.sendMessage(chatId, '⛔ You are not authorized to control this device.');
      return;
    }

    const { deviceOnline, lastHeartbeat, lastCommand, deviceName } =
      CommandService.getStatus();

    const onlineStr = deviceOnline ? '✅ Yes' : '❌ No';
    const heartbeatStr = lastHeartbeat ? timeAgo(lastHeartbeat) : 'Never';

    let lastCommandStr = 'None';
    if (lastCommand) {
      const cmdTime = lastCommand.acknowledgedAt || lastCommand.deliveredAt || lastCommand.confirmedAt || lastCommand.createdAt;
      lastCommandStr = `${lastCommand.commandType} → ${lastCommand.status} at ${formatDate(cmdTime)}`;
    }

    const statusText =
      `📡 *Device Status*\n` +
      `──────────────\n` +
      `Device: ${deviceName ?? 'Unknown'}\n` +
      `Online: ${onlineStr}\n` +
      `Last heartbeat: ${heartbeatStr}\n` +
      `Last command: ${lastCommandStr}\n` +
      `Door position: Not verified (no sensor)`;

    await bot.sendMessage(chatId, statusText, { parse_mode: 'Markdown' });
  });

  // -------------------------------------------------------------------------
  // /history
  // -------------------------------------------------------------------------
  bot.onText(/\/history/, async (msg) => {
    const chatId = msg.chat.id;
    const telegramUserId = String(msg.from?.id ?? '');

    if (!telegramUserId || !isAuthorized(telegramUserId)) {
      await bot.sendMessage(chatId, '⛔ You are not authorized to control this device.');
      return;
    }

    const history = CommandService.getHistory(telegramUserId);

    if (history.length === 0) {
      await bot.sendMessage(chatId, '📋 No commands found in your history.');
      return;
    }

    const lines = history.map((cmd, i) => {
      const result = cmd.executionResult ? ` (${cmd.executionResult})` : '';
      return `${i + 1}. \`${cmd.commandType}\` → *${cmd.status}*${result}\n   🕒 ${formatDate(cmd.createdAt)}`;
    });

    const historyText = `📋 *Your last ${history.length} command(s):*\n\n` + lines.join('\n\n');

    await bot.sendMessage(chatId, historyText, { parse_mode: 'Markdown' });
  });

  // -------------------------------------------------------------------------
  // /cancel
  // -------------------------------------------------------------------------
  bot.onText(/\/cancel/, async (msg) => {
    const chatId = msg.chat.id;
    const telegramUserId = String(msg.from?.id ?? '');

    if (!telegramUserId || !isAuthorized(telegramUserId)) {
      await bot.sendMessage(chatId, '⛔ You are not authorized to control this device.');
      return;
    }

    // Find most recent pending command for this user
    const pending = CommandRepository.findPendingByUser(telegramUserId);

    if (!pending) {
      await bot.sendMessage(chatId, 'ℹ️ You have no pending command to cancel.');
      return;
    }

    const cancelled = await CommandService.cancelCommand(pending.id);

    if (cancelled) {
      await bot.sendMessage(chatId, '🚫 Your pending command has been cancelled.');
    } else {
      await bot.sendMessage(
        chatId,
        'ℹ️ Could not cancel — the command may have already been confirmed or expired.',
      );
    }
  });

  // -------------------------------------------------------------------------
  // Inline keyboard callback queries (Confirm / Cancel buttons)
  // -------------------------------------------------------------------------
  bot.on('callback_query', async (query) => {
    const data = query.data || '';
    const chatId = query.message?.chat.id;
    const messageId = query.message?.message_id;
    const telegramUserId = String(query.from?.id ?? '');

    try {
      if (data.startsWith('confirm:')) {
        const callbackId = data.replace('confirm:', '');

        // Verify ownership — only the originating user may confirm
        const command = CommandRepository.findById(callbackId);
        if (!command) {
          await bot.answerCallbackQuery(query.id, {
            text: 'Command not found.',
            show_alert: true,
          });
          return;
        }

        if (command.requestedByUserId !== telegramUserId) {
          await bot.answerCallbackQuery(query.id, {
            text: '⛔ You are not the owner of this command.',
            show_alert: true,
          });
          return;
        }

        const confirmed = await CommandService.confirmCommand(
          callbackId,
          String(messageId ?? ''),
        );

        if (!confirmed) {
          // Expired or already processed
          if (chatId && messageId) {
            await bot.editMessageText(
              '⏱ Confirmation expired. Please issue the command again.',
              { chat_id: chatId, message_id: messageId },
            );
          }
          await bot.answerCallbackQuery(query.id);
          return;
        }

        // Remove inline buttons and show queued message
        if (chatId && messageId) {
          await bot.editMessageText(
            '✅ Command queued. Waiting for the device to pick it up.',
            {
              chat_id: chatId,
              message_id: messageId,
              reply_markup: { inline_keyboard: [] },
            },
          );
        }
      } else if (data.startsWith('cancel:')) {
        const callbackId = data.replace('cancel:', '');

        const command = CommandRepository.findById(callbackId);
        if (!command) {
          await bot.answerCallbackQuery(query.id, {
            text: 'Command not found.',
            show_alert: true,
          });
          return;
        }

        if (command.requestedByUserId !== telegramUserId) {
          await bot.answerCallbackQuery(query.id, {
            text: '⛔ You are not the owner of this command.',
            show_alert: true,
          });
          return;
        }

        await CommandService.cancelCommand(callbackId);

        // Remove inline buttons and show cancelled message
        if (chatId && messageId) {
          await bot.editMessageText('🚫 Command cancelled.', {
            chat_id: chatId,
            message_id: messageId,
            reply_markup: { inline_keyboard: [] },
          });
        }
      }
    } catch (err) {
      console.error('[Bot] Error handling callback_query:', err);
    }

    await bot.answerCallbackQuery(query.id);
  });

  // -------------------------------------------------------------------------
  // Polling error handler
  // -------------------------------------------------------------------------
  bot.on('polling_error', (error) => {
    console.error('[Bot] Polling error:', error.message);
  });
}
