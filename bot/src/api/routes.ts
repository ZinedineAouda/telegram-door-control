import { Router, Request, Response } from 'express';
import { verifyDeviceKey, rateLimitDevice } from './middleware';
import { DeviceRepository } from '../db/devices';
import { CommandRepository } from '../db/commands';
import { AuditRepository } from '../db/audit';
import { notifyCommandResult } from '../bot/notifications';
import {
  HeartbeatRequest,
  AckRequest,
} from '../types';

const router = Router();

// ---------------------------------------------------------------------------
// Helper: extract IP from request
// ---------------------------------------------------------------------------
function getIp(req: Request): string {
  return (
    (req.headers['x-forwarded-for'] as string | undefined)?.split(',')[0]?.trim() ||
    req.socket.remoteAddress ||
    'unknown'
  );
}

// ---------------------------------------------------------------------------
// POST /api/device/auth
// Device authenticates and gets its ID back.
// Body: { deviceKey: string }
// ---------------------------------------------------------------------------
router.post('/device/auth', async (req: Request, res: Response) => {
  const ip = getIp(req);
  const { deviceKey } = req.body as { deviceKey?: string };

  if (!deviceKey || typeof deviceKey !== 'string') {
    AuditRepository.log({
      eventType: 'device_auth_failed',
      ipAddress: ip,
      details: { reason: 'missing_device_key' },
    });
    res.status(401).json({ ok: false, error: 'missing_device_key' });
    return;
  }

  try {
    const device = DeviceRepository.authenticate(deviceKey);

    if (!device) {
      AuditRepository.log({
        eventType: 'device_auth_failed',
        ipAddress: ip,
        details: { reason: 'invalid_device_key' },
      });
      res.status(401).json({ ok: false });
      return;
    }

    // Update last-seen on successful auth
    DeviceRepository.updateLastSeen(device.id, undefined, ip);

    AuditRepository.log({
      eventType: 'device_auth_success',
      deviceId: device.id,
      ipAddress: ip,
      details: { deviceName: device.deviceName },
    });

    res.json({
      ok: true,
      deviceId: device.id,
      deviceName: device.deviceName,
    });
  } catch (err) {
    console.error('[API] /device/auth error:', err);
    res.status(500).json({ ok: false, error: 'internal_error' });
  }
});

// ---------------------------------------------------------------------------
// POST /api/device/heartbeat
// Body: { deviceKey, firmwareVersion?, freeHeap?, uptimeSeconds?, wifiRssi? }
// ---------------------------------------------------------------------------
router.post(
  '/device/heartbeat',
  verifyDeviceKey,
  rateLimitDevice,
  async (req: Request, res: Response) => {
    const ip = getIp(req);
    const device = req.device!;
    const body = req.body as HeartbeatRequest;

    try {
      // Validate optional numeric fields
      const freeHeap =
        typeof body.freeHeap === 'number' && isFinite(body.freeHeap) ? body.freeHeap : undefined;
      const uptimeSeconds =
        typeof body.uptimeSeconds === 'number' && isFinite(body.uptimeSeconds)
          ? body.uptimeSeconds
          : undefined;
      const wifiRssi =
        typeof body.wifiRssi === 'number' && isFinite(body.wifiRssi) ? body.wifiRssi : undefined;
      const firmwareVersion =
        typeof body.firmwareVersion === 'string' ? body.firmwareVersion : undefined;

      // Update device last_seen + firmware
      DeviceRepository.updateLastSeen(device.id, firmwareVersion, ip);

      // Record heartbeat row
      DeviceRepository.recordHeartbeat(device.id, {
        firmwareVersion,
        freeHeap,
        uptimeSeconds,
        wifiRssi,
      });

      res.json({ ok: true, serverTime: new Date().toISOString() });
    } catch (err) {
      console.error('[API] /device/heartbeat error:', err);
      res.status(500).json({ ok: false, error: 'internal_error' });
    }
  },
);

