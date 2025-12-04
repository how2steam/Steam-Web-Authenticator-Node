const { getSessionCookiesForAccount } = require('./storage');

function getSessionCookieHeader(account) {
  const saved = getSessionCookiesForAccount(account.id);
  const sessionid =
    saved?.sessionid || account.raw_mafile?.Session?.SessionID || '';
  const token =
    saved?.steamLoginSecure ||
    account.raw_mafile?.Session?.SteamLoginSecure ||
    account.raw_mafile?.Session?.AccessToken;
  if (!sessionid || !token) {
    throw new Error('LOGIN_REQUIRED');
  }
  return `sessionid=${sessionid}; steamLoginSecure=${token}`;
}

module.exports = { getSessionCookieHeader };
