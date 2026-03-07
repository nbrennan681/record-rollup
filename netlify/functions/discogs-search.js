// netlify/functions/discogs-search.js
// Proxies search requests to Discogs using a secret token stored
// as a Netlify environment variable — visitors never see the token.

exports.handler = async (event) => {
  const query = event.queryStringParameters?.q;

  if (!query) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Missing q param' }) };
  }

  const token = process.env.DISCOGS_TOKEN;
  if (!token) {
    return {
      statusCode: 503,
      body: JSON.stringify({ error: 'Discogs token not configured on server' })
    };
  }

  try {
    const url = `https://api.discogs.com/database/search?q=${encodeURIComponent(query)}&type=release&per_page=40`;
    const res = await fetch(url, {
      headers: {
        'Authorization': `Discogs token=${token}`,
        'User-Agent': 'RecordRollup/1.0'
      }
    });

    if (!res.ok) {
      return { statusCode: res.status, body: JSON.stringify({ error: 'Discogs API error' }) };
    }

    const data = await res.json();

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify(data)
    };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
