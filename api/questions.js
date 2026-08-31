// GET  /api/questions             — list subjects with counts
// GET  /api/questions?subject=xxx — fetch full questions for a subject
// POST /api/questions             — admin: save questions { subject, questions[] }
const { getRedis, verifyToken, cors } = require('./_lib/auth');

async function checkSession(req, res) {
  const payload = verifyToken(req);
  if (!payload) { res.status(401).json({ error: '未登录' }); return null; }
  const kv = getRedis();
  const activeSession = await kv.hget('sessions', payload.username);
  if (activeSession !== payload.sessionId) { res.status(401).json({ error: '账号已在其他设备登录' }); return null; }
  return payload;
}

module.exports = async (req, res) => {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  const payload = await checkSession(req, res);
  if (!payload) return;

  const kv = getRedis();

  if (req.method === 'GET') {
    const subject = req.query?.subject;
    if (subject) {
      const data = await kv.get('questions:' + subject) || [];
      return res.json({ questions: data });
    }
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
    const subjects = await kv.get('subjects') || [];
    if (!subjects.includes(subject)) {
      subjects.push(subject);
      await kv.set('subjects', subjects);
    }
    return res.json({ ok: true, count: questions.length });
  }

  res.status(405).end();
};
