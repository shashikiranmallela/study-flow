/* ============================================================
   script.js  -  StudyFlow app logic

   Data keys (same shapes as before, so existing cloud data keeps working):
     todos         [{ id, text, completed, createdAt, completedAt }]
     timeSessions  [{ date, duration(sec), type: 'study'|'break', task }]
     routine       [{ id, time: '08:00 AM', activity }]
     timerState    { seconds, isRunning, isBreak, currentTask, startTime }
     theme         'dark' | 'light'
     username      string
     settings      { accent, goalHours, mode, focusMin, breakMin, volume, chime, lite, tasksDone }   (new)

   firebase-wrapper.js wraps window.storage.set so every save also reaches Firestore.
   ============================================================ */
'use strict';

(function () {
  // ------------------------------------------------------------
  // tiny helpers
  // ------------------------------------------------------------
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
  const pad2 = (n) => String(n).padStart(2, '0');
  const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const dayKey = (d) => d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
  const parseKey = (k) => { const p = k.split('-').map(Number); return new Date(p[0], p[1] - 1, p[2]); };
  const newId = () => Date.now().toString() + Math.random().toString(36).slice(2, 7);
  const clamp = (n, a, b) => Math.min(b, Math.max(a, n));
  const ico = (name, cls) => '<svg class="i' + (cls ? ' ' + cls : '') + '"><use href="#i-' + name + '"/></svg>';
  const reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function fmtShort(sec) {
    sec = Math.max(0, Math.round(sec));
    if (sec < 60) return sec > 0 ? sec + 's' : '0m';
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    if (h > 0) return m ? h + 'h ' + m + 'm' : h + 'h';
    return m + 'm';
  }
  function timeAgo(iso) {
    const t = new Date(iso).getTime();
    if (!t) return '';
    const s = Math.max(0, (Date.now() - t) / 1000);
    if (s < 60) return 'just now';
    if (s < 3600) return Math.floor(s / 60) + ' min ago';
    if (s < 86400) return Math.floor(s / 3600) + 'h ago';
    const d = Math.floor(s / 86400);
    return d === 1 ? 'yesterday' : d + ' days ago';
  }

  // ------------------------------------------------------------
  // storage  (firebase-wrapper.js wraps .set to mirror into Firestore)
  // ------------------------------------------------------------
  const storage = {
    get(key, def) {
      if (def === undefined) def = null;
      try {
        const item = localStorage.getItem(key);
        return item ? JSON.parse(item) : def;
      } catch (e) { return def; }
    },
    set(key, value) {
      try { localStorage.setItem(key, JSON.stringify(value)); return true; }
      catch (e) { console.warn('storage.set failed', e); return false; }
    }
  };
  window.storage = storage;

  // ------------------------------------------------------------
  // toast (also used by firebase-wrapper.js)
  // ------------------------------------------------------------
  let toastTimer = 0;
  function showToast(msg, ms) {
    const el = $('#toast');
    if (!el) return;
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), ms || 3200);
  }
  window.showToast = showToast;

  // ------------------------------------------------------------
  // look-and-feel data
  // ------------------------------------------------------------
  const ACCENTS = {
    aurora:    { idle: ['#7f6bff', '#ff7ad1', '#4fe3ff'], bg: ['#5b3df5', '#0fb3d9'] },
    sunset:    { idle: ['#ff7a59', '#ffc14d', '#ff5c8a'], bg: ['#ff5c8a', '#ff9a3c'] },
    matcha:    { idle: ['#43d9a3', '#b8f26b', '#3ab7ff'], bg: ['#1fb98a', '#7bd63a'] },
    bubblegum: { idle: ['#ff6fb5', '#8c7bff', '#6fd8ff'], bg: ['#ff4fa3', '#6a5cff'] }
  };
  const STATE_PAL = {
    focus: ['#ff6b5e', '#ffb04a', '#ff5fa2'],
    break: ['#3fe0b0', '#4fb0ff', '#a9f5dc']
  };
  const LEVEL_NAMES = ['Curious', 'Focused', 'Steady', 'Deep diver', 'In the zone', 'Flow state', 'Scholar', 'Sage', 'Grandmaster', 'Legend'];
  const CIRC = 2 * Math.PI * 94;

  const DEFAULT_ROUTINE = [
    { id: '1', time: '06:00 AM', activity: 'Wake up & Morning routine' },
    { id: '2', time: '07:00 AM', activity: 'Breakfast' },
    { id: '3', time: '08:00 AM', activity: 'Study Session 1' },
    { id: '4', time: '10:00 AM', activity: 'Break' },
    { id: '5', time: '10:30 AM', activity: 'Study Session 2' },
    { id: '6', time: '12:30 PM', activity: 'Lunch' },
    { id: '7', time: '02:00 PM', activity: 'Study Session 3' },
    { id: '8', time: '04:00 PM', activity: 'Exercise' },
    { id: '9', time: '05:00 PM', activity: 'Study Session 4' },
    { id: '10', time: '07:00 PM', activity: 'Dinner' },
    { id: '11', time: '08:00 PM', activity: 'Free time / Hobbies' },
    { id: '12', time: '10:00 PM', activity: 'Sleep preparation' }
  ];
  const DEFAULT_SETTINGS = { accent: 'aurora', goalHours: 4, mode: 'stopwatch', focusMin: 25, breakMin: 5, volume: 0.5, chime: true, lite: false, tasksDone: 0 };
  const defaultTimer = () => ({ seconds: 0, isRunning: false, isBreak: false, currentTask: '', startTime: null });

  // ------------------------------------------------------------
  // state
  // ------------------------------------------------------------
  const S = {
    todos: [], sessions: [], routine: [], timer: defaultTimer(),
    settings: Object.assign({}, DEFAULT_SETTINGS), theme: 'dark',
    ui: { editingTask: null, routineEdit: false, newTaskId: null }
  };
  let currentPage = 'home';
  let booted = false;

  const asArray = (v) => (Array.isArray(v) ? v : []);

  function cleanSessions(list) {
    return asArray(list).map((x) => {
      if (!x || typeof x !== 'object') return null;
      let d = x.date;
      if (d && typeof d.toDate === 'function') d = d.toDate();        // Firestore Timestamp
      const dt = new Date(d);
      if (isNaN(dt.getTime())) return null;
      return { date: dt.toISOString(), duration: Math.max(0, Number(x.duration) || 0), type: x.type === 'break' ? 'break' : 'study', task: x.task ? String(x.task) : null };
    }).filter(Boolean);
  }
  function cleanTodos(list) {
    return asArray(list).filter((t) => t && typeof t === 'object' && t.text).map((t) => ({
      id: t.id ? String(t.id) : newId(), text: String(t.text), completed: !!t.completed,
      createdAt: t.createdAt || new Date().toISOString(), completedAt: t.completedAt || (t.completed ? new Date().toISOString() : null)
    }));
  }

  function loadAll() {
    S.todos = cleanTodos(storage.get('todos', []));
    S.sessions = cleanSessions(storage.get('timeSessions', []));
    const r = storage.get('routine', null);
    S.routine = Array.isArray(r) && r.length ? r : JSON.parse(JSON.stringify(DEFAULT_ROUTINE));
    if (!T.interval) S.timer = Object.assign(defaultTimer(), storage.get('timerState', {}) || {});
    S.settings = Object.assign({}, DEFAULT_SETTINGS, storage.get('settings', {}) || {});
    if (!ACCENTS[S.settings.accent]) S.settings.accent = 'aurora';
    S.theme = storage.get('theme', 'dark') === 'light' ? 'light' : 'dark';
    pruneTodos();
  }
  const saveTodos = () => storage.set('todos', S.todos);
  const saveSessions = () => storage.set('timeSessions', S.sessions);
  const saveRoutine = () => storage.set('routine', S.routine);
  const saveTimer = () => storage.set('timerState', S.timer);
  const saveSettings = () => storage.set('settings', S.settings);

  // completed tasks are kept for 30 days, then dropped to keep the cloud document small
  function pruneTodos() {
    const cutoff = Date.now() - 30 * 24 * 3600 * 1000;
    const before = S.todos.length;
    S.todos = S.todos.filter((t) => !t.completed || !t.completedAt || new Date(t.completedAt).getTime() > cutoff);
    if (S.todos.length !== before) saveTodos();
  }

  // ------------------------------------------------------------
  // derived data: study per day, streaks, XP, levels
  // ------------------------------------------------------------
  function studyDaily() {
    const m = new Map();
    S.sessions.forEach((s) => {
      if (s.type !== 'study') return;
      const k = dayKey(new Date(s.date));
      m.set(k, (m.get(k) || 0) + (s.duration || 0));
    });
    return m;
  }
  function streaks(daily) {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    let cur = 0;
    let atRisk = false;
    if (!(daily.get(dayKey(d)) > 0)) {
      d.setDate(d.getDate() - 1);
      atRisk = daily.get(dayKey(d)) > 0;
    }
    while (daily.get(dayKey(d)) > 0) { cur++; d.setDate(d.getDate() - 1); }

    const keys = Array.from(daily.keys()).filter((k) => daily.get(k) > 0).sort();
    let best = 0, run = 0, prev = null;
    keys.forEach((k) => {
      const dt = parseKey(k);
      run = prev && Math.round((dt - prev) / 864e5) === 1 ? run + 1 : 1;
      best = Math.max(best, run);
      prev = dt;
    });
    return { current: cur, best: Math.max(best, cur), atRisk: atRisk, activeDays: keys.length };
  }
  function totalStudySec() {
    let t = 0;
    S.sessions.forEach((s) => { if (s.type === 'study') t += s.duration || 0; });
    return t;
  }
  const xpTotal = () => Math.floor(totalStudySec() / 60) + 5 * (S.settings.tasksDone || 0);
  function levelInfo(xp) {
    const level = Math.floor(Math.sqrt(xp / 60)) + 1;
    const base = 60 * Math.pow(level - 1, 2);
    const next = 60 * Math.pow(level, 2);
    return { level: level, name: LEVEL_NAMES[Math.min(level - 1, LEVEL_NAMES.length - 1)], xp: xp, base: base, next: next, pct: clamp((xp - base) / (next - base), 0, 1) };
  }

  // ------------------------------------------------------------
  // bar chart markup (shared with insights.js)
  // ------------------------------------------------------------
  function barChart(items) {
    const max = Math.max.apply(null, items.map((i) => i.value).concat([0]));
    return items.map((it, idx) => {
      const zero = !(it.value > 0);
      const pct = max ? (it.value / max) * 100 : 0;
      return '<div class="bar-col' + (it.hi ? ' hi' : '') + '" data-tip="' + esc(it.tip || '') + '" style="--i:' + idx + '">' +
        '<div class="bar-track"><div class="bar' + (zero ? ' zero' : '') + '" style="height:' + (zero ? 0 : pct.toFixed(1)) + '%"></div></div>' +
        '<span class="bar-label">' + esc(it.label || '') + '</span></div>';
    }).join('');
  }

  // ------------------------------------------------------------
  // 3D orbs
  // ------------------------------------------------------------
  const ORB = { home: null, focus: null, bg: null };

  function initOrbs() {
    const ok = window.SFOrb && window.SFOrb.supported;
    if (ok) {
      ORB.home = window.SFOrb.orb($('#homeOrb'));
      ORB.focus = window.SFOrb.orb($('#focusOrb'));
      ORB.bg = window.SFOrb.backdrop($('#bgCanvas'));
      document.addEventListener('pointermove', (e) => {
        window.SFOrb.setMouse((e.clientX / window.innerWidth) * 2 - 1, -((e.clientY / window.innerHeight) * 2 - 1));
      }, { passive: true });
    }
    $('#homeOrbWrap').dataset.gl = ORB.home ? '1' : '0';
    $('#focusOrbWrap').dataset.gl = ORB.focus ? '1' : '0';
  }
  const orbState = () => (S.timer.isBreak ? 'break' : S.timer.isRunning ? 'focus' : 'idle');

  function applyOrbLook() {
    const acc = ACCENTS[S.settings.accent] || ACCENTS.aurora;
    const st = orbState();
    const pal = st === 'focus' ? STATE_PAL.focus : st === 'break' ? STATE_PAL.break : acc.idle;
    const energy = st === 'focus' ? 1 : st === 'break' ? 0.3 : 0.38;
    [ORB.home, ORB.focus].forEach((o) => {
      if (!o) return;
      o.setPalette(pal[0], pal[1], pal[2]);
      o.setEnergy(energy);
      o.setLight(S.theme === 'light');
      o.setLite(S.settings.lite);
    });
    if (ORB.bg) {
      ORB.bg.setPalette(acc.bg[0], acc.bg[1], acc.bg[1]);
      ORB.bg.setEnabled(!S.settings.lite && S.theme !== 'light');
    }
    $('#homeOrbWrap').dataset.state = st;
    $('#focusOrbWrap').dataset.state = st;
  }

  function applyLook() {
    const root = document.documentElement;
    root.dataset.theme = S.theme;
    root.dataset.accent = S.settings.accent;
    root.classList.toggle('lite', !!S.settings.lite);
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.content = S.theme === 'light' ? '#f3efff' : '#0e0a1a';
    $('#themeIcon').innerHTML = '<use href="#i-' + (S.theme === 'light' ? 'moon' : 'sun') + '"/>';
    $('#themeBtn').setAttribute('aria-label', S.theme === 'light' ? 'Switch to dark theme' : 'Switch to light theme');
    applyOrbLook();
  }
  function toggleTheme() {
    S.theme = S.theme === 'light' ? 'dark' : 'light';
    storage.set('theme', S.theme);
    applyLook();
  }

  // ------------------------------------------------------------
  // auth / header
  // ------------------------------------------------------------
  function getUser() {
    try { return window.firebase && firebase.auth().currentUser; } catch (e) { return null; }
  }
  function getName() {
    const u = getUser();
    const stored = storage.get('username', '');
    if (stored && typeof stored === 'string') return stored;
    if (u) return u.displayName || (u.email || '').split('@')[0] || 'friend';
    return 'friend';
  }
  function renderAuth() {
    const u = getUser();
    $('#guestAuth').hidden = !!u;
    $('#userMenu').hidden = !u;
    const dot = $('#syncDot');
    dot.classList.remove('ok', 'err');
    if (u) {
      const name = getName();
      $('#avatarBtn').textContent = (name.trim().charAt(0) || 'S').toUpperCase();
      $('#menuName').textContent = name;
      $('#menuEmail').textContent = u.email || '';
      if (window.__cloudSyncError) { dot.classList.add('err'); dot.title = 'Cloud sync problem: saved on this device only'; }
      else { dot.classList.add('ok'); dot.title = 'Synced to your account'; }
    } else {
      dot.title = 'Guest mode: saved on this device. Sign up to sync.';
    }
  }
  function renderChrome() {
    const li = levelInfo(xpTotal());
    $('#levelChipText').textContent = 'Lv ' + li.level;
    $('#levelChipBar').style.width = Math.round(li.pct * 100) + '%';
    $('#username').textContent = getName();
    renderAuth();
  }
  async function logout() {
    try {
      if (getUser()) {
        await Promise.race([firebase.firestore().waitForPendingWrites(), new Promise((r) => setTimeout(r, 3000))]);
        await firebase.auth().signOut();
      }
    } catch (e) { console.warn('logout', e); }
    try { localStorage.clear(); } catch (e) { /* ignore */ }
    location.hash = '';
    location.reload();
  }

  // ------------------------------------------------------------
  // routing
  // ------------------------------------------------------------
  const PAGES = ['home', 'focus', 'tasks', 'planner', 'insights'];

  function navigate(page) {
    if (location.hash.slice(1) === page) show(page);
    else location.hash = page;
  }
  function show(page) {
    if (PAGES.indexOf(page) === -1) page = 'home';
    currentPage = page;
    $$('.page').forEach((p) => p.classList.toggle('active', p.id === 'page-' + page));
    $$('.dock a').forEach((a) => {
      if (a.dataset.go === page) a.setAttribute('aria-current', 'page');
      else a.removeAttribute('aria-current');
    });
    document.body.dataset.page = page;
    if (page !== 'focus') exitZen();
    closePops();
    renderPage(page);
    window.scrollTo(0, 0);
  }
  function renderPage(page) {
    if (page === 'home') renderHome();
    else if (page === 'focus') renderFocus();
    else if (page === 'tasks') renderTasks();
    else if (page === 'planner') renderPlanner();
    else if (page === 'insights') {
      const sub = $('#insightsSub');
      if (!window.SF || !window.SF.insights) {
        sub.textContent = 'Insights could not load: insights.js is missing or failed to load on the server.';
        sub.style.color = 'var(--ember)';
      } else {
        try { window.SF.insights.render(); } catch (e) { console.error(e); sub.textContent = 'Insights error: ' + (e && e.message); sub.style.color = 'var(--ember)'; }
      }
    }
    if (window.SFX) window.SFX.tilt(document);
  }
  function refreshAll() {
    renderChrome();
    renderPage(currentPage);
  }

  // ------------------------------------------------------------
  // HOME
  // ------------------------------------------------------------
  function parseTime(str) {
    const m = String(str || '').match(/(\d{1,2}):?(\d{2})?\s*(AM|PM)?/i);
    if (!m) return null;
    let h = +m[1];
    const mi = +(m[2] || 0);
    const ap = m[3] && m[3].toUpperCase();
    if (ap === 'PM' && h !== 12) h += 12;
    if (ap === 'AM' && h === 12) h = 0;
    if (h > 23 || mi > 59) return null;
    return h * 60 + mi;
  }
  const to24 = (min) => pad2(Math.floor(min / 60)) + ':' + pad2(min % 60);
  function to12(min) {
    const h = Math.floor(min / 60);
    return pad2(h % 12 || 12) + ':' + pad2(min % 60) + ' ' + (h >= 12 ? 'PM' : 'AM');
  }
  function sortedRoutine() {
    return S.routine
      .map((r) => ({ id: r.id, activity: r.activity, min: parseTime(r.time) }))
      .filter((r) => r.min !== null && r.activity)
      .sort((a, b) => a.min - b.min);
  }
  function nowInfo() {
    const list = sortedRoutine();
    const d = new Date();
    const nowMin = d.getHours() * 60 + d.getMinutes();
    let idx = -1;
    list.forEach((r, i) => { if (r.min <= nowMin) idx = i; });
    const cur = list[idx] || null;
    const next = list[idx + 1] || null;
    const end = next ? next.min : 24 * 60;
    return { list: list, idx: idx, cur: cur, next: next, nowMin: nowMin, left: cur ? end - nowMin : 0, pct: cur ? clamp((nowMin - cur.min) / (end - cur.min), 0, 1) : 0 };
  }
  const fmtLeft = (min) => (min >= 60 ? Math.floor(min / 60) + 'h ' + (min % 60) + 'm' : min + ' min');

  function nowHTML(big) {
    const n = nowInfo();
    if (!n.list.length) return '<p class="mini-empty">No routine yet. <a href="#planner" data-go="planner">Build one</a>.</p>';
    if (!n.cur) {
      return '<div class="now-name">Before your day starts</div><div class="now-meta">First up at ' + to12(n.list[0].min) + ': ' + esc(n.list[0].activity) + '</div>';
    }
    let h = '<div class="now-name">' + esc(n.cur.activity) + '</div>' +
      '<div class="now-meta">' + fmtLeft(n.left) + ' left</div>' +
      '<div class="slot-progress"><i style="width:' + Math.round(n.pct * 100) + '%"></i></div>';
    if (n.next) h += '<div class="now-next">Next at ' + to12(n.next.min) + ': <strong>' + esc(n.next.activity) + '</strong></div>';
    else if (big) h += '<div class="now-next">That is the last block of the day.</div>';
    return h;
  }

  function renderHomeNow() {
    $('#homeNow').innerHTML = nowHTML(false);
  }

  function renderHome() {
    const now = new Date();
    const hr = now.getHours();
    const greet = hr < 5 ? 'Still up' : hr < 12 ? 'Good morning' : hr < 17 ? 'Good afternoon' : hr < 22 ? 'Good evening' : 'Late session';
    $('#greetWord').textContent = greet;
    $('#username').textContent = getName();
    $('#heroDate').textContent = now.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' });

    const daily = studyDaily();
    const st = streaks(daily);
    const todaySec = (daily.get(dayKey(now)) || 0) + (S.timer.isRunning && !S.timer.isBreak ? elapsedSec() : 0);
    const goalSec = S.settings.goalHours * 3600;

    // hero copy
    let sub;
    if (S.timer.isRunning) sub = 'Your session is running. Jump back in.';
    else if (st.atRisk && st.current > 0) sub = 'Your ' + st.current + '-day streak ends tonight. One session keeps it alive.';
    else if (todaySec >= goalSec) sub = 'Daily goal reached. Anything more is a bonus.';
    else if (todaySec > 0) sub = fmtShort(todaySec) + ' done today, ' + fmtShort(goalSec - todaySec) + ' to go for your goal.';
    else if (!S.sessions.length) sub = 'Pick a subject and start your first session. Ten minutes counts.';
    else sub = 'A fresh day. Pick a subject and start a session.';
    $('#heroSub').textContent = sub;

    // goal ring in the orb
    $('#homeGoalNum').textContent = fmtShort(todaySec);
    $('#homeGoalCap').textContent = 'of ' + S.settings.goalHours + 'h goal';
    $('#homeRing').style.strokeDashoffset = CIRC * (1 - clamp(todaySec / goalSec, 0, 1));

    // level
    const li = levelInfo(xpTotal());
    $('#levelNum').textContent = li.level;
    $('#levelName').textContent = li.name;
    $('#levelBar').style.width = Math.round(li.pct * 100) + '%';
    $('#levelNote').textContent = (li.next - li.xp) + ' XP to level ' + (li.level + 1) + '. Every minute is 1 XP, every finished task is 5.';

    // streak
    $('#streakNum').textContent = st.current;
    let dots = '';
    for (let i = 6; i >= 0; i--) {
      const d = new Date(now); d.setDate(d.getDate() - i);
      const on = (daily.get(dayKey(d)) || 0) > 0;
      dots += '<div class="wd' + (on ? ' on' : '') + (i === 0 ? ' today' : '') + '"><i></i><span>' + d.toLocaleDateString(undefined, { weekday: 'narrow' }) + '</span></div>';
    }
    $('#weekDots').innerHTML = dots;
    $('#streakNote').textContent = st.current === 0 ? 'Study today to start a streak.' : st.atRisk ? 'Study today to keep it going. Best: ' + st.best + ' days.' : 'Best so far: ' + st.best + ' days.';

    // last 7 days
    const items = [];
    let weekSec = 0;
    for (let i = 6; i >= 0; i--) {
      const d = new Date(now); d.setDate(d.getDate() - i);
      const sec = daily.get(dayKey(d)) || 0;
      weekSec += sec;
      items.push({ value: sec, label: d.toLocaleDateString(undefined, { weekday: 'short' }), tip: d.toLocaleDateString(undefined, { weekday: 'long' }) + ': ' + fmtShort(sec), hi: i === 0 });
    }
    $('#weekTotal').textContent = fmtShort(weekSec);
    $('#weekBars').innerHTML = barChart(items);

    // up next
    const active = S.todos.filter((t) => !t.completed).slice(0, 4);
    $('#homeTasks').innerHTML = active.length
      ? active.map((t) => '<li class="mini-task"><button class="tick" type="button" data-act="done" data-id="' + esc(t.id) + '" aria-label="Mark done">' + ico('check') + '</button><span>' + esc(t.text) + '</span></li>').join('')
      : '<li class="mini-empty">Nothing queued. <a href="#tasks" data-go="tasks">Add a task</a>.</li>';

    renderHomeNow();
    updateTimerUI();
  }

  // ------------------------------------------------------------
  // TIMER
  // ------------------------------------------------------------
  const T = { interval: null };
  const isPomo = () => S.settings.mode === 'pomodoro';
  const targetSec = () => (isPomo() ? (S.timer.isBreak ? S.settings.breakMin : S.settings.focusMin) * 60 : 0);
  function elapsedSec() {
    const ts = S.timer;
    return ts.isRunning && ts.startTime ? Math.max(0, Math.floor((Date.now() - ts.startTime) / 1000)) : ts.seconds || 0;
  }

  function startTimer(resume) {
    if (T.interval) return;
    const ts = S.timer;
    if (!(resume && ts.startTime)) ts.startTime = Date.now() - (ts.seconds || 0) * 1000;
    ts.isRunning = true;
    saveTimer();
    T.interval = setInterval(tick, 500);
    applyOrbLook();
    updateTimerUI();
  }
  function pauseTimer() {
    const ts = S.timer;
    if (T.interval) { clearInterval(T.interval); T.interval = null; }
    if (ts.isRunning && ts.startTime) ts.seconds = Math.floor((Date.now() - ts.startTime) / 1000);
    ts.isRunning = false;
    saveTimer();
    applyOrbLook();
  }
  function tick() {
    const tg = targetSec();
    if (tg && elapsedSec() >= tg) { finishPomodoro(); return; }
    updateTimerUI();
  }

  function logSession(sec) {
    if (sec <= 0) return null;
    const before = levelInfo(xpTotal());
    S.sessions.push({
      date: new Date().toISOString(),
      duration: sec,
      type: S.timer.isBreak ? 'break' : 'study',
      task: S.timer.isBreak ? null : (S.timer.currentTask || null)
    });
    saveSessions();
    return { before: before, after: levelInfo(xpTotal()), sec: sec, wasBreak: S.timer.isBreak };
  }
  function resetTimerValues() {
    S.timer.seconds = 0;
    S.timer.startTime = null;
    saveTimer();
  }
  function celebrate(r, big, extra) {
    if (!r || r.wasBreak) return;
    const xp = Math.floor(r.sec / 60);
    if (r.after.level > r.before.level) {
      showToast('Level up! You are now level ' + r.after.level + ', ' + r.after.name + '.' + (extra || ''), 4800);
      if (window.SFX) window.SFX.Confetti.burst(window.innerWidth / 2, window.innerHeight * 0.4, 160, { spread: 22, up: 18 });
    } else {
      showToast('Session saved: ' + fmtShort(r.sec) + (xp ? ' (+' + xp + ' XP).' : '.') + (extra || ''), 4200);
      if (big && window.SFX) window.SFX.Confetti.burst(window.innerWidth / 2, window.innerHeight * 0.4, 110);
    }
    if (window.SF && window.SF.badges) window.SF.badges.checkNew();
  }

  function finishPomodoro() {
    const tg = targetSec();
    pauseTimer();
    const wasBreak = S.timer.isBreak;
    const r = logSession(tg);
    resetTimerValues();
    S.timer.isBreak = !wasBreak;
    saveTimer();
    if (S.settings.chime && window.SFX) window.SFX.Sound.chime();
    if (wasBreak) showToast('Break over. Ready for another round?', 4200);
    else celebrate(r, true, ' Break time when you are ready.');
    refreshAll();
  }

  function endSession() {
    const sec = elapsedSec();
    pauseTimer();
    let r = null;
    if (sec >= 1) r = logSession(sec);
    resetTimerValues();
    if (r) {
      if (S.settings.chime && !r.wasBreak && sec >= 60 && window.SFX) window.SFX.Sound.chime();
      if (r.wasBreak) showToast('Break logged: ' + fmtShort(sec), 2800);
      else celebrate(r, sec >= 600);
    }
    refreshAll();
  }
  function resetTimer() {
    pauseTimer();
    resetTimerValues();
    updateTimerUI();
    refreshAll();
  }
  function toggleTimer() {
    if (T.interval) {
      pauseTimer();
      updateTimerUI();
    } else {
      if (!S.timer.isBreak) {
        const input = $('#taskInput');
        S.timer.currentTask = input.value.trim();
      }
      startTimer(false);
    }
    if (currentPage === 'focus') renderFocusSide();
  }
  function toggleBreak() {
    const sec = elapsedSec();
    pauseTimer();
    if (sec >= 1) logSession(sec);
    resetTimerValues();
    S.timer.isBreak = !S.timer.isBreak;
    saveTimer();
    refreshAll();
  }
  function focusOn(text) {
    text = (text || '').trim();
    if (elapsedSec() > 0 && !T.interval) {
      navigate('focus');
      showToast('You have a paused session. Resume it or end it first.', 3600);
      return;
    }
    if (T.interval) { navigate('focus'); return; }
    if (S.timer.isBreak) { S.timer.isBreak = false; }
    S.timer.currentTask = text;
    saveTimer();
    navigate('focus');
    setTimeout(() => { $('#taskInput').value = text; startTimer(false); renderFocusSide(); }, 60);
  }

  // ---- timer UI ----
  let lastDigits = '';
  function setDigits(sec) {
    const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
    const txt = h > 0 ? h + ':' + pad2(m) + ':' + pad2(s) : pad2(m) + ':' + pad2(s);
    if (txt !== lastDigits) {
      lastDigits = txt;
      const el = $('#timerDigits');
      el.classList.toggle('long', h > 0);
      el.innerHTML = txt.split('').map((ch) => (ch === ':' ? '<span class="c">:</span>' : '<span class="d">' + ch + '</span>')).join('');
    }
    return txt;
  }
  function updateTimerUI() {
    const ts = S.timer;
    const e = elapsedSec();
    const tg = targetSec();
    const running = !!ts.isRunning;
    const shown = tg ? Math.max(0, tg - e) : e;
    const txt = setDigits(shown);

    const p = tg ? clamp(e / tg, 0, 1) : (e % 3600) / 3600;
    $('#ringProg').style.strokeDashoffset = CIRC * (1 - p);

    let sub;
    if (running) sub = ts.isBreak ? 'On a break' : 'Focusing on ' + (ts.currentTask || 'your work');
    else if (e > 0) sub = 'Paused';
    else sub = ts.isBreak ? 'Break is ready' : 'Ready when you are';
    $('#timerSub').textContent = sub;

    const btn = $('#toggleBtn');
    btn.classList.toggle('running', running && !ts.isBreak);
    btn.classList.toggle('onbreak', running && ts.isBreak);
    btn.setAttribute('aria-label', running ? 'Pause timer' : e > 0 ? 'Resume timer' : 'Start timer');
    $('#toggleIcon').innerHTML = '<use href="#i-' + (running ? 'pause' : 'play') + '"/>';
    btn.classList.toggle('is-playing', running);
    $('#endBtn').disabled = e < 1;
    $('#resetBtn').disabled = e < 1 && !running;
    $('#breakBtnText').textContent = ts.isBreak ? 'Back to focus' : 'Take a break instead';
    $('#taskInput').disabled = running;

    document.title = running ? txt + ' | StudyFlow' : 'StudyFlow';
    orbStateSync();
  }
  let lastOrbState = '';
  function orbStateSync() {
    const st = orbState();
    if (st !== lastOrbState) { lastOrbState = st; applyOrbLook(); }
  }

  // ---- FOCUS page ----
  function renderFocus() {
    $('#taskInput').value = S.timer.isBreak ? $('#taskInput').value : (S.timer.currentTask || $('#taskInput').value || '');
    $$('#modeSeg button').forEach((b) => b.classList.toggle('on', b.dataset.mode === S.settings.mode));
    $('#pomoPresets').hidden = !isPomo();
    $$('#pomoPresets .chip-btn').forEach((c) => c.classList.toggle('on', +c.dataset.f === S.settings.focusMin && +c.dataset.b === S.settings.breakMin));
    $$('#soundGrid button').forEach((b) => b.classList.toggle('on', b.dataset.sound === (window.SFX ? window.SFX.Sound.kind : 'off')));
    $('#volume').value = S.settings.volume;
    renderFocusSide();
    updateTimerUI();
  }
  function renderFocusSide() {
    // recent subjects
    const seen = [];
    for (let i = S.sessions.length - 1; i >= 0 && seen.length < 6; i--) {
      const s = S.sessions[i];
      if (s.type === 'study' && s.task && seen.indexOf(s.task) === -1) seen.push(s.task);
    }
    $('#subjectChips').innerHTML = seen.map((s) => '<button type="button" class="chip chip-btn" data-subject="' + esc(s) + '">' + esc(s) + '</button>').join('');
    $$('#subjectChips button').forEach((b) => { b.disabled = !!S.timer.isRunning; });

    // tasks to focus on
    const active = S.todos.filter((t) => !t.completed).slice(0, 6);
    $('#focusTaskPicks').innerHTML = active.length
      ? active.map((t) => '<li><button type="button" class="pick" data-pick="' + esc(t.text) + '">' + ico('target') + '<span>' + esc(t.text) + '</span></button></li>').join('')
      : '<li class="pick-empty">Add tasks and they show up here.</li>';

    // today summary
    const now = new Date();
    const key = dayKey(now);
    let study = 0, brk = 0, count = 0;
    S.sessions.forEach((s) => {
      if (dayKey(new Date(s.date)) !== key) return;
      if (s.type === 'study') { study += s.duration || 0; count++; } else brk += s.duration || 0;
    });
    const goal = S.settings.goalHours * 3600;
    $('#todaySummary').innerHTML =
      '<div class="meter"><i style="width:' + Math.round(clamp(study / goal, 0, 1) * 100) + '%"></i></div>' +
      '<div class="summary-row"><span>Studied</span><strong>' + fmtShort(study) + '</strong></div>' +
      '<div class="summary-row"><span>Breaks</span><strong>' + fmtShort(brk) + '</strong></div>' +
      '<div class="summary-row"><span>Sessions</span><strong>' + count + '</strong></div>';
  }

  // ------------------------------------------------------------
  // TASKS
  // ------------------------------------------------------------
  function addTask(text) {
    text = (text || '').trim();
    if (!text) return false;
    const t = { id: newId(), text: text, completed: false, createdAt: new Date().toISOString(), completedAt: null };
    S.todos.push(t);
    S.ui.newTaskId = t.id;
    saveTodos();
    return true;
  }
  function completeTask(id, x, y) {
    const t = S.todos.find((q) => q.id === id);
    if (!t) return;
    t.completed = !t.completed;
    t.completedAt = t.completed ? new Date().toISOString() : null;
    S.settings.tasksDone = Math.max(0, (S.settings.tasksDone || 0) + (t.completed ? 1 : -1));
    saveTodos();
    saveSettings();
    if (t.completed) {
      showToast('Task done (+5 XP)', 2200);
      if (window.SFX) window.SFX.Confetti.burst(x || window.innerWidth / 2, y || window.innerHeight / 2, 46, { spread: 9, up: 9 });
      if (window.SF && window.SF.badges) window.SF.badges.checkNew();
    }
    refreshAll();
  }
  function deleteTask(id) {
    S.todos = S.todos.filter((t) => t.id !== id);
    saveTodos();
    refreshAll();
  }

  function taskHTML(t) {
    const isNew = S.ui.newTaskId === t.id;
    if (S.ui.editingTask === t.id) {
      return '<li class="task"><input class="input task-edit-input" data-edit="' + esc(t.id) + '" value="' + esc(t.text) + '" maxlength="120" aria-label="Edit task"></li>';
    }
    if (t.completed) {
      return '<li class="task done"><button class="tick on" type="button" data-act="done" data-id="' + esc(t.id) + '" aria-label="Mark as not done">' + ico('check') + '</button>' +
        '<span class="task-text">' + esc(t.text) + '</span><span class="task-when">' + esc(timeAgo(t.completedAt)) + '</span>' +
        '<div class="task-actions"><button class="mini-btn danger" type="button" data-act="delete" data-id="' + esc(t.id) + '" aria-label="Delete task">' + ico('trash') + '</button></div></li>';
    }
    return '<li class="task' + (isNew ? ' is-new' : '') + '"><button class="tick" type="button" data-act="done" data-id="' + esc(t.id) + '" aria-label="Mark done">' + ico('check') + '</button>' +
      '<span class="task-text">' + esc(t.text) + '</span>' +
      '<div class="task-actions">' +
      '<button class="mini-btn" type="button" data-act="focus" data-id="' + esc(t.id) + '" aria-label="Focus on this task" title="Focus on this">' + ico('target') + '</button>' +
      '<button class="mini-btn" type="button" data-act="edit" data-id="' + esc(t.id) + '" aria-label="Edit task">' + ico('pencil') + '</button>' +
      '<button class="mini-btn danger" type="button" data-act="delete" data-id="' + esc(t.id) + '" aria-label="Delete task">' + ico('trash') + '</button></div></li>';
  }

  function renderTasks() {
    const active = S.todos.filter((t) => !t.completed);
    const done = S.todos.filter((t) => t.completed).sort((a, b) => new Date(b.completedAt) - new Date(a.completedAt));
    $('#activeCount').textContent = active.length;
    $('#doneCount').textContent = done.length;
    $('#activeTodos').innerHTML = active.map(taskHTML).join('');
    $('#doneTodos').innerHTML = done.map(taskHTML).join('');
    $('#activeEmpty').hidden = active.length > 0;
    $('#doneEmpty').hidden = done.length > 0;
    $('#clearDone').hidden = done.length === 0;

    const total = active.length + done.length;
    $('#taskProgress').hidden = total === 0;
    if (total) {
      $('#taskProgressBar').style.width = Math.round((done.length / total) * 100) + '%';
      $('#taskProgressText').textContent = done.length + ' of ' + total + ' done';
    }
    $('#taskSub').textContent = active.length ? active.length + (active.length === 1 ? ' thing' : ' things') + ' left. Start with the one you are avoiding.' : 'Write it down, then get it done.';
    S.ui.newTaskId = null;

    const ed = $('[data-edit]');
    if (ed) { ed.focus(); ed.setSelectionRange(ed.value.length, ed.value.length); }
  }

  // ------------------------------------------------------------
  // PLANNER
  // ------------------------------------------------------------
  function renderPlanner() {
    const editing = S.ui.routineEdit;
    $('#routineEdit').querySelector('span').textContent = editing ? 'Save' : 'Edit';
    $('#routineDefaults').hidden = !editing;
    $('#addSlot').hidden = !editing;
    const box = $('#routineList');

    if (editing) {
      box.innerHTML = S.routine.map((r) => {
        const m = parseTime(r.time);
        return '<div class="slot-edit" data-id="' + esc(r.id) + '">' +
          '<input type="time" class="input time-in" value="' + (m === null ? '' : to24(m)) + '" aria-label="Start time">' +
          '<span></span><div class="row"><input type="text" class="input act-in" value="' + esc(r.activity) + '" maxlength="50" placeholder="Activity" aria-label="Activity">' +
          '<button class="mini-btn danger" type="button" data-act="del-slot" aria-label="Remove slot">' + ico('trash') + '</button></div></div>';
      }).join('');
    } else {
      const n = nowInfo();
      box.innerHTML = n.list.length ? n.list.map((r, i) => {
        const cls = i === n.idx ? ' now' : i < n.idx ? ' past' : '';
        return '<div class="slot' + cls + '"><div class="slot-time">' + to12(r.min) + '</div>' +
          '<div class="slot-line"><span class="slot-dot"></span></div>' +
          '<div class="slot-body"><div class="slot-card">' + esc(r.activity) + (i === n.idx ? '<span class="slot-now-tag">Now</span>' : '') +
          (i === n.idx ? '<div class="slot-progress"><i style="width:' + Math.round(n.pct * 100) + '%"></i></div>' : '') + '</div></div></div>';
      }).join('') : '<p class="empty">No routine yet. Press Edit to add your first block.</p>';
    }
    $('#nowPanel').innerHTML = '<h2 class="panel-title">Right now</h2>' + nowHTML(true);
  }
  function commitRoutine() {
    S.routine = S.routine
      .filter((r) => r.activity && r.activity.trim() && parseTime(r.time) !== null)
      .map((r) => ({ id: r.id, time: to12(parseTime(r.time)), activity: r.activity.trim() }))
      .sort((a, b) => parseTime(a.time) - parseTime(b.time));
    saveRoutine();
  }

  // ------------------------------------------------------------
  // ZEN, POPOVERS
  // ------------------------------------------------------------
  function enterZen() {
    document.body.classList.add('zen');
    $('#zenExit').hidden = false;
    navigate('focus');
  }
  function exitZen() {
    document.body.classList.remove('zen');
    $('#zenExit').hidden = true;
  }
  function closePops() {
    $('#settingsPop').hidden = true;
    $('#settingsBtn').setAttribute('aria-expanded', 'false');
    $('#userDropdown').hidden = true;
    $('#avatarBtn').setAttribute('aria-expanded', 'false');
  }
  function openSettings() {
    const pop = $('#settingsPop');
    const willOpen = pop.hidden;
    closePops();
    if (!willOpen) return;
    $$('#accentSwatches button').forEach((b) => b.classList.toggle('on', b.dataset.accent === S.settings.accent));
    $('#goalInput').value = S.settings.goalHours;
    $('#focusMin').value = S.settings.focusMin;
    $('#breakMin').value = S.settings.breakMin;
    $('#chimeToggle').checked = !!S.settings.chime;
    $('#liteToggle').checked = !!S.settings.lite;
    pop.hidden = false;
    $('#settingsBtn').setAttribute('aria-expanded', 'true');
  }

  // ------------------------------------------------------------
  // COMMAND PALETTE
  // ------------------------------------------------------------
  let palItems = [];
  let palIdx = 0;
  function buildCommands(q) {
    const S_ = window.SFX ? window.SFX.Sound : null;
    const list = [
      { label: 'Go to Home', icon: 'home', run: () => navigate('home') },
      { label: 'Go to Focus timer', icon: 'focus', run: () => navigate('focus') },
      { label: 'Go to Tasks', icon: 'tasks', run: () => navigate('tasks') },
      { label: 'Go to Daily routine', icon: 'planner', run: () => navigate('planner') },
      { label: 'Go to Insights', icon: 'insights', run: () => navigate('insights') },
      { label: S.timer.isRunning ? 'Pause timer' : 'Start timer', icon: S.timer.isRunning ? 'pause' : 'play', hint: 'Space', run: () => { navigate('focus'); setTimeout(toggleTimer, 60); } },
      { label: 'Zen mode', icon: 'expand', hint: 'F', run: enterZen },
      { label: S.theme === 'light' ? 'Switch to dark theme' : 'Switch to light theme', icon: S.theme === 'light' ? 'moon' : 'sun', run: toggleTheme },
      { label: 'Open settings', icon: 'sliders', run: () => setTimeout(openSettings, 30) },
      { label: 'Ambience: rain', icon: 'rain', run: () => S_ && S_.set('rain') },
      { label: 'Ambience: ocean', icon: 'waves', run: () => S_ && S_.set('ocean') },
      { label: 'Ambience: deep focus', icon: 'deep', run: () => S_ && S_.set('deep') },
      { label: 'Ambience: off', icon: 'mute', run: () => S_ && S_.set('off') }
    ];
    if (getUser()) list.push({ label: 'Log out', icon: 'logout', run: logout });
    else list.push({ label: 'Log in or sign up', icon: 'logout', run: () => { location.href = 'loginpage.html'; } });

    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    let out = list.filter((c) => words.every((w) => c.label.toLowerCase().indexOf(w) !== -1));
    const raw = q.trim();
    if (raw) {
      out = out.concat([
        { label: 'Add task: ' + raw, icon: 'plus', run: () => { addTask(raw); showToast('Task added', 1800); navigate('tasks'); refreshAll(); } },
        { label: 'Focus on: ' + raw, icon: 'target', run: () => focusOn(raw) }
      ]);
    }
    return out;
  }
  function renderPalette() {
    $('#paletteList').innerHTML = palItems.map((c, i) =>
      '<li role="option" data-i="' + i + '" aria-selected="' + (i === palIdx) + '">' + ico(c.icon) + '<span>' + esc(c.label) + '</span>' + (c.hint ? '<em>' + esc(c.hint) + '</em>' : '') + '</li>').join('');
    const sel = $('#paletteList li[aria-selected="true"]');
    if (sel && sel.scrollIntoView) sel.scrollIntoView({ block: 'nearest' });
  }
  function openPalette() {
    closePops();
    $('#palette').hidden = false;
    $('#paletteInput').value = '';
    palItems = buildCommands('');
    palIdx = 0;
    renderPalette();
    $('#paletteInput').focus();
  }
  function closePalette() { $('#palette').hidden = true; }
  function runPalette(i) {
    const c = palItems[i];
    if (!c) return;
    closePalette();
    c.run();
  }

  // ------------------------------------------------------------
  // EVENT WIRING
  // ------------------------------------------------------------
  function wire() {
    // navigation: anything with data-go
    document.addEventListener('click', (e) => {
      const go = e.target.closest('[data-go]');
      if (go) { e.preventDefault(); navigate(go.dataset.go); }
    });
    window.addEventListener('hashchange', () => show(location.hash.slice(1)));

    // header
    $('#cmdBtn').addEventListener('click', openPalette);
    $('#themeBtn').addEventListener('click', toggleTheme);
    $('#settingsBtn').addEventListener('click', (e) => { e.stopPropagation(); openSettings(); });
    $('#avatarBtn').addEventListener('click', (e) => {
      e.stopPropagation();
      const dd = $('#userDropdown');
      const open = dd.hidden;
      closePops();
      dd.hidden = !open;
      $('#avatarBtn').setAttribute('aria-expanded', String(open));
    });
    $('#logoutBtn').addEventListener('click', logout);
    document.addEventListener('click', (e) => {
      if (!e.target.closest('#settingsPop') && !e.target.closest('#userDropdown')) closePops();
    });

    // settings
    $('#accentSwatches').addEventListener('click', (e) => {
      const b = e.target.closest('button[data-accent]');
      if (!b) return;
      S.settings.accent = b.dataset.accent;
      saveSettings();
      $$('#accentSwatches button').forEach((x) => x.classList.toggle('on', x === b));
      applyLook();
      if (currentPage === 'insights') renderPage('insights');
    });
    const numSetting = (sel, key, min, max) => $(sel).addEventListener('change', (e) => {
      const v = parseFloat(e.target.value);
      S.settings[key] = clamp(isNaN(v) ? DEFAULT_SETTINGS[key] : v, min, max);
      e.target.value = S.settings[key];
      saveSettings();
      refreshAll();
    });
    numSetting('#goalInput', 'goalHours', 0.5, 16);
    numSetting('#focusMin', 'focusMin', 5, 180);
    numSetting('#breakMin', 'breakMin', 1, 60);
    $('#chimeToggle').addEventListener('change', (e) => { S.settings.chime = e.target.checked; saveSettings(); });
    $('#liteToggle').addEventListener('change', (e) => { S.settings.lite = e.target.checked; saveSettings(); applyLook(); });

    // home
    $('#quickStart').addEventListener('submit', (e) => {
      e.preventDefault();
      const v = $('#quickTask').value;
      $('#quickTask').value = '';
      focusOn(v);
    });
    $('#homeTasks').addEventListener('click', (e) => {
      const b = e.target.closest('[data-act="done"]');
      if (!b) return;
      const r = b.getBoundingClientRect();
      completeTask(b.dataset.id, r.left + r.width / 2, r.top + r.height / 2);
    });

    // focus
    $('#toggleBtn').addEventListener('click', toggleTimer);
    $('#resetBtn').addEventListener('click', resetTimer);
    $('#endBtn').addEventListener('click', endSession);
    $('#breakBtn').addEventListener('click', toggleBreak);
    $('#zenBtn').addEventListener('click', enterZen);
    $('#zenExit').addEventListener('click', exitZen);
    $('#taskInput').addEventListener('change', (e) => { S.timer.currentTask = e.target.value.trim(); saveTimer(); });
    $('#taskInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); toggleTimer(); } });
    $('#modeSeg').addEventListener('click', (e) => {
      const b = e.target.closest('button[data-mode]');
      if (!b || b.dataset.mode === S.settings.mode) return;
      if (elapsedSec() > 0) { showToast('End or reset the current session to switch modes.', 3000); return; }
      S.settings.mode = b.dataset.mode;
      saveSettings();
      renderFocus();
    });
    $('#pomoPresets').addEventListener('click', (e) => {
      const b = e.target.closest('.chip-btn');
      if (!b) return;
      if (S.timer.isRunning) { showToast('Pause the timer before changing lengths.', 2600); return; }
      S.settings.focusMin = +b.dataset.f;
      S.settings.breakMin = +b.dataset.b;
      saveSettings();
      renderFocus();
    });
    $('#subjectChips').addEventListener('click', (e) => {
      const b = e.target.closest('[data-subject]');
      if (!b) return;
      $('#taskInput').value = b.dataset.subject;
      S.timer.currentTask = b.dataset.subject;
      saveTimer();
    });
    $('#focusTaskPicks').addEventListener('click', (e) => {
      const b = e.target.closest('[data-pick]');
      if (!b || S.timer.isRunning) return;
      $('#taskInput').value = b.dataset.pick;
      S.timer.currentTask = b.dataset.pick;
      saveTimer();
    });
    $('#soundGrid').addEventListener('click', (e) => {
      const b = e.target.closest('button[data-sound]');
      if (!b || !window.SFX) return;
      window.SFX.Sound.set(b.dataset.sound);
      window.SFX.Sound.setVolume(S.settings.volume);
      $$('#soundGrid button').forEach((x) => x.classList.toggle('on', x === b));
    });
    $('#volume').addEventListener('input', (e) => { if (window.SFX) window.SFX.Sound.setVolume(+e.target.value); });
    $('#volume').addEventListener('change', (e) => { S.settings.volume = +e.target.value; saveSettings(); });

    // tasks
    $('#addTaskForm').addEventListener('submit', (e) => {
      e.preventDefault();
      const input = $('#newTodo');
      if (addTask(input.value)) { input.value = ''; renderTasks(); renderChrome(); }
      input.focus();
    });
    const taskList = (e) => {
      const b = e.target.closest('[data-act]');
      if (!b) return;
      const id = b.dataset.id;
      if (b.dataset.act === 'done') { const r = b.getBoundingClientRect(); completeTask(id, r.left + r.width / 2, r.top + r.height / 2); }
      else if (b.dataset.act === 'delete') deleteTask(id);
      else if (b.dataset.act === 'edit') { S.ui.editingTask = id; renderTasks(); }
      else if (b.dataset.act === 'focus') { const t = S.todos.find((q) => q.id === id); if (t) focusOn(t.text); }
    };
    $('#activeTodos').addEventListener('click', taskList);
    $('#doneTodos').addEventListener('click', taskList);
    $('#activeTodos').addEventListener('keydown', (e) => {
      if (!e.target.matches('[data-edit]')) return;
      if (e.key === 'Enter') e.target.blur();
      if (e.key === 'Escape') { S.ui.editingTask = null; renderTasks(); }
    });
    $('#activeTodos').addEventListener('focusout', (e) => {
      if (!e.target.matches('[data-edit]')) return;
      const t = S.todos.find((q) => q.id === e.target.dataset.edit);
      const v = e.target.value.trim();
      S.ui.editingTask = null;
      if (t && v && v !== t.text) { t.text = v; saveTodos(); }
      renderTasks();
    });
    $('#clearDone').addEventListener('click', () => {
      if (!confirm('Remove all completed tasks?')) return;
      S.todos = S.todos.filter((t) => !t.completed);
      saveTodos();
      refreshAll();
    });

    // planner
    $('#routineEdit').addEventListener('click', () => {
      if (S.ui.routineEdit) commitRoutine();
      S.ui.routineEdit = !S.ui.routineEdit;
      renderPlanner();
    });
    $('#addSlot').addEventListener('click', () => {
      S.routine.push({ id: newId(), time: '09:00 AM', activity: '' });
      renderPlanner();
      const rows = $$('#routineList .act-in');
      if (rows.length) rows[rows.length - 1].focus();
    });
    $('#routineDefaults').addEventListener('click', () => {
      if (!confirm('Replace your routine with the default one?')) return;
      S.routine = JSON.parse(JSON.stringify(DEFAULT_ROUTINE));
      saveRoutine();
      S.ui.routineEdit = false;
      renderPlanner();
    });
    $('#routineList').addEventListener('input', (e) => {
      const row = e.target.closest('.slot-edit');
      if (!row) return;
      const r = S.routine.find((q) => q.id === row.dataset.id);
      if (!r) return;
      if (e.target.matches('.time-in')) { const m = parseTime(e.target.value); if (m !== null) r.time = to12(m); }
      if (e.target.matches('.act-in')) r.activity = e.target.value;
    });
    $('#routineList').addEventListener('click', (e) => {
      const b = e.target.closest('[data-act="del-slot"]');
      if (!b) return;
      const id = b.closest('.slot-edit').dataset.id;
      S.routine = S.routine.filter((r) => r.id !== id);
      renderPlanner();
    });

    // command palette
    $('#paletteInput').addEventListener('input', (e) => { palItems = buildCommands(e.target.value); palIdx = 0; renderPalette(); });
    $('#paletteInput').addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown') { e.preventDefault(); palIdx = Math.min(palItems.length - 1, palIdx + 1); renderPalette(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); palIdx = Math.max(0, palIdx - 1); renderPalette(); }
      else if (e.key === 'Enter') { e.preventDefault(); runPalette(palIdx); }
    });
    $('#paletteList').addEventListener('click', (e) => { const li = e.target.closest('li[data-i]'); if (li) runPalette(+li.dataset.i); });
    $('#palette').addEventListener('mousedown', (e) => { if (e.target === $('#palette')) closePalette(); });

    // keyboard shortcuts
    document.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); $('#palette').hidden ? openPalette() : closePalette(); return; }
      if (e.key === 'Escape') {
        if (!$('#palette').hidden) closePalette();
        else if (document.body.classList.contains('zen')) exitZen();
        else closePops();
        return;
      }
      const tag = (e.target.tagName || '').toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select' || e.target.isContentEditable || e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key >= '1' && e.key <= '5') navigate(PAGES[+e.key - 1]);
      else if (e.key === ' ' && currentPage === 'focus' && tag !== 'button' && tag !== 'a') { e.preventDefault(); toggleTimer(); }
      else if (e.key.toLowerCase() === 'f' && currentPage === 'focus') enterZen();
    });

    // keep the clock honest when the tab wakes up
    document.addEventListener('visibilitychange', () => { if (!document.hidden && T.interval) tick(); });

    // changes made in another tab
    window.addEventListener('storage', (e) => {
      if (!booted || !e.key) return;
      if (['todos', 'timeSessions', 'routine', 'settings', 'theme', 'username'].indexOf(e.key) !== -1) { loadAll(); applyLook(); refreshAll(); }
    });

    // cloud sync finished (or account changed)
    document.addEventListener('cloud-sync-ready', () => {
      if (!booted) return;
      loadAll();
      applyLook();
      resumeTimer();
      refreshAll();
    });

    // keep "now" markers fresh
    setInterval(() => {
      if (document.hidden) return;
      if (currentPage === 'home') { renderHomeNow(); }
      else if (currentPage === 'planner' && !S.ui.routineEdit) renderPlanner();
    }, 30000);
  }

  // ------------------------------------------------------------
  // BOOT
  // ------------------------------------------------------------
  function resumeTimer() {
    if (T.interval) return;
    const ts = S.timer;
    if (ts.isRunning && ts.startTime) {
      const elapsedMs = Date.now() - ts.startTime;
      if (elapsedMs < 12 * 3600 * 1000) { startTimer(true); return; }
      // a timer left running for 12h+ is almost certainly forgotten: drop it
      ts.isRunning = false; ts.seconds = 0; ts.startTime = null;
      saveTimer();
    } else if (ts.isRunning) {
      ts.isRunning = false;
      saveTimer();
    }
  }

  function waitForCloud() {
    return new Promise((resolve) => {
      if (window.__firestoreDataLoaded) return resolve();
      const done = () => { clearTimeout(t); resolve(); };
      const t = setTimeout(done, 10000);                    // never hang forever
      document.addEventListener('cloud-sync-ready', done, { once: true });
    });
  }

  async function boot() {
    wire();
    await waitForCloud();
    loadAll();
    initOrbs();
    applyLook();
    renderChrome();
    show(location.hash.slice(1) || 'home');
    resumeTimer();
    updateTimerUI();
    booted = true;

    if (window.SF && window.SF.badges) window.SF.badges.init();
    if (window.__cloudSyncError && getUser()) showToast('Cloud sync is having trouble. Your data is saved on this device.', 5000);

    const loader = $('#loader');
    loader.classList.add('done');
    setTimeout(() => loader.remove(), 700);
  }

  // ------------------------------------------------------------
  // public surface for insights.js
  // ------------------------------------------------------------
  window.SF = Object.assign(window.SF || {}, {
    S: S, storage: storage, $: $, $$: $$, esc: esc, pad2: pad2, dayKey: dayKey, parseKey: parseKey, clamp: clamp, ico: ico,
    fmtShort: fmtShort, timeAgo: timeAgo, studyDaily: studyDaily, streaks: streaks, levelInfo: levelInfo, xpTotal: xpTotal,
    totalStudySec: totalStudySec, barChart: barChart, toast: showToast, navigate: navigate, saveSessions: saveSessions,
    reload: refreshAll, reduceMotion: reduceMotion
  });

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();