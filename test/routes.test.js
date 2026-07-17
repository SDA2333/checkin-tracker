import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import express from 'express';

const tempDir = mkdtempSync(join(tmpdir(), 'checkin-tracker-'));
process.env.DB_PATH = join(tempDir, 'test.db');
process.env.BACKGROUND_DIR = join(tempDir, 'backgrounds');

const [{ default: db }, { default: sites }, { default: checkins }, { default: renewals }, { default: backgrounds }] =
  await Promise.all([
    import('../src/db.js'),
    import('../src/routes/sites.js'),
    import('../src/routes/checkins.js'),
    import('../src/routes/renewals.js'),
    import('../src/routes/backgrounds.js'),
  ]);

const app = express();
app.use(express.json());
app.use('/sites', sites);
app.use('/checkins', checkins);
app.use('/renewals', renewals);
app.use('/backgrounds', backgrounds);

const server = await new Promise((resolve) => {
  const value = app.listen(0, '127.0.0.1', () => resolve(value));
});
const base = `http://127.0.0.1:${server.address().port}`;

async function request(path, options = {}) {
  const response = await fetch(base + path, {
    headers: { 'content-type': 'application/json' },
    ...options,
  });
  const body = await response.json();
  return { status: response.status, body };
}

test('route validation prevents invalid data and database errors', async (t) => {
  let siteId;

  await t.test('creates a valid site', async () => {
    const result = await request('/sites', {
      method: 'POST',
      body: JSON.stringify({ name: 'Example' }),
    });
    assert.equal(result.status, 200);
    siteId = result.body.id;
  });

  await t.test('rejects an empty name on update', async () => {
    const result = await request(`/sites/${siteId}`, {
      method: 'PUT',
      body: JSON.stringify({ name: '  ' }),
    });
    assert.equal(result.status, 400);
  });

  await t.test('rejects invalid site frequency and missing deletes', async () => {
    const invalidFrequency = await request('/sites', {
      method: 'POST',
      body: JSON.stringify({ name: 'Bad', frequency: 'monthly' }),
    });
    assert.equal(invalidFrequency.status, 400);
    const missingDelete = await request('/sites/999999', { method: 'DELETE' });
    assert.equal(missingDelete.status, 404);
  });

  await t.test('rejects impossible dates and missing sites for check-ins', async () => {
    const invalidDate = await request('/checkins', {
      method: 'POST',
      body: JSON.stringify({ site_id: siteId, date: '2026-02-31' }),
    });
    assert.equal(invalidDate.status, 400);

    const missingSite = await request('/checkins', {
      method: 'POST',
      body: JSON.stringify({ site_id: 999999, date: '2026-02-28' }),
    });
    assert.equal(missingSite.status, 404);

    const futureDate = await request('/checkins', {
      method: 'POST',
      body: JSON.stringify({ site_id: siteId, date: '2999-01-01' }),
    });
    assert.equal(futureDate.status, 400);
  });

  await t.test('preserves historical check-ins and totals after archiving', async () => {
    db.prepare('UPDATE sites SET active_from = ? WHERE id = ?').run('2026-01-01', siteId);
    db.prepare('UPDATE site_activity_periods SET active_from = ? WHERE site_id = ?').run('2026-01-01', siteId);
    const checked = await request('/checkins', {
      method: 'POST',
      body: JSON.stringify({ site_id: siteId, date: '2026-01-01' }),
    });
    assert.equal(checked.status, 200);

    const lateSite = await request('/sites', {
      method: 'POST',
      body: JSON.stringify({ name: 'Added later' }),
    });
    assert.equal(lateSite.status, 200);
    const historical = await request('/checkins/calendar?from=2026-01-01&to=2026-01-31');
    assert.equal(historical.body.days['2026-01-01'], 1);
    assert.equal(historical.body.totals['2026-01-01'], 1);
    assert.equal(historical.body.totals['2026-01-31'], 1);
    const historicalToday = await request('/checkins/today?date=2026-01-01');
    assert.equal(historicalToday.body.total, 1);
    assert.equal(historicalToday.body.doneCount, 1);

    const archived = await request(`/sites/${siteId}`, {
      method: 'PUT',
      body: JSON.stringify({ archived: true }),
    });
    assert.equal(archived.status, 200);
    const historicalAfterArchive = await request('/checkins/calendar?from=2026-01-01&to=2026-01-31');
    assert.equal(historicalAfterArchive.body.days['2026-01-01'], 1);
    assert.equal(historicalAfterArchive.body.totals['2026-01-01'], 1);
    assert.equal(historicalAfterArchive.body.totals['2026-01-31'], 1);
    const historicalDetail = await request('/checkins/today?date=2026-01-01');
    assert.equal(historicalDetail.body.total, 1);
    assert.equal(historicalDetail.body.doneCount, 1);

    const allowedHistoricalCorrection = await request('/checkins', {
      method: 'POST',
      body: JSON.stringify({ site_id: siteId, date: '2026-01-02' }),
    });
    assert.equal(allowedHistoricalCorrection.status, 200);

    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Hong_Kong' }).format(new Date());
    const rejectedCurrent = await request('/checkins', {
      method: 'POST',
      body: JSON.stringify({ site_id: siteId, date: today }),
    });
    assert.equal(rejectedCurrent.status, 409);
  });

  await t.test('limits oversized calendar ranges', async () => {
    const result = await request('/checkins/calendar?from=2024-01-01&to=2026-01-01');
    assert.equal(result.status, 400);
  });

  await t.test('rejects fractional cycles and invalid period ranges', async () => {
    const fractional = await request('/renewals', {
      method: 'POST',
      body: JSON.stringify({ name: 'Plan', cycle_days: 1.5, last_renewed: '2026-01-01' }),
    });
    assert.equal(fractional.status, 400);

    const reversed = await request('/renewals', {
      method: 'POST',
      body: JSON.stringify({
        name: 'Plan',
        cycle_days: 30,
        current_period_start: '2026-02-01',
        current_period_end: '2026-01-31',
      }),
    });
    assert.equal(reversed.status, 400);

    const invalidPolicy = await request('/renewals', {
      method: 'POST',
      body: JSON.stringify({ name: 'Plan', cycle_days: 30, last_renewed: '2026-01-01', renewal_policy: 'other' }),
    });
    assert.equal(invalidPolicy.status, 400);
  });

  await t.test('returns 404 for missing renewal history and deletes', async () => {
    assert.equal((await request('/renewals/999999/history')).status, 404);
    assert.equal((await request('/renewals/999999', { method: 'DELETE' })).status, 404);
  });

  await t.test('validates renewal updates and payment dates', async () => {
    const created = await request('/renewals', {
      method: 'POST',
      body: JSON.stringify({ name: 'Plan', cycle_days: 30, last_renewed: '2026-01-01' }),
    });
    assert.equal(created.status, 200);

    const negativeReminder = await request(`/renewals/${created.body.id}`, {
      method: 'PUT',
      body: JSON.stringify({ remind_before_days: -1 }),
    });
    assert.equal(negativeReminder.status, 400);

    const invalidPayment = await request(`/renewals/${created.body.id}/renew`, {
      method: 'POST',
      body: JSON.stringify({ paid_on: '2026-02-30' }),
    });
    assert.equal(invalidPayment.status, 400);

    const expectedPeriodEnd = created.body.current_period_end;
    const renewed = await request(`/renewals/${created.body.id}/renew`, {
      method: 'POST',
      body: JSON.stringify({
        paid_on: '2026-01-15',
        policy: 'extend_from_due',
        expected_period_end: expectedPeriodEnd,
      }),
    });
    assert.equal(renewed.status, 200);

    const duplicate = await request(`/renewals/${created.body.id}/renew`, {
      method: 'POST',
      body: JSON.stringify({
        paid_on: '2026-01-15',
        policy: 'extend_from_due',
        expected_period_end: expectedPeriodEnd,
      }),
    });
    assert.equal(duplicate.status, 409);
    const history = await request(`/renewals/${created.body.id}/history`);
    assert.equal(history.body.length, 2);
  });

  await t.test('moves renewal items within the same category and persists order', async () => {
    const create = (name, category) => request('/renewals', {
      method: 'POST',
      body: JSON.stringify({ name, category, cycle_days: 30, last_renewed: '2026-03-01' }),
    });
    const first = await create('Order A', '排序测试');
    const second = await create('Order B', '排序测试');
    await create('Other category', '其他分类');
    assert.equal(first.status, 200);
    assert.equal(second.status, 200);

    const moved = await request(`/renewals/${second.body.id}/move`, {
      method: 'POST',
      body: JSON.stringify({ dir: 'up' }),
    });
    assert.equal(moved.status, 200);
    assert.equal(moved.body.moved, true);

    const ordered = (await request('/renewals?today=2026-03-10')).body
      .filter((item) => item.category === '排序测试')
      .map((item) => item.name);
    assert.deepEqual(ordered, ['Order B', 'Order A']);

    const boundary = await request(`/renewals/${second.body.id}/move`, {
      method: 'POST',
      body: JSON.stringify({ dir: 'up' }),
    });
    assert.equal(boundary.status, 200);
    assert.equal(boundary.body.moved, false);
    assert.equal((await request(`/renewals/${second.body.id}/move`, {
      method: 'POST',
      body: JSON.stringify({ dir: 'sideways' }),
    })).status, 400);
    assert.equal((await request('/renewals/999999/move', {
      method: 'POST',
      body: JSON.stringify({ dir: 'down' }),
    })).status, 404);
  });
});

