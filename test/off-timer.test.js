'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { OffTimer, presets } = require('../lib/off-timer');
function setup(t, off = async () => true) {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'lg-off-timer-'));
  let now = 1000000;
  const options = { file: path.join(directory, 'timer.json'), off, now: () => now,
    changed() {}, log: { warn() {} } };
  const timer = new OffTimer(options);
  t.after(() => { timer.stop(); fs.rmSync(directory, { recursive: true, force: true }); });
  return { timer, options, advance: n => { now += n; }, directory };
}
test('validates minute presets without coercion, deduplicates, supports disable', () => {
  assert.deepEqual(presets(), [60, 120, 240, 480]);
  assert.deepEqual(presets([1, 1, 1440]), [1, 1440]); assert.deepEqual(presets([]), []);
  for (const v of [[0], [-1], [1.5], ['60'], [1441], null, Array(13).fill(1)]) assert.throws(() => presets(v));
});
test('does not shut down early; confirms off and clears persistent reservation', async t => {
  let calls = 0; const { timer, advance, options } = setup(t, async () => { calls++; return true; });
  timer.set(1); const generation = timer.generation;
  await timer.fire(generation); assert.equal(calls, 0);
  advance(60000); await timer.fire(generation);
  assert.equal(calls, 1); assert.equal(timer.record, null);
  assert.equal(JSON.parse(fs.readFileSync(options.file)), null);
});
test('replacement and cancellation invalidate queued actions', async t => {
  let calls = 0; const { timer, advance } = setup(t, async () => { calls++; return true; });
  timer.set(1); const old = timer.generation; timer.set(2); advance(60000);
  await timer.fire(old); assert.equal(calls, 0); assert.equal(timer.record.minutes, 2);
  const current = timer.generation; timer.cancel(); advance(60000);
  await timer.fire(current); assert.equal(calls, 0);
});
test('restores original absolute deadline and retains it during shutdown', async t => {
  const { timer, options, advance } = setup(t); timer.set(1);
  const expected = { ...timer.record }; timer.stop(); advance(30000);
  const restored = new OffTimer(options); t.after(() => restored.stop());
  assert.deepEqual(restored.record, expected); assert.equal(restored.record.deadline - options.now(), 30000);
});
test('failed command/readback keeps reservation for retry; grace period expires safely', async t => {
  let calls = 0; const { timer, advance } = setup(t, async () => { calls++; throw new Error('offline'); });
  timer.set(1); advance(60000); await timer.fire(timer.generation);
  assert.equal(calls, 1); assert.ok(timer.record);
  advance(60000); await timer.fire(timer.generation); assert.equal(calls, 2);
  advance(15 * 60000); await timer.fire(timer.generation);
  assert.equal(calls, 2); assert.equal(timer.record, null);
});
test('unconfirmed command retries; stopped timer cannot send', async t => {
  let calls = 0; const { timer, advance } = setup(t, async () => { calls++; return false; });
  timer.set(1); advance(60000); await timer.fire(timer.generation); assert.ok(timer.record);
  timer.stop(); await timer.fire(timer.generation); assert.equal(calls, 1);
});
test('disk failure cannot acknowledge new reservation', t => {
  const { timer, directory } = setup(t); timer.file = path.join(directory, 'missing', 'timer.json');
  assert.throws(() => timer.set(1)); assert.equal(timer.record, null);
});
