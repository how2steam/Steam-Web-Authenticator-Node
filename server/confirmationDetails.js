const crypto = require('crypto');
const axios = require('axios');
const cheerio = require('cheerio');

const { getSessionCookiesForAccount } = require('./storage');
const { getAgent } = require('./proxy');

const STEAM_WEB_API_KEY = process.env.STEAM_WEB_API_KEY || null;

let timeOffset = 0;
let isTimeAligned = false;

const STEAM_HEADERS = {
  Accept: 'application/json, text/javascript; q=0.01',
  'User-Agent':
    'Mozilla/5.0 (Linux; Android 6.0; Nexus 6P Build/MDA89D) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/88.0.4324.181 Mobile Safari/537.36',
  'X-Requested-With': 'com.valvesoftware.android.steam.community',
  Referer: 'https://steamcommunity.com/mobileconf/conf',
  Host: 'steamcommunity.com'
};

async function alignTime() {
  if (isTimeAligned) return;
  try {
    const agent = getAgent();
    const res = await axios.post(
      'https://api.steampowered.com/ITwoFactorService/QueryTime/v0001',
      {},
      {
        headers: { 'Content-Length': '0' },
        httpsAgent: agent,
        validateStatus: () => true
      }
    );
    const serverTime = parseInt(res.data?.response?.server_time, 10);
    if (!Number.isNaN(serverTime)) {
      const localTime = Math.floor(Date.now() / 1000);
      timeOffset = serverTime - localTime;
      isTimeAligned = true;
    }
  } catch (err) {
    console.warn('[Details] Time sync failed:', err.message);
  }
}

function getSteamTime() {
  return Math.floor(Date.now() / 1000) + timeOffset;
}

function bufferizeSecret(secret) {
  if (typeof secret === 'string' && secret.match(/^[0-9a-f]{40}$/i)) {
    return Buffer.from(secret, 'hex');
  }
  return Buffer.from(secret, 'base64');
}

