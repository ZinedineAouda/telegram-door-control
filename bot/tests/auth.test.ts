import { initDatabase } from '../src/db/database';
import { UserRepository } from '../src/db/users';
import path from 'path';
import fs from 'fs';

const schemaSQL = fs.readFileSync(
  path.join(__dirname, '../../database/schema.sql'),
  'utf-8'
);

describe('UserRepository', () => {
  beforeEach(() => {
    // Re-initialize with in-memory DB for each test
    const db = initDatabase(':memory:');
    db.exec(schemaSQL);
  });

  test('isAuthorized returns false for unknown user', () => {
    const result = UserRepository.isAuthorized('999999999');
    expect(result).toBe(false);
  });

  test('isAuthorized returns true after addUser', () => {
    UserRepository.addUser('123456789', 'Alice', 'Primary Admin');
    const result = UserRepository.isAuthorized('123456789');
    expect(result).toBe(true);
  });

  test('isAuthorized returns false after deactivate', () => {
    UserRepository.addUser('111222333', 'Bob', 'Temporary user');
    expect(UserRepository.isAuthorized('111222333')).toBe(true);

    UserRepository.deactivate('111222333');
    expect(UserRepository.isAuthorized('111222333')).toBe(false);
  });

  test('numeric user IDs stored as strings work correctly', () => {
    const largeTelegramId = '9876543210123456';
    UserRepository.addUser(largeTelegramId, 'Large ID User', null);

    const user = UserRepository.findByTelegramId(largeTelegramId);
    expect(user).not.toBeNull();
    expect(user?.telegramUserId).toBe(largeTelegramId);
    expect(UserRepository.isAuthorized(largeTelegramId)).toBe(true);
  });

  test('findByTelegramId returns null for unknown user', () => {
    const user = UserRepository.findByTelegramId('non_existent_id');
    expect(user).toBeNull();
  });

  test('listActive returns only active users', () => {
    UserRepository.addUser('101', 'User 1', null);
    UserRepository.addUser('102', 'User 2', null);
    UserRepository.addUser('103', 'User 3', null);

    UserRepository.deactivate('102');

    const active = UserRepository.listActive();
    expect(active.length).toBe(2);
    expect(active.map((u) => u.telegramUserId)).toEqual(
      expect.arrayContaining(['101', '103'])
    );
    expect(active.map((u) => u.telegramUserId)).not.toContain('102');
  });
});