test('background gallery validates uploads and keeps selection consistent', async (t) => {
  await t.test('starts without a background selected', async () => {
    const result = await request('/backgrounds');
    assert.equal(result.status, 200);
    assert.equal(result.body.selected, 'none');
    assert.deepEqual(result.body.items.slice(0, 3).map((item) => item.id), ['none', 'default', 'summer']);

    const summer = await request('/backgrounds/selection', {
      method: 'PUT',
      body: JSON.stringify({ id: 'summer' }),
    });
    assert.equal(summer.status, 200);
    assert.equal(summer.body.selected, 'summer');

    await request('/backgrounds/selection', {
      method: 'PUT',
      body: JSON.stringify({ id: 'none' }),
    });
  });

  await t.test('rejects unsupported and forged image bodies', async () => {
    const unsupported = await request('/backgrounds', {
      method: 'POST',
      headers: { 'content-type': 'image/gif' },
      body: Buffer.from('GIF89a'),
    });
    assert.equal(unsupported.status, 415);

    const forged = await request('/backgrounds', {
      method: 'POST',
      headers: { 'content-type': 'image/png' },
      body: Buffer.from('not a png'),
    });
    assert.equal(forged.status, 400);
  });

  let uploadedId;
  await t.test('uploads and automatically selects a valid image', async () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
    const result = await request('/backgrounds', {
      method: 'POST',
      headers: { 'content-type': 'image/png', 'x-file-name': encodeURIComponent('测试背景.png') },
      body: png,
    });
    assert.equal(result.status, 201);
    uploadedId = result.body.selected;
    assert.match(uploadedId, /^upload:\d+$/);
    assert.equal(result.body.item.name, '测试背景');
    assert.equal((await request('/backgrounds')).body.selected, uploadedId);
  });

  await t.test('serves the uploaded bytes and validates selection IDs', async () => {
    const numericId = uploadedId.slice(7);
    const image = await fetch(`${base}/backgrounds/${numericId}/image`);
    assert.equal(image.status, 200);
    assert.equal(image.headers.get('content-type'), 'image/png');
    assert.equal((await image.arrayBuffer()).byteLength, 9);

    const missing = await request('/backgrounds/selection', {
      method: 'PUT',
      body: JSON.stringify({ id: 'upload:999999' }),
    });
    assert.equal(missing.status, 404);
  });

  await t.test('deleting the selected upload falls back to no background', async () => {
    const result = await request(`/backgrounds/${uploadedId.slice(7)}`, { method: 'DELETE' });
    assert.equal(result.status, 200);
    assert.equal(result.body.selected, 'none');
    const gallery = await request('/backgrounds');
    assert.equal(gallery.body.selected, 'none');
    assert.equal(gallery.body.items.length, 3);
  });
});

test.after(async () => {
  await new Promise((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  db.close();
  rmSync(tempDir, { recursive: true, force: true });
});