function generateConfirmationKey(identitySecret, time, tag) {
  const secretBuf = bufferizeSecret(identitySecret);
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

function mapAppIdToName(appid) {
  const map = {
    730: 'Counter-Strike',
    570: 'Dota 2',
    440: 'Team Fortress 2',
    578080: 'PUBG',
    252490: 'Rust',
    753: 'Steam'
  };
  return map[appid] || `App ${appid}`;
}

async function fetchItemNameFallback(account, appid, classid, instanceid) {
  try {
    const cookie = getSessionCookieHeader(account);
    const url = `https://steamcommunity.com/economy/itemclasshover/${appid}/${classid}/${instanceid || 0}? content_only=1&l=english`;
    
    const res = await axios.get(url, {
      headers: { 
        ...STEAM_HEADERS, 
        'Cookie': cookie 
      },
      httpsAgent: getAgent(),
      validateStatus: () => true
    });

    const html = res.data;
    if (! html || typeof html !== 'string') return null;

    const matchH1 = html.match(/<h1[^>]*>([^<]+)<\/h1>/i);
    if (matchH1 && matchH1[1]) return matchH1[1].trim();

    const matchDiv = html.match(/class=["']hover_item_name["'][^>]*>([^<]+)</i);
    if (matchDiv && matchDiv[1]) return matchDiv[1].trim();

    return null;
  } catch (e) {
    console.warn(`[Details] Fallback fetch failed for ${classid}: ${e.message}`);
    return null;
  }
}

async function fetchAssetDescription(appid, classid, instanceid) {
  if (!STEAM_WEB_API_KEY || !appid || !classid) return null;

  const params = new URLSearchParams();
  params.set('key', STEAM_WEB_API_KEY);
  params.set('appid', String(appid));
  params.set('class_count', '1');
  params.set('classid0', String(classid));
  if (instanceid && instanceid !== '0') params.set('instanceid0', String(instanceid));

  try {
    const res = await axios.get(
      'https://api.steampowered.com/ISteamEconomy/GetAssetClassInfo/v1',
      { params, httpsAgent: getAgent(), validateStatus: () => true }
    );

    const result = res.data?.result;
    if (!result) return null;

    let desc = result[classid] || (result.classes && result.classes[0]) || (result.classes && result.classes[classid]);
    if (!desc) return null;

    return {
      name: desc.market_name || desc.name || desc.market_hash_name,
      marketHashName: desc.market_hash_name || desc.name,
      iconUrl: desc.icon_url_large || desc.icon_url,
      type: desc.type,
      tradable: desc.tradable !== undefined ? !!desc.tradable : true,
      marketable: desc.marketable !== undefined ?  !!desc.marketable : true
    };
  } catch (err) {
    return null;
  }
}

async function fetchMarketPrice(appid, marketHashName) {
  if (!appid || !marketHashName) return null;

  try {
    const res = await axios.get('https://steamcommunity.com/market/priceoverview/', {
      params: {
        currency: 1,
        appid,
        market_hash_name: marketHashName
      },
      httpsAgent: getAgent(),
      validateStatus: () => true
    });

    const data = res.data;
    if (!data || data.success === false) return null;

    return {
      lowest: data.lowest_price || null,
      median: data.median_price || null,
      volume: data.volume || null
    };
  } catch (err) {
    return null;
  }
}

async function enrichItemsWithMarket(account, items) {
  if (!items || ! items.length) return items;

  const byKey = new Map();
  for (const item of items) {
    const key = `${item.appid}:${item.classid}:${item.instanceid || '0'}`;
    if (!byKey.has(key)) byKey.set(key, item);
  }

  for (const [, item] of byKey) {
    try {
      let desc = await fetchAssetDescription(item.appid, item.classid, item.instanceid);

      if (!desc && (! item.name || item.name.trim() === '')) {
         const scrapedName = await fetchItemNameFallback(account, item.appid, item.classid, item.instanceid);
         if (scrapedName) {
             item.name = scrapedName;
             item.marketHashName = scrapedName;
         }
      } else if (desc) {
        item.name = desc.name || item.name;
        item.marketHashName = desc.marketHashName || item.name;
        if (! item.icon && desc.iconUrl) {
          item.icon = `https://steamcommunity-a.akamaihd.net/economy/image/${desc.iconUrl}`;
        }
        item.type = desc.type || item.type;
      }

      if (item.name && ! item.marketHashName) {
          item.marketHashName = item.name;
      }

      if (item.appid && item.marketHashName) {
        const price = await fetchMarketPrice(item.appid, item.marketHashName);
        if (price) {
          item.price = price;
        }
      }
    } catch (err) {
      console.warn('[Details] Enrich failed for item:', err.message);
    }
  }
  return items;
}

function parseTradeHtml(html) {
  const $ = cheerio.load(html);

  const tradeArea = $('.mobileconf_trade_area');
  const partnerBlock = tradeArea.find('.trade_partner_header').first();
  const partnerName = partnerBlock.find('.trade_partner_headline_sub a').text().trim() || null;
  const partnerProfileUrl = partnerBlock.find('.trade_partner_headline_sub a').attr('href') || null;
  const avatarImg = tradeArea.find('.tradeoffer_avatar img').first().attr('src') || null;
  const warningText = tradeArea.find('div[style*="color: #7A7A7A"]').text().trim() || null;

  const youGiveItems = [];
  const youReceiveItems = [];

  function parseItemList(root, targetArray, sideLabel) {
    const items = root.find('.tradeoffer_item_list .trade_item');
    items.each((_, el) => {
      const node = $(el);
      const econ = node.attr('data-economy-item') || '';
      const parts = econ.split('/');

      let appid = null, classid = null, instanceid = '0';
      if (parts[0] === 'classinfo') {
        appid = parseInt(parts[1], 10) || null;
        classid = parts[2] || null;
        instanceid = parts[3] || '0';
      }

      let assetid = node.attr('data-assetid') || node.attr('data-id') || null;

      const img = node.find('img').first();
      let icon = img.attr('src') || null;

      let scrapedName = node.attr('data-name') || img.attr('alt') || img.attr('title') || null;
      if (!scrapedName) {
         const clone = node.clone();
         clone.children().remove(); 
         const text = clone.text().trim();
         if(text && text.length > 1) scrapedName = text;
      }

      const style = node.attr('style') || '';
      const borderMatch = style.match(/border-color:\s*([^;]+)/i);
      const bgMatch = style.match(/background-color:\s*([^;]+)/i);
      
      targetArray.push({
        side: sideLabel,
        appid,
        appName: appid ? mapAppIdToName(appid) : null,
        classid,
        instanceid,
        assetid,
        icon,
        borderColor: borderMatch ? borderMatch[1].trim() : null,
        backgroundColor: bgMatch ? bgMatch[1].trim() : null,
        name: scrapedName,
        marketHashName: scrapedName,
        price: null
      });
    });
  }

  const primary = tradeArea.find('.tradeoffer_items.primary').first();
  const secondary = tradeArea.find('.tradeoffer_items.secondary').first();

  parseItemList(primary, youGiveItems, 'you_give');
  parseItemList(secondary, youReceiveItems, 'you_receive');

  return {
    partner: { name: partnerName, profileUrl: partnerProfileUrl, avatar: avatarImg },
    youGiveItems,
    youReceiveItems,
    warningText
  };
}

async function fetchMobileConfDetails(account, payload) {
  await alignTime();
  const cookie = getSessionCookieHeader(account);
  const qsBase = generateConfirmationQueryParams(account, 'details');
  const params = new URLSearchParams(qsBase.toString());
  
  params.set('cid', String(payload.confirmationId || payload.id));
  params.set('ck', String(payload.key || payload.nonce || ''));

  const url = `https://steamcommunity.com/mobileconf/details/${params.get('cid')}? ${params.toString()}`;

  const res = await axios.get(url, {
    headers: { ...STEAM_HEADERS, Cookie: cookie },
    httpsAgent: getAgent(),
    responseType: 'text',
    validateStatus: () => true
  });

  if (res.status === 401 || res.status === 403) throw new Error('LOGIN_REQUIRED');

  let html = res.data;
  let type = payload.type;
  let creator = payload.creatorId;
  let raw = res.data;

  if (typeof res.data === 'string' && res.data.trim().startsWith('{')) {
      try {
          const parsed = JSON.parse(res.data);
          html = parsed.html || res.data;
          if (parsed.type) type = parsed.type;
          if (parsed.creator) creator = parsed.creator;
          raw = parsed;
      } catch (e) { /* ignore */ }
  } else if (typeof res.data === 'object') {
      html = res.data.html;
      raw = res.data;
  }

  return { html, type, creator, raw };
}

async function getRichConfirmationDetails(account, opts) {
  const base = {
    type: 'generic',
    confirmationId: String(opts.confirmationId || opts.id || ''),
    creatorId: opts.creatorId,
    html: null,
    raw: null
  };

  const raw = await fetchMobileConfDetails(account, opts);
  base.html = raw.html;
  base.raw = raw.raw;

  if (! base.html) return base;

  if (base.html.includes('mobileconf_trade_area') || base.html.includes('tradeoffer')) {
      const trade = parseTradeHtml(base.html);
      
      await enrichItemsWithMarket(account, trade.youGiveItems);
      await enrichItemsWithMarket(account, trade.youReceiveItems);

      const sum = (items) => items.reduce((acc, i) => {
          const p = i.price?.median || i.price?.lowest;
          if(! p) return acc;
          const val = parseFloat(p.replace(/[^\d.,]/g, '').replace(',', '.'));
          return ! isNaN(val) ? acc + val : acc;
      }, 0);

      return {
          ...base,
          type: 'trade',
          partner: trade.partner,
          youGiveItems: trade.youGiveItems,
          youReceiveItems: trade.youReceiveItems,
          totals: {
              giveValue: sum(trade.youGiveItems),
              receiveValue: sum(trade.youReceiveItems)
          }
      };
  }

  return base;
}

module.exports = { getRichConfirmationDetails };