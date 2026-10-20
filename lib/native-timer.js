'use strict';
// Device-hosted sleep timer. No local countdown, scheduled power command or absolute reservation.
function supported(profile) {
  const p = profile?.property?.sleepTimer;
  return ['number', 'range'].includes(p?.relativeHourToStop?.type) &&
    ['r', 'w'].every(m => p.relativeHourToStop.mode?.includes(m)) &&
    p.relativeStopTimer?.type === 'enum' &&
    ['r', 'w'].every(m => p.relativeStopTimer.mode?.includes(m)) &&
    p.relativeStopTimer.value?.w?.includes('UNSET');
}
function hours(value = [1, 2, 4, 8]) {
  // UI limit only; actual allowed values may be narrower and LG remains authoritative.
  if (!Array.isArray(value) || value.length > 12 || value.some(h => !Number.isInteger(h) || h < 1 || h > 24)) {
    throw new Error('nativeTimerHours must contain at most 12 whole hours from 1 to 24');
  }
  return [...new Set(value)];
}
function command(profile, hour) {
  if (!supported(profile)) throw new Error('Device does not expose a writable native sleep timer');
  if (hour === null) return { sleepTimer: { relativeStopTimer: 'UNSET' } };
  hours([hour]);
  const rule = profile.property.sleepTimer.relativeHourToStop.value?.w;
  if (rule && ((!Array.isArray(rule) && (
    (Number.isFinite(rule.min) && hour < rule.min) ||
    (Number.isFinite(rule.max) && hour > rule.max) ||
    (Number.isFinite(rule.step) && rule.step > 0 && Math.abs((hour - (rule.min ?? 0)) / rule.step - Math.round((hour - (rule.min ?? 0)) / rule.step)) > 1e-6) ||
    rule.except?.includes(hour))) || (Array.isArray(rule) && !rule.includes(hour)))) {
    throw new Error('Requested timer duration is outside the device profile');
  }
  // Minutes are read-only on DHUM_231006_WW. SET is also not writable.
  return { sleepTimer: { relativeHourToStop: hour } };
}
function active(device) {
  device.assertOnline();
  const value = device.state.sleepTimer?.relativeStopTimer;
  if (!['SET', 'UNSET'].includes(value)) throw device.error();
  return value === 'SET';
}
function bind(device) {
  if (!supported(device.profile)) return;
  const { S, C } = device;
  const status = device.service(S.Switch, '定時關機啟用', 'native-sleep-timer');
  device.bind(status, C.On, () => active(device), async on => {
    if (on) { if (!active(device)) throw new Error('請使用「設定定時」按鈕選擇小時數'); }
    else await device.writeNativeTimer(null);
  });
  device.nativeTimerResets = new Set();
  for (const hour of hours(device.platform.config.nativeTimerHours)) {
    try { command(device.profile, hour); } catch { continue; }
    const service = device.service(S.Switch, `設定定時 ${hour} 小時`, `native-sleep-timer:${hour}`);
    device.bind(service, C.On, () => { device.assertOnline(); return false; }, async on => {
      if (!on) return;
      await device.writeNativeTimer(hour);
      // Momentary command button, not a countdown or a claim that the timer is active.
      const reset = setTimeout(() => {
        device.nativeTimerResets.delete(reset);
        service.updateCharacteristic(C.On, false);
      }, 250);
      device.nativeTimerResets.add(reset);
    });
  }
}
module.exports = { supported, hours, command, active, bind };
