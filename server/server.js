const path = require('path');
const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const { getRichConfirmationDetails } = require('./confirmationDetails');

const { generateSteamGuardCode } = require('./steamGuard');
const {
  loadAccounts,
  addAccountFromMaFile,
  getManifestSettings,
  getSessionCookiesForAccount,
  setSessionCookiesForAccount,
  updateSessionLastUsed,
  clearSessionForAccount,
  isSessionValid
} = require('./storage');

const { fetchConfirmations, actOnConfirmations } = require('./confirmations');
const { loginAccount } = require('./login');

const {
  setupLogin,
  submitEmailCode,
  addPhoneNumber,
  sendPhoneVerificationSMS,
  verifyPhoneSMS,
  enable2FA,
  finalize2FA
} = require('./setup');

const {
  getAuthorizedDevices,
  getDevicesFromSettings,
  removeDevice,
  removeAllDevices,
  removeAuthenticator,
  getSecurityStatus,
  getBackupCodes
} = require('./accountManagement');

const app = express();
const PORT = 3000;

app.use(cors());
app.use(bodyParser.json({ limit: '50mb' }));
app.use(express.static(path.join(__dirname, '..', 'public')));

app.get('/', (req, res) =>
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'))
);


app.get('/api/manifest', (req, res) => {
  res.json({ settings: getManifestSettings() });
});

app.get('/api/accounts', (req, res) => {
  const accounts = loadAccounts().map((a) => ({
    id: a.id,
    account_name: a.account_name,
    steamid: a.steamid
  }));
  res.json({ accounts });
});

app.post('/api/accounts', (req, res) => {
  try {
    const input = req.body.maFileContent || req.body.maFile;
    const account = addAccountFromMaFile(input);
    res
      .status(201)
      .json({ account: { id: account.id, account_name: account.account_name } });
  } catch (err) {
    console.error('Import Error:', err.message);
    res.status(400).json({ error: err.message });
  }
});

app.get('/api/accounts/:id/code', (req, res) => {
  try {
    const account = loadAccounts().find((a) => a.id === req.params.id);
    if (!account) return res.status(404).json({ error: 'Account not found' });

    const now = Date.now();
    const code = generateSteamGuardCode(account.shared_secret, now);
    const valid_for_seconds = 30 - (Math.floor(now / 1000) % 30);

    res.json({ code, valid_for_seconds });
  } catch (err) {
    res.status(500).json({ error: 'Failed to generate code' });
  }
});

app.post('/api/accounts/:id/confirmations/details', async (req, res) => {
  const account = loadAccounts().find((a) => a.id === req.params.id);
  if (!  account) return res.status(404).json({ error: 'Account not found' });

  const { confirmationId, key, type, rawType, creatorId } = req.body;

  try {
    const details = await getRichConfirmationDetails(account, {
      confirmationId,
      key,
      type,
      rawType,
      creatorId
    });
    res.json(details);
  } catch (err) {
    console.error('Details error:', err.message);
    if (err.message === 'LOGIN_REQUIRED') {
      return res.status(401).json({ error: 'LOGIN_REQUIRED' });
    }
    res.status(400).json({ error: err.message });
  }
});

app.post('/api/accounts/:id/login', async (req, res) => {
  const { password } = req.body;
  if (!password) return res.status(400).json({ error: 'Password required' });

  const account = loadAccounts().find(a => a.id === req.params.id);
  if (! account) return res.status(404).json({ error: 'Account not found' });

  try {
    await loginAccount(account, password);
    res.json({ success: true });
  } catch (err) {
    console.error('Login failed:', err.message);
    res.status(401).json({ error: err.message });
  }
});

