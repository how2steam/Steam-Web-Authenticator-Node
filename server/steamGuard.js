const crypto = require('crypto');
const { bufferizeSecret } = require('./steamCrypto');

const STEAM_CHARS = '23456789BCDFGHJKMNPQRTVWXY';

function generateSteamGuardCode(sharedSecretInput, timestampMs = Date.now()) {
  const sharedSecret = bufferizeSecret(sharedSecretInput);
  if (!sharedSecret) {
    throw new Error('Missing shared secret');
  }
  const time = Math.floor(timestampMs / 1000);
  const timeStep = Math.floor(time / 30);
  const timeBuffer = Buffer.alloc(8);
  timeBuffer.writeUInt32BE(0, 0);
  timeBuffer.writeUInt32BE(timeStep, 4);
  const hmac = crypto.createHmac('sha1', sharedSecret).update(timeBuffer).digest();
  const offset = hmac[19] & 0x0f;
  let fullCode =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);
  let code = '';
  for (let i = 0; i < 5; i++) {
    const charIndex = fullCode % STEAM_CHARS.length;
    code += STEAM_CHARS.charAt(charIndex);
    fullCode = Math.floor(fullCode / STEAM_CHARS.length);
  }
  return code;
}

module.exports = {
  generateSteamGuardCode
};
