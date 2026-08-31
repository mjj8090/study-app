// GET /api/me — validate token and check session is still active
const { kv } = require('@vercel/kv');
const { verifyToken, cors } = require('./_lib/auth');

module.exports = async (req, res) => {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  const payload = verifyToken(req);
  if (!payload) return res.status(401).json({ error: '未登录' });

  // Verify this is the current active session for the user
  const activeSession = await kv.hget('sessions', payload.username);
  if (activeSession !== payload.sessionId) {
    return res.status(401).json({ error: '账号已在其他设备登录' });
  }

  res.json({ username: payload.username, role: payload.role });
};
