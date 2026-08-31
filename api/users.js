// GET  /api/users           — admin: list users
// POST /api/users           — admin: create user  { username, password }
// DELETE /api/users/:name   — admin: delete user  (via ?username=xxx)
const { kv } = require('@vercel/kv');
const { verifyToken, cors } = require('./_lib/auth');

module.exports = async (req, res) => {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  const payload = verifyToken(req);
  if (!payload || payload.role !== 'admin') {
    return res.status(403).json({ error: '无权限' });
  }

  if (req.method === 'GET') {
    const users = await kv.hgetall('users') || {};
    return res.json({ users: Object.keys(users) });
  }

  if (req.method === 'POST') {
    const { username, password } = req.body || {};
    if (!username || !password) return res.status(400).json({ error: '缺少参数' });

    const existing = await kv.hget('users', username);
    if (existing) return res.status(409).json({ error: '用户名已存在' });

    const userCount = Object.keys(await kv.hgetall('users') || {}).length;
    if (userCount >= 10) return res.status(400).json({ error: '用户数已达上限（10人）' });

    await kv.hset('users', { [username]: { password } });
    return res.json({ ok: true });
  }

  if (req.method === 'DELETE') {
    const { username } = req.query || {};
    if (!username) return res.status(400).json({ error: '缺少用户名' });
    await kv.hdel('users', username);
    await kv.hdel('sessions', username);
    return res.json({ ok: true });
  }

  res.status(405).end();
};
