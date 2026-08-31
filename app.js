// ===== AUTH STATE =====
let authToken = null, authUser = null, authRole = null;

function clearAuth() {
  authToken = authUser = authRole = null;
  localStorage.removeItem('auth_token');
  localStorage.removeItem('auth_user');
  localStorage.removeItem('auth_role');
}

// ===== APP STATE =====
let state = {
  questions: [],
  streak: 0,
  lastStudyDate: null,
  importDate: null,
  planStartId: null,
  dailyNewCount: 5,
  dailyPlans: {}
};

function dbKey() { return 'studyapp_v2_' + (authUser || 'anon'); }

function save() {
  const progress = {};
  state.questions.forEach(q => { progress[qKey(q)] = { status: q.status, reviews: q.reviews, nextReview: q.nextReview }; });
  localStorage.setItem(dbKey(), JSON.stringify({
    streak: state.streak, lastStudyDate: state.lastStudyDate,
    importDate: state.importDate, planStartId: state.planStartId,
    dailyNewCount: state.dailyNewCount, dailyPlans: state.dailyPlans, progress
  }));
}

function load() {
  try {
    const raw = localStorage.getItem(dbKey());
    if (raw) {
      const d = JSON.parse(raw);
      state.streak = d.streak || 0;
      state.lastStudyDate = d.lastStudyDate || null;
      state.importDate = d.importDate || null;
      state.planStartId = d.planStartId || null;
      state.dailyNewCount = d.dailyNewCount || 5;
      state.dailyPlans = d.dailyPlans || {};
      if (d.progress) {
        state.questions.forEach(q => {
          const p = d.progress[qKey(q)];
          if (p) { q.status = p.status; q.reviews = p.reviews; q.nextReview = p.nextReview; }
        });
      }
    }
  } catch(e) {}
  if (!state.planStartId) state.planStartId = null;
  if (!state.dailyNewCount) state.dailyNewCount = 5;
  if (!state.dailyPlans) state.dailyPlans = {};
  updateStreak();
}

// ===== API =====
async function apiFetch(path, opts = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (authToken) headers['Authorization'] = 'Bearer ' + authToken;
  const res = await fetch('/api' + path, { ...opts, headers: { ...headers, ...(opts.headers || {}) } });
  if (res.status === 401) { clearAuth(); renderApp(); throw new Error('401'); }
  return res.json();
}

async function apiLogin(username, password) {
  const res = await fetch('/api/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password })
  });
  return res.json();
}

async function loadQuestionsFromServer() {
  const { subjects } = await apiFetch('/questions');
  if (!subjects || !subjects.length) return;
  state.questions = [];
  for (const { subject } of subjects) {
    const { questions } = await apiFetch('/questions?subject=' + encodeURIComponent(subject));
    if (questions) {
      questions.forEach(q => { q.subject = subject; q.status = 'new'; q.reviews = 0; q.nextReview = null; });
      state.questions.push(...questions);
    }
  }
  load();  // apply stored progress on top of fresh questions
}

// ===== EBBINGHAUS =====
const INTERVALS = [1, 1, 2, 3, 8];

function today() { return new Date().toISOString().slice(0, 10); }

function addDays(dateStr, days) {
  const d = new Date(dateStr + 'T00:00:00');
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function qKey(q) { return q.id + '|||' + (q.subject || ''); }

function isDue(q) { return !q.nextReview || q.nextReview <= today(); }
function getDueQuestions() { return state.questions.filter(isDue); }

function getTodayNewQueue() {
  const startId = state.planStartId || 1;
  return state.questions
    .filter(q => q.status === 'new' && q.id >= startId)
    .sort((a, b) => a.id - b.id)
    .slice(0, state.dailyNewCount || 5);
}

// ===== DAILY PLAN =====
function getTodayPlan() {
  const t = today();
  if (!state.dailyPlans[t]) generateTodayPlan();
  return state.dailyPlans[t];
}

function generateTodayPlan() {
  const t = today();
  const newQs = getTodayNewQueue();
  const dueQs = getDueQuestions().filter(q => q.status !== 'new');
  const newKeys = newQs.map(qKey);
  const dueKeys = dueQs.map(qKey);
  const existing = state.dailyPlans[t];
  state.dailyPlans[t] = { newKeys, dueKeys, doneKeys: existing ? existing.doneKeys : [] };
  save();
  return state.dailyPlans[t];
}

function markQuestionDone(q) {
  const t = today();
  if (!state.dailyPlans[t]) generateTodayPlan();
  const plan = state.dailyPlans[t];
  const k = qKey(q);
  if (!plan.doneKeys.includes(k)) { plan.doneKeys.push(k); save(); }
}

function getPlanStats() {
  const plan = getTodayPlan();
  const total = plan.newKeys.length + plan.dueKeys.length;
  const done = plan.doneKeys.length;
  return { total, done, pct: total > 0 ? Math.round(done / total * 100) : 0 };
}

function getPlanQueue() {
  const plan = getTodayPlan();
  const allKeys = [...plan.newKeys, ...plan.dueKeys];
  const doneSet = new Set(plan.doneKeys);
  return allKeys
    .filter(k => !doneSet.has(k))
    .map(k => {
      const [idStr, subject] = k.split('|||');
      return state.questions.find(q => q.id === parseInt(idStr) && (q.subject || '') === subject);
    })
    .filter(Boolean);
}

// ===== STREAK =====
function updateStreak() {
  if (!state.lastStudyDate) return;
  const t = today();
  if (state.lastStudyDate === t) return;
  if (state.lastStudyDate < addDays(t, -1)) state.streak = 0;
}

function markStudiedToday() {
  const t = today();
  if (state.lastStudyDate === t) return;
  state.streak = state.lastStudyDate === addDays(t, -1) ? (state.streak || 0) + 1 : 1;
  state.lastStudyDate = t;
  save();
}

// ===== PARSE TXT =====
function parseTxt(text) {
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
  const questions = [];
  let i = 0;
  while (i < lines.length) {
    const m = lines[i].match(/^(\d+)[.、。\)）]\s*([\s\S]*)/);
    if (m) {
      const ansLines = [];
      i++;
      while (i < lines.length && !lines[i].match(/^\d+[.、。\)）]/)) {
        ansLines.push(lines[i]);
        i++;
      }
      questions.push({ id: parseInt(m[1]), question: m[2], answer: ansLines.join('\n'), status: 'new', reviews: 0, nextReview: null });
    } else { i++; }
  }
  return questions;
}

