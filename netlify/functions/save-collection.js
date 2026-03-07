const { getStore } = require('@netlify/blobs');

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  try {
    const { userId, collection, wantlist, conditions } = JSON.parse(event.body);

    if (!userId || typeof userId !== 'string' || userId.length < 10) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Invalid userId' }) };
    }

    const store = getStore('collections');
    await store.setJSON(userId, { collection, wantlist, conditions, updatedAt: new Date().toISOString() });

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ ok: true }),
    };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
