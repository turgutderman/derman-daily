const REPO = 'turgutderman/derman-daily';
const GITHUB_API = 'https://api.github.com';

// Blocked paths that should never be writable
const BLOCKED_PATTERNS = ['.env', '.git'];

function isBlockedPath(filePath) {
  const normalized = filePath.replace(/\\/g, '/').toLowerCase();
  for (const pattern of BLOCKED_PATTERNS) {
    if (
      normalized === pattern ||
      normalized.startsWith(pattern + '/') ||
      normalized.startsWith('.' + pattern) ||
      normalized.includes('/' + pattern + '/') ||
      normalized.endsWith('/' + pattern)
    ) {
      return true;
    }
  }
  // Also block any dotenv variations and git internals
  if (/\.(env|env\..*)$/i.test(normalized)) {
    return true;
  }
  if (/^\.git(\/|$)/i.test(normalized) || /\/\.git(\/|$)/i.test(normalized)) {
    return true;
  }
  return false;
}

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

  const { path: filePath, content, message } = req.body || {};

  if (!filePath || typeof filePath !== 'string') {
    return res.status(400).json({ error: 'Missing or invalid path field' });
  }

  if (content === undefined || content === null) {
    return res.status(400).json({ error: 'Missing content field' });
  }

  // Block dangerous paths
  if (isBlockedPath(filePath)) {
    return res
      .status(403)
      .json({ error: `Blocked: cannot write to ${filePath} (protected path)` });
  }

  try {
    // CRITICAL: content is RAW TEXT — we handle base64 encoding here
    const rawContent = typeof content === 'string' ? content : JSON.stringify(content, null, 2);
    const base64Content = Buffer.from(rawContent, 'utf-8').toString('base64');

    // Get current file SHA if it exists (needed for update)
    const getRes = await fetch(
      `${GITHUB_API}/repos/${REPO}/contents/${encodeURIComponent(filePath).replace(/%2F/g, '/')}`,
      {
        headers: {
          Authorization: `token ${ghToken}`,
          Accept: 'application/vnd.github.v3+json',
        },
      }
    );

    let sha = null;
    if (getRes.ok) {
      const existing = await getRes.json();
      sha = existing.sha;
    } else if (getRes.status !== 404) {
      const errText = await getRes.text();
      throw new Error(`GitHub GET error ${getRes.status}: ${errText}`);
    }

    // Write the file
    const commitMessage =
      message || `[dashboard] Update ${filePath} — ${new Date().toISOString()}`;
    const putBody = {
      message: commitMessage,
      content: base64Content,
    };
    if (sha) {
      putBody.sha = sha;
    }

    const putRes = await fetch(
      `${GITHUB_API}/repos/${REPO}/contents/${encodeURIComponent(filePath).replace(/%2F/g, '/')}`,
      {
        method: 'PUT',
        headers: {
          Authorization: `token ${ghToken}`,
          Accept: 'application/vnd.github.v3+json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(putBody),
      }
    );

    if (!putRes.ok) {
      const errText = await putRes.text();
      throw new Error(`GitHub PUT error ${putRes.status}: ${errText}`);
    }

    const result = await putRes.json();

    return res.status(200).json({
      success: true,
      path: filePath,
      sha: result.content?.sha || null,
      message: commitMessage,
      updatedAt: new Date().toISOString(),
    });
  } catch (err) {
    console.error('Update file error:', err);
    return res.status(500).json({ error: err.message });
  }
}
