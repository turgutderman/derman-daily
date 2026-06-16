const ASANA_BASE = 'https://app.asana.com/api/1.0';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { taskGid, completed } = req.body || {};

  if (!taskGid) {
    return res.status(400).json({ error: 'Missing required field: taskGid' });
  }

  if (typeof completed !== 'boolean') {
    return res.status(400).json({ error: 'Missing or invalid field: completed (must be boolean)' });
  }

  const token = process.env.ASANA_TOKEN;
  if (!token) {
    return res.status(500).json({ error: 'ASANA_TOKEN not configured' });
  }

  try {
    const updateRes = await fetch(`${ASANA_BASE}/tasks/${taskGid}`, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        data: { completed },
      }),
    });

    if (!updateRes.ok) {
      const errText = await updateRes.text();
      throw new Error(`Asana API error ${updateRes.status}: ${errText}`);
    }

    const result = await updateRes.json();
    const task = result.data;

    return res.status(200).json({
      success: true,
      taskGid: task.gid,
      completed: task.completed,
      name: task.name,
    });
  } catch (err) {
    console.error('Agenda complete error:', err);
    return res.status(500).json({ error: err.message });
  }
}
