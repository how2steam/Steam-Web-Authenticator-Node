const crypto = require('crypto');

function generateAndroidDeviceId(steamid) {
  const hash = crypto.createHash('sha1').update(String(steamid)).digest('hex');
  return 'android:' + hash.replace(
    /^([0-9a-f]{8})([0-9a-f]{4})([0-9a-f]{4})([0-9a-f]{4})([0-9a-f]{12}).*$/,
    '$1-$2-$3-$4-$5'
  );
}

module.exports = { generateAndroidDeviceId };
