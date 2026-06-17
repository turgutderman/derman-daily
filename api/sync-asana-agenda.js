const ASANA_BASE = 'https://app.asana.com/api/1.0';
const REPO = 'turgutderman/derman-daily';
const GITHUB_API = 'https://api.github.com';
const CONTENT_PATH = 'dashboard-content.json';
const DEFAULT_AGENDA_PROJECT_GID = '1213948223325688'; // MirthPlus: Marketing & Content

async function asanaFetch(path, token) {
  const res = await fetch(`${ASANA_BASE}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Asana API error ${res.status}: ${text}`);
  }
  const json = await res.json();
  return json.data;
}

async function getGitHubFile(ghToken) {
  const res = await fetch(`${GITHUB_API}/repos/${REPO}/contents/${CONTENT_PATH}`, {
    headers: {
      Authorization: `token ${ghToken}`,
      Accept: 'application/vnd.github.v3+json',
    },
  });
  if (res.status === 404) {
    return { exists: false, sha: null, content: null };
  }
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`GitHub GET error ${res.status}: ${text}`);
  }
  const data = await res.json();
  const decoded = Buffer.from(data.content, 'base64').toString('utf-8');
  return { exists: true, sha: data.sha, content: decoded };
}

async function putGitHubFile(ghToken, content, sha) {
  const body = {
    message: `[sync] Update dashboard-content.json — ${new Date().toISOString()}`,
    content: Buffer.from(content, 'utf-8').toString('base64'),
  };
  if (sha) {
    body.sha = sha;
  }
  const res = await fetch(`${GITHUB_API}/repos/${REPO}/contents/${CONTENT_PATH}`, {
    method: 'PUT',
    headers: {
      Authorization: `token ${ghToken}`,
      Accept: 'application/vnd.github.v3+json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`GitHub PUT error ${res.status}: ${text}`);
  }
  return await res.json();
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Auth: check sync secret (query param) OR Vercel cron secret (header)
  const { secret } = req.query;
  const authHeader = req.headers['authorization'];
  const cronSecret = process.env.CRON_SECRET;

  const isValidQuerySecret = secret && secret === process.env.SYNC_SECRET;
  const isValidCronSecret = cronSecret && authHeader === `Bearer ${cronSecret}`;

  if (!isValidQuerySecret && !isValidCronSecret) {
    return res.status(401).json({ error: 'Invalid or missing sync secret' });
  }

  const asanaToken = process.env.ASANA_TOKEN;
  const ghToken = process.env.GITHUB_TOKEN;

  if (!asanaToken || !ghToken) {
    return res.status(500).json({ error: 'Missing ASANA_TOKEN or GITHUB_TOKEN' });
  }

  const projectGid = process.env.AGENDA_PROJECT_GID || DEFAULT_AGENDA_PROJECT_GID;

  try {
    // Fetch incomplete tasks from the agenda project
    const tasks = await asanaFetch(
      `/projects/${projectGid}/tasks?opt_fields=name,due_on,assignee.name,completed,notes,projects.name&completed_since=now&limit=100`,
      asanaToken
    );

    const agendaTasks = tasks
      .filter((t) => !t.completed)
      .map((t) => ({
        gid: t.gid,
        name: t.name,
        due_on: t.due_on || null,
        assignee: t.assignee ? t.assignee.name : null,
        notes: t.notes || '',
        projects: (t.projects || []).map((p) => p.name),
      }));

    // Get current file from GitHub
    const existing = await getGitHubFile(ghToken);

    // Parse existing content to preserve non-sync fields
    let existingData = {};
    if (existing.exists && existing.content) {
      try {
        existingData = JSON.parse(existing.content);
      } catch (parseErr) {
        // If parse fails, start fresh
      }
    }

    // Diff: only commit if tasks actually changed
    const existingTasks = JSON.stringify(existingData.agendaTasks || []);
    const newTasks = JSON.stringify(agendaTasks);
    if (existingTasks === newTasks) {
      return res.status(200).json({
        success: true,
        changed: false,
        message: 'No changes detected, skipping commit',
        taskCount: agendaTasks.length,
      });
    }

    // MERGE: preserve all existing fields, only update sync-related ones
    const mergedData = {
      ...existingData,
      agendaTasks,
      syncedAt: new Date().toISOString(),
      source: `asana:project:${projectGid}`,
    };

    const newContent = JSON.stringify(mergedData, null, 2);

    // Commit the merged content
    await putGitHubFile(ghToken, newContent, existing.sha);

    return res.status(200).json({
      success: true,
      changed: true,
      message: 'Dashboard content updated',
      taskCount: agendaTasks.length,
      syncedAt: new Date().toISOString(),
    });
  } catch (err) {
    console.error('Sync error:', err);
    return res.status(500).json({ error: err.message });
  }
}
