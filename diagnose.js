'use strict';
const { randomUUID } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { ThinQClient } = require('./lib/client');
const caps = require('./lib/capabilities');

(async () => {
  const tokenFile = process.env.LG_THINQ_TOKEN_FILE;
  if (!tokenFile) throw new Error('請設定 LG_THINQ_TOKEN_FILE，指向只包含 PAT 的文字檔。');
  const idFile = `${tokenFile}.diagnostic-client-id`;
  let id;
  try { id = fs.readFileSync(idFile, 'utf8').trim(); }
  catch (e) { if (e.code !== 'ENOENT') throw e; id = randomUUID(); fs.writeFileSync(idFile, id, { mode: 0o600 }); }
  const client = new ThinQClient({ tokenFile }, id);
  const devices = (await client.list()).filter(d => d.deviceInfo?.deviceType === 'DEVICE_DEHUMIDIFIER');
  console.log(`找到 ${devices.length} 台除濕機。以下識別碼只供本機設定，分享前請遮蔽。`);
  const results = [];
  for (const device of devices) {
    console.log(`設備識別碼：${device.deviceId}`);
    const profile = await client.profile(device.deviceId);
    const state = await client.state(device.deviceId);
    // 輸出僅允許列出的功能欄位，不包含裝置 ID、別名、PAT 或 MQTT 憑證。
    results.push({
      model: device.deviceInfo.modelName,
      capabilities: Object.fromEntries(Object.keys(caps.paths).map(k => [k, caps.property(profile, k)])),
      current: Object.fromEntries(Object.keys(caps.paths).map(k => [k, caps.read(state, k)])),
      nativeTimers: Object.fromEntries(['timer', 'sleepTimer'].filter(key => profile.property?.[key]).map(key => [key, { capability: profile.property[key], current: state[key] ?? null }])),
      waterFullNotification: profile.notification?.push?.includes('WATER_IS_FULL') === true,
      notifications: profile.notification?.push || [],
    });
  }
  const output = path.resolve('lg-thinq-diagnostic.json');
  fs.writeFileSync(output, JSON.stringify(results, null, 2) + '\n', { mode: 0o600 });
  console.log(`已寫入 ${output}；本次只有讀取設備資料，沒有控制家電。`);
})().catch(e => { console.error(e.message); process.exitCode = 1; });
