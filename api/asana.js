const ASANA_BASE = 'https://app.asana.com/api/1.0';

const MY_PROJECT_GIDS = [
  '1213948223325688', // MirthPlus: Marketing & Content
  '1213942743399057', // SailPin: Operations & Fulfillment
];

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

  const token = process.env.ASANA_TOKEN;
  if (!token) {
    return res.status(500).json({ error: 'ASANA_TOKEN not configured' });
  }

  try {
    // Fetch all projects with task counts
    const projectDetails = await Promise.all(
      MY_PROJECT_GIDS.map((gid) =>
        asanaFetch(`/projects/${gid}?opt_fields=name,task_counts`, token)
      )
    );

    // Fetch incomplete tasks for each project
    const tasksByProject = await Promise.all(
      MY_PROJECT_GIDS.map((gid) =>
        asanaFetch(
          `/projects/${gid}/tasks?opt_fields=name,due_on,assignee.name,completed,projects.name&completed_since=now&limit=100`,
          token
        )
      )
    );

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayStr = today.toISOString().slice(0, 10);

    const sevenDaysOut = new Date(today);
    sevenDaysOut.setDate(sevenDaysOut.getDate() + 7);
    const sevenDaysStr = sevenDaysOut.toISOString().slice(0, 10);

    const projects = projectDetails.map((p) => {
      const counts = p.task_counts || {};
      return {
        gid: p.gid,
        name: p.name,
        total: (counts.num_completed_tasks || 0) + (counts.num_incomplete_tasks || 0),
        completed: counts.num_completed_tasks || 0,
        incomplete: counts.num_incomplete_tasks || 0,
      };
    });

    // Flatten and deduplicate all incomplete tasks
    const seenGids = new Set();
    const allIncompleteTasks = [];

    for (const tasks of tasksByProject) {
      for (const t of tasks) {
        if (t.completed || seenGids.has(t.gid)) continue;
        seenGids.add(t.gid);
        allIncompleteTasks.push({
          gid: t.gid,
          name: t.name,
          due_on: t.due_on || null,
          assignee: t.assignee ? t.assignee.name : null,
          projects: (t.projects || []).map((p) => p.name),
        });
      }
    }

    const overdueTasks = [];
    const upcomingTasks = [];
    const noDueTasks = [];

    for (const t of allIncompleteTasks) {
      if (!t.due_on) {
        noDueTasks.push(t);
      } else if (t.due_on < todayStr) {
        overdueTasks.push(t);
      } else if (t.due_on <= sevenDaysStr) {
        upcomingTasks.push(t);
      } else {
        upcomingTasks.push(t);
      }
    }

    // Sort overdue by date ascending (most overdue first)
    overdueTasks.sort((a, b) => (a.due_on || '').localeCompare(b.due_on || ''));
    // Sort upcoming by date ascending (soonest first)
    upcomingTasks.sort((a, b) => (a.due_on || '').localeCompare(b.due_on || ''));

    const summary = {
      totalIncomplete: allIncompleteTasks.length,
      totalComplete: projects.reduce((sum, p) => sum + p.completed, 0),
      overdueCount: overdueTasks.length,
      upcomingCount: upcomingTasks.length,
    };

    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=60');
    return res.status(200).json({
      projects,
      overdueTasks,
      upcomingTasks,
      noDueTasks,
      summary,
      fetchedAt: new Date().toISOString(),
    });
  } catch (err) {
    console.error('Asana fetch error:', err);
    return res.status(500).json({ error: err.message });
  }
}
