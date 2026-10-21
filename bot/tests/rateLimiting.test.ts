import { initDatabase } from '../src/db/database';
import { RateLimiter, AuditRepository } from '../src/db/audit';
import path from 'path';
import fs from 'fs';

const schemaSQL = fs.readFileSync(
  path.join(__dirname, '../../database/schema.sql'),
  'utf-8'
);

describe('RateLimiter & AuditRepository', () => {
  const userId = '123456789';

  beforeEach(() => {
    const db = initDatabase(':memory:');
    db.exec(schemaSQL);
  });

  test('RateLimiter allows up to 5 requests per minute, then blocks', () => {
    // 5 allowed
    for (let i = 0; i < 5; i++) {
      expect(RateLimiter.check(userId, 'press')).toBe(true);
      RateLimiter.record(userId, 'press');
    }

    // 6th request must be blocked
    expect(RateLimiter.check(userId, 'press')).toBe(false);
  });

  test('Rate limits are tracked independently per user', () => {
    const userA = '1001';
    const userB = '1002';

    for (let i = 0; i < 5; i++) {
      RateLimiter.record(userA, 'press');
    }

    // User A is blocked
    expect(RateLimiter.check(userA, 'press')).toBe(false);

    // User B is still permitted
    expect(RateLimiter.check(userB, 'press')).toBe(true);
  });

  test('AuditRepository logs events and retrieves them accurately', () => {
    AuditRepository.log({
      eventType: 'command_requested',
      telegramUserId: userId,
      details: { commandType: 'press', source: 'test' },
      ipAddress: '127.0.0.1',
    });

    const events = AuditRepository.getRecent(10);
    expect(events.length).toBe(1);
    expect(events[0].eventType).toBe('command_requested');
    expect(events[0].telegramUserId).toBe(userId);
    expect(events[0].details).toEqual({ commandType: 'press', source: 'test' });
    expect(events[0].ipAddress).toBe('127.0.0.1');
  });

  test('AuditRepository.pruneRateLimitEvents executes without error', () => {
    expect(() => {
      AuditRepository.pruneRateLimitEvents();
    }).not.toThrow();
  });
});
