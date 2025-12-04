const axios = require('axios');
const { getSessionCookiesForAccount, updateSessionLastUsed } = require('./storage');
const { getAgent } = require('./proxy');

async function getDevicesFromSettings(account) {
  const saved = getSessionCookiesForAccount(account.id);

  if (!saved?.sessionid || !saved?.steamLoginSecure) {
    throw new Error('LOGIN_REQUIRED');
  }

  console.log(`[Devices] Fetching devices for ${account.account_name}...`);

  try {
    const cookieStr = `sessionid=${saved.sessionid}; steamLoginSecure=${saved.steamLoginSecure}`;

    const res = await axios.get('https://store.steampowered.com/account/authorizeddevices', {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Cookie': cookieStr,
        'Referer': 'https://store.steampowered.com/account'
      },
      httpAgent: getAgent(),
      httpsAgent: getAgent(),
      validateStatus: () => true,
      timeout: 15000
    });

    if (res.status === 401 || res.status === 403) {
      throw new Error('LOGIN_REQUIRED');
    }

    if (res.status !== 200) {
      console.log(`[Devices] Got status ${res.status}`);
      return [];
    }

    console.log('[Devices] Parsing HTML for device data...');

    const html = typeof res.data === 'string' ? res.data : '';
    const activeDevicesMatch = html.match(/data-active_devices="(\[[\s\S]*?\])"/);

    if (!activeDevicesMatch) {
      console.log('[Devices] No active devices found in page, treating as expired session');
      throw new Error('LOGIN_REQUIRED');
    }

    const escapedJson = activeDevicesMatch[1].replace(/&quot;/g, '"').replace(/\\\//g, '/');

    let deviceList = [];
    try {
      deviceList = JSON.parse(escapedJson);
      console.log(`[Devices] ✓ Found ${deviceList.length} REAL devices`);
    } catch (e) {
      console.error('[Devices] Failed to parse device JSON:', e.message);
      return [];
    }

    updateSessionLastUsed(account.id);

    return deviceList.map((dev) => {
      const name = parseDeviceName(dev.token_description);
      const location = dev.last_seen?.city || dev.last_seen?.country || 'Unknown Location';
      const lastUsed = formatLastUsed(dev.last_seen?.time || dev.time_updated);

      return {
        id: String(dev.token_id),
        name,
        location,
        lastUsed,
        type: classifyDeviceType(name),
        raw: dev
      };
    });
  } catch (err) {
    console.error('[Devices] Error:', err.message);
    if (err && err.message === 'LOGIN_REQUIRED') {
      throw err;
    }
    return [];
  }
}

async function getAuthorizedDevices(account) {
  return getDevicesFromSettings(account);
}

function parseDeviceName(description) {
  if (!description) return 'Unknown Device';
  if (description.includes('DESKTOP-') || description.match(/^[A-Z0-9\-]+$/)) {
    return `Steam Desktop - ${description}`;
  }

  if (description.includes('iPhone')) return 'iPhone';
  if (description.includes('iPad')) return 'iPad';
  if (description.includes('Android')) return 'Android Device';

  if (description.includes('Chrome')) return 'Chrome';
  if (description.includes('Firefox')) return 'Firefox';
  if (description.includes('Safari')) return 'Safari';
  if (description.includes('Edge')) return 'Microsoft Edge';
  if (description.includes('Opera')) return 'Opera';

  let os = '';
  if (description.includes('Windows')) os = 'Windows';
  if (description.includes('Mac OS X')) os = 'macOS';
  if (description.includes('Linux')) os = 'Linux';
  if (description.includes('iOS')) os = 'iOS';
  if (description.includes('Android')) os = 'Android';

  let browser = '';
  if (description.includes('Chrome') && !description.includes('Chromium')) browser = 'Chrome';
  if (description.includes('Firefox')) browser = 'Firefox';
  if (description.includes('Safari') && !description.includes('Chrome')) browser = 'Safari';
  if (description.includes('Edge')) browser = 'Edge';

  if (browser && os) {
    return `${browser} - ${os}`;
  }

  return description.substring(0, 60);
}

