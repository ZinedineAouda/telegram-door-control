import { initDatabase } from '../src/db/database';
import { CommandRepository } from '../src/db/commands';
import { UserRepository } from '../src/db/users';
import { DeviceRepository } from '../src/db/devices';
import path from 'path';
import fs from 'fs';

const schemaSQL = fs.readFileSync(
  path.join(__dirname, '../../database/schema.sql'),
  'utf-8'
);

describe('CommandRepository', () => {
  let deviceId: string;
  const telegramUserId = '123456789';

  beforeEach(() => {
    const db = initDatabase(':memory:');
    db.exec(schemaSQL);

    UserRepository.addUser(telegramUserId, 'Test User', 'Notes');
    const { device } = DeviceRepository.register('Main Door', 'secret_key_123');
    deviceId = device.id;
  });

  test('Creating a command sets status to pending', () => {
    const cmd = CommandRepository.create({
      deviceId,
      requestedByUserId: telegramUserId,
      commandType: 'press',
      telegramChatId: '987654',
      idempotencyKey: 'key-1',
    });

    expect(cmd).not.toBeNull();
    expect(cmd.status).toBe('pending');
    expect(cmd.commandType).toBe('press');
    expect(cmd.requestedByUserId).toBe(telegramUserId);
    expect(cmd.deviceId).toBe(deviceId);
  });

  test('confirm() transitions command from pending to confirmed', () => {
    const cmd = CommandRepository.create({
      deviceId,
      requestedByUserId: telegramUserId,
      commandType: 'open',
      telegramChatId: '987654',
      idempotencyKey: 'key-2',
    });

    const confirmed = CommandRepository.confirm(cmd.id, 'msg-123');
    expect(confirmed).not.toBeNull();
    expect(confirmed?.status).toBe('confirmed');
    expect(confirmed?.telegramMessageId).toBe('msg-123');
    expect(confirmed?.confirmedAt).not.toBeNull();
  });

  test('cancel() transitions command to cancelled', () => {
    const cmd = CommandRepository.create({
      deviceId,
      requestedByUserId: telegramUserId,
      commandType: 'close',
      telegramChatId: '987654',
      idempotencyKey: 'key-3',
    });

    const cancelled = CommandRepository.cancel(cmd.id);
    expect(cancelled).not.toBeNull();
    expect(cancelled?.status).toBe('cancelled');
    expect(cancelled?.cancelledAt).not.toBeNull();
  });

  test('getNextForDevice() returns null for pending commands and returns confirmed commands', () => {
    const cmd = CommandRepository.create({
      deviceId,
      requestedByUserId: telegramUserId,
      commandType: 'press',
      telegramChatId: '987654',
      idempotencyKey: 'key-4',
    });

    // Device should not see pending unconfirmed commands
    expect(CommandRepository.getNextForDevice(deviceId)).toBeNull();

    // Confirm it
    CommandRepository.confirm(cmd.id, 'msg-456');

    // Device now sees the confirmed command
    const nextCmd = CommandRepository.getNextForDevice(deviceId);
    expect(nextCmd).not.toBeNull();
    expect(nextCmd?.id).toBe(cmd.id);
  });

  test('markDelivered() transitions command to delivered', () => {
    const cmd = CommandRepository.create({
      deviceId,
      requestedByUserId: telegramUserId,
      commandType: 'press',
      telegramChatId: '987654',
      idempotencyKey: 'key-5',
    });
    CommandRepository.confirm(cmd.id, 'msg-789');

    CommandRepository.markDelivered(cmd.id);

    const fetched = CommandRepository.findById(cmd.id);
    expect(fetched?.status).toBe('delivered');
    expect(fetched?.deliveredAt).not.toBeNull();

    // After delivery, getNextForDevice should return null
    expect(CommandRepository.getNextForDevice(deviceId)).toBeNull();
  });

  test('acknowledge() transitions delivered command to executed with result', () => {
    const cmd = CommandRepository.create({
      deviceId,
      requestedByUserId: telegramUserId,
      commandType: 'press',
      telegramChatId: '987654',
      idempotencyKey: 'key-6',
    });
    CommandRepository.confirm(cmd.id, 'msg-000');
    CommandRepository.markDelivered(cmd.id);

    const acked = CommandRepository.acknowledge(cmd.id, 'success', 'pulse_completed');
    expect(acked).not.toBeNull();
    expect(acked?.status).toBe('executed');
    expect(acked?.executionResult).toBe('success');
    expect(acked?.executionDetail).toBe('pulse_completed');
    expect(acked?.acknowledgedAt).not.toBeNull();

    // Calling acknowledge a second time returns null (cannot ack an already-executed command)
    const secondAck = CommandRepository.acknowledge(cmd.id, 'success', 'duplicate');
    expect(secondAck).toBeNull();
  });

  test('acknowledge() supports uncertain result without re-triggering', () => {
    const cmd = CommandRepository.create({
      deviceId,
      requestedByUserId: telegramUserId,
      commandType: 'press',
      telegramChatId: '987654',
      idempotencyKey: 'key-7',
    });
    CommandRepository.confirm(cmd.id, 'msg-111');
    CommandRepository.markDelivered(cmd.id);

    const acked = CommandRepository.acknowledge(cmd.id, 'uncertain', 'network_timeout_after_pulse');
    expect(acked).not.toBeNull();
    expect(acked?.status).toBe('uncertain');
    expect(acked?.executionResult).toBe('uncertain');
  });

  test('findByIdempotencyKey() returns existing command', () => {
    const idempotencyKey = 'unique-key-xyz';
    const cmd = CommandRepository.create({
      deviceId,
      requestedByUserId: telegramUserId,
      commandType: 'press',
      telegramChatId: '987654',
      idempotencyKey,
    });

    const found = CommandRepository.findByIdempotencyKey(idempotencyKey);
    expect(found).not.toBeNull();
    expect(found?.id).toBe(cmd.id);
  });
});
