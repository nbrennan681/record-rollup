import crypto from 'crypto';

function buildOAuthHeader(method, url, consumerKey, consumerSecret) {
  const nonce = crypto.randomBytes(16).toString('hex');
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const params = {
    oauth_consumer_key: consumerKey,
    oauth_nonce: nonce,
    oauth_signature_method: 'HMAC-SHA1',
    oauth_timestamp: timestamp,
    oauth_version: '1.0',
  };
  const sortedParams = Object.keys(params).sort().map(k =>
    `${encodeURIComponent(k)}=${encodeURIComponent(params[k])}`
  ).join('&');
  const baseString = [
    method.toUpperCase(),
    encodeURIComponent(url),
    encodeURIComponent(sortedParams),
  ].join('&');
  const signingKey = `${encodeURIComponent(consumerSecret)}&`;
  const signature = crypto.createHmac('sha1', signingKey).update(baseString).digest('base64');
  params.oauth_signature = signature;
  return 'OAuth ' + Object.keys(params).sort().map(k =>
    `${encodeURIComponent(k)}="${encodeURIComponent(params[k])}"`
  ).join(', ');
}

export default async function handler(req, res) {
  const token = process.env.DISCOGS_TOKEN;
  const consumerKey = process.env.DISCOGS_CONSUMER_KEY;
  const consumerSecret = process.env.DISCOGS_CONSUMER_SECRET;

  const simpleHeaders = {
    'Authorization': `Discogs token=${token}`,
    'User-Agent': 'RecordRollup/1.0 +https://record-rollup.vercel.app',
    'Accept': 'application/json',
  };

  // Search for Drake vinyl
  const searchRes = await fetch(
    'https://api.discogs.com/database/search?q=drake+certified+lover+boy&type=release&format=vinyl&per_page=3',
    { headers: simpleHeaders }
  );
  const searchData = await searchRes.json();
  const releases = (searchData.results || []).slice(0, 3);

  // Test both endpoints for each release
  const debug = await Promise.all(releases.map(async r => {
    // Test marketplace/stats (simple token)
    const statsRes = await fetch(
      `https://api.discogs.com/marketplace/stats/${r.id}?curr_abbr=USD`,
      { headers: simpleHeaders }
    );
    const statsRaw = await statsRes.json();

    // Test price_suggestions (OAuth)
    const suggestUrl = `https://api.discogs.com/marketplace/price_suggestions/${r.id}`;
    const oauthHeader = buildOAuthHeader('GET', suggestUrl, consumerKey, consumerSecret);
    const suggestRes = await fetch(suggestUrl, {
      headers: {
        'Authorization': oauthHeader,
        'User-Agent': 'RecordRollup/1.0 +https://record-rollup.vercel.app',
        'Accept': 'application/json',
      }
    });
    const suggestRaw = await suggestRes.json();

    return {
      release_id: r.id,
      title: r.title,
      year: r.year,
      stats: statsRaw,
      price_suggestions_status: suggestRes.status,
      price_suggestions: suggestRaw,
    };
  }));

  res.status(200).json({
    env_check: {
      has_token: !!token,
      has_consumer_key: !!consumerKey,
      has_consumer_secret: !!consumerSecret,
    },
    debug
  });
}
