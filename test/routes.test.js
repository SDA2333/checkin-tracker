import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import express from 'express';

const tempDir = mkdtempSync(join(tmpdir(), 'checkin-tracker-'));
process.env.DB_PATH = join(tempDir, 'test.db');

const [{ default: db }, { default: sites }, { default: checkins }, { default: renewals }] =
  await Promise.all([
    import('../src/db.js'),
    import('../src/routes/sites.js'),
    import('../src/routes/checkins.js'),
    import('../src/routes/renewals.js'),
  ]);

const app = express();
app.use(express.json());
app.use('/sites', sites);
app.use('/checkins', checkins);
app.use('/renewals', renewals);

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

  await t.test('excludes archived sites from check-ins and calendar counts', async () => {
    db.prepare('UPDATE sites SET active_from = ? WHERE id = ?').run('2026-01-01', siteId);
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
    const rejected = await request('/checkins', {
      method: 'POST',
      body: JSON.stringify({ site_id: siteId, date: '2026-01-02' }),
    });
    assert.equal(rejected.status, 409);
    const calendar = await request('/checkins/calendar?from=2026-01-01&to=2026-01-31');
    assert.deepEqual(calendar.body.days, {});
    assert.equal(calendar.body.totals['2026-01-01'], 0);
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
});

test.after(async () => {
  await new Promise((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  db.close();
  rmSync(tempDir, { recursive: true, force: true });
});