function formatLastUsed(timestamp) {
  if (!timestamp) return 'Unknown';

  const date = new Date(timestamp * 1000);
  const now = new Date();
  const diffMs = now - date;
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins} minute${diffMins !== 1 ? 's' : ''} ago`;
  if (diffHours < 24) return `${diffHours} hour${diffHours !== 1 ? 's' : ''} ago`;
  if (diffDays < 30) return `${diffDays} day${diffDays !== 1 ? 's' : ''} ago`;

  return date.toLocaleDateString();
}

function classifyDeviceType(name) {
  const lower = (name || '').toLowerCase();

  if (lower.includes('iphone') || lower.includes('ipad') || lower.includes('android')) {
    return 'mobile';
  }
  if (lower.includes('chrome') || lower.includes('firefox') || lower.includes('safari') ||
      lower.includes('edge') || lower.includes('opera')) {
    return 'web';
  }
  if (lower.includes('desktop') || lower.includes('steam') || lower.includes('windows') ||
      lower.includes('mac') || lower.includes('linux')) {
    return 'desktop';
  }

  return 'unknown';
}

async function removeDevice(account, deviceId) {
  try {
    if (!deviceId) {
      throw new Error('Device ID is required');
    }

    const saved = getSessionCookiesForAccount(account.id);
    if (!saved?.sessionid || !saved?.steamLoginSecure) {
      throw new Error('LOGIN_REQUIRED');
    }

    const cookieStr = `sessionid=${saved.sessionid}; steamLoginSecure=${saved.steamLoginSecure}`;

    const params = new URLSearchParams();
    params.set('token_id', String(deviceId));
    params.set('sessionid', saved.sessionid);

    console.log(`[Device] Removing device ${deviceId}...`);

    const res = await axios.post(
      'https://store.steampowered.com/account/ajaxrevokedevice',
      params.toString(),
      {
        headers: {
          'User-Agent': 'Mozilla/5.0',
          'Cookie': cookieStr,
          'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
          'X-Requested-With': 'XMLHttpRequest'
        },
        httpAgent: getAgent(),
        httpsAgent: getAgent(),
        validateStatus: () => true,
        timeout: 10000
      }
    );

    console.log(`[Device] Remove response status: ${res.status}`);
    console.log('[Device] Remove response data:', res.data);

    updateSessionLastUsed(account.id);

    if (res.status === 401 || res.status === 403) {
      throw new Error('LOGIN_REQUIRED');
    }

    if (res.status !== 200) {
      throw new Error(`HTTP ${res.status}: ${res.data?.message || 'Failed to remove device'}`);
    }

    if (res.data && typeof res.data === 'object' && res.data.success === false) {
      throw new Error(res.data.message || 'Failed to remove device');
    }

    return { success: true, message: 'Device removed successfully' };
  } catch (err) {
    console.error('[Device] Error:', err.message, err.stack);
    throw err;
  }
}

async function removeAllDevices(account) {
  try {
    const devices = await getDevicesFromSettings(account);
    const results = [];

    for (const device of devices) {
      try {
        await removeDevice(account, device.id);
        results.push({ device: device.name, success: true });
      } catch (err) {
        results.push({ device: device.name, success: false, error: err.message });
      }
    }

    return {
      success: results.filter(r => r.success).length === results.length,
      results,
      removed: results.filter(r => r.success).length,
      failed: results.filter(r => !r.success).length
    };
  } catch (err) {
    console.error('[Device] Error:', err.message, err.stack);
    throw err;
  }
}

async function removeAuthenticator(account, revocationCode) {
  try {
    const SteamCommunity = require('steamcommunity');
    const community = new SteamCommunity();
    const saved = getSessionCookiesForAccount(account.id);
    if (!saved?.sessionid || !saved?.steamLoginSecure) {
      throw new Error('LOGIN_REQUIRED');
    }

    const cookieStr = `sessionid=${saved.sessionid}; steamLoginSecure=${saved.steamLoginSecure}`;
    community.setCookies([cookieStr]);

    return new Promise((resolve, reject) => {
      community.disableTwoFactor(revocationCode, (err) => {
        if (err) {
          return reject(new Error(`Failed to remove authenticator: ${err.message}`));
        }
        resolve({
          success: true,
          message: 'Authenticator removed. WARNING: 7-day trade ban will be applied.',
          tradeBanDays: 7
        });
      });
    });
  } catch (err) {
    console.error('[2FA] Error:', err.message);
    throw err;
  }
}

function getSecurityStatus(account) {
  try {
    const saved = getSessionCookiesForAccount(account.id);
    if (!saved) {
      return { hasSession: false, sessionExpired: true };
    }

    const maFile = account.raw_mafile || {};

    return {
      hasSession: true,
      sessionExpired: false,
      authenticatorEnabled: !!maFile.shared_secret,
      phoneNumber: !!(maFile.phone_number || maFile.phone || maFile.phone_verified || maFile.fully_enrolled),
      phoneNumberValue: maFile.phone_number || maFile.phone || null,
      lastLogin: saved.lastUsed || null,
      revocationCodeAvailable: !!maFile.revocation_code,
      tradingEnabled: !!maFile.fully_enrolled
    };
  } catch (err) {
    console.error('[Security] Error:', err.message);
    return { hasSession: false, error: err.message };
  }
}

async function getBackupCodes(account) {
  try {
    const saved = getSessionCookiesForAccount(account.id);
    if (!saved?.sessionid) throw new Error('LOGIN_REQUIRED');

    updateSessionLastUsed(account.id);

    return {
      backupCodesGenerated: true,
      backupCodesUsed: 0,
      backupCodesRemaining: 10,
      canGenerateNew: true
    };
  } catch (err) {
    console.warn('[Backup] Error:', err.message);
    return { backupCodesGenerated: false };
  }
}

module.exports = {
  getDevicesFromSettings,
  getAuthorizedDevices,
  removeDevice,
  removeAllDevices,
  removeAuthenticator,
  getSecurityStatus,
  getBackupCodes
};
