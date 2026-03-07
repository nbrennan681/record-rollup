exports.handler = async function (event) {
  const query = event.queryStringParameters?.q || '';
  if (!query || query.length < 2) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Query too short' }) };
  }

  const token = process.env.DISCOGS_TOKEN;
  if (!token) {
    return { statusCode: 500, body: JSON.stringify({ error: 'Discogs token not configured' }) };
  }

  const headers = {
    'Authorization': `Discogs token=${token}`,
    'User-Agent': 'RecordRollup/1.0 +https://recordrollup.app',
    'Accept': 'application/json',
  };

  async function discogsFetch(url) {
    try {
      const res = await fetch(url, { headers });
      if (!res.ok) return null;
      return res.json();
    } catch { return null; }
  }

  function normaliseTitle(raw) {
    // Extract just the album title portion from "Artist - Title" strings
    let title = raw || '';
    if (title.includes(' - ')) {
      title = title.split(' - ').slice(1).join(' - ');
    }
    return title.toLowerCase()
      .replace(/\s*\(\d+\)\s*/g, '')   // remove (year) disambiguators
      .replace(/[^a-z0-9\s]/g, '')     // strip punctuation
      .replace(/\s+/g, ' ')
      .trim();
  }

  async function getPriceForRelease(releaseId) {
    const suggestions = await discogsFetch(
      `https://api.discogs.com/marketplace/price_suggestions/${releaseId}`
    );
    if (!suggestions) return null;

    const nm  = suggestions['Near Mint (NM or M-)']?.value;
    const vgp = suggestions['Very Good Plus (VG+)']?.value;
    const vg  = suggestions['Very Good (VG)']?.value;

    const weighted = [
      ...(nm  ? [nm,  nm,  nm ]  : []),
      ...(vgp ? [vgp, vgp, vgp]  : []),
      ...(vg  ? [vg]             : []),
    ].filter(v => typeof v === 'number' && v > 0);

    return weighted.length
      ? Math.round(weighted.reduce((a, b) => a + b, 0) / weighted.length)
      : null;
  }

  try {
    // Search masters (canonical albums) and releases in parallel
    const [masterData, releaseData] = await Promise.all([
      discogsFetch(`https://api.discogs.com/database/search?q=${encodeURIComponent(query)}&type=master&per_page=25`),
      discogsFetch(`https://api.discogs.com/database/search?q=${encodeURIComponent(query)}&type=release&format=vinyl&per_page=25`),
    ]);

    const masters  = (masterData?.results  || []).map(r => ({ ...r, _type: 'master'  }));
    const releases = (releaseData?.results || []).map(r => ({ ...r, _type: 'release' }));

    // Deduplicate by album title only — ignore artist/year variations
    const seen = new Set();
    const combined = [];
    for (const item of [...masters, ...releases]) {
      const key = normaliseTitle(item.title);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      combined.push(item);
    }

    // Enrich top 10 with real pricing
    const enriched = await Promise.all(
      combined.slice(0, 10).map(async (item) => {
        let releaseId = item.id;
        let avg_price = null;

        try {
          if (item._type === 'master') {
            // Get the canonical main release for this master
            const masterDetail = await discogsFetch(`https://api.discogs.com/masters/${item.id}`);
            if (masterDetail?.main_release) {
              releaseId = masterDetail.main_release;
            }
          }
          avg_price = await getPriceForRelease(releaseId);
        } catch { /* keep null */ }

        return {
          ...item,
          avg_price,
          has_real_price: avg_price !== null,
        };
      })
    );

    const final = [...enriched, ...combined.slice(10)];

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
      body: JSON.stringify({ results: final }),
    };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
