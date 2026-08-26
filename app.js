// ===== STATE =====
const DB_KEY = 'studyapp_v1';
let state = { questions: [], streak: 0, lastStudyDate: null, importDate: null, studyStartFrom: null };

function save() { localStorage.setItem(DB_KEY, JSON.stringify(state)); }

function load() {
  try { const r = localStorage.getItem(DB_KEY); if (r) state = JSON.parse(r); } catch(e) {}
  if (state.studyStartFrom === undefined) state.studyStartFrom = null;
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

function isDue(q) { return !q.nextReview || q.nextReview <= today(); }
function getDueQuestions() { return state.questions.filter(isDue); }
function getDueFiltered() {
  let qs;
  if (studyStatusFilter === 'due') qs = getDueQuestions();
  else if (studyStatusFilter === 'unmastered') qs = state.questions.filter(q => q.status !== 'mastered');
  else if (studyStatusFilter === 'mastered') qs = state.questions.filter(q => q.status === 'mastered');
  else qs = [...state.questions];
  if (studySubjectFilter !== 'all') qs = qs.filter(q => q.subject === studySubjectFilter);
  if (state.studyStartFrom) qs = qs.filter(q => q.id >= state.studyStartFrom);
  return qs;
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

// ===== UI STATE =====
let currentTab = 'home';
let studyQueue = [], studyIdx = 0, studyShown = false, studyStats = { remembered: 0, forgot: 0 };
let studySubjectFilter = 'all', studyStatusFilter = 'due', studySetup = true;
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
  const due = getDueQuestions();
  const total = state.questions.length;
  const mastered = state.questions.filter(q => q.status === 'mastered').length;
  const learning = state.questions.filter(q => q.status === 'learning').length;
  const newQ = state.questions.filter(q => q.status === 'new').length;
  const streak = state.streak || 0;

  if (total === 0) return `<div class="page">
    <div class="page-header"><div class="page-title">备考助手</div><div class="page-subtitle">${dateStr()}</div></div>
    <div class="empty-state"><div class="icon">📚</div><h2>还没有题目</h2><p>去「导入」页面上传 TXT 题库文件，开始备考吧！</p><button class="btn btn-primary" data-tab="import">去导入题库</button></div>
  </div>`;

  const stepLabels = ['新题', '第1次复习', '第2次复习', '第3次复习', '第4次复习'];
  const dueByStep = stepLabels.map((lbl, i) => {
    const n = due.filter(q => (q.reviews || 0) === i).length;
    return n > 0 ? `<div class="card-row"><span class="card-row-label">${lbl}</span><span class="card-row-value blue">${n}</span></div>` : '';
  }).join('');

  return `<div class="page">
    <div class="page-header"><div class="page-title">备考助手</div><div class="page-subtitle">${dateStr()}</div></div>
    ${streak > 0 ? `<div class="streak-badge">🔥 连续学习 ${streak} 天</div>` : ''}
    <div class="today-banner">
      <h2>今日学习计划</h2>
      <p>${due.length > 0 ? `共 ${due.length} 道题待复习` : '今日任务已完成 🎉'}</p>
      <div class="today-stats">
        <div class="today-stat"><div class="val">${due.length}</div><div class="lbl">待复习</div></div>
        <div class="today-stat"><div class="val">${mastered}</div><div class="lbl">已掌握</div></div>
        <div class="today-stat"><div class="val">${total}</div><div class="lbl">总题数</div></div>
      </div>
    </div>
    <div class="btn-group mt-12">
      <button class="btn btn-primary" id="startStudy" ${due.length === 0 ? 'disabled style="opacity:.5"' : ''}>
        <svg viewBox="0 0 24 24" fill="currentColor" style="width:18px;height:18px"><path d="M18 2H6c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zM6 4h5v8l-2.5-1.5L6 12V4z"/></svg>
        ${due.length > 0 ? `开始学习 (${due.length})` : '今日已完成'}
      </button>
      <button class="btn btn-secondary" data-tab="quiz">
        <svg viewBox="0 0 24 24" fill="currentColor" style="width:18px;height:18px"><path d="M11 18h2v-2h-2v2zm1-16C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8zm0-14c-2.21 0-4 1.79-4 4h2c0-1.1.9-2 2-2s2 .9 2 2c0 2-3 1.75-3 5h2c0-2.25 3-2.5 3-5 0-2.21-1.79-4-4-4z"/></svg>
        随机抽题
      </button>
    </div>
    ${due.length > 0 ? `
    <div class="section-label">今日复习明细</div>
    <div class="card">${dueByStep}</div>` : ''}
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
  const statusOptions = [
    { id: 'due',        label: '今日计划' },
    { id: 'unmastered', label: '未掌握' },
    { id: 'mastered',   label: '已掌握' },
    { id: 'all',        label: '全部题目' },
  ];
  const statusChips = statusOptions.map(o =>
    `<button class="filter-chip${studyStatusFilter === o.id ? ' active' : ''}" data-study-status="${o.id}">${o.label}</button>`
  ).join('');
  const count = getDueFiltered().length;
  const countLabel = studyStatusFilter === 'due' ? `${count} 题待复习` : `${count} 题`;

  return `<div class="page">
    <div class="page-header"><div class="page-title">学习</div></div>
    <div class="section-label">学习范围</div>
    <div class="quiz-controls">${statusChips}</div>
    <div class="section-label">选择科目</div>
    <div class="quiz-controls">${subjectChips}</div>
    <div class="section-label">开始位置</div>
    <div class="start-from-row">
      <span>从第</span>
      <input type="number" id="startFromInput" value="${state.studyStartFrom || ''}" placeholder="1" min="1" inputmode="numeric">
      <span>题开始（留空 = 全部）</span>
    </div>
    <div class="section-label">当前筛选：${countLabel}</div>
    <div class="px-16 mt-12">
      <button class="btn btn-primary full" id="startStudyBtn" ${count === 0 ? 'disabled style="opacity:.5"' : ''}>
        开始学习 (${count})
      </button>
    </div>
  </div>`;
}

function renderStudyDone() {
  markStudiedToday();
  return `<div class="page">
    <div class="page-header"><div class="page-title">学习</div></div>
    <div class="session-done"><div class="done-icon">🎉</div><h2>本次学习完成！</h2><p>继续保持，明天见！</p></div>
    <div class="done-stats">
      <div class="done-stat"><div class="val green">${studyStats.remembered}</div><div class="lbl">记住了</div></div>
      <div class="done-stat"><div class="val red">${studyStats.forgot}</div><div class="lbl">没记住</div></div>
    </div>
    <div class="px-16 mt-12"><button class="btn btn-primary full" id="resetStudy">重新筛选</button></div>
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

  return `<div class="page">
    <div class="page-header"><div class="page-title">统计</div></div>
    <div class="big-ring-wrap">
      <div class="big-ring">
        <svg width="160" height="160"><circle cx="80" cy="80" r="${r}" fill="none" stroke="#E5E5EA" stroke-width="10"/>
        <circle cx="80" cy="80" r="${r}" fill="none" stroke="#34C759" stroke-width="10" stroke-dasharray="${dash.toFixed(1)} ${circ.toFixed(1)}" stroke-linecap="round"/></svg>
        <div class="ring-text"><div class="ring-pct">${pct}%</div><div class="ring-lbl">掌握率</div></div>
      </div>
    </div>
    <div class="stats-grid">
      <div class="stat-card blue"><div class="val">${total}</div><div class="lbl">总题数</div></div>
      <div class="stat-card green"><div class="val">${mastered}</div><div class="lbl">已掌握</div></div>
      <div class="stat-card orange"><div class="val">${learning}</div><div class="lbl">学习中</div></div>
      <div class="stat-card"><div class="val">${newQ}</div><div class="lbl">未开始</div></div>
    </div>
    ${subjectRows ? `<div class="section-label">各科进度</div><div class="card">${subjectRows}</div>` : ''}
    <div class="section-label">复习计划</div>
    <div class="card">
      <div class="card-row"><span class="card-row-label">今日待复习</span><span class="card-row-value blue">${getDueQuestions().length}</span></div>
      <div class="card-row"><span class="card-row-label">连续学习</span><span class="card-row-value">${state.streak || 0} 天</span></div>
      <div class="card-row"><span class="card-row-label">上次学习</span><span class="card-row-value">${state.lastStudyDate || '尚未开始'}</span></div>
    </div>
    <div class="section-label">艾宾浩斯复习间隔</div>
    <div class="card">
      ${['D0→D1','D1→D2','D2→D4','D4→D7','D7→D15'].map((lbl, i) => `<div class="card-row"><span class="card-row-label">第 ${i + 1} 次 (${lbl})</span><span class="card-row-value">${INTERVALS[i]} 天后</span></div>`).join('')}
    </div>
  </div>`;
}

// ===== IMPORT =====
function renderImport() {
  const subjects = ['教育学', '心理学', '小三门'];
  const subjectChips = subjects.map(s =>
    `<button class="filter-chip${selectedImportSubject === s ? ' active' : ''}" data-import-subject="${s}">${s}</button>`
  ).join('');

  const subjectCounts = subjects.map(s => {
    const n = state.questions.filter(q => q.subject === s).length;
    return n > 0 ? `${s} ${n} 题` : null;
  }).filter(Boolean).join('　');

  const hasData = state.questions.length > 0;
  const canImport = previewQuestions.length > 0 && selectedImportSubject !== '';

  return `<div class="page">
    <div class="page-header"><div class="page-title">导入题库</div><div class="page-subtitle">支持 TXT 格式，按科目分别导入</div></div>
    <div class="import-zone">
      <div class="icon">📄</div>
      <h3>选择 TXT 文件</h3>
      <p>格式：<br>1. 什么是教育？<br>教育是培养人的活动……<br><br>2. 素质教育的内涵？<br>素质教育是……</p>
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

  on('startStudyBtn', () => {
    const inp = document.getElementById('startFromInput');
    const val = inp && inp.value ? parseInt(inp.value) : null;
    state.studyStartFrom = (val && val >= 1) ? val : null;
    save();
    studyQueue = [...getDueFiltered()];
    studyIdx = 0; studyShown = false; studyStats = { remembered: 0, forgot: 0 };
    studySetup = false;
    render();
  });

  document.querySelectorAll('[data-study-subject]').forEach(el => el.addEventListener('click', () => {
    studySubjectFilter = el.dataset.studySubject; render();
  }));
  document.querySelectorAll('[data-study-status]').forEach(el => el.addEventListener('click', () => {
    studyStatusFilter = el.dataset.studyStatus; render();
  }));

  on('backToSetup', () => { studySetup = true; studyQueue = []; render(); });
  on('revealBtn', () => { studyShown = true; render(); });
  on('forgotBtn', () => { scheduleNext(studyQueue[studyIdx], false); studyStats.forgot++; save(); studyIdx++; studyShown = false; render(); });
  on('knewBtn',   () => { scheduleNext(studyQueue[studyIdx], true);  studyStats.remembered++; save(); studyIdx++; studyShown = false; render(); });
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
    studyQueue = []; quizList = []; previewQuestions = [];
    save();
    showToast(`成功导入 ${state.questions.filter(q => q.subject === selectedImportSubject).length} 道题（${selectedImportSubject}）！`);
    selectedImportSubject = '';
    currentTab = 'home'; render();
  });

  on('clearData', () => { clearConfirmPending = true; render(); });
  on('clearCancelBtn', () => { clearConfirmPending = false; render(); });
  on('clearConfirmBtn', () => {
    state = { questions: [], streak: 0, lastStudyDate: null, importDate: null, studyStartFrom: null };
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
