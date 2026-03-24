import { Router } from 'express';

const router = Router();

// GET /api/gmail/auth-url
router.get('/auth-url', (req, res) => {
  const origin = req.query.origin || '';
  const state = Buffer.from(origin).toString('base64');

  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID,
    redirect_uri: process.env.GOOGLE_REDIRECT_URI,
    response_type: 'code',
    scope: 'https://www.googleapis.com/auth/gmail.send https://www.googleapis.com/auth/userinfo.email',
    access_type: 'offline',
    prompt: 'consent',
    state,
  });

  const url = `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
  res.json({ url });
});

// GET /api/gmail/callback
router.get('/callback', async (req, res) => {
  const { code, state } = req.query;
  let origin = '';
  try {
    origin = Buffer.from(state || '', 'base64').toString('utf8');
  } catch {
    origin = '';
  }

  if (!origin) {
    return res.status(400).send('Missing state');
  }

  try {
    // Exchange code for tokens
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: process.env.GOOGLE_CLIENT_ID,
        client_secret: process.env.GOOGLE_CLIENT_SECRET,
        redirect_uri: process.env.GOOGLE_REDIRECT_URI,
        grant_type: 'authorization_code',
      }),
    });

    const tokenData = await tokenRes.json();
    if (!tokenData.access_token) {
      return res.redirect(`${origin}#gmail_error=true`);
    }

    const { access_token, refresh_token } = tokenData;

    // Get user email
    const userRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: { Authorization: `Bearer ${access_token}` },
    });
    const userData = await userRes.json();
    const email = userData.email || '';

    return res.redirect(
      `${origin}#gmail_access=${encodeURIComponent(access_token)}&gmail_refresh=${encodeURIComponent(refresh_token)}&gmail_email=${encodeURIComponent(email)}`
    );
  } catch (err) {
    console.error('Gmail callback error:', err);
    return res.redirect(`${origin}#gmail_error=true`);
  }
});

// POST /api/gmail/send
router.post('/send', async (req, res) => {
  const { accessToken, refreshToken, to, subject, htmlBody, fromEmail } = req.body;

  if (!accessToken || !to || !subject || !htmlBody) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  const sendWithToken = async (token) => {
    const rawEmail = [
      `From: ${fromEmail || token}`,
      `To: ${to}`,
      `Subject: ${subject}`,
      'MIME-Version: 1.0',
      'Content-Type: text/html; charset=utf-8',
      '',
      htmlBody,
    ].join('\r\n');

    const encoded = Buffer.from(rawEmail)
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');

    const gmailRes = await fetch('https://www.googleapis.com/gmail/v1/users/me/messages/send', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ raw: encoded }),
    });

    return gmailRes;
  };

  let gmailRes = await sendWithToken(accessToken);

  if (gmailRes.status === 401 && refreshToken) {
    // Try refreshing the token
    try {
      const refreshRes = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: process.env.GOOGLE_CLIENT_ID,
          client_secret: process.env.GOOGLE_CLIENT_SECRET,
          refresh_token: refreshToken,
          grant_type: 'refresh_token',
        }),
      });
      const refreshData = await refreshRes.json();
      if (refreshData.access_token) {
        gmailRes = await sendWithToken(refreshData.access_token);
      }
    } catch (err) {
      console.error('Token refresh error:', err);
      return res.status(401).json({ error: 'Token refresh failed' });
    }
  }

  if (!gmailRes.ok) {
    const errData = await gmailRes.json().catch(() => ({}));
    return res.status(gmailRes.status).json({ error: errData?.error?.message || 'Failed to send email' });
  }

  const data = await gmailRes.json();
  return res.json({ success: true, messageId: data.id });
});

// POST /api/gmail/refresh
router.post('/refresh', async (req, res) => {
  const { refreshToken } = req.body;
  if (!refreshToken) {
    return res.status(400).json({ error: 'Missing refreshToken' });
  }

  try {
    const refreshRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: process.env.GOOGLE_CLIENT_ID,
        client_secret: process.env.GOOGLE_CLIENT_SECRET,
        refresh_token: refreshToken,
        grant_type: 'refresh_token',
      }),
    });

    const data = await refreshRes.json();
    if (!data.access_token) {
      return res.status(401).json({ error: 'Failed to refresh token' });
    }

    return res.json({ access_token: data.access_token, expires_in: data.expires_in });
  } catch (err) {
    console.error('Refresh error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
