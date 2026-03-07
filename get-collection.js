const { getStore } = require('@netlify/blobs');

exports.handler = async function (event) {
  const userId = event.queryStringParameters?.id;

  if (!userId || typeof userId !== 'string' || userId.length < 10) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid userId' }) };
  }

  try {
    const store = getStore('collections');
    const data = await store.get(userId, { type: 'json' });

    if (!data) {
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
        body: JSON.stringify({ collection: [], wantlist: [], conditions: {} }),
      };
    }

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify(data),
    };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
