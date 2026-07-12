import test from 'node:test';
import assert from 'node:assert/strict';

import { addDays, businessTimeZone, daysBetween, isValidDate, isoToday } from '../src/dates.js';

test('isValidDate rejects impossible and loosely formatted dates', () => {
  assert.equal(isValidDate('2024-02-29'), true);
  assert.equal(isValidDate('2023-02-29'), false);
  assert.equal(isValidDate('2026-02-31'), false);
  assert.equal(isValidDate('2026-2-01'), false);
  assert.equal(isValidDate('2026-02-01extra'), false);
});

test('date arithmetic remains stable across leap days', () => {
  assert.equal(addDays('2024-02-28', 1), '2024-02-29');
  assert.equal(addDays('2024-02-29', 1), '2024-03-01');
  assert.equal(daysBetween('2024-02-28', '2024-03-01'), 2);
  assert.throws(() => addDays('2023-02-29', 1), RangeError);
});

test('isoToday uses the configured business timezone instead of UTC', () => {
  const instant = new Date('2026-07-10T16:30:00.000Z');
  assert.equal(isoToday('Asia/Shanghai', instant), '2026-07-11');
  assert.equal(isoToday('UTC', instant), '2026-07-10');
});

test('business timezone follows CHECKIN_TZ and safely falls back', () => {
  const previous = process.env.CHECKIN_TZ;
  process.env.CHECKIN_TZ = 'Asia/Tokyo';
  assert.equal(businessTimeZone(), 'Asia/Tokyo');
  process.env.CHECKIN_TZ = 'Not/A_Timezone';
  assert.equal(businessTimeZone(), 'Asia/Hong_Kong');
  if (previous === undefined) delete process.env.CHECKIN_TZ;
  else process.env.CHECKIN_TZ = previous;
});
