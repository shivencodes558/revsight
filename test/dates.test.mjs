import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseDate, shiftYMD, daysBetween } from '../api/_dates.js';

test('ISO strings pass through', () => {
  assert.equal(parseDate('2026-08-04'), '2026-08-04');
  assert.equal(parseDate('2026-08-04T13:59:19.000'), '2026-08-04');
  assert.equal(parseDate('2026-8-4'), '2026-08-04'); // single-digit ISO
});

test('DD-MM-YYYY India format parses day-first', () => {
  assert.equal(parseDate('04-08-2026'), '2026-08-04');
  assert.equal(parseDate('13-01-2026'), '2026-01-13'); // "13" proves day-first
  assert.equal(parseDate('31/12/2025'), '2025-12-31');
});

test('DD-MM-YY expands to 20YY', () => {
  assert.equal(parseDate('04-08-26'), '2026-08-04');
  assert.equal(parseDate('13-01-26'), '2026-01-13');
});

test('impossible dates are REJECTED (the Adsight bug)', () => {
  // toYMD_ddmmyyyy would have emitted "2026-13-07"; we return null instead
  assert.equal(parseDate('07-13-2026'), null); // month 13
  assert.equal(parseDate('32-01-2026'), null); // day 32
  assert.equal(parseDate('31-02-2026'), null); // Feb 31
  assert.equal(parseDate('2026-13-01'), null); // ISO month 13
  assert.equal(parseDate('2026-02-30'), null); // ISO Feb 30
});

test('leap-year handling', () => {
  assert.equal(parseDate('29-02-2024'), '2024-02-29'); // 2024 is leap
  assert.equal(parseDate('29-02-2026'), null);         // 2026 is not
});

test('Excel serials convert', () => {
  assert.equal(parseDate(46188), '2026-06-15');
  assert.equal(parseDate('46188'), '2026-06-15');
});

test('Date objects and epoch ms', () => {
  assert.equal(parseDate(new Date(Date.UTC(2026, 7, 4))), '2026-08-04');
  assert.equal(parseDate(new Date('invalid')), null);
});

test('empty / null / junk → null', () => {
  assert.equal(parseDate(null), null);
  assert.equal(parseDate(''), null);
  assert.equal(parseDate('   '), null);
  assert.equal(parseDate('not a date'), null);
});

test('shiftYMD and daysBetween', () => {
  assert.equal(shiftYMD('2026-08-04', -1), '2026-08-03');
  assert.equal(shiftYMD('2026-03-01', -1), '2026-02-28');
  assert.equal(shiftYMD('2024-03-01', -1), '2024-02-29'); // leap
  assert.equal(daysBetween('2026-08-01', '2026-08-04'), 4); // inclusive
  assert.equal(daysBetween('2026-08-04', '2026-08-04'), 1);
});