function scheduleNext(q, remembered) {
  if (remembered) {
    const step = Math.min((q.reviews || 0), INTERVALS.length - 1);
    q.nextReview = addDays(today(), INTERVALS[step]);
    q.reviews = (q.reviews || 0) + 1;
    q.status = q.reviews >= INTERVALS.length ? 'mastered' : 'learning';
  } else {
    q.nextReview = addDays(today(), 1);
    q.reviews = 0;
    q.status = 'learning';
  }
}

// ===== UI STATE =====
let currentTab = 'home';
let studyQueue = [], studyIdx = 0, studyShown = false, studyStats = { remembered: 0, forgot: 0 };
let studySubjectFilter = 'all', studySetup = true;
let quizFilter = 'all', quizSubject = 'all', quizList = [], quizIdx = 0, quizShown = false;
let previewQuestions = [], selectedImportSubject = '', importLoading = false;
let loginError = '', loginLoading = false;
let newUserName = '', newUserPass = '', usersList = [], usersError = '', usersLoading = false;

// ===== RENDER ENTRY =====
function renderApp() {
  if (!authToken) {
    document.getElementById('app').innerHTML = renderLogin();
    attachLoginEvents();
    return;
  }
  render();
}

// ===== LOGIN PAGE =====
function renderLogin() {
  return `<div style="min-height:100dvh;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:32px 24px;background:var(--bg);">
    <div style="font-size:48px;margin-bottom:16px;">📚</div>
    <div style="font-size:28px;font-weight:700;margin-bottom:6px;">备考助手</div>
    <div style="font-size:15px;color:var(--text2);margin-bottom:36px;">登录以继续</div>
    <div style="width:100%;max-width:340px;">
      <input id="loginUser" type="text" autocomplete="username" placeholder="用户名"
        style="width:100%;font-size:17px;padding:14px 16px;border:1.5px solid var(--gray3);border-radius:12px;background:var(--card);color:var(--text);font-family:inherit;margin-bottom:12px;display:block;">
      <input id="loginPass" type="password" autocomplete="current-password" placeholder="密码"
        style="width:100%;font-size:17px;padding:14px 16px;border:1.5px solid var(--gray3);border-radius:12px;background:var(--card);color:var(--text);font-family:inherit;margin-bottom:16px;display:block;">
      ${loginError ? `<div style="color:var(--red);font-size:14px;margin-bottom:12px;text-align:center;">${esc(loginError)}</div>` : ''}
      <button id="loginBtn" class="btn btn-primary full" ${loginLoading ? 'disabled' : ''}>${loginLoading ? '登录中…' : '登录'}</button>
    </div>
  </div>`;
}

function attachLoginEvents() {
  const btn = document.getElementById('loginBtn');
  const doLogin = async () => {
    const username = document.getElementById('loginUser').value.trim();
    const password = document.getElementById('loginPass').value;
    if (!username || !password) { loginError = '请输入用户名和密码'; renderApp(); return; }
    loginLoading = true; loginError = ''; renderApp();
    try {
      const data = await apiLogin(username, password);
      if (data.token) {
        authToken = data.token; authUser = data.username; authRole = data.role;
        localStorage.setItem('auth_token', authToken);
        localStorage.setItem('auth_user', authUser);
        localStorage.setItem('auth_role', authRole);
        loginLoading = false;
        state = { questions: [], streak: 0, lastStudyDate: null, importDate: null, planStartId: null, dailyNewCount: 5, dailyPlans: {} };
        await loadQuestionsFromServer();
        renderApp();
      } else {
        loginLoading = false;
        loginError = data.error || '登录失败';
        renderApp();
      }
    } catch {
      loginLoading = false; loginError = '网络错误，请重试'; renderApp();
    }
  };
  btn.addEventListener('click', doLogin);
  document.getElementById('loginPass').addEventListener('keydown', e => { if (e.key === 'Enter') doLogin(); });
}

