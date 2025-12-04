const axios = require('axios');
const { updateSessionLastUsed } = require('./storage');
const { getAgent } = require('./proxy');
const { alignTime } = require('./steamTime');
const { generateConfirmationQueryParams } = require('./steamCrypto');
const { getSessionCookieHeader } = require('./steamSession');

const STEAM_HEADERS = {
  Accept: 'application/json, text/javascript; q=0.01',
  'User-Agent':
    'Mozilla/5.0 (Linux; Android 6.0; Nexus 6P Build/MDA89D) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/88.0.4324.181 Mobile Safari/537.36',
  'X-Requested-With': 'com.valvesoftware.android.steam.community',
  Referer: 'https://steamcommunity.com/mobileconf/conf',
  Host: 'steamcommunity.com'
};

async function fetchConfirmations(account) {
  await alignTime('Confirmations');
  if (!account.identity_secret) {
    throw new Error('Identity secret not found. Cannot fetch confirmations.');
  }
  try {
    const cookie = getSessionCookieHeader(account);
    const params = generateConfirmationQueryParams(account, 'conf');
    const url = `https://steamcommunity.com/mobileconf/getlist?${params.toString()}`;
    console.log('[Confirmations] Fetching from:', url.split('?')[0]);
    const res = await axios.get(url, {
      headers: { ...STEAM_HEADERS, Cookie: cookie },
      httpAgent: getAgent(),
      httpsAgent: getAgent(),
      validateStatus: () => true,
      timeout: 10000
    });
    console.log('[Confirmations] Response status:', res.status);
    if (res.status === 401 || res.status === 403) {
      throw new Error('LOGIN_REQUIRED');
    }
    if (res.status !== 200) {
      console.error('[Confirmations] HTTP Error:', res.status, res.data);
      throw new Error(`HTTP ${res.status}: ${res.data?.message || 'Failed to fetch confirmations'}`);
    }
    updateSessionLastUsed(account.id);
    let data = res.data;
    if (typeof res.data === 'string') {
      try {
        data = JSON.parse(res.data);
      } catch (e) {
        console.error('[Confirmations] Failed to parse response as JSON');
        return { conf: [] };
      }
    }
    const confirmations = data.conf || [];
    console.log(`[Confirmations] ✓ Fetched ${confirmations.length} confirmations`);
    return { conf: confirmations };
  } catch (err) {
    console.error('[Confirmations] Fetch error:', err.message);
    throw err;
  }
}

async function actOnConfirmations(account, op, confirmations) {
  await alignTime('Confirmations');
  if (!account.identity_secret) {
    throw new Error('Identity secret not found.Cannot act on confirmations.');
  }
  if (!op || !['allow', 'cancel'].includes(op)) {
    throw new Error('Invalid operation. Must be "allow" or "cancel"');
  }
  if (!Array.isArray(confirmations) || confirmations.length === 0) {
    throw new Error('No confirmations provided');
  }
  try {
    const cookie = getSessionCookieHeader(account);
    console.log(`[Confirmations] Acting on ${confirmations.length} confirmations with op: ${op}`);
    console.log('[Confirmations] Confirmations data:', JSON.stringify(confirmations, null, 2));
    const results = [];
    for (let i = 0; i < confirmations.length; i++) {
      const conf = confirmations[i];
      const confId = conf.id || conf.confirmationId;
      const confKey = conf.key || conf.nonce;
      console.log(`[Confirmations] Processing conf ${i + 1}/${confirmations.length}: id=${confId}, key=${confKey}`);
      if (!confId || !confKey) {
        throw new Error(`Confirmation ${i} missing id (${confId}) or key (${confKey})`);
      }
      const baseParams = generateConfirmationQueryParams(account, op);
      const body = new URLSearchParams(baseParams);
      body.set('op', op);
      body.set('cid', String(confId));
      body.set('ck', String(confKey));
      const url = 'https://steamcommunity.com/mobileconf/ajaxop';
      console.log(`[Confirmations] Sending request for confirmation ${confId}`);
      console.log('[Confirmations] Body:', body.toString());
      const res = await axios.post(url, body.toString(), {
        headers: {
          ...STEAM_HEADERS,
          Cookie: cookie,
          'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8'
        },
        httpAgent: getAgent(),
        httpsAgent: getAgent(),
        validateStatus: () => true,
        timeout: 10000
      });
      console.log(`[Confirmations] Response status: ${res.status}`);
      console.log('[Confirmations] Response data:', res.data);
      if (res.status === 401 || res.status === 403) {
        throw new Error('LOGIN_REQUIRED');
      }
      if (res.status !== 200) {
        console.error(`[Confirmations] HTTP Error for conf ${confId}:`, res.status);
        throw new Error(`HTTP ${res.status}: Failed to act on confirmation ${confId}`);
      }
      let data = res.data;
      if (typeof res.data === 'string') {
        try {
          data = JSON.parse(res.data);
        } catch (e) {
          console.log(`[Confirmations] Could not parse response as JSON: "${res.data}"`);
          results.push({ confId, success: true, message: 'Processed' });
          continue;
        }
      }
      console.log(`[Confirmations] Parsed response for conf ${confId}:`, data);
      if (data && data.success === true) {
        console.log(`[Confirmations] ✓ Confirmation ${confId} processed successfully`);
        results.push({ confId, success: true });
      } else if (data && (data.success === false || data.error)) {
        const errMsg = data.message || data.error || 'Unknown error';
        console.error(`[Confirmations] ✗ Confirmation ${confId} failed:`, errMsg);
        results.push({ confId, success: false, error: errMsg });
      } else if (res.status === 200) {
        console.log(`[Confirmations] ✓ Confirmation ${confId} likely processed (HTTP 200)`);
        results.push({ confId, success: true });
      } else {
        console.warn(`[Confirmations] ?  Confirmation ${confId} unclear result:`, data);
        results.push({ confId, success: false, error: 'Unclear response' });
      }
    }
    updateSessionLastUsed(account.id);
    const successful = results.filter(r => r.success).length;
    const failed = results.filter(r => !r.success).length;
    console.log(`[Confirmations] Summary: ${successful} successful, ${failed} failed`);
    if (failed > 0) {
      const failedConfIds = results.filter(r => !r.success).map(r => r.confId).join(', ');
      throw new Error(`Failed to process confirmations: ${failedConfIds}`);
    }
    console.log(`[Confirmations] ✓ All ${confirmations.length} confirmation(s) processed successfully`);
    return { success: true, results };
  } catch (err) {
    console.error('[Confirmations] Action error:', err.message);
    console.error('[Confirmations] Stack:', err.stack);
    throw err;
  }
}

module.exports = {
  fetchConfirmations,
  actOnConfirmations
};
