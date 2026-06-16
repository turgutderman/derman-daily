const ASANA_BASE = 'https://app.asana.com/api/1.0';

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

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { gid } = req.query;
  if (!gid) {
    return res.status(400).json({ error: 'Missing required query parameter: gid' });
  }

  const token = process.env.ASANA_TOKEN;
  if (!token) {
    return res.status(500).json({ error: 'ASANA_TOKEN not configured' });
  }

  try {
    // Fetch subtasks, stories, and attachments in parallel
    const [subtasks, stories, attachments] = await Promise.all([
      asanaFetch(
        `/tasks/${gid}/subtasks?opt_fields=name,completed,due_on,assignee.name`,
        token
      ),
      asanaFetch(
        `/tasks/${gid}/stories?opt_fields=created_at,created_by.name,text,type,resource_subtype`,
        token
      ),
      asanaFetch(
        `/tasks/${gid}/attachments?opt_fields=name,download_url,host,view_url,permanent_url`,
        token
      ),
    ]);

    // Filter stories to only comments
    const comments = stories
      .filter((s) => s.resource_subtype === 'comment_added' || s.type === 'comment')
      .map((s) => ({
        gid: s.gid,
        text: s.text,
        created_at: s.created_at,
        created_by: s.created_by ? s.created_by.name : null,
      }));

    // Map subtasks
    const mappedSubtasks = subtasks.map((s) => ({
      gid: s.gid,
      name: s.name,
      completed: s.completed,
      due_on: s.due_on || null,
      assignee: s.assignee ? s.assignee.name : null,
    }));

    // Map attachments
    const mappedAttachments = attachments.map((a) => ({
      gid: a.gid,
      name: a.name,
      download_url: a.download_url || null,
      view_url: a.view_url || a.permanent_url || null,
      host: a.host || null,
    }));

    res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=30');
    return res.status(200).json({
      success: true,
      gid,
      subtasks: mappedSubtasks,
      comments,
      attachments: mappedAttachments,
      fetchedAt: new Date().toISOString(),
    });
  } catch (err) {
    console.error('Asana task details error:', err);
    return res.status(500).json({ error: err.message });
  }
}
