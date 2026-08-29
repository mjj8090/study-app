// ===== STATE =====
const DB_KEY = 'studyapp_v2';
let state = {
  questions: [],
  streak: 0,
  lastStudyDate: null,
  importDate: null,
  planStartId: null,
  dailyNewCount: 5,
  dailyPlans: {}   // { 'YYYY-MM-DD': { newKeys, dueKeys, doneKeys } }
};

function save() { localStorage.setItem(DB_KEY, JSON.stringify(state)); }

function load() {
  try {
    // migrate v1 -> v2
    const old = localStorage.getItem('studyapp_v1');
    const cur = localStorage.getItem(DB_KEY);
    if (!cur && old) {
      const v1 = JSON.parse(old);
      state = { ...state, ...v1, dailyPlans: {} };
      save();
    } else if (cur) {
      state = JSON.parse(cur);
    }
  } catch(e) {}
  if (!state.planStartId) state.planStartId = null;
  if (!state.dailyNewCount) state.dailyNewCount = 5;
  if (!state.dailyPlans) state.dailyPlans = {};
  updateStreak();
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
  if (!state.dailyPlans[t]) {
    generateTodayPlan();
  }
  return state.dailyPlans[t];
}

function generateTodayPlan() {
  const t = today();
  const newQs = getTodayNewQueue();
  const dueQs = getDueQuestions().filter(q => q.status !== 'new');
  const newKeys = newQs.map(qKey);
  const dueKeys = dueQs.map(qKey);
  const existing = state.dailyPlans[t];
  // preserve doneKeys if regenerating
  state.dailyPlans[t] = {
    newKeys,
    dueKeys,
    doneKeys: existing ? existing.doneKeys : []
  };
  save();
  return state.dailyPlans[t];
}

function markQuestionDone(q) {
  const t = today();
  if (!state.dailyPlans[t]) generateTodayPlan();
  const plan = state.dailyPlans[t];
  const k = qKey(q);
  if (!plan.doneKeys.includes(k)) {
    plan.doneKeys.push(k);
    save();
  }
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

// ===== UI STATE =====
let currentTab = 'home';
let studyQueue = [], studyIdx = 0, studyShown = false, studyStats = { remembered: 0, forgot: 0 };
let studySubjectFilter = 'all', studySetup = true;
let quizFilter = 'all', quizSubject = 'all', quizList = [], quizIdx = 0, quizShown = false;
let previewQuestions = [], selectedImportSubject = '';
let clearConfirmPending = false;

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
    { id: 'import', icon: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M9 16h6v-6h4l-7-7-7 7h4zm-4 2h14v2H5z"/></svg>', label: '导入' },
  ];
  return `<nav class="nav">${tabs.map(t => `<button class="nav-item${currentTab === t.id ? ' active' : ''}" data-tab="${t.id}">${t.icon}<span class="nav-label">${t.label}</span></button>`).join('')}</nav>`;
}

function renderPage() {
  if (currentTab === 'home')   return renderHome();
  if (currentTab === 'study')  return renderStudy();
  if (currentTab === 'quiz')   return renderQuiz();
  if (currentTab === 'stats')  return renderStats();
  if (currentTab === 'import') return renderImport();
  return '';
}

