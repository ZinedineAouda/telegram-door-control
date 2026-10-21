import { Request, Response, NextFunction } from 'express';
import { DeviceRepository } from '../db/devices';
import { Device } from '../types';

// Augment Express Request to carry authenticated device
declare global {
  namespace Express {
    interface Request {
      device?: Device;
    }
  }
}

// In-memory rate limit map: deviceId -> { count, resetAt }
interface RateLimitEntry {
  count: number;
  resetAt: number;
}
const rateLimitMap = new Map<string, RateLimitEntry>();

const RATE_LIMIT_MAX = 180;
const RATE_LIMIT_WINDOW_MS = 60_000;

export function verifyDeviceKey(req: Request, res: Response, next: NextFunction): void {
  const { deviceKey } = req.body as { deviceKey?: string };

  if (!deviceKey || typeof deviceKey !== 'string') {
    res.status(401).json({ ok: false, error: 'missing_device_key' });
    return;
  }

  const device = DeviceRepository.authenticate(deviceKey);
  if (!device) {
    res.status(401).json({ ok: false, error: 'invalid_device_key' });
    return;
  }

  req.device = device;
  next();
}

export function requestLogger(req: Request, res: Response, next: NextFunction): void {
  const ip =
    (req.headers['x-forwarded-for'] as string | undefined)?.split(',')[0]?.trim() ||
    req.socket.remoteAddress ||
    'unknown';
  const timestamp = new Date().toISOString();
  console.log(`[API] ${timestamp} ${req.method} ${req.path} from ${ip}`);
  next();
}

export function rateLimitDevice(req: Request, res: Response, next: NextFunction): void {
  const device = req.device;
  if (!device) {
    // Should never happen if verifyDeviceKey runs first, but guard anyway
    res.status(401).json({ ok: false, error: 'unauthenticated' });
    return;
  }

  const now = Date.now();
  const key = String(device.id);
  let entry = rateLimitMap.get(key);

  if (!entry || now >= entry.resetAt) {
    entry = { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS };
    rateLimitMap.set(key, entry);
    next();
    return;
  }

  if (entry.count >= RATE_LIMIT_MAX) {
    const retryAfterSec = Math.ceil((entry.resetAt - now) / 1000);
    res.setHeader('Retry-After', String(retryAfterSec));
    res.status(429).json({
      ok: false,
      error: 'rate_limit_exceeded',
      retryAfterSeconds: retryAfterSec,
    });
    return;
  }

  entry.count += 1;
  next();
}
