// POST /api/login  { username, password }
// Returns JWT token on success
const { kv } = require('@vercel/kv');
const jwt = require('jsonwebtoken');
const { cors, JWT_SECRET, ADMIN_USER, ADMIN_PASS } = require('./_lib/auth');

module.exports = async (req, res) => {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();

  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: '缺少用户名或密码' });

  let role = null;

  // Check admin credentials (stored in env vars)
  if (username === ADMIN_USER && password === ADMIN_PASS) {
    role = 'admin';
  } else {
    // Check regular user in KV store
    const stored = await kv.hget('users', username);
    if (!stored || stored.password !== password) {
      return res.status(401).json({ error: '用户名或密码错误' });
    }
    role = 'user';
  }

  // Single session: store active token id per user, invalidate old sessions
  const sessionId = Date.now().toString(36) + Math.random().toString(36).slice(2);
  await kv.hset('sessions', { [username]: sessionId });

  const token = jwt.sign({ username, role, sessionId }, JWT_SECRET, { expiresIn: '30d' });
  res.json({ token, username, role });
};
