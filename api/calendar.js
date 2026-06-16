export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const refreshToken = process.env.GOOGLE_REFRESH_TOKEN;

  if (!clientId || !clientSecret || !refreshToken) {
    return res.status(500).json({ error: 'Google OAuth credentials not configured' });
  }

  try {
    // Step 1: Exchange refresh token for access token
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: refreshToken,
      }),
    });

    if (!tokenRes.ok) {
      const errText = await tokenRes.text();
      throw new Error(`Token refresh failed ${tokenRes.status}: ${errText}`);
    }

    const tokenData = await tokenRes.json();
    const accessToken = tokenData.access_token;

    // Step 2: Build time range for today (UTC)
    const now = new Date();
    const todayStart = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0));
    const tomorrowStart = new Date(todayStart);
    tomorrowStart.setUTCDate(tomorrowStart.getUTCDate() + 1);

    const params = new URLSearchParams({
      timeMin: todayStart.toISOString(),
      timeMax: tomorrowStart.toISOString(),
      singleEvents: 'true',
      orderBy: 'startTime',
    });

    const calRes = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/primary/events?${params}`,
      {
        headers: { Authorization: `Bearer ${accessToken}` },
      }
    );

    if (!calRes.ok) {
      const errText = await calRes.text();
      throw new Error(`Calendar API error ${calRes.status}: ${errText}`);
    }

    const calData = await calRes.json();

    // Step 3: Map events
    const events = (calData.items || []).map((evt) => ({
      summary: evt.summary || '(No title)',
      start: { dateTime: evt.start?.dateTime || evt.start?.date || null },
      end: { dateTime: evt.end?.dateTime || evt.end?.date || null },
      location: evt.location || null,
      htmlLink: evt.htmlLink || null,
      attendees: (evt.attendees || []).map((a) => ({
        email: a.email,
        responseStatus: a.responseStatus,
      })),
    }));

    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=60');
    return res.status(200).json({
      events,
      fetchedAt: new Date().toISOString(),
    });
  } catch (err) {
    console.error('Calendar fetch error:', err);
    return res.status(500).json({ error: err.message });
  }
}
