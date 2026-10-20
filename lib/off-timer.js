'use strict';
const fs = require('node:fs');

// A Homebridge-hosted timer, deliberately independent of undocumented LG timers.
const RETRY = 60000;
const GRACE = 15 * 60000;
function presets(value = [60, 120, 240, 480]) {
  if (!Array.isArray(value) || value.length > 12 || value.some(n => !Number.isInteger(n) || n < 1 || n > 1440)) {
    throw new Error('timerPresets must contain at most 12 whole minutes, from 1 to 1440');
  }
  return [...new Set(value)];
}
class OffTimer {
  constructor({ file, off, changed, log, now = Date.now }) {
    Object.assign(this, { file, off, changed, log, now });
    this.record = null; this.generation = 0; this.stopped = false;
    try {
      const r = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (r === null) return;
      if (Number.isSafeInteger(r.deadline) && r.deadline > 0 && Number.isInteger(r.minutes) && r.minutes >= 1 && r.minutes <= 1440) this.record = r;
      else throw new Error('Invalid saved off timer');
    } catch (e) { if (e.code !== 'ENOENT') log.warn(`Cannot restore off timer: ${e.message}`); }
  }
  save(record) {
    // Write first: a failed save must not acknowledge an unpersisted reservation.
    const temp = `${this.file}.tmp`;
    fs.writeFileSync(temp, JSON.stringify(record), { mode: 0o600 });
    fs.renameSync(temp, this.file);
    this.record = record; this.generation++;
    clearTimeout(this.timer); this.changed(); this.arm();
  }
  set(minutes) {
    presets([minutes]);
    if (this.stopped) throw new Error('Homebridge is shutting down');
    this.save({ minutes, deadline: this.now() + minutes * 60000 });
  }
  cancel() { if (this.record) this.save(null); }
  arm(delay) {
    if (this.stopped || !this.record) return;
    clearTimeout(this.timer);
    const generation = this.generation;
    this.timer = setTimeout(() => void this.fire(generation), delay ?? Math.max(0, this.record.deadline - this.now()));
  }
  async fire(generation) {
    const valid = () => !this.stopped && generation === this.generation && !!this.record;
    if (!valid()) return;
    try {
      if (this.now() < this.record.deadline) { this.arm(); return; }
      if (this.now() - this.record.deadline > GRACE) {
        this.log.warn('Off timer expired more than 15 minutes ago; discarding to avoid a delayed unexpected shutdown.');
        this.cancel(); return;
      }
      // The callback rechecks valid() inside the device command queue.
      if (await this.off(valid)) { if (valid()) this.cancel(); }
      else if (valid()) this.arm(RETRY);
    } catch (e) {
      this.log.warn(`Scheduled shutdown not confirmed; retrying: ${e.message}`);
      if (valid()) this.arm(RETRY);
    }
  }
  stop() { this.stopped = true; this.generation++; clearTimeout(this.timer); }
}
module.exports = { OffTimer, presets };
