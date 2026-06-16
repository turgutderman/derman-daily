const REPO = 'turgutderman/derman-daily';
const GITHUB_API = 'https://api.github.com';
const CONTENT_PATH = 'dashboard-content.json';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Auth: check publish secret from header or body
  const publishSecret = process.env.PUBLISH_SECRET;
  const providedSecret =
    req.headers['x-publish-secret'] || (req.body && req.body.secret);

  if (!publishSecret || providedSecret !== publishSecret) {
    return res.status(401).json({ error: 'Invalid or missing publish secret' });
  }

  const ghToken = process.env.GITHUB_TOKEN;
  if (!ghToken) {
    return res.status(500).json({ error: 'GITHUB_TOKEN not configured' });
  }

  const { content } = req.body || {};
  if (!content || typeof content !== 'object') {
    return res.status(400).json({ error: 'Missing or invalid content field (must be an object)' });
  }

  try {
    const newContent = JSON.stringify(content, null, 2);

    // Get current file SHA (needed for update)
    const getRes = await fetch(`${GITHUB_API}/repos/${REPO}/contents/${CONTENT_PATH}`, {
      headers: {
        Authorization: `token ${ghToken}`,
        Accept: 'application/vnd.github.v3+json',
      },
    });

    let sha = null;
    if (getRes.ok) {
      const existing = await getRes.json();
      sha = existing.sha;
    } else if (getRes.status !== 404) {
      const errText = await getRes.text();
      throw new Error(`GitHub GET error ${getRes.status}: ${errText}`);
    }

    // Write the file
    const putBody = {
      message: `[dashboard] Update content — ${new Date().toISOString()}`,
      content: Buffer.from(newContent, 'utf-8').toString('base64'),
    };
    if (sha) {
      putBody.sha = sha;
    }

    const putRes = await fetch(`${GITHUB_API}/repos/${REPO}/contents/${CONTENT_PATH}`, {
      method: 'PUT',
      headers: {
        Authorization: `token ${ghToken}`,
        Accept: 'application/vnd.github.v3+json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(putBody),
    });

    if (!putRes.ok) {
      const errText = await putRes.text();
      throw new Error(`GitHub PUT error ${putRes.status}: ${errText}`);
    }

    const result = await putRes.json();

    return res.status(200).json({
      success: true,
      message: 'Dashboard content published',
      sha: result.content?.sha || null,
      publishedAt: new Date().toISOString(),
    });
  } catch (err) {
    console.error('Update content error:', err);
    return res.status(500).json({ error: err.message });
  }
}
