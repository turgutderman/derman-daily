import { createHash } from 'crypto';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { password } = req.body || {};

  if (!password) {
    return res.status(400).json({ error: 'Password is required' });
  }

  if (password !== process.env.DASHBOARD_PASSWORD) {
    return res.status(401).json({ error: 'Invalid password' });
  }

  const token = createHash('sha256')
    .update(password + (process.env.TOKEN_SALT || 'default-salt'))
    .digest('hex');

  return res.status(200).json({ success: true, token });
}