// ===== HOME =====
function renderHome() {
  const total = state.questions.length;
  const mastered = state.questions.filter(q => q.status === 'mastered').length;
  const learning = state.questions.filter(q => q.status === 'learning').length;
  const newQ = state.questions.filter(q => q.status === 'new').length;
  const streak = state.streak || 0;

  if (total === 0) return `<div class="page">
    <div class="page-header"><div class="page-title">备考助手</div><div class="page-subtitle">${dateStr()}</div></div>
    <div class="empty-state"><div class="icon">📚</div><h2>还没有题目</h2><p>去「导入」页面上传 TXT 题库文件，开始备考吧！</p><button class="btn btn-primary" data-tab="import">去导入题库</button></div>
  </div>`;

  const plan = getTodayPlan();
  const stats = getPlanStats();
  const remaining = getPlanQueue().length;
  const isAllDone = stats.total > 0 && stats.done >= stats.total;

  // 近7日打卡
  const last7 = [];
  for (let i = 6; i >= 0; i--) {
    const d = addDays(today(), -i);
    const p = state.dailyPlans[d];
    const isDone = p && (p.newKeys.length + p.dueKeys.length) > 0 && p.doneKeys.length >= (p.newKeys.length + p.dueKeys.length);
    const hasTask = p && (p.newKeys.length + p.dueKeys.length) > 0;
    last7.push({ d, isDone, hasTask });
  }
  const weekDots = last7.map(({ d, isDone, hasTask }) => {
    const label = new Date(d + 'T00:00:00').getDate();
    const cls = isDone ? 'dot-done' : hasTask ? 'dot-partial' : 'dot-empty';
    return `<div class="week-dot ${cls}"><span>${label}</span></div>`;
  }).join('');

  return `<div class="page">
    <div class="page-header"><div class="page-title">备考助手</div><div class="page-subtitle">${dateStr()}</div></div>
    ${streak > 0 ? `<div class="streak-badge">🔥 连续学习 ${streak} 天</div>` : ''}
    <div class="today-banner ${isAllDone ? 'banner-done' : ''}">
      <div class="banner-top">
        <h2>${isAllDone ? '今日计划已完成 🎉' : '今日学习计划'}</h2>
        <span class="plan-pct">${stats.pct}%</span>
      </div>
      <div class="plan-progress-bar"><div class="plan-progress-fill" style="width:${stats.pct}%"></div></div>
      <div class="today-stats">
        <div class="today-stat"><div class="val">${plan.newKeys.length}</div><div class="lbl">新题</div></div>
        <div class="today-stat"><div class="val">${plan.dueKeys.length}</div><div class="lbl">复习</div></div>
        <div class="today-stat"><div class="val">${stats.done}</div><div class="lbl">已完成</div></div>
        <div class="today-stat"><div class="val">${remaining}</div><div class="lbl">剩余</div></div>
      </div>
    </div>
    <div class="btn-group mt-12">
      <button class="btn btn-primary" id="startStudy" ${remaining === 0 ? 'disabled style="opacity:.5"' : ''}>
        <svg viewBox="0 0 24 24" fill="currentColor" style="width:18px;height:18px"><path d="M18 2H6c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zM6 4h5v8l-2.5-1.5L6 12V4z"/></svg>
        ${remaining > 0 ? `继续学习 (${remaining})` : '今日已完成'}
      </button>
      <button class="btn btn-secondary" data-tab="quiz">
        <svg viewBox="0 0 24 24" fill="currentColor" style="width:18px;height:18px"><path d="M11 18h2v-2h-2v2zm1-16C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8zm0-14c-2.21 0-4 1.79-4 4h2c0-1.1.9-2 2-2s2 .9 2 2c0 2-3 1.75-3 5h2c0-2.25 3-2.5 3-5 0-2.21-1.79-4-4-4z"/></svg>
        随机抽题
      </button>
    </div>
    ${plan.newKeys.length > 0 ? (() => {
      const newQs = plan.newKeys.map(k => { const [idStr, subj] = k.split('|||'); return state.questions.find(q => q.id === parseInt(idStr) && (q.subject||'') === subj); }).filter(Boolean);
      const doneSet = new Set(plan.doneKeys);
      const newDone = plan.newKeys.filter(k => doneSet.has(k)).length;
      return `<div class="section-label">今日新题</div>
      <div class="card">
        <div class="card-row">
          <span class="card-row-label">第 ${newQs[0].id}～${newQs[newQs.length-1].id} 题</span>
          <span class="card-row-value ${newDone === plan.newKeys.length ? 'green' : 'blue'}">${newDone}/${plan.newKeys.length} 完成</span>
        </div>
      </div>`;
    })() : ''}
    ${plan.dueKeys.length > 0 ? (() => {
      const doneSet = new Set(plan.doneKeys);
      const dueDone = plan.dueKeys.filter(k => doneSet.has(k)).length;
      return `<div class="section-label">今日复习</div>
      <div class="card">
        <div class="card-row">
          <span class="card-row-label">待复习题目</span>
          <span class="card-row-value ${dueDone === plan.dueKeys.length ? 'green' : 'blue'}">${dueDone}/${plan.dueKeys.length} 完成</span>
        </div>
      </div>`;
    })() : ''}
    <div class="section-label">近7日打卡</div>
    <div class="week-track">${weekDots}</div>
    <div class="section-label">学习进度</div>
    <div class="card">
      <div class="card-row"><span class="card-row-label">总题数</span><span class="card-row-value">${total}</span></div>
      <div class="card-row"><span class="card-row-label">已掌握</span><span class="card-row-value green">${mastered}</span></div>
      <div class="card-row"><span class="card-row-label">学习中</span><span class="card-row-value blue">${learning}</span></div>
      <div class="card-row"><span class="card-row-label">未开始</span><span class="card-row-value">${newQ}</span></div>
    </div>
  </div>`;
}

