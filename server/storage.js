const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { generateAndroidDeviceId } = require('./deviceID');

const DATA_DIR = path.join(__dirname, '..', 'data');
const MANIFEST_FILE = path.join(DATA_DIR, 'manifest.json');
const SESSIONS_FILE = path.join(DATA_DIR, 'sessions.json');

const SESSION_EXPIRY_MS = 30 * 24 * 60 * 60 * 1000;
const SESSION_IDLE_TIMEOUT_MS = 7 * 24 * 60 * 60 * 1000;

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function parseMaFileSafe(input) {
  if (!input) return {};
  if (typeof input === 'object') return input;
  try {
    let safeString = input;
    safeString = safeString.replace(
      /"(S|s)team(ID|id)"\s*:\s*([0-9]{16,})/g,
      '"$1team$2": "$3"'
    );
    safeString = safeString.replace(
      /"SessionID"\s*:\s*([0-9]{8,})/g,
      '"SessionID": "$1"'
    );
    return JSON.parse(safeString);
  } catch (e) {
    console.error('Safe Parse Failed:', e.message);
    return JSON.parse(input);
  }
}

function loadManifest() {
  ensureDataDir();
  if (!fs.existsSync(MANIFEST_FILE)) {
    return { entries: [] };
  }
  try {
    const raw = fs.readFileSync(MANIFEST_FILE, 'utf8');
    const manifest = parseMaFileSafe(raw) || {};
    if (!Array.isArray(manifest.entries)) {
      manifest.entries = [];
    }
    return manifest;
  } catch {
    return { entries: [] };
  }
}

function saveManifest(manifest) {
  ensureDataDir();
  fs.writeFileSync(MANIFEST_FILE, JSON.stringify(manifest, null, 2));
}

function getManifestSettings() {
  const manifest = loadManifest();
  return {
    entries: manifest.entries.length,
    hasEncryption: !!manifest.encryption || manifest.entries.some(e => e.encryption_iv || e.encryption_salt)
  };
}

function loadAccounts() {
  ensureDataDir();
  const manifest = loadManifest();
  const entries = Array.isArray(manifest.entries) ? manifest.entries : [];
  const accounts = [];
  for (const entry of entries) {
    const steamid = String(entry.steamid || '');
    if (!steamid) continue;
    const filename = entry.filename || `${steamid}.maFile`;
    const fullPath = path.join(DATA_DIR, filename);
    if (!fs.existsSync(fullPath)) continue;
    let maFile;
    try {
      maFile = parseMaFileSafe(fs.readFileSync(fullPath, 'utf8'));
    } catch {
      continue;
    }
    const device_id =
      maFile.device_id ||
      maFile.deviceID ||
      maFile.deviceId ||
      generateAndroidDeviceId(steamid);
    accounts.push({
      id: steamid,
      steamid,
      account_name: maFile.account_name || '',
      display_name: maFile.account_name || '',
      shared_secret: maFile.shared_secret || '',
      identity_secret: maFile.identity_secret || '',
      device_id,
      raw_mafile: maFile
    });
  }
  return accounts;
}

function loadSessionStore() {
  ensureDataDir();
  if (!fs.existsSync(SESSIONS_FILE)) return { sessions: {} };
  try {
    return JSON.parse(fs.readFileSync(SESSIONS_FILE, 'utf8'));
  } catch {
    return { sessions: {} };
  }
}

function saveSessionStore(store) {
  ensureDataDir();
  fs.writeFileSync(SESSIONS_FILE, JSON.stringify(store, null, 2));
}

function getSessionCookiesForAccount(accountId) {
  const store = loadSessionStore();
  const session = store.sessions && store.sessions[accountId];
  if (!session) {
    console.log(`[Sessions] No session found for account ${accountId}`);
    return null;
  }
  console.log(`[Sessions] Loaded session for ${accountId}`);
  return session;
}

function isSessionExpired(session) {
  if (!session || !session.createdAt) {
    return true;
  }
  const createdAt = new Date(session.createdAt).getTime();
  const now = Date.now();
  const age = now - createdAt;
  if (age > SESSION_EXPIRY_MS) {
    console.log(`[Sessions] Session expired by age: ${Math.floor(age / (24 * 60 * 60 * 1000))} days old`);
    return true;
  }
  if (session.lastUsed) {
    const lastUsed = new Date(session.lastUsed).getTime();
    const idleTime = now - lastUsed;
    if (idleTime > SESSION_IDLE_TIMEOUT_MS) {
      console.log(`[Sessions] Session expired by inactivity: ${Math.floor(idleTime / (24 * 60 * 60 * 1000))} days idle`);
      return true;
    }
  }
  return false;
}

function isSessionValid(accountId) {
  const session = getSessionCookiesForAccount(accountId);
  if (!session) {
    return { valid: false, reason: 'NO_SESSION' };
  }
  if (!session.sessionid || !session.steamLoginSecure) {
    return { valid: false, reason: 'INCOMPLETE_SESSION' };
  }
  if (isSessionExpired(session)) {
    return { valid: false, reason: 'SESSION_EXPIRED' };
  }
  return { valid: true, session };
}