// ---------------------------------------------------------------------------
// POST /api/device/command/pending
// Device polls for the next confirmed command.
// Body: { deviceKey }
// ---------------------------------------------------------------------------
router.post(
  '/device/command/pending',
  verifyDeviceKey,
  rateLimitDevice,
  async (req: Request, res: Response) => {
    const ip = getIp(req);
    const device = req.device!;
    const pulseDurationMs = parseInt(process.env.PULSE_DURATION_MS || '400', 10);

    try {
      // Expire any stale commands first, so we never hand out an expired one
      CommandRepository.expireStale();

      // Get the oldest confirmed, non-expired command for this device
      const command = CommandRepository.getNextForDevice(device.id);

      if (!command) {
        res.json({ ok: true, command: null });
        return;
      }

      // Mark as delivered immediately so duplicate polls return null
      CommandRepository.markDelivered(command.id);

      AuditRepository.log({
        eventType: 'command_delivered',
        deviceId: device.id,
        commandId: command.id,
        ipAddress: ip,
        details: { commandType: command.commandType },
      });

      res.json({
        ok: true,
        command: {
          id: command.id,
          commandType: command.commandType,
          expiresAt: command.expiresAt.toISOString(),
          pulseDurationMs,
        },
      });
    } catch (err) {
      console.error('[API] /device/command/pending error:', err);
      res.status(500).json({ ok: false, error: 'internal_error' });
    }
  },
);

// ---------------------------------------------------------------------------
// POST /api/device/command/ack
// Device reports execution result.
// Body: { deviceKey, commandId, result: 'success'|'uncertain'|'failed', detail? }
// ---------------------------------------------------------------------------
router.post(
  '/device/command/ack',
  verifyDeviceKey,
  rateLimitDevice,
  async (req: Request, res: Response) => {
    const ip = getIp(req);
    const device = req.device!;
    const body = req.body as AckRequest;

    const { commandId, result, detail } = body;

    // Input validation
    if (!commandId || typeof commandId !== 'string') {
      res.status(400).json({ ok: false, error: 'missing_command_id' });
      return;
    }

    if (!['success', 'uncertain', 'failed'].includes(result)) {
      res.status(400).json({ ok: false, error: 'invalid_result' });
      return;
    }

    try {
      const command = CommandRepository.findById(commandId);

      if (!command) {
        res.status(404).json({ ok: false, error: 'command_not_found' });
        return;
      }

      // Ensure this command belongs to this device
      if (command.deviceId !== device.id) {
        AuditRepository.log({
          eventType: 'command_ack_unauthorized',
          deviceId: device.id,
          commandId,
          ipAddress: ip,
          details: { reason: 'device_mismatch', ownerId: command.deviceId },
        });
        res.status(403).json({ ok: false, error: 'forbidden' });
        return;
      }

      // Idempotency: if already acknowledged, return accepted=false without re-notifying
      if (
        command.status === 'executed' ||
        command.status === 'uncertain' ||
        command.status === 'failed' ||
        command.acknowledgedAt !== null
      ) {
        res.json({
          ok: true,
          accepted: false,
          reason: 'already_acknowledged',
        });
        return;
      }

      // Only 'delivered' commands can be acked
      if (command.status !== 'delivered') {
        res.status(409).json({
          ok: false,
          error: 'invalid_state',
          currentStatus: command.status,
        });
        return;
      }

      // Acknowledge the command
      const acknowledged = CommandRepository.acknowledge(
        commandId,
        result,
        typeof detail === 'string' ? detail : undefined,
      );

      if (!acknowledged) {
        res.status(409).json({ ok: false, error: 'acknowledge_failed' });
        return;
      }

      AuditRepository.log({
        eventType: 'command_acknowledged',
        deviceId: device.id,
        commandId,
        ipAddress: ip,
        details: { result, detail: detail ?? null },
      });

      // Notify originating Telegram user asynchronously (don't await to avoid timeout)
      notifyCommandResult(acknowledged).catch((err) => {
        console.error(`[API] Failed to notify user for command ${commandId}:`, err);
      });

      res.json({ ok: true, accepted: true });
    } catch (err) {
      console.error('[API] /device/command/ack error:', err);
      res.status(500).json({ ok: false, error: 'internal_error' });
    }
  },
);

export default router;
