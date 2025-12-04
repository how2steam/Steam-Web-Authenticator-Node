const axios = require('axios');
const { getAgent } = require('./proxy');

let timeOffset = 0;
let isTimeAligned = false;

async function alignTime(logPrefix) {
  const prefix = logPrefix || 'SteamTime';
  if (isTimeAligned) return;
  try {
    const agent = getAgent();
    const res = await axios.post(
      'https://api.steampowered.com/ITwoFactorService/QueryTime/v0001',
      {},
      {
        headers: { 'Content-Length': '0' },
        httpsAgent: agent,
        validateStatus: () => true,
        timeout: 5000
      }
    );
    const serverTime = parseInt(res.data?.response?.server_time, 10);
    if (!Number.isNaN(serverTime)) {
      const localTime = Math.floor(Date.now() / 1000);
      timeOffset = serverTime - localTime;
      isTimeAligned = true;
      console.log(`[${prefix}] Time aligned. Offset:`, timeOffset);
    }
  } catch (err) {
    console.warn(`[${prefix}] Time sync failed:`, err.message);
  }
}

function getSteamTime() {
  return Math.floor(Date.now() / 1000) + timeOffset;
}

module.exports = { alignTime, getSteamTime };
