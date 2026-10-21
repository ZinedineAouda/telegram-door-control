import express from 'express';
import request from 'supertest';
import path from 'path';
import fs from 'fs';
import { initDatabase } from '../src/db/database';
import { DeviceRepository } from '../src/db/devices';
import { CommandRepository } from '../src/db/commands';
import { UserRepository } from '../src/db/users';
import deviceRouter from '../src/api/routes';

const schemaSQL = fs.readFileSync(
  path.join(__dirname, '../../database/schema.sql'),
  'utf-8'
);

describe('Device API Routes', () => {
  let app: express.Express;
  const testDeviceKey = 'test-secret-key-12345';
  let deviceId: string;
  const testUserId = '88888888';

  beforeEach(() => {
    const db = initDatabase(':memory:');
    db.exec(schemaSQL);

    UserRepository.addUser(testUserId, 'API Tester', null);
    const { device } = DeviceRepository.register('Front Door Relay', testDeviceKey);
    deviceId = device.id;

    app = express();
    app.use(express.json());
    app.use('/api', deviceRouter);
    app.get('/health', (_req, res) => res.json({ ok: true }));
  });

  test('GET /health returns 200 OK', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  test('POST /api/device/auth with valid key returns 200 and device info', async () => {
    const res = await request(app)
      .post('/api/device/auth')
      .send({ deviceKey: testDeviceKey });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.deviceId).toBe(deviceId);
    expect(res.body.deviceName).toBe('Front Door Relay');
  });

  test('POST /api/device/auth with invalid key returns 401', async () => {
    const res = await request(app)
      .post('/api/device/auth')
      .send({ deviceKey: 'wrong-key' });

    expect(res.status).toBe(401);
    expect(res.body.ok).toBe(false);
  });

  test('POST /api/device/heartbeat with valid key returns 200', async () => {
    const res = await request(app)
      .post('/api/device/heartbeat')
      .send({
        deviceKey: testDeviceKey,
        firmwareVersion: '1.0.0',
        freeHeap: 45000,
        uptimeSeconds: 120,
        wifiRssi: -65,
      });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.serverTime).toBeDefined();

    const lastHb = DeviceRepository.getLastHeartbeat(deviceId);
    expect(lastHb).not.toBeNull();
    expect(lastHb?.freeHeap).toBe(45000);
  });

  test('POST /api/device/heartbeat without deviceKey returns 401', async () => {
    const res = await request(app)
      .post('/api/device/heartbeat')
      .send({ freeHeap: 30000 });

    expect(res.status).toBe(401);
    expect(res.body.ok).toBe(false);
  });

  test('POST /api/device/command/pending returns null when no commands exist', async () => {
    const res = await request(app)
      .post('/api/device/command/pending')
      .send({ deviceKey: testDeviceKey });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.command).toBeNull();
  });

  test('POST /api/device/command/pending returns confirmed command and marks delivered', async () => {
    const cmd = CommandRepository.create({
      deviceId,
      requestedByUserId: testUserId,
      commandType: 'press',
      telegramChatId: '123',
      idempotencyKey: 'idemp-api-1',
    });
    CommandRepository.confirm(cmd.id, 'msg-api-1');

    const res = await request(app)
      .post('/api/device/command/pending')
      .send({ deviceKey: testDeviceKey });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.command).not.toBeNull();
    expect(res.body.command.id).toBe(cmd.id);
    expect(res.body.command.commandType).toBe('press');
    expect(res.body.command.pulseDurationMs).toBeDefined();

    // Verify command status transitioned to delivered
    const updated = CommandRepository.findById(cmd.id);
    expect(updated?.status).toBe('delivered');

    // A second poll immediately returns null (already delivered)
    const secondPoll = await request(app)
      .post('/api/device/command/pending')
      .send({ deviceKey: testDeviceKey });
    expect(secondPoll.body.command).toBeNull();
  });

  test('POST /api/device/command/ack acknowledges execution and handles duplicate calls idempotently', async () => {
    const cmd = CommandRepository.create({
      deviceId,
      requestedByUserId: testUserId,
      commandType: 'press',
      telegramChatId: '123',
      idempotencyKey: 'idemp-api-2',
    });
    CommandRepository.confirm(cmd.id, 'msg-api-2');
    CommandRepository.markDelivered(cmd.id);

    // First ACK: accepted = true
    const res1 = await request(app)
      .post('/api/device/command/ack')
      .send({
        deviceKey: testDeviceKey,
        commandId: cmd.id,
        result: 'success',
        detail: 'pulse_complete_400ms',
      });

    expect(res1.status).toBe(200);
    expect(res1.body.ok).toBe(true);
    expect(res1.body.accepted).toBe(true);

    const updated = CommandRepository.findById(cmd.id);
    expect(updated?.status).toBe('executed');
    expect(updated?.executionResult).toBe('success');

    // Second ACK: accepted = false with already_acknowledged (idempotent duplicate protection)
    const res2 = await request(app)
      .post('/api/device/command/ack')
      .send({
        deviceKey: testDeviceKey,
        commandId: cmd.id,
        result: 'success',
        detail: 'duplicate_ack',
      });

    expect(res2.status).toBe(200);
    expect(res2.body.ok).toBe(true);
    expect(res2.body.accepted).toBe(false);
    expect(res2.body.reason).toBe('already_acknowledged');
  });

  test('POST /api/device/command/ack records uncertain result without allowing automatic re-trigger', async () => {
    const cmd = CommandRepository.create({
      deviceId,
      requestedByUserId: testUserId,
      commandType: 'close',
      telegramChatId: '123',
      idempotencyKey: 'idemp-api-3',
    });
    CommandRepository.confirm(cmd.id, 'msg-api-3');
    CommandRepository.markDelivered(cmd.id);

    const res = await request(app)
      .post('/api/device/command/ack')
      .send({
        deviceKey: testDeviceKey,
        commandId: cmd.id,
        result: 'uncertain',
        detail: 'device_reset_during_pulse',
      });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.accepted).toBe(true);

    const updated = CommandRepository.findById(cmd.id);
    expect(updated?.status).toBe('uncertain');
    expect(updated?.executionResult).toBe('uncertain');
  });
});
