const crypto = require('crypto');
const { getSteamTime } = require('./steamTime');

function bufferizeSecret(secret) {
  if (!secret) return null;
  if (Buffer.isBuffer(secret)) return secret;
  if (typeof secret === 'string' && secret.match(/^[0-9a-f]{40}$/i)) {
    return Buffer.from(secret, 'hex');
  }
  return Buffer.from(secret, 'base64');
}

function generateConfirmationKey(identitySecret, time, tag) {
  const secretBuf = bufferizeSecret(identitySecret);
  if (!secretBuf) throw new Error('Missing identity secret');
  const tagBuf = Buffer.from(tag || '', 'utf8');
  const buf = Buffer.alloc(8 + tagBuf.length);
  buf.writeUInt32BE(0, 0);
  buf.writeUInt32BE(time, 4);
  if (tagBuf.length > 0) tagBuf.copy(buf, 8);
  return crypto.createHmac('sha1', secretBuf).update(buf).digest('base64');
}

function generateConfirmationQueryParams(account, tag) {
  const time = getSteamTime();
  const key = generateConfirmationKey(account.identity_secret, time, tag);
  const params = new URLSearchParams();
  params.set('p', account.device_id);
  params.set('a', account.steamid);
  params.set('k', key);
  params.set('t', time);
  params.set('m', 'android');
  params.set('tag', tag);
  return params;
}

module.exports = {
  bufferizeSecret,
  generateConfirmationKey,
  generateConfirmationQueryParams
};
