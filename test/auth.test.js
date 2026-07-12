import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const tempDir = mkdtempSync(join(tmpdir(), 'checkin-auth-'));
process.env.SECRET_PATH = join(tempDir, '.secret');
process.env.APP_PASSWORD = 'test-password';

const { cookieName, checkPassword, isAuthed, makeToken } = await import('../src/auth.js');

test('authentication uses exact password and exact two-part session tokens', () => {
  assert.equal(checkPassword('test-password'), true);
  assert.equal(checkPassword('test-password-extra'), false);
  const token = makeToken();
  assert.equal(isAuthed({ cookies: { [cookieName]: token } }), true);
  assert.equal(isAuthed({ cookies: { [cookieName]: `${token}.ignored` } }), false);
});

test.after(() => rmSync(tempDir, { recursive: true, force: true }));
