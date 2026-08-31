// GET /api/questions?subject=xxx  — fetch questions for logged-in users
// POST /api/questions  { subject, questions[] }  — admin only: save questions
const { kv } = require('@vercel/kv');
const { verifyToken, cors } = require('./_lib/auth');

module.exports = async (req, res) => {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  const payload = verifyToken(req);
  if (!payload) return res.status(401).json({ error: '未登录' });

  // Verify active session
  const activeSession = await kv.hget('sessions', payload.username);
  if (activeSession !== payload.sessionId) {
    return res.status(401).json({ error: '账号已在其他设备登录' });
  }

  if (req.method === 'GET') {
    // Return list of subjects and their question counts (not the questions themselves for listing)
    // If ?subject=xxx is specified, return full questions for that subject
    const { subject } = req.query || {};
    if (subject) {
      const data = await kv.get('questions:' + subject);
      return res.json({ questions: data || [] });
    }
    // Return subject list with counts
    const subjects = await kv.get('subjects') || [];
    const result = [];
    for (const s of subjects) {
      const qs = await kv.get('questions:' + s) || [];
      result.push({ subject: s, count: qs.length });
    }
    return res.json({ subjects: result });
  }

  if (req.method === 'POST') {
    if (payload.role !== 'admin') return res.status(403).json({ error: '无权限' });
    const { subject, questions } = req.body || {};
    if (!subject || !Array.isArray(questions)) return res.status(400).json({ error: '参数错误' });

    await kv.set('questions:' + subject, questions);

    // Update subject list
    const subjects = await kv.get('subjects') || [];
    if (!subjects.includes(subject)) {
      subjects.push(subject);
      await kv.set('subjects', subjects);
    }
    return res.json({ ok: true, count: questions.length });
  }

  res.status(405).end();
};
