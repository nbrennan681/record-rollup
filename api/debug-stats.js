export default async function handler(req, res) {
  const token = process.env.DISCOGS_TOKEN;
  const headers = {
    'Authorization': `Discogs token=${token}`,
    'User-Agent': 'RecordRollup/1.0 +https://record-rollup.vercel.app',
    'Accept': 'application/json',
  };

  // First search for Drake vinyl to get real release IDs
  const searchRes = await fetch(
    'https://api.discogs.com/database/search?q=drake&type=release&format=vinyl&per_page=5',
    { headers }
  );
  const searchData = await searchRes.json();
  const releases = (searchData.results || []).slice(0, 3);

  // Then hit marketplace/stats for each and return the raw response
  const debug = await Promise.all(releases.map(async r => {
    const statsRes = await fetch(
      `https://api.discogs.com/marketplace/stats/${r.id}?curr_abbr=USD`,
      { headers }
    );
    const statsRaw = await statsRes.json();
    return {
      release_id: r.id,
      title: r.title,
      year: r.year,
      stats_status: statsRes.status,
      stats_raw: statsRaw,
    };
  }));

  res.status(200).json({ debug });
}