// ===== STUDY =====
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
    ${studyShown ? `
    <div class="section-label">你还记得吗？</div>
    <div class="btn-group">
      <button class="btn btn-danger full" id="forgotBtn">❌ 没记住</button>
      <button class="btn btn-success full" id="knewBtn">✅ 记住了</button>
    </div>` : ''}
  </div>`;
}

function renderStudySetup() {
  const subjects = ['all', '教育学', '心理学', '小三门'];
  const subjectChips = subjects.map(s =>
    `<button class="filter-chip${studySubjectFilter === s ? ' active' : ''}" data-study-subject="${s}">${s === 'all' ? '全部科目' : s}</button>`
  ).join('');

  const plan = getTodayPlan();
  const stats = getPlanStats();
  const newQs = plan.newKeys.map(k => {
    const [idStr, subj] = k.split('|||');
    return state.questions.find(q => q.id === parseInt(idStr) && (q.subject||'') === subj);
  }).filter(Boolean);
  const firstNew = newQs.length > 0 ? newQs[0].id : '-';
  const lastNew  = newQs.length > 0 ? newQs[newQs.length-1].id : '-';
  const remaining = getPlanQueue().length;

  return `<div class="page">
    <div class="page-header"><div class="page-title">学习</div></div>

    <div class="section-label">今日计划概览</div>
    <div class="card">
      <div class="card-row"><span class="card-row-label">日期</span><span class="card-row-value">${today()}</span></div>
      <div class="card-row"><span class="card-row-label">今日新题</span><span class="card-row-value blue">${newQs.length > 0 ? `第 ${firstNew}～${lastNew} 题（共 ${plan.newKeys.length} 道）` : '无'}</span></div>
      <div class="card-row"><span class="card-row-label">今日复习</span><span class="card-row-value blue">${plan.dueKeys.length} 道</span></div>
      <div class="card-row"><span class="card-row-label">已完成</span><span class="card-row-value green">${stats.done} / ${stats.total}</span></div>
    </div>

    <div class="section-label">调整计划设置</div>
    <div class="plan-row">
      <span>每天背</span>
      <input type="number" id="dailyNewInput" value="${state.dailyNewCount || 5}" min="1" max="50" inputmode="numeric">
      <span>道新题</span>
    </div>
    <div class="plan-row">
      <span>从第</span>
      <input type="number" id="planStartInput" value="${state.planStartId || ''}" placeholder="1" min="1" inputmode="numeric">
      <span>题开始（留空=全部）</span>
    </div>
    <div class="px-16" style="margin-bottom:8px">
      <button class="btn btn-secondary full" id="regenPlan">重新生成今日计划</button>
    </div>

    <div class="section-label">选择科目</div>
    <div class="quiz-controls">${subjectChips}</div>

    <div class="section-label" style="margin-top:8px">
      今日剩余：${remaining} 道
    </div>
    <div class="px-16 mt-12">
      <button class="btn btn-primary full" id="startStudyBtn" ${remaining === 0 ? 'disabled style="opacity:.5"' : ''}>
        ${remaining > 0 ? `开始学习（${remaining} 道）` : '今日已全部完成 🎉'}
      </button>
    </div>
  </div>`;
}

function renderStudyDone() {
  markStudiedToday();
  const stats = getPlanStats();
  return `<div class="page">
    <div class="page-header"><div class="page-title">学习</div></div>
    <div class="session-done"><div class="done-icon">🎉</div><h2>本次学习完成！</h2><p>继续保持，明天见！</p></div>
    <div class="done-stats">
      <div class="done-stat"><div class="val green">${studyStats.remembered}</div><div class="lbl">记住了</div></div>
      <div class="done-stat"><div class="val red">${studyStats.forgot}</div><div class="lbl">没记住</div></div>
    </div>
    <div class="done-stats" style="margin-top:8px">
      <div class="done-stat"><div class="val blue">${stats.done}</div><div class="lbl">今日已完成</div></div>
      <div class="done-stat"><div class="val">${stats.total}</div><div class="lbl">今日总任务</div></div>
    </div>
    <div class="px-16 mt-12"><button class="btn btn-primary full" id="resetStudy">返回设置</button></div>
  </div>`;
}

// ===== QUIZ =====
function renderQuiz() {
  const statusFilters = [{ id: 'all', label: '全部' }, { id: 'new', label: '新题' }, { id: 'learning', label: '未掌握' }, { id: 'mastered', label: '已掌握' }];
  const subjectFilters = [{ id: 'all', label: '全科' }, { id: '教育学', label: '教育学' }, { id: '心理学', label: '心理学' }, { id: '小三门', label: '小三门' }];
  const statusChips = statusFilters.map(f => `<button class="filter-chip${quizFilter === f.id ? ' active' : ''}" data-filter="${f.id}">${f.label}</button>`).join('');
  const subjectChips = subjectFilters.map(f => `<button class="filter-chip${quizSubject === f.id ? ' active' : ''}" data-quiz-subject="${f.id}">${f.label}</button>`).join('');

  const pool = state.questions.filter(q =>
    (quizFilter === 'all' || q.status === quizFilter) &&
    (quizSubject === 'all' || q.subject === quizSubject)
  );

  if (pool.length === 0) return `<div class="page">
    <div class="page-header"><div class="page-title">抽题测试</div></div>
    <div class="quiz-controls">${statusChips}</div>
    <div class="quiz-controls">${subjectChips}</div>
    <div class="quiz-empty"><div class="icon">🔍</div><p>该分类暂无题目</p></div>
  </div>`;

  if (quizList.length === 0 || quizIdx >= quizList.length) {
    quizList = shuffle([...pool]); quizIdx = 0; quizShown = false;
  }

  const q = quizList[quizIdx];
  const tag = q.status === 'new' ? '新题' : q.status === 'mastered' ? '已掌握' : '学习中';

  return `<div class="page">
    <div class="page-header"><div class="page-title">抽题测试</div><div class="page-subtitle">${pool.length} 题可用 · 第 ${quizIdx + 1}/${quizList.length} 题</div></div>
    <div class="quiz-controls">${statusChips}</div>
    <div class="quiz-controls">${subjectChips}</div>
    <div class="quiz-card">
      <div class="q-num">第 ${q.id} 题 · ${tag}${q.subject ? ' · ' + q.subject : ''}</div>
      <div class="q-title">${esc(q.question)}</div>
      ${quizShown ? `<div class="q-answer">${esc(q.answer).replace(/\n/g, '<br>')}</div>` : ''}
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

  const subjects = ['教育学', '心理学', '小三门'];
  const subjectRows = subjects.map(s => {
    const qs = state.questions.filter(q => q.subject === s);
    if (qs.length === 0) return '';
    const m = qs.filter(q => q.status === 'mastered').length;
    return `<div class="card-row"><span class="card-row-label">${s}</span><span class="card-row-value">${m}/${qs.length} 已掌握</span></div>`;
  }).join('');

  // 近30日完成情况
  const planRows = [];
  for (let i = 0; i < 7; i++) {
    const d = addDays(today(), -i);
    const p = state.dailyPlans[d];
    if (!p) continue;
    const tot = p.newKeys.length + p.dueKeys.length;
    if (tot === 0) continue;
    const done = p.doneKeys.length;
    const pctDay = Math.round(done / tot * 100);
    const dateLabel = new Date(d + 'T00:00:00').toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric', weekday: 'short' });
    planRows.push(`<div class="card-row">
      <span class="card-row-label">${dateLabel}</span>
      <span class="card-row-value ${done >= tot ? 'green' : done > 0 ? 'blue' : ''}">${done}/${tot} (${pctDay}%)</span>
    </div>`);
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

// ===== IMPORT =====
function renderImport() {
  const subjects = ['教育学', '心理学', '小三门'];
  const subjectChips = subjects.map(s =>
    `<button class="filter-chip${selectedImportSubject === s ? ' active' : ''}" data-import-subject="${s}">${s}</button>`
  ).join('');
  const hasData = state.questions.length > 0;
  const canImport = previewQuestions.length > 0 && selectedImportSubject;
  const subjectCounts = subjects.map(s => {
    const n = state.questions.filter(q => q.subject === s).length;
    return n ? `${s}:${n}` : '';
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
    <div class="quiz-controls" style="margin-bottom:12px">${subjectChips}</div>
    ${selectedImportSubject ? `<div class="import-warn" style="background:rgba(0,122,255,0.08);color:var(--blue)">将导入为「${selectedImportSubject}」，同科目旧题将被替换</div>` : `<div class="import-warn">⚠️ 请先选择科目</div>`}
    <div class="px-16 mt-12"><button class="btn btn-primary full" id="confirmImport" ${canImport ? '' : 'disabled style="opacity:.5"'}>确认导入 ${previewQuestions.length} 题${selectedImportSubject ? '（' + selectedImportSubject + '）' : ''}</button></div>` : ''}
    ${hasData ? `
    <div class="section-label">当前题库</div>
    <div class="card">
      <div class="card-row"><span class="card-row-label">总题数</span><span class="card-row-value">${state.questions.length}</span></div>
      ${subjectCounts ? `<div class="card-row"><span class="card-row-label">各科</span><span class="card-row-value" style="font-size:14px">${subjectCounts}</span></div>` : ''}
      <div class="card-row"><span class="card-row-label">导入日期</span><span class="card-row-value">${state.importDate || '未知'}</span></div>
    </div>
    ${clearConfirmPending ? `
    <div class="import-warn" style="background:rgba(255,59,48,0.1);color:var(--red)">⚠️ 确认清除全部数据？此操作不可撤销！</div>
    <div class="btn-group mt-12"><button class="btn btn-danger" id="clearConfirmBtn">确认清除</button><button class="btn btn-secondary" id="clearCancelBtn">取消</button></div>` :
    `<div class="px-16 mt-12"><button class="btn btn-danger full" id="clearData">清除所有数据</button></div>`}` : ''}
  </div>`;
}

// ===== EVENTS =====
function attachEvents() {
  document.querySelectorAll('[data-tab]').forEach(el => el.addEventListener('click', () => {
    currentTab = el.dataset.tab;
    if (currentTab === 'study') { studyQueue = []; studyIdx = 0; studyShown = false; studyStats = { remembered: 0, forgot: 0 }; studySetup = true; }
    if (currentTab === 'quiz') { quizList = []; quizIdx = 0; quizShown = false; }
    clearConfirmPending = false;
    render();
  }));

  const on = (id, fn) => { const el = document.getElementById(id); if (el) el.addEventListener('click', fn); };

  on('startStudy', () => { currentTab = 'study'; studyQueue = []; studyIdx = 0; studyShown = false; studyStats = { remembered: 0, forgot: 0 }; studySetup = true; render(); });

  on('regenPlan', () => {
    const dailyInp = document.getElementById('dailyNewInput');
    const startInp = document.getElementById('planStartInput');
    const dailyVal = dailyInp && dailyInp.value ? parseInt(dailyInp.value) : 5;
    const startVal = startInp && startInp.value ? parseInt(startInp.value) : null;
    state.dailyNewCount = (dailyVal >= 1) ? dailyVal : 5;
    state.planStartId = (startVal && startVal >= 1) ? startVal : null;
    generateTodayPlan();
    showToast('今日计划已重新生成');
    render();
  });

  on('startStudyBtn', () => {
    const dailyInp = document.getElementById('dailyNewInput');
    const startInp = document.getElementById('planStartInput');
    const dailyVal = dailyInp && dailyInp.value ? parseInt(dailyInp.value) : 5;
    const startVal = startInp && startInp.value ? parseInt(startInp.value) : null;
    state.dailyNewCount = (dailyVal >= 1) ? dailyVal : 5;
    state.planStartId = (startVal && startVal >= 1) ? startVal : null;
    save();
    studyQueue = getPlanQueue();
    studyIdx = 0; studyShown = false; studyStats = { remembered: 0, forgot: 0 };
    studySetup = false;
    render();
  });

  document.querySelectorAll('[data-study-subject]').forEach(el => el.addEventListener('click', () => {
    studySubjectFilter = el.dataset.studySubject; render();
  }));

  on('backToSetup', () => { studySetup = true; studyQueue = []; render(); });
  on('revealBtn', () => { studyShown = true; render(); });
  on('forgotBtn', () => {
    markQuestionDone(studyQueue[studyIdx]);
    scheduleNext(studyQueue[studyIdx], false);
    studyStats.forgot++; save(); studyIdx++; studyShown = false; render();
  });
  on('knewBtn', () => {
    markQuestionDone(studyQueue[studyIdx]);
    scheduleNext(studyQueue[studyIdx], true);
    studyStats.remembered++; save(); studyIdx++; studyShown = false; render();
  });
  on('resetStudy', () => { studySetup = true; studyQueue = []; render(); });

  document.querySelectorAll('[data-filter]').forEach(el => el.addEventListener('click', () => {
    quizFilter = el.dataset.filter; quizList = []; quizIdx = 0; quizShown = false; render();
  }));
  document.querySelectorAll('[data-quiz-subject]').forEach(el => el.addEventListener('click', () => {
    quizSubject = el.dataset.quizSubject; quizList = []; quizIdx = 0; quizShown = false; render();
  }));

  on('quizReveal', () => { quizShown = true; render(); });
  on('quizSkip',   () => { quizIdx++; quizShown = false; if (quizIdx >= quizList.length) { quizList = []; quizIdx = 0; } render(); });
  on('quizForgot', () => {
    const orig = state.questions.find(x => x.id === quizList[quizIdx].id && x.subject === quizList[quizIdx].subject);
    if (orig) { orig.status = 'learning'; orig.reviews = 0; if (!orig.nextReview) orig.nextReview = addDays(today(), 1); save(); }
    showToast('已标记为未掌握'); quizIdx++; quizShown = false;
    if (quizIdx >= quizList.length) { quizList = []; quizIdx = 0; } render();
  });
  on('quizKnew', () => {
    const orig = state.questions.find(x => x.id === quizList[quizIdx].id && x.subject === quizList[quizIdx].subject);
    if (orig) { orig.status = 'mastered'; orig.reviews = INTERVALS.length; orig.nextReview = addDays(today(), 90); save(); }
    showToast('已标记为已掌握 ✅'); quizIdx++; quizShown = false;
    if (quizIdx >= quizList.length) { quizList = []; quizIdx = 0; } render();
  });

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

  on('confirmImport', () => {
    if (!selectedImportSubject) return;
    state.questions = state.questions.filter(q => q.subject !== selectedImportSubject);
    state.questions.push(...previewQuestions.map(q => ({ ...q, subject: selectedImportSubject })));
    state.importDate = today();
    state.dailyPlans = {};  // reset plans after new import
    studyQueue = []; quizList = []; previewQuestions = [];
    save();
    showToast(`成功导入 ${state.questions.filter(q => q.subject === selectedImportSubject).length} 道题（${selectedImportSubject}）！`);
    selectedImportSubject = '';
    currentTab = 'home'; render();
  });

  on('clearData', () => { clearConfirmPending = true; render(); });
  on('clearCancelBtn', () => { clearConfirmPending = false; render(); });
  on('clearConfirmBtn', () => {
    state = { questions: [], streak: 0, lastStudyDate: null, importDate: null, planStartId: null, dailyNewCount: 5, dailyPlans: {} };
    studyQueue = []; quizList = []; previewQuestions = []; selectedImportSubject = ''; clearConfirmPending = false; save();
    showToast('数据已清除'); render();
  });
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
load();
render();

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