function getSessionAge(accountId) {
  const session = getSessionCookiesForAccount(accountId);
  if (!session || !session.createdAt) {
    return null;
  }
  const createdAt = new Date(session.createdAt).getTime();
  const now = Date.now();
  const ageMs = now - createdAt;
  const days = Math.floor(ageMs / (24 * 60 * 60 * 1000));
  const hours = Math.floor((ageMs % (24 * 60 * 60 * 1000)) / (60 * 60 * 1000));
  return {
    ageMs,
    ageDays: days,
    ageHours: hours,
    ageFormatted: `${days} day${days !== 1 ? 's' : ''}, ${hours} hour${hours !== 1 ? 's' : ''}`,
    expiresInMs: SESSION_EXPIRY_MS - ageMs,
    expiresInDays: Math.floor((SESSION_EXPIRY_MS - ageMs) / (24 * 60 * 60 * 1000)),
    lastUsed: session.lastUsed ? new Date(session.lastUsed).toISOString() : null
  };
}

function setSessionCookiesForAccount(
  accountId,
  sessionid,
  steamLoginSecure,
  oAuthToken = null
) {
  const store = loadSessionStore();
  if (!store.sessions) store.sessions = {};
  const timestamp = new Date().toISOString();
  const existingSession = store.sessions[accountId];
  const createdAt = existingSession?.createdAt || timestamp;
  store.sessions[accountId] = {
    sessionid,
    steamLoginSecure,
    oAuthToken,
    createdAt,
    lastUsed: timestamp,
    lastRefreshed: timestamp
  };
  const age = getSessionAge(accountId);
  if (age) {
    console.log(`[Sessions] Session for account ${accountId}: ${age.ageFormatted} old, expires in ${age.expiresInDays} days`);
  } else {
    console.log(`[Sessions] Created new session for account ${accountId}`);
  }
  saveSessionStore(store);
}

function updateSessionLastUsed(accountId) {
  const store = loadSessionStore();
  if (store.sessions && store.sessions[accountId]) {
    store.sessions[accountId].lastUsed = new Date().toISOString();
    saveSessionStore(store);
  }
}

function clearSessionForAccount(accountId) {
  const store = loadSessionStore();
  if (store.sessions && store.sessions[accountId]) {
    delete store.sessions[accountId];
    saveSessionStore(store);
    console.log(`[Sessions] Cleared session for account ${accountId}`);
  }
}

function addAccountFromMaFile(input) {
  ensureDataDir();
  let maFile;
  if (typeof input === 'string') {
    maFile = parseMaFileSafe(input);
  } else if (typeof input === 'object' && input !== null) {
    maFile = input;
  } else {
    throw new Error('Invalid maFile input type');
  }
  let steamid = maFile.steamid || (maFile.Session ? maFile.Session.SteamID : null);
  if (!steamid) {
    throw new Error('Invalid maFile: missing SteamID');
  }
  steamid = String(steamid);
  maFile.steamid = steamid;
  if (maFile.Session) {
    maFile.Session.SteamID = steamid;
  }
  if (!maFile.device_id && (maFile.deviceID || maFile.deviceId)) {
    maFile.device_id = maFile.deviceID || maFile.deviceId;
  }
  const filename = `${steamid}.maFile`;
  const fullPath = path.join(DATA_DIR, filename);
  fs.writeFileSync(fullPath, JSON.stringify(maFile, null, 2));
  const manifest = loadManifest();
  if (!manifest.entries) manifest.entries = [];
  let entry = manifest.entries.find(e => String(e.steamid) === steamid);
  if (!entry) {
    entry = {
      encryption_iv: null,
      encryption_salt: null,
      filename,
      steamid,
      auto_confirm_trades: false,
      auto_confirm_market_transactions: false
    };
    manifest.entries.push(entry);
  } else {
    if (!Object.prototype.hasOwnProperty.call(entry, 'filename')) {
      entry.filename = filename;
    }
    if (!Object.prototype.hasOwnProperty.call(entry, 'encryption_iv')) {
      entry.encryption_iv = null;
    }
    if (!Object.prototype.hasOwnProperty.call(entry, 'encryption_salt')) {
      entry.encryption_salt = null;
    }
    if (!Object.prototype.hasOwnProperty.call(entry, 'auto_confirm_trades')) {
      entry.auto_confirm_trades = false;
    }
    if (!Object.prototype.hasOwnProperty.call(entry, 'auto_confirm_market_transactions')) {
      entry.auto_confirm_market_transactions = false;
    }
    delete entry.account_name;
    delete entry.display_name;
  }
  saveManifest(manifest);
  if (maFile.Session && (maFile.Session.SteamLoginSecure || maFile.Session.AccessToken)) {
    const token =
      maFile.Session.SteamLoginSecure ||
      maFile.Session.AccessToken;
    if (token) {
      setSessionCookiesForAccount(
        steamid,
        maFile.Session.SessionID || '',
        token,
        maFile.Session.OAuthToken || maFile.Session.RefreshToken || null
      );
    }
  }
  return loadAccounts().find(a => String(a.steamid) === steamid);
}

module.exports = {
  loadAccounts,
  addAccountFromMaFile,
  getSessionCookiesForAccount,
  setSessionCookiesForAccount,
  updateSessionLastUsed,
  clearSessionForAccount,
  getManifestSettings,
  isSessionValid,
  isSessionExpired,
  getSessionAge
};