app.get('/api/accounts/:id/session/validate', (req, res) => {
  try {
    const account = loadAccounts().find(a => a.id === req.params.id);
    if (! account) return res.status(404).json({ error: 'Account not found' });

    const validationResult = isSessionValid(account.id);
    
    res.json({
      valid: validationResult.valid,
      reason: validationResult.reason || null,
      accountName: account.account_name,
      steamid: account.steamid
    });
  } catch (err) {
    console.error('[Session Validation] Error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/accounts/:id/confirmations', async (req, res) => {
  const account = loadAccounts().find((a) => a.id === req.params.id);
  if (!account) return res.status(404).json({ error: 'Account not found' });

  try {
    const data = await fetchConfirmations(account);
    res.json({ confirmations: data.conf || [] });
  } catch (err) {
    console.error('Conf Error:', err.message);
    if (err.message === 'LOGIN_REQUIRED') {
      return res.status(401).json({ error: 'LOGIN_REQUIRED' });
    }
    res.status(400).json({ error: err.message });
  }
});

app.post('/api/accounts/:id/confirmations/act', async (req, res) => {
  const { op, confirmations } = req.body;
  const account = loadAccounts().find((a) => a.id === req.params.id);
  if (!account) return res.status(404).json({ error: 'Account not found' });

  try {
    // Validate input
    if (!op || !Array.isArray(confirmations) || confirmations.length === 0) {
      console.error('[Confirmations] Invalid input: op=' + op + ', confirmations length=' + (confirmations ? confirmations.length : 'null'));
      return res.status(400).json({ error: 'Invalid request: op and confirmations array required' });
    }

    // Validate each confirmation has required fields
    for (let i = 0; i < confirmations.length; i++) {
      const conf = confirmations[i];
      const hasId = conf.id || conf.confirmationId;
      const hasKey = conf.key || conf.nonce;
      
      console.log(`[Confirmations] Validating conf ${i}:`, { hasId, hasKey, conf });
      
      if (! hasId) {
        return res.status(400).json({ 
          error: `Confirmation ${i} missing id field. Received: ${JSON.stringify(conf)}` 
        });
      }
      if (!hasKey) {
        return res.status(400).json({ 
          error: `Confirmation ${i} missing key field. Received: ${JSON.stringify(conf)}` 
        });
      }
    }

    console.log(`[Confirmations] Request validated. Acting on ${confirmations.length} confirmations with op: ${op}`);
    await actOnConfirmations(account, op, confirmations);
    res.json({ success: true });
  } catch (err) {
    console.error('[Confirmations] Error:', err.message, err.stack);
    if (err.message === 'LOGIN_REQUIRED') {
      return res.status(401).json({ error: 'LOGIN_REQUIRED' });
    }
    res.status(400).json({ error: err.message });
  }
});


app.post('/api/setup/login', async (req, res) => {
  const { username, password, emailCode } = req.body;
  try {
    if (emailCode) {
      return res.status(400).json({ error: 'Use /api/setup/submit-email-code' });
    }
    const result = await setupLogin(username, password);
    res.json(result);
  } catch (err) {
    res.status(401).json({ error: err.message });
  }
});

app.post('/api/setup/submit-email-code', async (req, res) => {
  const { setupId, emailCode } = req.body;
  try {
    const result = await submitEmailCode(setupId, emailCode);
    res.json(result);
  } catch (err) {
    res.status(401).json({ error: err.message });
  }
});

app.post('/api/setup/add-phone', async (req, res) => {
  const { setupId, phoneNumber } = req.body;
  try {
    const result = await addPhoneNumber(setupId, phoneNumber);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/api/setup/send-phone-sms', async (req, res) => {
  const { setupId } = req.body;
  try {
    const result = await sendPhoneVerificationSMS(setupId);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/api/setup/verify-phone', async (req, res) => {
  const { setupId, phoneCode } = req.body;
  try {
    const result = await verifyPhoneSMS(setupId, phoneCode);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/api/setup/enable', async (req, res) => {
  const { setupId } = req.body;
  try {
    const result = await enable2FA(setupId);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/api/setup/finalize', async (req, res) => {
  const { setupId, smsCode } = req.body;
  try {
    const result = await finalize2FA(setupId, smsCode);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});


app.get('/api/accounts/:id/session-status', (req, res) => {
  try {
    const account = loadAccounts().find(a => a.id === req.params.id);
    if (!  account) return res.status(404).json({ error: 'Account not found' });

    const saved = getSessionCookiesForAccount(account.id);
    
    res.json({
      hasSession: !!saved,
      accountName: account.account_name,
      steamid: account.steamid,
      lastUsed: saved?.lastUsed || null
    });
  } catch (err) {
    console.error('[Session Status] Error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/accounts/:id/session-info', (req, res) => {
  try {
    const account = loadAccounts().find(a => a.id === req.params.id);
    if (! account) return res.status(404).json({ error: 'Account not found' });

    const { getSessionAge } = require('./storage');
    const validationResult = isSessionValid(account.id);
    const ageInfo = getSessionAge(account.id);
    
    res.json({
      valid: validationResult.valid,
      reason: validationResult.reason || null,
      accountName: account.account_name,
      steamid: account.steamid,
      age: ageInfo,
      maxAgeDays: 30,
      idleTimeoutDays: 7
    });
  } catch (err) {
    console.error('[Session Info] Error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/accounts/:id/refresh-session', async (req, res) => {
  try {
    const { password } = req.body;
    if (!password) return res.status(400).json({ error: 'Password required' });

    const account = loadAccounts().find(a => a.id === req.params.id);
    if (! account) return res.status(404).json({ error: 'Account not found' });

    console.log(`[Session] Refreshing session for ${account.account_name}...`);
    await loginAccount(account, password);
    
    res.json({ success: true, message: 'Session refreshed' });
  } catch (err) {
    console.error('[Session] Refresh failed:', err.message);
    res.status(401).json({ error: err.message });
  }
});


app.get('/api/accounts/:id/security-status', (req, res) => {
  try {
    const account = loadAccounts().find(a => a.id === req.params.id);
    if (! account) return res.status(404).json({ error: 'Account not found' });

    const status = getSecurityStatus(account);
    res.json(status);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/accounts/:id/devices', async (req, res) => {
  const account = loadAccounts().find(a => a.id === req.params.id);
  if (! account) return res.status(404).json({ error: 'Account not found' });

  try {
    const devices = await getDevicesFromSettings(account);
    res.json({ devices, count: devices.length });
  } catch (err) {
    console.error('Devices error:', err.message);
    if (err.message === 'LOGIN_REQUIRED') {
      return res.status(401).json({ error: 'LOGIN_REQUIRED' });
    }
    res.status(400).json({ error: err.message });
  }
});

app.post('/api/accounts/:id/devices/:deviceId/remove', async (req, res) => {
  const account = loadAccounts().find(a => a.id === req.params.id);
  if (! account) return res.status(404).json({ error: 'Account not found' });

  try {
    const result = await removeDevice(account, req.params.deviceId);
    res.json(result);
  } catch (err) {
    console.error('Device removal error:', err.message, err.stack);
    if (err.message === 'LOGIN_REQUIRED') {
      return res.status(401).json({ error: 'LOGIN_REQUIRED' });
    }
    res.status(400).json({ error: err.message });
  }
});

app.post('/api/accounts/:id/devices/remove-all', async (req, res) => {
  const account = loadAccounts().find(a => a.id === req.params.id);
  if (!account) return res.status(404).json({ error: 'Account not found' });

  try {
    const result = await removeAllDevices(account);
    res.json(result);
  } catch (err) {
    console.error('Remove all devices error:', err.message, err.stack);
    if (err.message === 'LOGIN_REQUIRED') {
      return res.status(401).json({ error: 'LOGIN_REQUIRED' });
    }
    res.status(400).json({ error: err.message });
  }
});


app.get('/api/security/:steamid/devices', async (req, res) => {
  try {
    const account = loadAccounts().find(a => a.steamid === req.params.steamid);
    if (!account) {
      return res.status(404).json({ error: 'Account not found' });
    }

    console.log('[API] Getting devices for steamid:', req.params.steamid);
    const devices = await getDevicesFromSettings(account);
    console.log('[API] Returning', devices.length, 'devices');
    res.json({ devices });
  } catch (err) {
    console.error('[API] Error getting devices:', err.message, err.stack);
    if (err.message === 'LOGIN_REQUIRED') {
      return res.status(401).json({ error: 'LOGIN_REQUIRED' });
    }
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/security/:steamid/devices/:deviceId', async (req, res) => {
  try {
    const account = loadAccounts().find(a => a.steamid === req.params.steamid);
    if (!account) {
      return res.status(404).json({ error: 'Account not found' });
    }

    console.log('[API] Deleting device:', req.params.deviceId);
    const result = await removeDevice(account, req.params.deviceId);
    res.json(result);
  } catch (err) {
    console.error('[API] Error removing device:', err.message, err.stack);
    if (err.message === 'LOGIN_REQUIRED') {
      return res.status(401).json({ error: 'LOGIN_REQUIRED' });
    }
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/security/:steamid/devices/all', async (req, res) => {
  try {
    const account = loadAccounts().find(a => a.steamid === req.params.steamid);
    if (!account) {
      return res.status(404).json({ error: 'Account not found' });
    }

    console.log('[API] Deleting all devices');
    const result = await removeAllDevices(account);
    res.json(result);
  } catch (err) {
    console.error('[API] Error removing all devices:', err.message, err.stack);
    if (err.message === 'LOGIN_REQUIRED') {
      return res.status(401).json({ error: 'LOGIN_REQUIRED' });
    }
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/accounts/:id/authenticator/remove', async (req, res) => {
  const { revocationCode } = req.body;
  if (!revocationCode) {
    return res.status(400).json({ error: 'Revocation code required' });
  }

  const account = loadAccounts().find(a => a.id === req.params.id);
  if (! account) return res.status(404).json({ error: 'Account not found' });

  try {
    const result = await removeAuthenticator(account, revocationCode);
    res.json(result);
  } catch (err) {
    console.error('Authenticator removal error:', err.message);
    if (err.message === 'LOGIN_REQUIRED') {
      return res.status(401).json({ error: 'LOGIN_REQUIRED' });
    }
    res.status(400).json({ error: err.message });
  }
});

app.get('/api/accounts/:id/backup-codes', async (req, res) => {
  const account = loadAccounts().find(a => a.id === req.params.id);
  if (! account) return res.status(404).json({ error: 'Account not found' });

  try {
    const codes = await getBackupCodes(account);
    res.json(codes);
  } catch (err) {
    console.error('Backup codes error:', err.message);
    if (err.message === 'LOGIN_REQUIRED') {
      return res.status(401).json({ error: 'LOGIN_REQUIRED' });
    }
    res.status(400).json({ error: err.message });
  }
});

app.listen(PORT, () =>
  console.log(`SDA Clone running on http://localhost:${PORT}`)
);