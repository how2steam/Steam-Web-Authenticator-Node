const SteamCommunity = require('steamcommunity');
const SteamStore = require('steamstore');
const crypto = require('crypto');
const { addAccountFromMaFile } = require('./storage');
const { generateAndroidDeviceId } = require('./deviceID');

const PENDING_SETUPS = new Map();

function setupLogin(username, password, authCode = null, twoFactorCode = null) {
  return new Promise((resolve, reject) => {
    const community = new SteamCommunity();
    const loginDetails = {
      accountName: username,
      password,
      authCode,
      twoFactorCode,
      disableMobile: false
    };
    console.log('[Login] Starting login...');
    community.login(loginDetails, (err, sessionID, cookies, steamguard, oAuthToken) => {
      if (err) {
        if (err.message === 'SteamGuard') {
          console.log('[Login] Steam Guard email sent');
          const setupId = crypto.randomBytes(16).toString('hex');
          PENDING_SETUPS.set(setupId, {
            community,
            username,
            password,
            awaitingEmailCode: true
          });
          return resolve({
            status: 'need_email_code',
            msg: 'Code sent to email',
            setupId
          });
        }
        if (err.message === 'CAPTCHA') {
          return reject(new Error('Login CAPTCHA. Try with a proxy.'));
        }
        return reject(err);
      }
      console.log('[Login] Login successful');
      const steamID64 = community.steamID.getSteamID64();
      const setupId = sessionID || crypto.randomBytes(16).toString('hex');
      console.log('[Login] Cookies extracted, SteamID:', steamID64);
      const store = new SteamStore();
      store.setCookies(cookies || []);
      PENDING_SETUPS.set(setupId, {
        community,
        store,
        username,
        accountName: username,
        steamID: steamID64,
        cookies,
        sessionID: setupId,
        deviceID: generateAndroidDeviceId(steamID64),
        oAuthToken: oAuthToken || null,
        phone_added: false,
        phone_verified: false,
        authenticator_enabled: false
      });
      resolve({
        status: 'success',
        setupId,
        steamID: steamID64
      });
    });
  });
}

function submitEmailCode(setupId, emailCode) {
  return new Promise((resolve, reject) => {
    const session = PENDING_SETUPS.get(setupId);
    if (!session || !session.awaitingEmailCode) {
      return reject(new Error('No pending email verification'));
    }
    console.log('[Login] Retrying login with email code...');
    session.community.login(
      {
        accountName: session.username,
        password: session.password,
        authCode: emailCode,
        disableMobile: false
      },
      (err, newSessionID, newCookies, steamguard, oAuthToken) => {
        if (err) {
          console.error('[Login] Email code failed:', err.message);
          return reject(new Error(`Email code rejected: ${err.message}`));
        }
        console.log('[Login] Email code accepted, logged in');
        const steamID64 = session.community.steamID.getSteamID64();
        const newSetupId = newSessionID || crypto.randomBytes(16).toString('hex');
        const store = new SteamStore();
        store.setCookies(newCookies || []);
        PENDING_SETUPS.delete(setupId);
        PENDING_SETUPS.set(newSetupId, {
          community: session.community,
          store,
          username: session.username,
          accountName: session.username,
          steamID: steamID64,
          cookies: newCookies,
          sessionID: newSetupId,
          deviceID: generateAndroidDeviceId(steamID64),
          oAuthToken: oAuthToken || null,
          phone_added: false,
          phone_verified: false,
          authenticator_enabled: false
        });
        resolve({
          status: 'success',
          setupId: newSetupId,
          steamID: steamID64
        });
      }
    );
  });
}

function addPhoneNumber(setupId, phoneNumber) {
  return new Promise((resolve, reject) => {
    const session = PENDING_SETUPS.get(setupId);
    if (!session) return reject(new Error('Session expired. Login again.'));
    if (!session.store) return reject(new Error('Store session not initialized'));
    const number = String(phoneNumber || '').trim();
    if (!number.startsWith('+')) {
      return reject(new Error('Phone number must start with + and country code, e.g. +15551234567'));
    }
    console.log('[Phone] Adding phone number', number);
    session.store.addPhoneNumber(number, false, err => {
      if (err) {
        console.error('[Phone] addPhoneNumber error:', err.message);
        const msg = String(err.message || '');
        if (msg.includes('already has a phone number') || msg.includes('already has a phone')) {
          console.log('[Phone] Account already has a phone number, assuming verified.');
          session.phone_number = number;
          session.phone_added = true;
          session.phone_verified = true;
          PENDING_SETUPS.set(setupId, session);
          return resolve({
            success: true,
            status: 'phone_already',
            message: 'This account already has a phone number. You can continue with authenticator setup.'
          });
        }
        if (msg.includes('email_verification')) {
          return reject(
            new Error(
              'Steam requires email verification. Click the link in the email, then continue.'
            )
          );
        }
        return reject(err);
      }
      session.phone_number = number;
      session.phone_added = true;
      PENDING_SETUPS.set(setupId, session);
      resolve({
        success: true,
        status: 'phone_added',
        message: 'Phone number added. Check your email, click the confirmation link, then request SMS.'
      });
    });
  });
}

