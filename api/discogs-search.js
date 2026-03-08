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

  // Build signature base string
  const sortedParams = Object.keys(params).sort().map(k =>
    `${encodeURIComponent(k)}=${encodeURIComponent(params[k])}`
  ).join('&');

  const baseString = [
    method.toUpperCase(),
    encodeURIComponent(url),
    encodeURIComponent(sortedParams),
  ].join('&');

  // Sign with consumer secret (two-legged OAuth, no user token)
  const signingKey = `${encodeURIComponent(consumerSecret)}&`;
  const signature = crypto.createHmac('sha1', signingKey).update(baseString).digest('base64');

  params.oauth_signature = signature;

  const headerValue = 'OAuth ' + Object.keys(params).sort().map(k =>
    `${encodeURIComponent(k)}="${encodeURIComponent(params[k])}"`
  ).join(', ');

  return headerValue;
}

export default async function handler(req, res) {
  const query = req.query.q || '';
  if (!query || query.length < 2) {
    return res.status(400).json({ error: 'Query too short' });
  }

  const token = process.env.DISCOGS_TOKEN;
  const consumerKey = process.env.DISCOGS_CONSUMER_KEY;
  const consumerSecret = process.env.DISCOGS_CONSUMER_SECRET;

  if (!token) return res.status(500).json({ error: 'Token not configured' });

  const baseHeaders = {
    'Authorization': `Discogs token=${token}`,
    'User-Agent': 'RecordRollup/1.0 +https://record-rollup.vercel.app',
    'Accept': 'application/json',
  };

  async function discogsFetch(url, useOAuth = false) {
    try {
      const headers = useOAuth && consumerKey && consumerSecret
        ? {
            'Authorization': buildOAuthHeader('GET', url, consumerKey, consumerSecret),
            'User-Agent': 'RecordRollup/1.0 +https://record-rollup.vercel.app',
            'Accept': 'application/json',
          }
        : baseHeaders;
      const r = await fetch(url, { headers });
      if (!r.ok) return null;
      return r.json();
    } catch { return null; }
  }

  // Get price suggestions (requires OAuth) — returns prices by condition from real sales
  // Falls back to lowest_price from stats if OAuth not available
  async function getPrice(releaseId) {
    try {
      if (consumerKey && consumerSecret) {
        const url = `https://api.discogs.com/marketplace/price_suggestions/${releaseId}`;
        const suggestions = await discogsFetch(url, true);
        if (suggestions) {
          // Use VG+ price as the standard — most common condition for used vinyl
          const vgPlus = suggestions['Very Good Plus (VG+)']?.value;
          const nm = suggestions['Near Mint (NM or M-)']?.value;
          const vg = suggestions['Very Good (VG)']?.value;
          const price = vgPlus || nm || vg;
          if (price && price > 0) return { price: Math.round(price), label: 'VG+' };
        }
      }
      // Fallback: lowest active listing price
      const stats = await discogsFetch(
        `https://api.discogs.com/marketplace/stats/${releaseId}?curr_abbr=USD`
      );
      if (!stats || stats.blocked_from_sale) return null;
      const lowest = stats.lowest_price?.value;
      return (lowest && lowest > 0) ? { price: Math.round(lowest), label: 'mkt' } : null;
    } catch { return null; }
  }

  // Batched to stay within Discogs rate limits
  async function batchPrices(items, batchSize = 5) {
    const results = [];
    for (let i = 0; i < items.length; i += batchSize) {
      const batch = items.slice(i, i + batchSize);
      const batchResults = await Promise.all(
        batch.map(async item => {
          const result = await getPrice(item.id);
          return {
            ...item,
            avg_price: result?.price ?? null,
            price_label: result?.label ?? null,
            has_real_price: result !== null,
          };
        })
      );
      results.push(...batchResults);
      if (i + batchSize < items.length) {
        await new Promise(r => setTimeout(r, 200));
      }
    }
    return results;
  }

  try {
    const data = await discogsFetch(
      `https://api.discogs.com/database/search?q=${encodeURIComponent(query)}&type=release&format=vinyl&per_page=50`
    );

    // All variants/pressings — no deduplication
    const candidates = (data?.results || [])
      .filter(item => item.cover_image && !item.cover_image.includes('spacer'))
      .slice(0, 20);

    const withPrices = await batchPrices(candidates);
    const results = withPrices.filter(item => item.has_real_price);

    res.setHeader('Cache-Control', 'public, max-age=300');
    return res.status(200).json({ results });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