// ===== RENDER =====
function render() {
  document.getElementById('app').innerHTML = renderNav() + renderPage();
  attachEvents();
}

function renderNav() {
  const tabs = [
    { id: 'home',   icon: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M10 20v-6h4v6h5v-8h3L12 3 2 12h3v8z"/></svg>', label: '首页' },
    { id: 'study',  icon: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 3L1 9l4 2.18V17h2v-4.73L12 14l7-3.82V17h2V11.18L23 9 12 3zm0 13.64L5.77 13H6v-1.87l6 3.28 6-3.28V13h.23L12 16.64z"/></svg>', label: '学习' },
    { id: 'quiz',   icon: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M11 18h2v-2h-2v2zm1-16C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8zm0-14c-2.21 0-4 1.79-4 4h2c0-1.1.9-2 2-2s2 .9 2 2c0 2-3 1.75-3 5h2c0-2.25 3-2.5 3-5 0-2.21-1.79-4-4-4z"/></svg>', label: '抽题' },
    { id: 'stats',  icon: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zM9 17H7v-7h2v7zm4 0h-2V7h2v10zm4 0h-2v-4h2v4z"/></svg>', label: '统计' },
  ];
  if (authRole === 'admin') {
    tabs.push({ id: 'import', icon: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M9 16h6v-6h4l-7-7-7 7h4zm-4 2h14v2H5z"/></svg>', label: '导入' });
    tabs.push({ id: 'users',  icon: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5c-1.66 0-3 1.34-3 3s1.34 3 3 3zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5C6.34 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5z"/></svg>', label: '用户' });
  }
  return `<nav class="nav">${tabs.map(t => `<button class="nav-item${currentTab === t.id ? ' active' : ''}" data-tab="${t.id}">${t.icon}<span class="nav-label">${t.label}</span></button>`).join('')}</nav>`;
}

function renderPage() {
  if (currentTab === 'home')   return renderHome();
  if (currentTab === 'study')  return renderStudy();
  if (currentTab === 'quiz')   return renderQuiz();
  if (currentTab === 'stats')  return renderStats();
  if (currentTab === 'import' && authRole === 'admin') return renderImport();
  if (currentTab === 'users'  && authRole === 'admin') return renderUsers();
  return renderHome();
}

function on(id, fn) {
  const el = document.getElementById(id);
  if (el) el.addEventListener('click', fn);
}

// ===== HOME =====
function renderHome() {
  if (!state.questions.length) {
    return `<div class="page">
      <div class="page-header"><div class="page-title">首页</div><button class="setup-btn" id="logoutBtn">退出</button></div>
      <div class="empty-state">
        <div class="icon">📚</div>
        <h2>题库为空</h2>
        <p>管理员尚未导入题目，请稍后再试。</p>
      </div>
    </div>`;
  }
  const { total, done, pct } = getPlanStats();
  const plan = getTodayPlan();
  const isDone = pct === 100 && total > 0;
  const newDone = plan.newKeys.filter(k => plan.doneKeys.includes(k)).length;
  const dueDone = plan.dueKeys.filter(k => plan.doneKeys.includes(k)).length;
  const mastered = state.questions.filter(q => q.status === 'mastered').length;
  const learning = state.questions.filter(q => q.status === 'learning').length;
  const newQ = state.questions.filter(q => q.status === 'new').length;

  const weekDots = Array.from({length:7}).map((_, i) => {
    const d = addDays(today(), -(6-i));
    const p = state.dailyPlans[d];
    const label = new Date(d+'T00:00:00').toLocaleDateString('zh-CN',{weekday:'narrow'});
    if (!p || p.newKeys.length + p.dueKeys.length === 0) return `<div class="week-dot dot-empty"><span>${label}</span></div>`;
    const t2 = p.newKeys.length + p.dueKeys.length;
    const dn = p.doneKeys.length;
    const cls = dn >= t2 ? 'dot-done' : dn > 0 ? 'dot-partial' : 'dot-empty';
    return `<div class="week-dot ${cls}"><span>${label}</span></div>`;
  }).join('');

  return `<div class="page">
    <div class="page-header">
      <div>
        <div class="page-title">首页</div>
        <div class="page-subtitle">${dateStr()}</div>
      </div>
      <button class="setup-btn" id="logoutBtn">${esc(authUser)} 退出</button>
    </div>
    ${state.streak > 1 ? `<div class="streak-badge">🔥 ${state.streak} 天连续打卡</div>` : ''}
    <div class="today-banner${isDone ? ' banner-done' : ''}">
      <div class="banner-top">
        <h2>${isDone ? '今日完成 🎉' : '今日计划'}</h2>
        <span class="plan-pct">${pct}%</span>
      </div>
      <div class="plan-progress-bar"><div class="plan-progress-fill" style="width:${pct}%"></div></div>
      <div class="today-stats">
        <div class="today-stat"><div class="val">${done}</div><div class="lbl">已完成</div></div>
        <div class="today-stat"><div class="val">${total - done}</div><div class="lbl">剩余</div></div>
        <div class="today-stat"><div class="val">${plan.newKeys.length}</div><div class="lbl">新题</div></div>
        <div class="today-stat"><div class="val">${plan.dueKeys.length}</div><div class="lbl">复习</div></div>
      </div>
    </div>
    <div class="px-16">
      <div class="btn-group">
        <button class="btn btn-primary" id="startStudyBtn">开始学习</button>
        <button class="btn btn-secondary" id="regenPlanBtn">重新生成今日计划</button>
      </div>
    </div>
    <div class="plan-row">
      <span>每日新题数</span>
      <input type="number" id="dailyCountInput" min="1" max="50" value="${state.dailyNewCount}">
      <button class="setup-btn" id="saveDailyCount">确认</button>
    </div>
    <div class="plan-row">
      <span>从第</span>
      <input type="number" id="planStartInput" min="1" value="${state.planStartId || 1}">
      <span>题开始</span>
      <button class="setup-btn" id="savePlanStart">确认</button>
    </div>
    ${plan.dueKeys.length > 0 ? `
    <div class="section-label">今日任务明细</div>
    <div class="card">
      <div class="card-row">
        <span class="card-row-label">新学题目</span>
        <span class="card-row-value ${newDone === plan.newKeys.length ? 'green' : 'blue'}">${newDone}/${plan.newKeys.length} 完成</span>
      </div>
      <div class="card-row">
        <span class="card-row-label">待复习题目</span>
        <span class="card-row-value ${dueDone === plan.dueKeys.length ? 'green' : 'blue'}">${dueDone}/${plan.dueKeys.length} 完成</span>
      </div>
    </div>` : ''}
    <div class="section-label">近7日打卡</div>
    <div class="week-track">${weekDots}</div>
    <div class="section-label">学习进度</div>
    <div class="card">
      <div class="card-row"><span class="card-row-label">总题数</span><span class="card-row-value">${state.questions.length}</span></div>
      <div class="card-row"><span class="card-row-label">已掌握</span><span class="card-row-value green">${mastered}</span></div>
      <div class="card-row"><span class="card-row-label">学习中</span><span class="card-row-value blue">${learning}</span></div>
      <div class="card-row"><span class="card-row-label">未开始</span><span class="card-row-value">${newQ}</span></div>
    </div>
  </div>`;
}

// ===== STUDY =====
function renderStudySetup() {
  const subjects = [...new Set(state.questions.map(q => q.subject).filter(Boolean))];
  const chips = ['all', ...subjects].map(s =>
    `<button class="filter-chip${studySubjectFilter === s ? ' active' : ''}" data-study-filter="${s}">${s === 'all' ? '全部' : s}</button>`
  ).join('');
  const queue = getPlanQueue();
  return `<div class="page">
    <div class="page-header"><div class="page-title">学习</div></div>
    <div class="section-label">科目筛选</div>
    <div class="quiz-controls">${chips}</div>
    <div class="section-label">今日待学习（${queue.length} 题）</div>
    <div class="px-16" style="margin-top:8px;">
      <button class="btn btn-primary full" id="startPlanStudy">开始今日计划</button>
    </div>
  </div>`;
}

function renderStudy() {
  if (studySetup) return renderStudySetup();
  if (studyIdx >= studyQueue.length) return renderStudyDone();
  const q = studyQueue[studyIdx];
  const pct = studyIdx / studyQueue.length * 100;
  const tag = q.status === 'new' ? '新题' : q.status === 'mastered' ? '已掌握' : '复习';
  const subjectTag = q.subject ? ` · ${q.subject}` : '';
  return `<div class="page">
    <div class="page-header"><div class="page-title">学习</div><button class="setup-btn" id="backToSetup">筛选</button></div>
    <div class="progress-bar-wrap"><div class="progress-bar-fill" style="width:${pct}%"></div></div>
    <div class="study-counter">${studyIdx + 1} / ${studyQueue.length}</div>
    <div class="study-card">
      <div class="q-num">第 ${q.id} 题 · ${tag}${subjectTag}</div>
      <div class="q-title">${esc(q.question)}</div>
      ${studyShown
        ? `<div class="q-answer">${esc(q.answer).replace(/\n/g, '<br>')}</div>`
        : `<button class="reveal-btn" id="revealBtn">查看答案</button>`}
    </div>
    ${studyShown ? `<div class="btn-group mt-12">
      <button class="btn btn-danger" id="studyForgot">❌ 没掌握</button>
      <button class="btn btn-success" id="studyKnew">✅ 记住了</button>
    </div>` : ''}
  </div>`;
}

function renderStudyDone() {
  return `<div class="page">
    <div class="page-header"><div class="page-title">学习</div></div>
    <div class="session-done">
      <div class="done-icon">🎉</div>
      <h2>本次学习完成！</h2>
      <p>今日计划已全部完成</p>
    </div>
    <div class="done-stats">
      <div class="done-stat"><div class="val green">${studyStats.remembered}</div><div class="lbl">记住了</div></div>
      <div class="done-stat"><div class="val red">${studyStats.forgot}</div><div class="lbl">没掌握</div></div>
    </div>
    <div class="px-16 mt-12"><button class="btn btn-secondary full" id="resetStudy">返回</button></div>
  </div>`;
}

// ===== QUIZ =====
function buildQuizList() {
  let qs = [...state.questions];
  if (quizSubject !== 'all') qs = qs.filter(q => q.subject === quizSubject);
  if (quizFilter === 'mastered') qs = qs.filter(q => q.status === 'mastered');
  else if (quizFilter === 'unmastered') qs = qs.filter(q => q.status !== 'mastered');
  else if (quizFilter === 'new') qs = qs.filter(q => q.status === 'new');
  return shuffle(qs);
}

function renderQuiz() {
  if (!quizList.length) { quizList = buildQuizList(); quizIdx = 0; quizShown = false; }
  const subjects = [...new Set(state.questions.map(q => q.subject).filter(Boolean))];
  const filterChips = ['all','mastered','unmastered','new'].map(f =>
    `<button class="filter-chip${quizFilter === f ? ' active' : ''}" data-filter="${f}">${{all:'全部',mastered:'已掌握',unmastered:'未掌握',new:'新题'}[f]}</button>`
  ).join('');
  const subjectChips = ['all',...subjects].map(s =>
    `<button class="filter-chip${quizSubject === s ? ' active' : ''}" data-quiz-subject="${s}">${s === 'all' ? '全部' : s}</button>`
  ).join('');
  if (!quizList.length) return `<div class="page"><div class="page-header"><div class="page-title">抽题</div></div><div class="quiz-controls">${filterChips}</div><div class="quiz-empty"><div class="icon">📭</div><p>该分类暂无题目</p></div></div>`;
  const q = quizList[quizIdx];
  return `<div class="page">
    <div class="page-header"><div class="page-title">抽题</div></div>
    <div class="quiz-controls">${filterChips}</div>
    <div class="quiz-controls">${subjectChips}</div>
    <div class="quiz-card">
      <div class="q-num">第 ${q.id} 题 · ${q.subject || '未分类'} · ${quizIdx+1}/${quizList.length}</div>
      <div class="q-title">${esc(q.question)}</div>
      ${quizShown ? `<div class="q-answer">${esc(q.answer).replace(/\n/g,'<br>')}</div>` : ''}
    </div>
    <div class="btn-group">
      ${quizShown
        ? `<button class="btn btn-danger full" id="quizForgot">❌ 没掌握</button><button class="btn btn-success full" id="quizKnew">✅ 已掌握</button>`
        : `<button class="btn btn-secondary full" id="quizReveal">查看答案</button><button class="btn btn-outline full" id="quizSkip">换一题</button>`}
    </div>
  </div>`;
}

// ===== STATS =====
function renderStats() {
  const total = state.questions.length;
  const mastered = state.questions.filter(q => q.status === 'mastered').length;
  const learning = state.questions.filter(q => q.status === 'learning').length;
  const newQ = state.questions.filter(q => q.status === 'new').length;
  const pct = total > 0 ? Math.round(mastered / total * 100) : 0;
  const r = 68, circ = 2 * Math.PI * r;
  const dash = circ * pct / 100;
  const subjects = [...new Set(state.questions.map(q => q.subject).filter(Boolean))];
  const subjectRows = subjects.map(s => {
    const qs = state.questions.filter(q => q.subject === s);
    const m = qs.filter(q => q.status === 'mastered').length;
    return `<div class="card-row"><span class="card-row-label">${esc(s)}</span><span class="card-row-value">${m}/${qs.length} 已掌握</span></div>`;
  }).join('');
  const planRows = [];
  for (let i = 0; i < 7; i++) {
    const d = addDays(today(), -i);
    const p = state.dailyPlans[d];
    if (!p) continue;
    const tot = p.newKeys.length + p.dueKeys.length;
    if (tot === 0) continue;
    const dn = p.doneKeys.length;
    const pctDay = Math.round(dn / tot * 100);
    const dateLabel = new Date(d + 'T00:00:00').toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric', weekday: 'short' });
    planRows.push(`<div class="card-row"><span class="card-row-label">${dateLabel}</span><span class="card-row-value ${dn >= tot ? 'green' : dn > 0 ? 'blue' : ''}">${dn}/${tot} (${pctDay}%)</span></div>`);
  }
  return `<div class="page">
    <div class="page-header"><div class="page-title">统计</div></div>
    <div class="donut-wrap">
      <svg width="160" height="160" viewBox="0 0 160 160">
        <circle cx="80" cy="80" r="${r}" fill="none" stroke="var(--gray4)" stroke-width="16"/>
        <circle cx="80" cy="80" r="${r}" fill="none" stroke="var(--blue)" stroke-width="16"
          stroke-dasharray="${dash} ${circ}" stroke-dashoffset="${circ / 4}" stroke-linecap="round"/>
      </svg>
      <div class="donut-label"><div class="donut-pct">${pct}%</div><div class="donut-sub">已掌握</div></div>
    </div>
    <div class="card">
      <div class="card-row"><span class="card-row-label">总题数</span><span class="card-row-value">${total}</span></div>
      <div class="card-row"><span class="card-row-label">已掌握</span><span class="card-row-value green">${mastered}</span></div>
      <div class="card-row"><span class="card-row-label">学习中</span><span class="card-row-value blue">${learning}</span></div>
      <div class="card-row"><span class="card-row-label">未开始</span><span class="card-row-value">${newQ}</span></div>
      ${subjectRows}
    </div>
    ${planRows.length > 0 ? `<div class="section-label">近7日完成情况</div><div class="card">${planRows.join('')}</div>` : ''}
  </div>`;
}

// ===== IMPORT (admin only) =====
function renderImport() {
  const subjects = ['教育学', '心理学', '小三门'];
  const chips = subjects.map(s =>
    `<button class="filter-chip${selectedImportSubject === s ? ' active' : ''}" data-import-subject="${s}">${s}</button>`
  ).join('');
  const canImport = previewQuestions.length > 0 && selectedImportSubject && !importLoading;
  const subjectCounts = subjects.map(s => {
    const n = state.questions.filter(q => q.subject === s).length;
    return n ? `${s}: ${n}题` : '';
  }).filter(Boolean).join(' · ');

  return `<div class="page">
    <div class="page-header"><div class="page-title">导入题库</div></div>
    <div class="import-box">
      <div class="icon">📄</div>
      <h3>选择 TXT 文件</h3>
      <p>格式：<br>1. 什么是教育？<br>答案内容……<br><br>2. 素质教育的内涵？<br>答案内容……</p>
      <input type="file" id="fileInput" accept=".txt">
      <button class="btn btn-primary" id="chooseFile">选择文件</button>
    </div>
    ${previewQuestions.length > 0 ? `
    <div class="import-preview">
      <h4>预览（共 ${previewQuestions.length} 题）</h4>
      ${previewQuestions.slice(0, 5).map(q => `<div class="preview-item">${q.id}. ${esc(q.question.slice(0, 50))}${q.question.length > 50 ? '…' : ''}</div>`).join('')}
      ${previewQuestions.length > 5 ? `<div class="preview-item">…… 还有 ${previewQuestions.length - 5} 题</div>` : ''}
    </div>
    <div class="section-label">选择科目</div>
    <div class="quiz-controls" style="margin-bottom:12px">${chips}</div>
    ${selectedImportSubject
      ? `<div class="import-warn" style="background:rgba(0,122,255,0.08);color:var(--blue)">将上传为「${selectedImportSubject}」，同科目旧题将被替换</div>`
      : `<div class="import-warn">⚠️ 请先选择科目</div>`}
    <div class="px-16 mt-12">
      <button class="btn btn-primary full" id="confirmImport" ${canImport ? '' : 'disabled style="opacity:.5"'}>
        ${importLoading ? '上传中…' : `确认导入 ${previewQuestions.length} 题${selectedImportSubject ? '（' + selectedImportSubject + '）' : ''}`}
      </button>
    </div>` : ''}
    ${state.questions.length > 0 ? `
    <div class="section-label">当前服务器题库</div>
    <div class="card">
      <div class="card-row"><span class="card-row-label">总题数</span><span class="card-row-value">${state.questions.length}</span></div>
      ${subjectCounts ? `<div class="card-row"><span class="card-row-label">各科</span><span class="card-row-value" style="font-size:14px">${subjectCounts}</span></div>` : ''}
    </div>` : ''}
  </div>`;
}

// ===== USERS (admin only) =====
function renderUsers() {
  const rows = usersList.map(u => `
    <div class="card-row">
      <span class="card-row-label">${esc(u)}</span>
      <button class="setup-btn" style="color:var(--red)" data-delete-user="${esc(u)}">删除</button>
    </div>`).join('');
  return `<div class="page">
    <div class="page-header"><div class="page-title">用户管理</div><button class="btn-outline btn-sm" id="refreshUsers">刷新</button></div>
    <div class="section-label">当前用户（${usersList.length}/10）</div>
    ${usersList.length > 0 ? `<div class="card">${rows}</div>` : `<div style="padding:20px;color:var(--text2);text-align:center;">暂无普通用户</div>`}
    ${usersError ? `<div class="import-warn">${esc(usersError)}</div>` : ''}
    <div class="section-label">新增用户</div>
    <div class="plan-row">
      <span>用户名</span>
      <input id="newUserName" style="flex:1;font-size:16px;padding:6px 10px;border:1.5px solid var(--gray3);border-radius:8px;background:var(--bg);color:var(--text);" value="${esc(newUserName)}" placeholder="例如：小明">
    </div>
    <div class="plan-row">
      <span>密码</span>
      <input id="newUserPass" type="password" style="flex:1;font-size:16px;padding:6px 10px;border:1.5px solid var(--gray3);border-radius:8px;background:var(--bg);color:var(--text);" value="${esc(newUserPass)}" placeholder="至少4位">
    </div>
    <div class="px-16 mt-12">
      <button class="btn btn-primary full" id="createUserBtn" ${usersLoading ? 'disabled' : ''}>${usersLoading ? '创建中…' : '创建用户'}</button>
    </div>
  </div>`;
}

// ===== EVENTS =====
function attachEvents() {
  // Tab navigation
  document.querySelectorAll('[data-tab]').forEach(el => el.addEventListener('click', () => {
    currentTab = el.dataset.tab;
    if (currentTab === 'study') { studyQueue = []; studyIdx = 0; studyShown = false; studyStats = { remembered: 0, forgot: 0 }; studySetup = true; }
    if (currentTab === 'quiz')  { quizList = []; quizIdx = 0; quizShown = false; }
    if (currentTab === 'users') { loadUsersList(); }
    render();
  }));

  // Logout
  on('logoutBtn', () => { clearAuth(); state = { questions:[], streak:0, lastStudyDate:null, importDate:null, planStartId:null, dailyNewCount:5, dailyPlans:{} }; renderApp(); });

  // Home buttons
  on('startStudyBtn', () => { currentTab = 'study'; studySetup = true; studyQueue = []; render(); });
  on('regenPlanBtn', () => { generateTodayPlan(); showToast('计划已重新生成'); render(); });
  on('saveDailyCount', () => {
    const v = parseInt(document.getElementById('dailyCountInput')?.value || 5);
    state.dailyNewCount = v >= 1 && v <= 50 ? v : 5;
    save(); showToast('已保存'); render();
  });
  on('savePlanStart', () => {
    const v = parseInt(document.getElementById('planStartInput')?.value);
    state.planStartId = v >= 1 ? v : null;
    save(); showToast('已保存'); render();
  });

  // Study setup
  document.querySelectorAll('[data-study-filter]').forEach(el => el.addEventListener('click', () => {
    studySubjectFilter = el.dataset.studyFilter; render();
  }));
  on('startPlanStudy', () => {
    studyQueue = getPlanQueue();
    if (studySubjectFilter !== 'all') studyQueue = studyQueue.filter(q => q.subject === studySubjectFilter);
    studyIdx = 0; studyShown = false; studyStats = { remembered: 0, forgot: 0 };
    if (!studyQueue.length) { showToast('今日计划已完成 🎉'); return; }
    studySetup = false; render();
  });

  // Study card
  on('backToSetup', () => { studySetup = true; studyQueue = []; render(); });
  on('revealBtn',   () => { studyShown = true; render(); });
  on('studyForgot', () => {
    const q = studyQueue[studyIdx];
    markQuestionDone(q); scheduleNext(q, false);
    studyStats.forgot++; save(); studyIdx++; studyShown = false; render();
  });
  on('studyKnew', () => {
    const q = studyQueue[studyIdx];
    markQuestionDone(q); scheduleNext(q, true);
    studyStats.remembered++; save(); studyIdx++; studyShown = false; render();
    if (studyIdx === studyQueue.length) markStudiedToday();
  });
  on('resetStudy', () => { studySetup = true; studyQueue = []; render(); });

  // Quiz
  document.querySelectorAll('[data-filter]').forEach(el => el.addEventListener('click', () => {
    quizFilter = el.dataset.filter; quizList = []; quizIdx = 0; quizShown = false; render();
  }));
  document.querySelectorAll('[data-quiz-subject]').forEach(el => el.addEventListener('click', () => {
    quizSubject = el.dataset.quizSubject; quizList = []; quizIdx = 0; quizShown = false; render();
  }));
  on('quizReveal', () => { quizShown = true; render(); });
  on('quizSkip',   () => { quizIdx = (quizIdx + 1) % quizList.length; quizShown = false; render(); });
  on('quizForgot', () => {
    const q = state.questions.find(x => x.id === quizList[quizIdx].id && x.subject === quizList[quizIdx].subject);
    if (q) { q.status = 'learning'; q.reviews = 0; if (!q.nextReview) q.nextReview = addDays(today(), 1); save(); }
    showToast('已标记为未掌握'); quizIdx++; quizShown = false;
    if (quizIdx >= quizList.length) quizList = [];
    render();
  });
  on('quizKnew', () => {
    const q = state.questions.find(x => x.id === quizList[quizIdx].id && x.subject === quizList[quizIdx].subject);
    if (q) { q.status = 'mastered'; q.reviews = INTERVALS.length; q.nextReview = addDays(today(), 90); save(); }
    showToast('已掌握 ✅'); quizIdx++; quizShown = false;
    if (quizIdx >= quizList.length) quizList = [];
    render();
  });

  // Import (admin)
  document.querySelectorAll('[data-import-subject]').forEach(el => el.addEventListener('click', () => {
    selectedImportSubject = el.dataset.importSubject; render();
  }));
  const fileInput = document.getElementById('fileInput');
  on('chooseFile', () => fileInput && fileInput.click());
  if (fileInput) fileInput.addEventListener('change', e => {
    const file = e.target.files[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => { previewQuestions = parseTxt(ev.target.result); render(); };
    reader.readAsText(file, 'UTF-8');
  });
  on('confirmImport', async () => {
    if (!selectedImportSubject || !previewQuestions.length) return;
    importLoading = true; render();
    try {
      const qs = previewQuestions.map(q => ({ id: q.id, question: q.question, answer: q.answer }));
      const result = await apiFetch('/questions', { method: 'POST', body: JSON.stringify({ subject: selectedImportSubject, questions: qs }) });
      if (result.ok) {
        showToast(`成功上传 ${result.count} 题（${selectedImportSubject}）`);
        previewQuestions = []; selectedImportSubject = '';
        await loadQuestionsFromServer();
      } else {
        showToast('上传失败：' + (result.error || '未知错误'));
      }
    } catch { showToast('网络错误，请重试'); }
    importLoading = false; render();
  });

  // Users (admin)
  on('refreshUsers', () => loadUsersList());
  on('createUserBtn', async () => {
    const nameEl = document.getElementById('newUserName');
    const passEl = document.getElementById('newUserPass');
    const name = nameEl?.value.trim();
    const pass = passEl?.value;
    if (!name || !pass) { usersError = '用户名和密码不能为空'; render(); return; }
    if (pass.length < 4) { usersError = '密码至少4位'; render(); return; }
    usersLoading = true; usersError = ''; render();
    try {
      const r = await apiFetch('/users', { method: 'POST', body: JSON.stringify({ username: name, password: pass }) });
      if (r.ok) { newUserName = ''; newUserPass = ''; showToast('用户已创建'); await loadUsersList(); }
      else { usersError = r.error || '创建失败'; }
    } catch { usersError = '网络错误'; }
    usersLoading = false; render();
  });
  document.querySelectorAll('[data-delete-user]').forEach(el => {
    el.addEventListener('click', async () => {
      const name = el.dataset.deleteUser;
      if (!confirm(`确定删除用户「${name}」？`)) return;
      try {
        await apiFetch('/users?username=' + encodeURIComponent(name), { method: 'DELETE' });
        showToast('已删除用户 ' + name); loadUsersList();
      } catch { showToast('删除失败'); }
    });
  });
}

async function loadUsersList() {
  try {
    const r = await apiFetch('/users');
    if (r.users) { usersList = r.users; render(); }
  } catch {}
}

// ===== UTILS =====
function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [arr[i], arr[j]] = [arr[j], arr[i]]; }
  return arr;
}

function esc(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function showToast(msg) {
  let t = document.querySelector('.toast');
  if (!t) { t = document.createElement('div'); t.className = 'toast'; document.body.appendChild(t); }
  t.textContent = msg; t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 2200);
}

function dateStr() {
  return new Date().toLocaleDateString('zh-CN', { month: 'long', day: 'numeric', weekday: 'long' });
}

// ===== SERVICE WORKER =====
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => {}));
}

// ===== INIT =====
async function initApp() {
  // Restore auth from localStorage
  const storedToken = localStorage.getItem('auth_token');
  const storedUser  = localStorage.getItem('auth_user');
  const storedRole  = localStorage.getItem('auth_role');

  if (storedToken && storedUser) {
    authToken = storedToken;
    authUser  = storedUser;
    authRole  = storedRole;

    try {
      // Verify token is still valid (and not kicked by single-session rule)
      const me = await apiFetch('/me');
      if (me.username) {
        authRole = me.role;
        localStorage.setItem('auth_role', authRole);
        await loadQuestionsFromServer();
        renderApp();
        return;
      }
    } catch {}
    // Token invalid, clear and show login
    clearAuth();
  }
  renderApp();
}

initApp();