function sendPhoneVerificationSMS(setupId) {
  return new Promise((resolve, reject) => {
    const session = PENDING_SETUPS.get(setupId);
    if (!session) return reject(new Error('Session expired. Login again.'));
    if (!session.store) return reject(new Error('Store session not initialized'));
    if (!session.phone_added) return reject(new Error('Phone number not added yet'));
    console.log('[Phone] Sending verification SMS for phone...');
    session.store.sendPhoneNumberVerificationMessage(err => {
      if (err) {
        console.error('[Phone] sendPhoneNumberVerificationMessage error:', err.message);
        return reject(err);
      }
      session.awaitingPhoneSms = true;
      PENDING_SETUPS.set(setupId, session);
      resolve({
        success: true,
        status: 'sms_sent',
        message: 'SMS verification code sent to your phone.'
      });
    });
  });
}

function verifyPhoneSMS(setupId, smsPhoneCode) {
  return new Promise((resolve, reject) => {
    const session = PENDING_SETUPS.get(setupId);
    if (!session) return reject(new Error('Session expired. Login again.'));
    if (!session.store) return reject(new Error('Store session not initialized'));
    if (!session.awaitingPhoneSms) return reject(new Error('No pending phone SMS verification'));
    const code = String(smsPhoneCode || '').trim();
    if (!code) return reject(new Error('SMS code required'));
    console.log('[Phone] Verifying phone SMS...');
    session.store.verifyPhoneNumber(code, err => {
      if (err) {
        console.error('[Phone] verifyPhoneNumber error:', err.message);
        return reject(new Error('Failed to verify phone SMS: ' + err.message));
      }
      session.phone_verified = true;
      session.awaitingPhoneSms = false;
      PENDING_SETUPS.set(setupId, session);
      resolve({
        success: true,
        status: 'phone_verified',
        message: 'Phone number verified successfully.'
      });
    });
  });
}

function enable2FA(setupId) {
  return new Promise((resolve, reject) => {
    const session = PENDING_SETUPS.get(setupId);
    if (!session) return reject(new Error('Session expired. Login again.'));
    if (!session.phone_verified) {
      return reject(new Error('Phone must be verified before enabling authenticator'));
    }
    console.log('[Setup] Enabling authenticator via enableTwoFactor...');
    session.community.enableTwoFactor((err, response) => {
      if (err) {
        if (err.eresult === SteamCommunity.EResult.RateLimitExceeded) {
          console.error('[Setup] enableTwoFactor rate-limited (EResult 84)');
          return reject(
            new Error(
              'Steam is rate-limiting authenticator setup for this account/IP (EResult 84). Wait a while and try again, or use a different account.'
            )
          );
        }
        console.error('[Setup] enableTwoFactor error:', err);
        return reject(err);
      }
      if (!response || response.status !== SteamCommunity.EResult.OK) {
        const status = response ? response.status : 'UNKNOWN';
        console.error('[Setup] enableTwoFactor bad status:', status);
        return reject(
          new Error(`Failed to enable authenticator: Status ${status}`)
        );
      }
      session.secrets = response;
      session.authenticator_enabled = true;
      PENDING_SETUPS.set(setupId, session);
      console.log('[Setup] Authenticator enabled, waiting for SMS activation code');
      resolve({
        status: 'awaiting_auth_sms',
        message: 'Authenticator enabled. SMS activation code sent. Enter it to finalize.'
      });
    });
  });
}

function finalize2FA(setupId, authSmsCode) {
  return new Promise((resolve, reject) => {
    const session = PENDING_SETUPS.get(setupId);
    if (!session || !session.secrets || !session.authenticator_enabled) {
      return reject(new Error('Session invalid or authenticator not enabled yet'));
    }
    const activationCode = String(authSmsCode || '').trim();
    if (!activationCode) {
      return reject(new Error('Activation SMS code is required'));
    }
    console.log('[Setup] Finalizing authenticator with SMS activation code...');
    const sharedSecret = session.secrets.shared_secret;
    session.community.finalizeTwoFactor(sharedSecret, activationCode, err => {
      if (err) {
        console.error('[Setup] finalizeTwoFactor error:', err.message);
        return reject(
          new Error('Steam rejected the activation SMS code: ' + err.message)
        );
      }
      console.log('[Setup] Authenticator finalized successfully!');
      const steamidStr = String(session.steamID);
      const server_time =
        Number(session.secrets.server_time) || Math.floor(Date.now() / 1000);
      const maFile = {
        shared_secret: session.secrets.shared_secret,
        serial_number: session.secrets.serial_number,
        revocation_code: session.secrets.revocation_code,
        uri: session.secrets.uri,
        server_time,
        account_name: session.accountName,
        token_gid: session.secrets.token_gid,
        identity_secret: session.secrets.identity_secret,
        secret_1: session.secrets.secret_1,
        status: 1,
        device_id: session.deviceID,
        fully_enrolled: true,
        phone_number: session.phone_number || null,
        phone_verified: true,
        steamid: steamidStr,
        Session: {
          SteamID: steamidStr,
          AccessToken: session.oAuthToken || null,
          RefreshToken: session.oAuthToken || null,
          SessionID: session.sessionID || null
        }
      };
      addAccountFromMaFile(maFile);
      console.log('[Setup] maFile saved. Revocation code:', session.secrets.revocation_code);
      PENDING_SETUPS.delete(setupId);
      resolve({
        revocation_code: session.secrets.revocation_code,
        maFile
      });
    });
  });
}

module.exports = {
  setupLogin,
  submitEmailCode,
  addPhoneNumber,
  sendPhoneVerificationSMS,
  verifyPhoneSMS,
  enable2FA,
  finalize2FA
};
