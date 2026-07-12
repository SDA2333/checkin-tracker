import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const tempDir = mkdtempSync(join(tmpdir(), 'checkin-history-'));
process.env.DB_PATH = join(tempDir, 'test.db');

const [{ default: db }, { getNotificationHistory, getNotifiedToday }] = await Promise.all([
  import('../src/db.js'),
  import('../src/notifications/history.js'),
]);

test('notification deduplication aggregates every successful batch from the day', () => {
  const insert = db.prepare(
    `INSERT INTO notification_logs (sent_at, items, status, results) VALUES (?, ?, ?, ?)`
  );
  insert.run('2026-07-12', JSON.stringify([{ id: 1 }]), 'success', '[]');
  insert.run('2026-07-12', JSON.stringify([{ id: 2 }]), 'success', '[]');
  insert.run('2026-07-12', JSON.stringify([{ id: 3 }]), 'failed', '[]');
  insert.run('2026-07-12', '{broken', 'success', '[]');

  assert.deepEqual([...getNotifiedToday('2026-07-12')].sort(), [1, 2]);
});

test('corrupted history JSON does not break the whole history endpoint', () => {
  const rows = getNotificationHistory(10);
  const broken = rows.find((row) => row.items.length === 0);
  assert.ok(broken);
});

test.after(() => {
  db.close();
  rmSync(tempDir, { recursive: true, force: true });
});
