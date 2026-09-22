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
    bubblegum: { idle: ['#ff6fb5', '#8c7bff', '#6fd8ff'], bg: ['#ff4fa3', '#6a5cff'] },
    system:    { idle: ['#2f7bff', '#8a5cff', '#3fd0ff'], bg: ['#1b3bd6', '#6a2bd6'] }
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
  const xpTotal = () => Math.floor(totalStudySec() / 60) + 5 * (S.settings.tasksDone || 0) + Math.floor((S.settings.hunter && Number(S.settings.hunter.bonusXp)) || 0);
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
    $('#levelChipText').textContent = 'Lv ' + li.level + (window.SF && window.SF.system ? ' · ' + window.SF.system.rank() : '');
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
  const PAGES = ['home', 'focus', 'tasks', 'planner', 'insights', 'system'];

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
    if (page === 'home') { renderHome(); if (window.SF && window.SF.realm) window.SF.realm.start(); }
    else if (page === 'focus') renderFocus();
    else if (page === 'tasks') renderTasks();
    else if (page === 'planner') renderPlanner();
    else if (page === 'insights') {
      const sub = $('#insightsSub');
      if (!window.SF || !window.SF.insights) {
        sub.textContent = 'Insights failed to start. Hard refresh (Ctrl+Shift+R); if it persists, re-upload script.js and index.html.';
        sub.style.color = 'var(--ember)';
      } else {
        try { window.SF.insights.render(); } catch (e) { console.error(e); sub.textContent = 'Insights error: ' + (e && e.message); sub.style.color = 'var(--ember)'; }
      }
    }
    else if (page === 'system') {
      const m = $('#sysMsg');
      if (!window.SF || !window.SF.system) { m.hidden = false; m.textContent = 'The System failed to start. Hard refresh (Ctrl+Shift+R), or re-upload script.js and index.html.'; }
      else { try { window.SF.system.render(); } catch (e) { console.error(e); m.hidden = false; m.textContent = 'System error: ' + (e && e.message); } }
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
    if (!resume && window.SF && window.SF.system) window.SF.system.onStart();
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
    const entry = {
      date: new Date().toISOString(),
      duration: sec,
      type: S.timer.isBreak ? 'break' : 'study',
      task: S.timer.isBreak ? null : (S.timer.currentTask || null)
    };
    S.sessions.push(entry);
    saveSessions();
    if (window.SF && window.SF.system) { try { window.SF.system.onSession(entry); } catch (e) { console.error(e); } }
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
      if (window.SF && window.SF.system) window.SF.system.levelUp(r.before, r.after);
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
      if (window.SF && window.SF.system) window.SF.system.check();
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
      if (e.key >= '1' && e.key <= '6') navigate(PAGES[+e.key - 1]);
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
      if (window.SF && window.SF.system) window.SF.system.init();
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
    if (window.SF && window.SF.system) window.SF.system.init();
    renderChrome();
    if (window.__cloudSyncError && getUser()) showToast('Cloud sync is having trouble. Your data is saved on this device.', 5000);

    const loader = $('#loader');
    loader.classList.add('done');
    setTimeout(() => loader.remove(), 700);
  }

  // ------------------------------------------------------------
  // public surface for insights.js
  // ------------------------------------------------------------
  function orbSpec() {
    const acc = ACCENTS[S.settings.accent] || ACCENTS.aurora, st = orbState();
    return { pal: st === 'focus' ? STATE_PAL.focus : st === 'break' ? STATE_PAL.break : acc.idle, energy: st === 'focus' ? 1 : st === 'break' ? 0.3 : 0.45 };
  }

  window.SF = Object.assign(window.SF || {}, {
    orbSpec: orbSpec,
    S: S, storage: storage, $: $, $$: $$, esc: esc, pad2: pad2, dayKey: dayKey, parseKey: parseKey, clamp: clamp, ico: ico,
    fmtShort: fmtShort, timeAgo: timeAgo, studyDaily: studyDaily, streaks: streaks, levelInfo: levelInfo, xpTotal: xpTotal,
    totalStudySec: totalStudySec, barChart: barChart, toast: showToast, navigate: navigate, saveSessions: saveSessions,
    reload: refreshAll, reduceMotion: reduceMotion, focusOn: focusOn, renderChrome: renderChrome, saveSettings: saveSettings, applyLook: applyLook
  });

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();

/* ============================================================
   insights.js  -  stats page
     - KPI tiles with comparison to the previous period
     - bar chart (today / week / month / year / any single day)
     - 3D "study skyline": every day is a tower, drag to rotate (custom canvas renderer)
     - subject breakdown (donut), rename / remove subjects
     - trophies (derived from your data)
   Needs script.js (window.SF) to be loaded first.
   ============================================================ */
(function () {
  'use strict';
  const SF = window.SF;
  if (!SF) { console.error('insights.js: script.js must load first'); return; }
  const { S, $, $$, esc, pad2, dayKey, parseKey, fmtShort, timeAgo, ico, barChart, clamp } = SF;

  const view = {
    period: 'week',
    date: null,          // 'YYYY-MM-DD' when a single day is picked
    editingSubject: null
  };
  const SUBJECT_COLORS = ['#9b8cff', '#5be7ff', '#ff7ac0', '#ffc14d', '#5be3a8', '#ff8a65', '#8c9bff'];

  // ------------------------------------------------------------
  // ranges
  // ------------------------------------------------------------
  const startOfDay = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };

  function rangeFor(period, base) {
    const b = startOfDay(base);
    let start, end, prevStart, label;
    if (period === 'today' || period === 'day') {
      start = b; end = new Date(b); end.setDate(end.getDate() + 1);
      prevStart = new Date(b); prevStart.setDate(prevStart.getDate() - 1);
      label = 'yesterday';
    } else if (period === 'week') {
      start = new Date(b); start.setDate(start.getDate() - start.getDay());
      end = new Date(start); end.setDate(end.getDate() + 7);
      prevStart = new Date(start); prevStart.setDate(prevStart.getDate() - 7);
      label = 'last week';
    } else if (period === 'month') {
      start = new Date(b.getFullYear(), b.getMonth(), 1);
      end = new Date(b.getFullYear(), b.getMonth() + 1, 1);
      prevStart = new Date(b.getFullYear(), b.getMonth() - 1, 1);
      label = 'last month';
    } else {
      start = new Date(b.getFullYear(), 0, 1);
      end = new Date(b.getFullYear() + 1, 0, 1);
      prevStart = new Date(b.getFullYear() - 1, 0, 1);
      label = 'last year';
    }
    // compare like with like: only the part of the previous period that matches how much of this one has passed
    const now = Date.now();
    const elapsed = Math.max(0, Math.min(now, end.getTime()) - start.getTime());
    const prevEnd = new Date(Math.min(prevStart.getTime() + elapsed, start.getTime()));
    return { start: start, end: end, prevStart: prevStart, prevEnd: prevEnd, label: label };
  }

  function sessionsIn(start, end, type) {
    const a = start.getTime(), b = end.getTime();
    return S.sessions.filter((s) => {
      const t = new Date(s.date).getTime();
      return s.type === type && t >= a && t < b;
    });
  }
  const sumSec = (list) => list.reduce((t, s) => t + (s.duration || 0), 0);

  function currentBase() { return view.date ? parseKey(view.date) : new Date(); }
  function currentPeriod() { return view.date ? 'day' : view.period; }

  // ------------------------------------------------------------
  // KPIs
  // ------------------------------------------------------------
  function deltaHTML(cur, prev, label) {
    if (!cur && !prev) return '<div class="kpi-delta">Nothing logged yet</div>';
    if (!prev) return '<div class="kpi-delta">Nothing to compare with ' + label + '</div>';
    const pct = Math.round(((cur - prev) / prev) * 100);
    if (pct === 0) return '<div class="kpi-delta">Same as ' + label + '</div>';
    return '<div class="kpi-delta ' + (pct > 0 ? 'up' : 'down') + '">' + (pct > 0 ? 'Up ' : 'Down ') + Math.abs(pct) + '% vs ' + label + '</div>';
  }

  function renderKpis(r, period) {
    const cur = sessionsIn(r.start, r.end, 'study');
    const prev = sessionsIn(r.prevStart, r.prevEnd, 'study');
    const curSec = sumSec(cur), prevSec = sumSec(prev);
    const brk = sumSec(sessionsIn(r.start, r.end, 'break'));

    const avg = cur.length ? curSec / cur.length : 0;
    const prevAvg = prev.length ? prevSec / prev.length : 0;

    let third;
    if (period === 'today' || period === 'day') {
      third = '<div class="kpi-label">Break time</div><div class="kpi-val">' + fmtShort(brk) + '</div><div class="kpi-delta">Rest counts too</div>';
    } else {
      const today = startOfDay(new Date());
      const last = today < r.end ? today : new Date(r.end.getTime() - 86400000);
      const days = Math.max(1, Math.round((last - r.start) / 86400000) + 1);
      const perDay = curSec / days;
      const pDays = Math.max(1, Math.round((r.prevEnd - r.prevStart) / 86400000));
      third = '<div class="kpi-label">Daily average</div><div class="kpi-val">' + fmtShort(perDay) + '</div>' + deltaHTML(perDay, prevSec / pDays, r.label);
    }

    $('#kpis').innerHTML =
      '<div class="kpi panel"><div class="kpi-label">Study time</div><div class="kpi-val">' + fmtShort(curSec) + '</div>' + deltaHTML(curSec, prevSec, r.label) + '</div>' +
      '<div class="kpi panel"><div class="kpi-label">Sessions</div><div class="kpi-val">' + cur.length + '</div>' +
      (cur.length ? '<div class="kpi-delta">Average ' + fmtShort(avg) + (prevAvg ? '' : '') + '</div>' : '<div class="kpi-delta">Start one on the Focus page</div>') + '</div>' +
      '<div class="kpi panel">' + third + '</div>';
  }

  // ------------------------------------------------------------
  // bar chart
  // ------------------------------------------------------------
  function renderChart(r, period) {
    const base = currentBase();
    const daily = SF.studyDaily();
    const items = [];
    let title;
    const todayKey = dayKey(new Date());
    const nowMonth = new Date().getMonth();
    const nowYear = new Date().getFullYear();

    if (period === 'today' || period === 'day') {
      const key = dayKey(base);
      const hours = new Array(24).fill(0);
      S.sessions.forEach((s) => {
        if (s.type !== 'study' || dayKey(new Date(s.date)) !== key) return;
        const end = new Date(s.date).getTime();
        let t = end - (s.duration || 0) * 1000;
        while (t < end) {
          const d = new Date(t);
          const hourEnd = new Date(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours() + 1).getTime();
          if (dayKey(d) === key) hours[d.getHours()] += (Math.min(end, hourEnd) - t) / 1000;
          t = hourEnd;
        }
      });
      const curHour = new Date().getHours();
      for (let h = 0; h < 24; h++) {
        const lab = h === 0 ? '12a' : h < 12 ? h + 'a' : h === 12 ? '12p' : (h - 12) + 'p';
        items.push({ value: hours[h], label: h % 3 === 0 ? lab : '', tip: lab + ': ' + fmtShort(hours[h]), hi: key === todayKey && h === curHour });
      }
      title = view.date ? 'Study time on ' + base.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' }) : 'Study time today';
    } else if (period === 'week') {
      for (let i = 0; i < 7; i++) {
        const d = new Date(r.start); d.setDate(d.getDate() + i);
        const sec = daily.get(dayKey(d)) || 0;
        items.push({ value: sec, label: d.toLocaleDateString(undefined, { weekday: 'short' }), tip: d.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'short' }) + ': ' + fmtShort(sec), hi: dayKey(d) === todayKey });
      }
      title = 'Study time this week';
    } else if (period === 'month') {
      const days = new Date(r.start.getFullYear(), r.start.getMonth() + 1, 0).getDate();
      for (let i = 1; i <= days; i++) {
        const d = new Date(r.start.getFullYear(), r.start.getMonth(), i);
        const sec = daily.get(dayKey(d)) || 0;
        items.push({ value: sec, label: i === 1 || i % 5 === 0 ? String(i) : '', tip: d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) + ': ' + fmtShort(sec), hi: dayKey(d) === todayKey });
      }
      title = 'Study time in ' + r.start.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
    } else {
      const months = new Array(12).fill(0);
      daily.forEach((sec, k) => { const d = parseKey(k); if (d.getFullYear() === r.start.getFullYear()) months[d.getMonth()] += sec; });
      for (let m = 0; m < 12; m++) {
        const d = new Date(r.start.getFullYear(), m, 1);
        items.push({ value: months[m], label: d.toLocaleDateString(undefined, { month: 'short' }), tip: d.toLocaleDateString(undefined, { month: 'long' }) + ': ' + fmtShort(months[m]), hi: r.start.getFullYear() === nowYear && m === nowMonth });
      }
      title = 'Study time in ' + r.start.getFullYear();
    }
    $('#chartTitle').textContent = title;
    $('#barChart').innerHTML = barChart(items);
  }

  // ------------------------------------------------------------
  // subjects (donut + list)
  // ------------------------------------------------------------
  function renderSubjects(r, period) {
    const dayMode = period === 'day' || period === 'today';
    const totals = new Map();
    const list = dayMode ? sessionsIn(r.start, r.end, 'study') : S.sessions.filter((s) => s.type === 'study');
    list.forEach((s) => { if (s.task) totals.set(s.task, (totals.get(s.task) || 0) + (s.duration || 0)); });
    const rows = Array.from(totals.entries()).sort((a, b) => b[1] - a[1]);
    const total = rows.reduce((t, x) => t + x[1], 0);

    $('#subjectsTitle').textContent = dayMode ? (view.date ? 'Subjects on this day' : 'Subjects today') : 'Subjects, all time';
    const box = $('#subjects');
    if (!rows.length) {
      box.innerHTML = '<p class="empty">Add a subject when you start a session and it shows up here.</p>';
      return;
    }

    const C = 2 * Math.PI * 54;
    let offset = 0;
    const top = rows.slice(0, 6);
    const otherSec = rows.slice(6).reduce((t, x) => t + x[1], 0);
    const segs = top.map((x, i) => ({ name: x[0], sec: x[1], color: SUBJECT_COLORS[i % SUBJECT_COLORS.length], real: true }));
    if (otherSec > 0) segs.push({ name: 'Other', sec: otherSec, color: 'rgba(160,150,190,.7)', real: false });

    const arcs = segs.map((sg) => {
      const len = Math.max(0.5, (sg.sec / total) * C - 2.5);
      const el = '<circle cx="70" cy="70" r="54" stroke="' + sg.color + '" stroke-dasharray="' + len.toFixed(2) + ' ' + (C - len).toFixed(2) + '" stroke-dashoffset="' + (-offset).toFixed(2) + '" stroke-linecap="round"/>';
      offset += (sg.sec / total) * C;
      return el;
    }).join('');

    const items = segs.map((sg) => {
      if (view.editingSubject === sg.name && sg.real && !dayMode) {
        return '<div class="subj"><span class="subj-dot" style="background:' + sg.color + '"></span><input class="input subj-edit" data-rename="' + esc(sg.name) + '" value="' + esc(sg.name) + '" maxlength="60" aria-label="Rename subject"></div>';
      }
      const actions = sg.real && !dayMode
        ? '<span class="subj-actions"><button class="mini-btn" type="button" data-sact="edit" data-name="' + esc(sg.name) + '" aria-label="Rename ' + esc(sg.name) + '">' + ico('pencil') + '</button>' +
          '<button class="mini-btn danger" type="button" data-sact="remove" data-name="' + esc(sg.name) + '" aria-label="Remove ' + esc(sg.name) + '">' + ico('trash') + '</button></span>'
        : '<span></span>';
      return '<div class="subj"><span class="subj-dot" style="background:' + sg.color + '"></span><span class="subj-name" title="' + esc(sg.name) + '">' + esc(sg.name) + '</span><span class="subj-time">' + fmtShort(sg.sec) + '</span>' + actions + '</div>';
    }).join('');

    box.innerHTML =
      '<div class="donut-wrap"><div class="donut-center"><svg class="donut" viewBox="0 0 140 140" aria-hidden="true"><circle class="d-track" cx="70" cy="70" r="54"/>' + arcs + '</svg>' +
      '<div class="donut-label">' + fmtShort(total) + '<small>tagged</small></div></div><div class="subj-list">' + items + '</div></div>' +
      (dayMode ? '' : '<p class="list-note">Removing a subject keeps the time in your totals as untagged.</p>');

    const ed = $('[data-rename]');
    if (ed) { ed.focus(); ed.setSelectionRange(ed.value.length, ed.value.length); }
  }

  function renameSubject(oldName, newName) {
    newName = newName.trim();
    view.editingSubject = null;
    if (newName && newName !== oldName) {
      S.sessions.forEach((s) => { if (s.task === oldName) s.task = newName; });
      SF.saveSessions();
    }
    render();
  }
  function removeSubject(name) {
    if (!confirm('Remove "' + name + '" from your subjects?\nThe study time stays in your totals as untagged.')) return;
    S.sessions.forEach((s) => { if (s.task === name) s.task = null; });
    SF.saveSessions();
    render();
  }

  // ------------------------------------------------------------
  // completed tasks
  // ------------------------------------------------------------
  function renderDone(r, period) {
    const dayMode = period === 'day' || period === 'today';
    let done = S.todos.filter((t) => t.completed && t.completedAt);
    if (dayMode) {
      const a = r.start.getTime(), b = r.end.getTime();
      done = done.filter((t) => { const x = new Date(t.completedAt).getTime(); return x >= a && x < b; });
    }
    done.sort((a, b) => new Date(b.completedAt) - new Date(a.completedAt));
    done = done.slice(0, 8);
    $('#doneTitle').textContent = dayMode ? (view.date ? 'Completed that day' : 'Completed today') : 'Recently completed';
    $('#insightDone').innerHTML = done.map((t) =>
      '<li class="task done"><span class="tick on">' + ico('check') + '</span><span class="task-text">' + esc(t.text) + '</span><span class="task-when">' + esc(timeAgo(t.completedAt)) + '</span></li>').join('');
    $('#insightDoneEmpty').hidden = done.length > 0;
  }

  // ------------------------------------------------------------
  // trophies
  // ------------------------------------------------------------
  const BADGES = [
    { id: 'spark', name: 'First spark', how: 'Log your first session', icon: 'bolt', test: (c) => c.sessions >= 1 },
    { id: 'warmup', name: 'Warm-up', how: 'Reach a 3-day streak', icon: 'flame', test: (c) => c.best >= 3 },
    { id: 'week', name: 'Week warrior', how: 'Reach a 7-day streak', icon: 'flame', test: (c) => c.best >= 7 },
    { id: 'deep', name: 'Deep diver', how: 'One session of 60+ minutes', icon: 'target', test: (c) => c.longest >= 3600 },
    { id: 'ten', name: 'Ten hours in', how: 'Study 10 hours in total', icon: 'clock', test: (c) => c.totalSec >= 36000 },
    { id: 'fifty', name: 'Fifty club', how: 'Study 50 hours in total', icon: 'trophy', test: (c) => c.totalSec >= 180000 },
    { id: 'owl', name: 'Night owl', how: 'Finish a session after 11 pm', icon: 'moon', test: (c) => c.owl },
    { id: 'bird', name: 'Early bird', how: 'Finish a session before 7 am', icon: 'sunrise', test: (c) => c.bird },
    { id: 'crusher', name: 'Task crusher', how: 'Complete 25 tasks', icon: 'check', test: (c) => (S.settings.tasksDone || 0) >= 25 }
  ];
  function badgeContext() {
    const daily = SF.studyDaily();
    const st = SF.streaks(daily);
    let longest = 0, owl = false, bird = false, sessions = 0, totalSec = 0;
    S.sessions.forEach((s) => {
      if (s.type !== 'study') return;
      sessions++;
      totalSec += s.duration || 0;
      longest = Math.max(longest, s.duration || 0);
      if ((s.duration || 0) >= 600) {
        const h = new Date(s.date).getHours();
        if (h >= 23 || h < 4) owl = true;
        if (h >= 4 && h < 7) bird = true;
      }
    });
    return { best: st.best, longest: longest, owl: owl, bird: bird, sessions: sessions, totalSec: totalSec };
  }
  const unlockedIds = () => { const c = badgeContext(); return BADGES.filter((b) => b.test(c)).map((b) => b.id); };

  function renderBadges() {
    const got = unlockedIds();
    $('#trophyHint').textContent = got.length + ' of ' + BADGES.length + ' unlocked. Hover a coin to see how to earn it.';
    $('#badges').innerHTML = BADGES.map((b) => {
      const on = got.indexOf(b.id) !== -1;
      return '<div class="badge' + (on ? '' : ' locked') + '" tabindex="0" aria-label="' + esc(b.name + ': ' + b.how + (on ? ' (unlocked)' : ' (locked)')) + '">' +
        '<div class="coin"><div class="coin-face coin-front">' + ico(on ? b.icon : 'lock') + '</div><div class="coin-face coin-back">' + esc(b.how) + '</div></div>' +
        '<div class="badge-name">' + esc(b.name) + '</div></div>';
    }).join('');
  }

  const SEEN_KEY = 'sf_badges_seen';            // device-local on purpose
  const badges = {
    init() { badges.checkNew(true); },
    checkNew(silent) {
      let seen = null;
      try { seen = JSON.parse(localStorage.getItem(SEEN_KEY)); } catch (e) { seen = null; }
      const now = unlockedIds();
      if (!Array.isArray(seen)) {                 // first run on this device: don't shower old achievements
        try { localStorage.setItem(SEEN_KEY, JSON.stringify(now)); } catch (e) { /* ignore */ }
        return;
      }
      const fresh = now.filter((id) => seen.indexOf(id) === -1);
      if (!fresh.length) return;
      try { localStorage.setItem(SEEN_KEY, JSON.stringify(now)); } catch (e) { /* ignore */ }
      if (silent) return;
      const b = BADGES.find((x) => x.id === fresh[0]);
      setTimeout(() => {
        SF.toast('Trophy unlocked: ' + b.name + (fresh.length > 1 ? ' (+' + (fresh.length - 1) + ' more)' : ''), 4200);
        if (window.SFX) window.SFX.Confetti.burst(window.innerWidth / 2, window.innerHeight * 0.35, 90);
      }, 1200);
    }
  };

  // ------------------------------------------------------------
  // 3D SKYLINE  (orthographic projection, painter's algorithm, drag to rotate)
  // ------------------------------------------------------------
  const Sky = (function () {
    let cv = null, ctx = null, wrap = null, tip = null;
    let bars = [];
    let weeks = 26;
    let yaw = -0.55, pitch = 0.5;
    let drag = null, idleUntil = 0, raf = 0, last = 0;
    let appearAt = 0, hover = null;
    let cw = 0, ch = 0, dpr = 1;
    let accent = [155, 140, 255], accent2 = [91, 231, 255], light = false;

    const hexToRgb = (h) => {
      h = (h || '').trim().replace('#', '');
      if (h.length === 3) h = h.replace(/./g, '$&$&');
      const v = parseInt(h, 16);
      return isNaN(v) ? null : [(v >> 16) & 255, (v >> 8) & 255, v & 255];
    };
    function readColors() {
      const cs = getComputedStyle(document.documentElement);
      accent = hexToRgb(cs.getPropertyValue('--accent')) || accent;
      accent2 = hexToRgb(cs.getPropertyValue('--accent-2')) || accent2;
      light = document.documentElement.dataset.theme === 'light';
    }
    const mix = (a, b, k) => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
    const rgb = (c, k) => 'rgb(' + Math.min(255, Math.round(c[0] * k)) + ',' + Math.min(255, Math.round(c[1] * k)) + ',' + Math.min(255, Math.round(c[2] * k)) + ')';

    function init() {
      if (cv) return;
      cv = $('#skyline'); wrap = $('#skylineWrap'); tip = $('#skyTip');
      ctx = cv.getContext('2d');

      wrap.addEventListener('pointerdown', (e) => {
        drag = { x: e.clientX, y: e.clientY };
        wrap.classList.add('drag');
        try { wrap.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
      });
      wrap.addEventListener('pointermove', (e) => {
        if (drag) {
          yaw += (e.clientX - drag.x) * 0.008;
          pitch = clamp(pitch + (e.clientY - drag.y) * 0.004, 0.32, 1.05);
          drag.x = e.clientX; drag.y = e.clientY;
          idleUntil = performance.now() + 4000;
          hover = null; tip.hidden = true;
        } else {
          const r = wrap.getBoundingClientRect();
          setHover(hit(e.clientX - r.left, e.clientY - r.top));
        }
      });
      const end = () => { drag = null; wrap.classList.remove('drag'); };
      wrap.addEventListener('pointerup', end);
      wrap.addEventListener('pointercancel', end);
      wrap.addEventListener('pointerleave', () => { if (!drag) setHover(null); });

      $('#skyRange').addEventListener('click', (e) => {
        const b = e.target.closest('button[data-weeks]');
        if (!b) return;
        weeks = +b.dataset.weeks;
        syncRange();
        build();
        appearAt = performance.now();
      });
    }
    function syncRange() { $$('#skyRange button').forEach((b) => b.classList.toggle('on', +b.dataset.weeks === weeks)); }

    function build() {
      const daily = SF.studyDaily();
      const today = startOfDay(new Date());
      const start = new Date(today);
      start.setDate(start.getDate() - start.getDay() - (weeks - 1) * 7);
      bars = [];
      let max = 0;
      for (let i = 0; i < weeks * 7; i++) {
        const d = new Date(start); d.setDate(start.getDate() + i);
        if (d > today) break;
        const sec = daily.get(dayKey(d)) || 0;
        max = Math.max(max, sec);
        bars.push({ col: Math.floor(i / 7), row: i % 7, date: d, sec: sec, polys: [] });
      }
      const cap = Math.max(3 * 3600, max);
      bars.forEach((b) => {
        b.ratio = b.sec > 0 ? Math.min(1, b.sec / cap) : 0;
        b.h = b.sec > 0 ? 0.25 + 6.2 * Math.pow(b.ratio, 0.7) : 0.06;
      });
    }

    function resize() {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      const r = wrap.getBoundingClientRect();
      cw = Math.max(10, r.width); ch = Math.max(10, r.height);
      const w = Math.round(cw * dpr), h = Math.round(ch * dpr);
      if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    const L = (function () { const x = -0.45, y = 0.8, z = 0.5, n = Math.hypot(x, y, z); return [x / n, y / n, z / n]; })();

    function draw(now) {
      resize();
      ctx.clearRect(0, 0, cw, ch);
      if (!bars.length) return;

      const c = Math.cos(yaw), s = Math.sin(yaw), sp = Math.sin(pitch), cp = Math.cos(pitch);
      const hx = (weeks * Math.abs(c) + 7 * Math.abs(s)) / 2;
      const hy = (weeks * Math.abs(s) + 7 * Math.abs(c)) / 2;
      let hMax = 1;
      bars.forEach((b) => { if (b.h > hMax) hMax = b.h; });
      const scale = Math.min((cw * 0.94) / (2 * hx + 0.8), (ch * 0.9) / (2 * hy * sp + hMax * cp + 0.5));
      const cy0 = ch / 2 + (hMax * cp * scale) / 2;

      const P = (x, z, y) => {
        const xr = x * c + z * s;
        const zr = -x * s + z * c;
        return [cw / 2 + xr * scale, cy0 + (zr * sp - y * cp) * scale, zr];
      };

      const cx = (weeks - 1) / 2;
      bars.forEach((b) => { b.x = b.col - cx; b.z = b.row - 3; b.depth = -b.x * s + b.z * c; });
      const order = bars.slice().sort((a, b) => a.depth - b.depth);

      const a = 0.39;
      const corners = [[-a, -a], [a, -a], [a, a], [-a, a]];
      const sides = [[0, 1, 0, -1], [1, 2, 1, 0], [2, 3, 0, 1], [3, 0, -1, 0]];   // corner idx, corner idx, normal x, normal z
      const neutral = light ? [90, 70, 160] : [255, 255, 255];
      const reduce = SF.reduceMotion;

      order.forEach((b) => {
        const grow = reduce ? 1 : clamp((now - appearAt) / 1000 * 1.5 - b.col * 0.018, 0, 1);
        const e = 1 - Math.pow(1 - grow, 3);
        const h = Math.max(0.05, b.h * e);
        const isHover = hover === b;
        const base = b.sec > 0 ? mix(accent, accent2, Math.pow(b.ratio, 0.8)) : neutral;
        const flat = b.sec <= 0;
        b.polys = [];

        if (!flat) {
          sides.forEach((sd) => {
            const nxr = sd[2] * c + sd[3] * s;
            const nzr = -sd[2] * s + sd[3] * c;
            if (nzr <= 0.001) return;
            const p0 = corners[sd[0]], p1 = corners[sd[1]];
            const A = P(b.x + p0[0], b.z + p0[1], 0), B = P(b.x + p1[0], b.z + p1[1], 0);
            const C2 = P(b.x + p1[0], b.z + p1[1], h), D = P(b.x + p0[0], b.z + p0[1], h);
            const shade = (0.42 + 0.78 * Math.max(0, nxr * L[0] + nzr * L[2])) * (isHover ? 1.2 : 1);
            const g = ctx.createLinearGradient(0, D[1], 0, A[1]);
            g.addColorStop(0, rgb(base, shade));
            g.addColorStop(1, rgb(base, shade * 0.62));
            poly([A, B, C2, D], g);
            b.polys.push([A, B, C2, D]);
          });
        }
        const T = corners.map((q) => P(b.x + q[0], b.z + q[1], h));
        const topShade = flat ? 1 : (isHover ? 1.35 : 1.12);
        const fill = flat ? 'rgba(' + neutral.join(',') + ',' + (light ? 0.09 : 0.075) + ')' : rgb(mix(base, [255, 255, 255], 0.16), topShade);
        poly(T, fill);
        b.polys.push(T);
        if (isHover) { ctx.lineWidth = 1.5; ctx.strokeStyle = 'rgba(255,255,255,.85)'; ctx.stroke(); }
        b.sx = T[0][0] * 0.25 + T[1][0] * 0.25 + T[2][0] * 0.25 + T[3][0] * 0.25;
        b.sy = T[0][1] * 0.25 + T[1][1] * 0.25 + T[2][1] * 0.25 + T[3][1] * 0.25;
      });
      order.reverse();          // near-to-far for hit testing
      hitOrder = order;
    }
    let hitOrder = [];

    function poly(pts, fill) {
      ctx.beginPath();
      ctx.moveTo(pts[0][0], pts[0][1]);
      for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
      ctx.closePath();
      ctx.fillStyle = fill;
      ctx.fill();
    }
    function inPoly(x, y, pts) {
      let inside = false;
      for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
        const xi = pts[i][0], yi = pts[i][1], xj = pts[j][0], yj = pts[j][1];
        if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
      }
      return inside;
    }
    function hit(x, y) {
      for (let i = 0; i < hitOrder.length; i++) {
        const b = hitOrder[i];
        for (let k = 0; k < b.polys.length; k++) if (inPoly(x, y, b.polys[k])) return b;
      }
      return null;
    }
    function setHover(b) {
      if (b === hover) return;
      hover = b;
      if (!b) { tip.hidden = true; return; }
      tip.hidden = false;
      tip.textContent = b.date.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' }) + ': ' + (b.sec ? fmtShort(b.sec) : 'no study');
      tip.style.left = b.sx + 'px';
      tip.style.top = b.sy + 'px';
    }

    function frame(now) {
      raf = 0;
      if (document.body.dataset.page !== 'insights' || document.hidden) return;
      const dt = Math.min(0.05, (now - last) / 1000 || 0.016);
      last = now;
      if (!SF.reduceMotion && now > idleUntil && !drag) yaw += dt * 0.12;
      draw(now);
      if (hover && tip && !tip.hidden) { tip.style.left = hover.sx + 'px'; tip.style.top = hover.sy + 'px'; }
      raf = requestAnimationFrame(frame);
    }

    return {
      render() {
        init();
        readColors();
        syncRange();
        const first = !bars.length;
        build();
        if (first) appearAt = performance.now();
        if (!raf) { last = performance.now(); raf = requestAnimationFrame(frame); }
      }
    };
  })();

  // ------------------------------------------------------------
  // render + events
  // ------------------------------------------------------------
  function syncControls() {
    $$('#periodSeg button').forEach((b) => b.classList.toggle('on', !view.date && b.dataset.period === view.period));
    const pick = $('#dayPick');
    pick.max = dayKey(new Date());
    pick.value = view.date || '';
    $('#dayClear').hidden = !view.date;
  }

  function render() {
    const errs = [];
    const safe = (name, fn) => { try { fn(); } catch (e) { console.error('Insights ' + name + ':', e); errs.push(name + ': ' + (e && e.message)); } };
    let period = 'week', r = null;
    safe('range', () => { period = currentPeriod(); r = rangeFor(period, currentBase()); });
    if (r) {
      safe('controls', syncControls);
      safe('kpis', () => renderKpis(r, period));
      safe('chart', () => renderChart(r, period));
      safe('subjects', () => renderSubjects(r, period));
      safe('tasks', () => renderDone(r, period));
      safe('trophies', renderBadges);
      safe('skyline', () => Sky.render());
    }
    const sub = $('#insightsSub');
    sub.textContent = errs.length ? 'Part of this page failed to load (' + errs.join('; ') + ')' : 'Where your time actually goes.';
    sub.style.color = errs.length ? 'var(--ember)' : '';
  }

  function wire() {
    view.period = ['today', 'week', 'month', 'year'].indexOf(SF.storage.get('currentStatsPeriod', 'week')) !== -1 ? SF.storage.get('currentStatsPeriod', 'week') : 'week';

    $('#periodSeg').addEventListener('click', (e) => {
      const b = e.target.closest('button[data-period]');
      if (!b) return;
      view.period = b.dataset.period;
      view.date = null;
      SF.storage.set('currentStatsPeriod', view.period);
      render();
    });
    $('#dayPick').addEventListener('change', (e) => { view.date = e.target.value || null; render(); });
    $('#dayClear').addEventListener('click', () => { view.date = null; render(); });

    $('#subjects').addEventListener('click', (e) => {
      const b = e.target.closest('[data-sact]');
      if (!b) return;
      if (b.dataset.sact === 'edit') { view.editingSubject = b.dataset.name; render(); }
      else if (b.dataset.sact === 'remove') removeSubject(b.dataset.name);
    });
    $('#subjects').addEventListener('keydown', (e) => {
      if (!e.target.matches('[data-rename]')) return;
      if (e.key === 'Enter') e.target.blur();
      if (e.key === 'Escape') { view.editingSubject = null; render(); }
    });
    $('#subjects').addEventListener('focusout', (e) => {
      if (!e.target.matches('[data-rename]')) return;
      renameSubject(e.target.dataset.rename, e.target.value);
    });
  }

  wire();
  SF.insights = { render: render };
  SF.badges = badges;
})();

/* ============================================================
   THE SYSTEM  -  daily quests, hunter stats, ranks + trials,
   gates (boss fights) and the shadow legion.
   Lives at the end of script.js. Everything is derived from the
   study data you already have; the game state is stored inside the
   synced `settings.hunter` object, so it follows you across devices.
   All names, art and mechanics here are original.
   ============================================================ */
(function () {
  'use strict';
  const SF = window.SF;
  if (!SF) { console.error('System: SF missing'); return; }
  const { S, $, $$, esc, pad2, dayKey, clamp, fmtShort } = SF;
  const reduce = SF.reduceMotion;

  // ------------------------------------------------------------
  // data
  // ------------------------------------------------------------
  const RANKS = ['E', 'D', 'C', 'B', 'A', 'S'];
  const RANK_TITLES = { E: 'Awakened Novice', D: 'Gate Runner', C: 'Dungeon Regular', B: 'Elite Hunter', A: 'Shadow Vanguard', S: 'Sovereign of Dusk' };
  const TRIALS = { D: { level: 3, min: 30 }, C: { level: 6, min: 45 }, B: { level: 10, min: 60 }, A: { level: 15, min: 90 }, S: { level: 22, min: 120 } };
  const RANK_XP = { D: 100, C: 200, B: 400, A: 800, S: 1500 };

  const SHADOWS = [
    { id: 'scout', name: 'Ashen Scout', title: 'The first to answer', kind: 'blade', scale: 0.8, hint: 'Log your first study session', bonus: { xp: 0.02 }, test: (c) => c.sessions >= 1 },
    { id: 'blade', name: 'Nightblade', title: 'Cuts distractions in half', kind: 'blade', scale: 0.95, hint: 'Reach a 3-day streak', bonus: { xp: 0.02 }, test: (c) => c.best >= 3 },
    { id: 'archer', name: 'Hollow Archer', title: 'Never misses a deadline', kind: 'bow', scale: 0.95, hint: 'Complete 10 tasks', bonus: { quest: 0.05 }, test: (c) => c.tasks >= 10 },
    { id: 'warden', name: 'Grave Warden', title: 'Guards your routine', kind: 'shield', scale: 1.0, hint: 'Reach a 7-day streak', bonus: { xp: 0.03 }, test: (c) => c.best >= 7 },
    { id: 'spear', name: 'Duskspear', title: 'Pierces the syllabus', kind: 'spear', scale: 1.05, hint: 'Study 10 hours in total', bonus: { xp: 0.03 }, test: (c) => c.totalSec >= 36000 },
    { id: 'knight', name: 'Umbral Knight', title: 'Unbroken focus', kind: 'sword', scale: 1.15, hint: 'Finish a 60-minute session without leaving the tab', bonus: { xp: 0.03 }, test: (c) => c.clean >= 3600 },
    { id: 'caller', name: 'Voidcaller', title: 'Answers the daily call', kind: 'staff', scale: 1.1, eye: '#93c5fd', hint: 'Clear all daily quests 3 times', bonus: { quest: 0.08 }, test: (c) => c.clears >= 3 },
    { id: 'sentinel', name: 'Rift Sentinel', title: 'Holds the gate', kind: 'shield', scale: 1.2, hint: 'Reach hunter rank D', bonus: { xp: 0.04 }, test: (c) => c.rank >= 1 },
    { id: 'reaper', name: 'Gate Reaper', title: 'Harvests fallen bosses', kind: 'scythe', scale: 1.2, eye: '#fca5a5', hint: 'Clear a gate', bonus: { xp: 0.04 }, test: (c) => c.gates >= 1 },
    { id: 'marshal', name: 'Ebon Marshal', title: 'Commands the night shift', kind: 'axe', scale: 1.3, hint: 'Reach rank C and study 50 hours', bonus: { xp: 0.05 }, test: (c) => c.rank >= 2 && c.totalSec >= 180000 },
    { id: 'colossus', name: 'Wraith Colossus', title: 'Heavier than any exam', kind: 'club', scale: 1.6, hint: 'Study 100 hours in total', bonus: { xp: 0.05 }, test: (c) => c.totalSec >= 360000 },
    { id: 'general', name: 'Nightfall General', title: 'Leads from the front', kind: 'sword', scale: 1.5, hint: 'Reach hunter rank B', bonus: { xp: 0.06 }, test: (c) => c.rank >= 3 },
    { id: 'sovereign', name: 'Sovereign of Dusk', title: 'Crowned by discipline', kind: 'crown', scale: 1.85, eye: '#f0abfc', hint: 'Reach hunter rank S', bonus: { xp: 0.1 }, test: (c) => c.rank >= 5 }
  ];

  // ------------------------------------------------------------
  // persisted state (inside settings.hunter, synced with the rest)
  // ------------------------------------------------------------
  let inited = false;
  const ready = () => inited && !!S.settings;
  function H() {
    const st = S.settings;
    if (!st.hunter || typeof st.hunter !== 'object') st.hunter = {};
    const h = st.hunter;
    if (!RANKS.includes(h.rank)) h.rank = 'E';
    if (!h.quests || typeof h.quests !== 'object') h.quests = { date: null, list: [], cleanMax: 0, allClear: false, penalty: null };
    if (!Array.isArray(h.quests.list)) h.quests.list = [];
    if (!Array.isArray(h.shadows)) h.shadows = [];
    if (!Array.isArray(h.gates)) h.gates = [];
    ['bonusXp', 'clearDays', 'cleanBest', 'gatesCleared'].forEach((k) => { h[k] = Number(h[k]) || 0; });
    if (h.trial === undefined) h.trial = null;
    return h;
  }
  const save = () => SF.saveSettings();
  const today = () => dayKey(new Date());
  const fmtMin = (m) => (m >= 60 ? Math.floor(m / 60) + 'h' + (m % 60 ? ' ' + (m % 60) + 'm' : '') : m + ' min');

  // ------------------------------------------------------------
  // focus integrity (leaving the tab while a study session runs)
  // ------------------------------------------------------------
  let run = { breaks: 0, away: 0, hiddenAt: 0 };
  try { const r = JSON.parse(sessionStorage.getItem('sf_run')); if (r && typeof r === 'object') run = Object.assign(run, r); } catch (e) { /* ignore */ }
  const persistRun = () => { try { sessionStorage.setItem('sf_run', JSON.stringify(run)); } catch (e) { /* ignore */ } };
  document.addEventListener('visibilitychange', () => {
    const t = S.timer;
    if (!t || !t.isRunning || t.isBreak) return;
    if (document.hidden) { run.hiddenAt = Date.now(); persistRun(); return; }
    if (run.hiddenAt) {
      const away = Date.now() - run.hiddenAt;
      run.hiddenAt = 0;
      if (away > 10000) { run.breaks++; run.away += away; notice('Focus broken', ['You left the tab for ' + Math.round(away / 1000) + 's'], 'warn'); }
      persistRun();
    }
  });

  // ------------------------------------------------------------
  // sound (uses the same "chime" switch as the timer)
  // ------------------------------------------------------------
  let ac = null;
  function A() {
    if (!S.settings.chime) return null;
    const C = window.AudioContext || window.webkitAudioContext;
    if (!C) return null;
    if (!ac) ac = new C();
    if (ac.state === 'suspended') ac.resume();
    return ac;
  }
  function tone(f, t0, dur, type, vol, f2) {
    const c = A(); if (!c) return;
    const o = c.createOscillator(), g = c.createGain(), t = c.currentTime + t0;
    o.type = type; o.frequency.setValueAtTime(f, t);
    if (f2) o.frequency.exponentialRampToValueAtTime(f2, t + dur);
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(vol, t + 0.03); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(c.destination); o.start(t); o.stop(t + dur + 0.05);
  }
  function rumble(t0, dur, vol) {
    const c = A(); if (!c) return;
    const n = c.sampleRate * dur, b = c.createBuffer(1, n, c.sampleRate), d = b.getChannelData(0);
    let last = 0;
    for (let i = 0; i < n; i++) { last = (last + 0.03 * (Math.random() * 2 - 1)) / 1.03; d[i] = last * 4; }
    const s = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain(), t = c.currentTime + t0;
    s.buffer = b; f.type = 'lowpass'; f.frequency.value = 160;
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(vol, t + dur * 0.4); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f); f.connect(g); g.connect(c.destination); s.start(t);
  }
  const sfxBlip = () => { tone(880, 0, 0.09, 'square', 0.03); tone(1320, 0.08, 0.12, 'square', 0.03); };
  const sfxLevel = () => { [523, 659, 784, 1046, 1318].forEach((f, i) => tone(f, i * 0.09, 0.5, 'triangle', 0.07)); };
  function sfxArise() {
    rumble(0, 2.6, 0.7); tone(58, 0.1, 1.8, 'sine', 0.5, 28); tone(116, 0.9, 1.2, 'sawtooth', 0.05, 60);
    [392, 494, 587, 784].forEach((f, i) => tone(f, 2.0 + i * 0.12, 1.4, 'triangle', 0.06));
  }

  // ------------------------------------------------------------
  // system notices (the blue holo windows)
  // ------------------------------------------------------------
  function notice(title, lines, kind) {
    const box = $('#sysNotices');
    if (!box) return;
    const el = document.createElement('div');
    el.className = 'sys-notice ' + (kind || 'info');
    el.innerHTML = '<b>[' + esc(title) + ']</b>' + (lines || []).map((l) => '<span>' + esc(l) + '</span>').join('');
    box.appendChild(el);
    sfxBlip();
    setTimeout(() => el.classList.add('out'), 5200);
    setTimeout(() => el.remove(), 5800);
    while (box.children.length > 4) box.firstChild.remove();
  }

  // ------------------------------------------------------------
  // bonuses / XP
  // ------------------------------------------------------------
  const cursed = () => { const p = H().quests.penalty; return !!(p && !p.done); };
  function bonus(kind) {
    let b = 0;
    H().shadows.forEach((id) => { const sh = SHADOWS.find((x) => x.id === id); if (sh && sh.bonus[kind]) b += sh.bonus[kind]; });
    return b;
  }
  const questMult = () => (cursed() ? 0.5 : 1) * (1 + bonus('quest'));
  function award(xp) {
    const before = SF.levelInfo(SF.xpTotal());
    H().bonusXp += xp;
    save();
    const after = SF.levelInfo(SF.xpTotal());
    if (after.level > before.level) levelUp(before, after);
    if (SF.renderChrome) SF.renderChrome();
  }
  function levelUp(before, after) {
    const h = H();
    const lines = ['Level ' + after.level + ': ' + after.name, 'Stats recalculated'];
    const nr = RANKS[RANKS.indexOf(h.rank) + 1];
    if (nr && after.level >= TRIALS[nr].level && before.level < TRIALS[nr].level) lines.push('Rank ' + nr + ' trial unlocked');
    notice('LEVEL UP', lines, 'level');
    sfxLevel();
    if (window.SFX) window.SFX.Confetti.burst(window.innerWidth / 2, window.innerHeight * 0.35, 120, { colors: ['#4aa8ff', '#8a5cff', '#7cc4ff', '#c4b5fd'] });
    const app = $('#app');
    if (app && !reduce) { app.classList.remove('shake'); void app.offsetWidth; app.classList.add('shake'); }
  }

  // ------------------------------------------------------------
  // daily quests
  // ------------------------------------------------------------
  function makeQuests() {
    const lv = SF.levelInfo(SF.xpTotal()).level;
    const studyMin = clamp(Math.round((45 + lv * 5) / 15) * 15, 45, 180);
    const cleanMin = clamp(Math.round((20 + lv * 2) / 5) * 5, 20, 60);
    return [
      { id: 'study', label: 'Study for ' + fmtMin(studyMin), target: studyMin * 60, xp: 30, done: false },
      { id: 'tasks', label: 'Complete 2 tasks', target: 2, xp: 30, done: false },
      { id: 'clean', label: 'One ' + cleanMin + '-minute session without leaving the tab', target: cleanMin * 60, xp: 30, done: false }
    ];
  }
  // returns { isNew, penalty } when a new day starts
  function ensureQuests() {
    const h = H(), q = h.quests, t = today();
    if (q.date === t) return null;
    const hadPrev = !!(q.date && q.list.length);
    let penalty = null;
    if (hadPrev && !q.list.every((x) => x.done)) penalty = { target: 25 * 60, done: false };
    else if (q.penalty && !q.penalty.done) penalty = { target: 25 * 60, done: false };
    h.quests = { date: t, list: makeQuests(), cleanMax: 0, allClear: false, penalty: penalty };
    save();
    return { first: !hadPrev, penalty: !!penalty };
  }
  function todayStats() {
    const key = today();
    let study = 0;
    S.sessions.forEach((s) => { if (s.type === 'study' && dayKey(new Date(s.date)) === key) study += s.duration || 0; });
    const tasks = S.todos.filter((t) => t.completed && t.completedAt && dayKey(new Date(t.completedAt)) === key).length;
    return { study: study, tasks: tasks, clean: H().quests.cleanMax || 0 };
  }
  const questValue = (x, ts) => (x.id === 'study' ? ts.study : x.id === 'tasks' ? ts.tasks : ts.clean);

  // ------------------------------------------------------------
  // stats (all derived, nothing to fake)
  // ------------------------------------------------------------
  function computeStats() {
    const now = Date.now(), d14 = now - 14 * 864e5, d30 = now - 30 * 864e5;
    const study = S.sessions.filter((s) => s.type === 'study');
    const recent = study.filter((s) => new Date(s.date).getTime() >= d14);
    const recentSec = recent.reduce((t, s) => t + s.duration, 0);
    const avgMin = recent.length ? recentSec / recent.length / 60 : 0;
    const hours = SF.totalStudySec() / 3600;
    const daily = SF.studyDaily();
    let active30 = 0;
    for (let i = 0; i < 30; i++) { const d = new Date(); d.setDate(d.getDate() - i); if (daily.get(dayKey(d)) > 0) active30++; }
    const st = SF.streaks(daily);
    const tasks30 = S.todos.filter((t) => t.completed && t.completedAt && new Date(t.completedAt).getTime() >= d30).length;
    const breakSec = S.sessions.filter((s) => s.type === 'break' && new Date(s.date).getTime() >= d14).reduce((t, s) => t + s.duration, 0);
    const ratio = recentSec ? breakSec / recentSec : 0;
    return [
      { k: 'FOCUS', v: clamp((avgMin / 75) * 100, 0, 100) },
      { k: 'KNOWLEDGE', v: 100 * (1 - Math.exp(-hours / 150)) },
      { k: 'DISCIPLINE', v: clamp((active30 / 30) * 70 + (Math.min(st.current, 30) / 30) * 30, 0, 100) },
      { k: 'SPEED', v: clamp((tasks30 / 30) * 100, 0, 100) },
      { k: 'RECOVERY', v: recentSec ? clamp(100 - (Math.abs(ratio - 0.2) / 0.2) * 100, 0, 100) : 0 }
    ];
  }

  // ------------------------------------------------------------
  // gates (boss fights)
  // ------------------------------------------------------------
  const gateRank = (hrs) => (hrs < 5 ? 'E' : hrs < 12 ? 'D' : hrs < 25 ? 'C' : hrs < 50 ? 'B' : hrs < 100 ? 'A' : 'S');
  function gateState(g) {
    const subj = String(g.subject).trim().toLowerCase();
    const start = new Date(g.created);
    const startKey = dayKey(start);
    const perDay = new Map();
    let dmg = 0;
    S.sessions.forEach((s) => {
      if (s.type !== 'study' || !s.task || String(s.task).trim().toLowerCase() !== subj) return;
      if (new Date(s.date) < start) return;
      dmg += s.duration;
      const k = dayKey(new Date(s.date));
      perDay.set(k, (perDay.get(k) || 0) + s.duration);
    });
    const total = g.hours * 3600;
    let missed = 0;
    const d = parseKeySafe(startKey), end = new Date(); end.setHours(0, 0, 0, 0);
    for (; d < end; d.setDate(d.getDate() + 1)) if (!(perDay.get(dayKey(d)) > 0)) missed++;
    const regen = Math.min(0.3, missed * 0.03) * total;
    const max = total + regen;
    const left = Math.max(0, max - dmg);
    let daysLeft = null;
    if (g.exam) { const e = parseKeySafe(g.exam), n = new Date(); n.setHours(0, 0, 0, 0); daysLeft = Math.round((e - n) / 864e5); }
    return { total: total, max: max, left: left, dmg: dmg, regen: regen, frac: max ? left / max : 0, daysLeft: daysLeft };
  }
  function parseKeySafe(k) { const p = String(k).split('-').map(Number); return new Date(p[0], (p[1] || 1) - 1, p[2] || 1); }

  // ------------------------------------------------------------
  // shadows
  // ------------------------------------------------------------
  function ctxData() {
    const daily = SF.studyDaily(), st = SF.streaks(daily), h = H();
    return {
      totalSec: SF.totalStudySec(), best: st.best, tasks: S.settings.tasksDone || 0,
      sessions: S.sessions.filter((s) => s.type === 'study').length, clean: h.cleanBest,
      rank: RANKS.indexOf(h.rank), clears: h.clearDays, gates: h.gatesCleared
    };
  }
  function checkShadows() {
    const h = H(), c = ctxData(), fresh = [];
    SHADOWS.forEach((sh) => { if (!h.shadows.includes(sh.id) && sh.test(c)) { h.shadows.push(sh.id); fresh.push(sh); } });
    if (!fresh.length) return false;
    fresh.slice(0, 3).forEach((sh) => queueCine({ type: 'arise', shadow: sh }));
    if (fresh.length > 3) notice('Legion', ['+' + (fresh.length - 3) + ' more shadows joined your legion'], 'level');
    return true;
  }

  // ------------------------------------------------------------
  // the check: run after anything that could progress the game
  // ------------------------------------------------------------
  function check() {
    if (!ready()) return;
    ensureQuests();
    const h = H(), q = h.quests, ts = todayStats();
    let changed = false;

    q.list.forEach((x) => {
      if (!x.done && questValue(x, ts) >= x.target) {
        x.done = true; changed = true;
        const gain = Math.round(x.xp * questMult());
        award(gain);
        notice('Quest complete', [x.label, '+' + gain + ' XP'], 'quest');
      }
    });
    if (!q.allClear && q.list.length && q.list.every((x) => x.done)) {
      q.allClear = true; h.clearDays++; changed = true;
      const gain = Math.round(100 * questMult());
      award(gain);
      notice('Daily clear', ['All quests completed', '+' + gain + ' XP bonus'], 'quest');
    }
    if (q.penalty && !q.penalty.done && ts.clean >= q.penalty.target) {
      q.penalty.done = true; changed = true;
      award(20);
      notice('Penalty cleared', ['The curse is lifted.'], 'quest');
    }
    h.gates.forEach((g) => {
      if (g.status !== 'active') return;
      const st = gateState(g);
      if (st.left <= 0) {
        g.status = 'cleared'; g.clearedAt = new Date().toISOString(); h.gatesCleared++; changed = true;
        const xp = Math.round(g.hours * 15);
        award(xp);
        queueCine({ type: 'gate', name: g.subject, xp: xp });
      } else if (g.exam && g.exam < today()) {
        g.status = 'failed'; changed = true;
        notice('Gate collapsed', [g.subject + ': the exam date passed'], 'warn');
      }
    });
    if (checkShadows()) changed = true;
    if (changed) save();
    if (SF.renderChrome) SF.renderChrome();
    if (SF.realm) SF.realm.hud();
    if (document.body.dataset.page === 'system') render();
  }

  // ------------------------------------------------------------
  // hooks called by the app
  // ------------------------------------------------------------
  function onStart() {
    run = { breaks: 0, away: 0, hiddenAt: 0 };
    persistRun();
    const t = H().trial;
    if (t) notice('Trial active', ['Rank ' + t.rank + ': stay in this tab for ' + t.min + ' minutes'], 'warn');
  }
  function onSession(s) {
    if (!ready()) return;
    const h = H();
    ensureQuests();
    const q = h.quests;
    if (s.type === 'study') {
      const dur = s.duration || 0, clean = run.breaks === 0;
      if (clean) { q.cleanMax = Math.max(q.cleanMax || 0, dur); h.cleanBest = Math.max(h.cleanBest, dur); }
      const extra = cursed() ? 0 : Math.floor((dur / 60) * bonus('xp'));
      if (extra > 0) h.bonusXp += extra;
      if (h.trial) {
        const need = h.trial.min * 60;
        if (dur >= need && clean) {
          const nr = h.trial.rank;
          h.rank = nr; h.trial = null; h.bonusXp += RANK_XP[nr];
          queueCine({ type: 'rank', rank: nr });
        } else if (dur >= need) {
          setTimeout(() => notice('Trial failed', ['You left the tab. The trial stays open.'], 'warn'), 700);
        } else if (dur >= 120) {
          setTimeout(() => notice('Trial unfinished', ['That session was shorter than ' + h.trial.min + ' minutes.'], 'warn'), 700);
        }
      }
      if (dur >= 300) {
        const integ = clamp(1 - run.away / 1000 / dur, 0, 1);
        setTimeout(() => notice('Focus report', [Math.round(integ * 100) + '% focus integrity', run.breaks ? run.breaks + ' distraction' + (run.breaks > 1 ? 's' : '') : 'No distractions'], run.breaks ? 'warn' : 'info'), 500);
      }
    }
    run = { breaks: 0, away: 0, hiddenAt: 0 };
    persistRun();
    save();
    setTimeout(check, 1400);
  }

  // ------------------------------------------------------------
  // figure drawing (original hooded shadow soldiers + boss)
  // ------------------------------------------------------------
  function weapon(g, x, y, h, kind, rim) {
    const hx = x + h * 0.2, hy = y - h * 0.46;
    g.save();
    g.lineCap = 'round'; g.lineJoin = 'round';
    g.strokeStyle = 'rgba(221,196,255,.95)'; g.fillStyle = 'rgba(221,196,255,.95)';
    g.shadowColor = 'rgba(' + rim + ',1)'; g.shadowBlur = h * 0.05; g.lineWidth = Math.max(2, h * 0.02);
    const line = (x1, y1, x2, y2) => { g.beginPath(); g.moveTo(x1, y1); g.lineTo(x2, y2); g.stroke(); };
    switch (kind) {
      case 'sword': case 'crown':
        line(hx, hy + h * 0.1, hx + h * 0.05, hy - h * 0.55); line(hx - h * 0.05, hy, hx + h * 0.08, hy - h * 0.02); break;
      case 'blade':
        line(hx, hy + h * 0.05, hx + h * 0.04, hy - h * 0.28); line(x - h * 0.2, hy + h * 0.05, x - h * 0.24, hy - h * 0.26); break;
      case 'spear':
        line(hx, hy + h * 0.28, hx + h * 0.03, hy - h * 0.66);
        g.beginPath(); g.moveTo(hx + h * 0.03, hy - h * 0.78); g.lineTo(hx - h * 0.02, hy - h * 0.62); g.lineTo(hx + h * 0.08, hy - h * 0.62); g.closePath(); g.fill(); break;
      case 'bow':
        g.beginPath(); g.arc(hx - h * 0.1, hy - h * 0.1, h * 0.32, -1.15, 1.15); g.stroke();
        g.lineWidth = Math.max(1, h * 0.006); line(hx - h * 0.1 + Math.cos(-1.15) * h * 0.32, hy - h * 0.1 + Math.sin(-1.15) * h * 0.32, hx - h * 0.1 + Math.cos(1.15) * h * 0.32, hy - h * 0.1 + Math.sin(1.15) * h * 0.32); break;
      case 'shield':
        g.beginPath(); g.ellipse(x - h * 0.22, y - h * 0.42, h * 0.1, h * 0.15, 0, 0, 6.283); g.fillStyle = 'rgba(30,12,60,.95)'; g.fill(); g.stroke();
        line(hx, hy + h * 0.06, hx + h * 0.04, hy - h * 0.34); break;
      case 'staff':
        line(hx, hy + h * 0.3, hx + h * 0.02, hy - h * 0.62);
        g.beginPath(); g.arc(hx + h * 0.02, hy - h * 0.68, h * 0.04, 0, 6.283); g.fill(); break;
      case 'scythe':
        line(hx, hy + h * 0.3, hx + h * 0.03, hy - h * 0.6);
        g.beginPath(); g.arc(hx - h * 0.1, hy - h * 0.6, h * 0.14, -0.3, 2.6, false); g.stroke(); break;
      case 'axe':
        line(hx, hy + h * 0.28, hx + h * 0.03, hy - h * 0.5);
        g.beginPath(); g.moveTo(hx + h * 0.03, hy - h * 0.5); g.quadraticCurveTo(hx + h * 0.2, hy - h * 0.56, hx + h * 0.16, hy - h * 0.32); g.lineTo(hx + h * 0.03, hy - h * 0.4); g.closePath(); g.fill(); break;
      case 'club':
        g.lineWidth = Math.max(4, h * 0.04); line(hx, hy + h * 0.2, hx + h * 0.05, hy - h * 0.5); break;
      default: break;
    }
    g.restore();
  }

  function drawFigure(g, x, y, h, o) {
    o = o || {};
    const t = o.t || 0, alpha = o.alpha == null ? 1 : o.alpha, boss = !!o.boss;
    const rim = boss ? '255,70,96' : '168,85,247';
    g.save();
    g.globalAlpha = alpha;
    const ag = g.createRadialGradient(x, y - h * 0.5, h * 0.05, x, y - h * 0.5, h * 0.9);
    ag.addColorStop(0, 'rgba(' + rim + ',.32)'); ag.addColorStop(1, 'rgba(' + rim + ',0)');
    g.fillStyle = ag; g.beginPath(); g.arc(x, y - h * 0.5, h * 0.9, 0, 6.283); g.fill();

    const w = h * (boss ? 0.36 : 0.3), sh = h * 0.15, hy = y - h * 0.8, hr = h * 0.075;
    for (let i = 0; i < 5; i++) {
      const ph = (t * 0.3 + i * 0.2) % 1, side = i % 2 ? 1 : -1;
      g.globalAlpha = alpha * (1 - ph) * 0.4; g.fillStyle = 'rgba(' + rim + ',1)';
      g.beginPath(); g.ellipse(x + side * (w * 0.9 + Math.sin(ph * 6 + i) * w * 0.25), y - ph * h * 0.62, h * 0.05 * (1 + ph), h * 0.03 * (1 + ph), 0, 0, 6.283); g.fill();
    }
    g.globalAlpha = alpha;
    g.beginPath();
    g.moveTo(x - sh, y - h * 0.68);
    g.bezierCurveTo(x - sh * 1.3, y - h * 0.45, x - w * 1.1, y - h * 0.2, x - w, y);
    const n = 7;
    for (let i = 1; i <= n; i++) g.lineTo(x - w + (2 * w * i) / n, y + Math.sin(t * 2 + i * 1.7) * h * 0.012 + (i % 2 ? h * 0.02 : 0));
    g.bezierCurveTo(x + w * 1.1, y - h * 0.2, x + sh * 1.3, y - h * 0.45, x + sh, y - h * 0.68);
    g.bezierCurveTo(x + sh * 0.9, y - h * 0.74, x + hr * 1.5, y - h * 0.72, x + hr * 1.15, y - h * 0.8);
    g.bezierCurveTo(x + hr * 1.1, y - h * 0.9, x - hr * 1.1, y - h * 0.9, x - hr * 1.15, y - h * 0.8);
    g.bezierCurveTo(x - hr * 1.5, y - h * 0.72, x - sh * 0.9, y - h * 0.74, x - sh, y - h * 0.68);
    g.closePath();
    const bg = g.createLinearGradient(0, y - h, 0, y);
    bg.addColorStop(0, boss ? '#3a0d1c' : '#241246'); bg.addColorStop(0.5, boss ? '#1a0510' : '#0d0620'); bg.addColorStop(1, '#04010a');
    g.fillStyle = bg; g.shadowColor = 'rgba(' + rim + ',.9)'; g.shadowBlur = h * 0.09; g.fill();
    g.shadowBlur = 0; g.lineWidth = Math.max(1, h * 0.008); g.strokeStyle = 'rgba(' + rim + ',.8)'; g.stroke();

    if (boss || o.horns) {
      g.strokeStyle = 'rgba(' + rim + ',.95)'; g.lineWidth = Math.max(2, h * 0.02); g.lineCap = 'round';
      [-1, 1].forEach((s) => { g.beginPath(); g.moveTo(x + s * hr * 0.9, hy - hr * 0.7); g.quadraticCurveTo(x + s * hr * 2.6, hy - hr * 1.2, x + s * hr * 2.2, hy - hr * 3.4); g.stroke(); });
    }
    if (o.kind === 'crown') {
      g.fillStyle = 'rgba(240,171,252,.95)'; g.shadowColor = 'rgba(240,171,252,1)'; g.shadowBlur = h * 0.05;
      g.beginPath(); g.moveTo(x - hr * 1.2, hy - hr * 1.2); g.lineTo(x - hr * 1.2, hy - hr * 2.3); g.lineTo(x - hr * 0.5, hy - hr * 1.6); g.lineTo(x, hy - hr * 2.6);
      g.lineTo(x + hr * 0.5, hy - hr * 1.6); g.lineTo(x + hr * 1.2, hy - hr * 2.3); g.lineTo(x + hr * 1.2, hy - hr * 1.2); g.closePath(); g.fill(); g.shadowBlur = 0;
    }
    const eye = o.eye || (boss ? '#ff4d6d' : '#c4b5fd');
    g.fillStyle = eye; g.shadowColor = eye; g.shadowBlur = h * 0.06;
    [-1, 1].forEach((s) => { g.beginPath(); g.ellipse(x + s * hr * 0.42, hy, hr * 0.3, hr * 0.1, s * 0.25, 0, 6.283); g.fill(); });
    g.shadowBlur = 0;

    weapon(g, x, y, h, boss ? 'club' : o.kind, rim);

    g.restore();
  }

  // ------------------------------------------------------------
  // cinematics (ARISE / RANK UP / GATE CLEARED)
  // ------------------------------------------------------------
  const cine = { q: [], busy: false };
  function queueCine(it) { cine.q.push(it); pump(); }
  function pump() {
    if (cine.busy || !cine.q.length) return;
    cine.busy = true;
    play(cine.q.shift()).then(() => { cine.busy = false; setTimeout(pump, 250); });
  }
  const bonusText = (b) => Object.keys(b || {}).map((k) => '+' + Math.round(b[k] * 100) + '% ' + (k === 'xp' ? 'session XP' : 'quest XP')).join('  ');

  function play(it) {
    return new Promise((resolve) => {
      const ov = $('#arise');
      if (!ov) { resolve(); return; }
      const cv = $('#ariseCanvas'), g = cv.getContext('2d');
      let cfg;
      if (it.type === 'arise') cfg = { word: 'ARISE', kicker: 'Shadow extracted', name: it.shadow.name, sub: it.shadow.title, extra: bonusText(it.shadow.bonus), spec: { kind: it.shadow.kind, eye: it.shadow.eye }, scale: it.shadow.scale };
      else if (it.type === 'rank') cfg = { word: 'RANK UP', kicker: 'Hunter rank', name: 'Rank ' + it.rank, sub: RANK_TITLES[it.rank], extra: '+' + RANK_XP[it.rank] + ' XP', badge: it.rank };
      else cfg = { word: 'GATE CLEARED', kicker: 'Boss defeated', name: it.name, sub: '+' + it.xp + ' XP', extra: '', spec: { boss: true }, scale: 1.3, dissolve: true };

      $('#ariseWord').textContent = cfg.word;
      $('#ariseKicker').textContent = cfg.kicker;
      $('#ariseName').textContent = cfg.name;
      $('#ariseTitle').textContent = cfg.sub;
      $('#ariseBonus').textContent = cfg.extra || '';
      const badge = $('#ariseBadge');
      badge.textContent = cfg.badge || '';
      badge.className = 'arise-badge' + (cfg.badge ? ' show rank-' + cfg.badge : '');
      $('#ariseWord').className = 'arise-word';
      $('#ariseCard').className = 'arise-card';

      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const W = window.innerWidth, Hh = window.innerHeight;
      cv.width = W * dpr; cv.height = Hh * dpr;
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      const ground = Hh * 0.7, figH = Math.min(Hh * 0.44, 400) * clamp(cfg.scale || 1, 0.8, 1.3);
      const embers = [];
      for (let i = 0; i < 46; i++) embers.push({ x: W / 2 + (Math.random() - 0.5) * figH * 0.9, y: ground - Math.random() * 20, v: 0.4 + Math.random() * 1.2, r: 1 + Math.random() * 2, p: Math.random() });

      ov.hidden = false;
      requestAnimationFrame(() => ov.classList.add('on'));
      sfxArise();
      if (window.SFX && !reduce && it.type !== 'arise') window.SFX.Confetti.burst(W / 2, Hh * 0.4, 100, { colors: ['#4aa8ff', '#8a5cff', '#c4b5fd', '#fff'] });

      let raf = 0, closed = false, canClose = false;
      const t0 = performance.now();
      const timers = [];
      const later = (fn, ms) => timers.push(setTimeout(fn, ms));
      later(() => { $('#ariseWord').classList.add('show'); }, 500);
      later(() => { $('#ariseCard').classList.add('show'); }, 2600);
      later(() => { canClose = true; }, 2000);
      later(() => close(), 14000);

      function frame(now) {
        if (closed) return;
        const el = (now - t0) / 1000;
        g.clearRect(0, 0, W, Hh);
        const rg = g.createRadialGradient(W / 2, ground, 10, W / 2, ground, figH * 0.9);
        rg.addColorStop(0, 'rgba(138,92,255,.55)'); rg.addColorStop(1, 'rgba(138,92,255,0)');
        g.fillStyle = rg; g.beginPath(); g.ellipse(W / 2, ground, figH * 0.9, figH * 0.18, 0, 0, 6.283); g.fill();
        if (cfg.spec) {
          const k = clamp((el - 1.0) / 1.6, 0, 1), e = 1 - Math.pow(1 - k, 3);
          const dk = cfg.dissolve ? clamp((el - 2.4) / 1.4, 0, 1) : 0;
          g.save(); g.beginPath(); g.rect(0, 0, W, ground); g.clip();
          drawFigure(g, W / 2, ground + (1 - e) * figH * 0.95, figH, Object.assign({ t: el, alpha: e * (1 - dk) }, cfg.spec));
          g.restore();
        }
        embers.forEach((m) => {
          m.y -= m.v; m.p += 0.01;
          if (m.y < ground - figH * 1.1) { m.y = ground; m.x = W / 2 + (Math.random() - 0.5) * figH * 0.9; }
          g.globalAlpha = clamp((ground - m.y) / (figH * 0.3), 0, 1) * 0.8;
          g.fillStyle = '#c4b5fd'; g.beginPath(); g.arc(m.x + Math.sin(m.p * 6) * 6, m.y, m.r, 0, 6.283); g.fill();
        });
        g.globalAlpha = 1;
        raf = requestAnimationFrame(frame);
      }
      raf = requestAnimationFrame(frame);

      const app = $('#app');
      if (app && !reduce) { app.classList.remove('shake'); void app.offsetWidth; app.classList.add('shake'); }

      function close() {
        if (closed) return;
        closed = true;
        cancelAnimationFrame(raf);
        timers.forEach(clearTimeout);
        ov.classList.remove('on');
        setTimeout(() => { ov.hidden = true; resolve(); }, 500);
        if (SF.renderChrome) SF.renderChrome();
        if (document.body.dataset.page === 'system') render();
      }
      ov.onclick = () => { if (canClose) close(); };
    });
  }

  // ------------------------------------------------------------
  // rendering the System page
  // ------------------------------------------------------------
  const bar = (p, cls) => '<div class="bar-h ' + (cls || '') + '"><i style="width:' + Math.round(clamp(p, 0, 1) * 100) + '%"></i></div>';
  let radarAnim = 0;
  function drawRadar(stats, prog) {
    const cv = $('#sysRadar'); if (!cv) return;
    const g = cv.getContext('2d'), W = cv.width, Hh = cv.height, cx = W / 2, cy = Hh / 2 + 6, R = Math.min(W, Hh) * 0.34, n = stats.length;
    const pt = (i, v) => { const a = -Math.PI / 2 + (i * 2 * Math.PI) / n; return [cx + Math.cos(a) * R * v, cy + Math.sin(a) * R * v]; };
    g.clearRect(0, 0, W, Hh);
    [0.25, 0.5, 0.75, 1].forEach((r) => {
      g.beginPath(); stats.forEach((_, i) => { const p = pt(i, r); if (i) g.lineTo(p[0], p[1]); else g.moveTo(p[0], p[1]); }); g.closePath();
      g.strokeStyle = 'rgba(74,168,255,' + (r === 1 ? 0.55 : 0.18) + ')'; g.lineWidth = 1; g.stroke();
    });
    stats.forEach((_, i) => { const p = pt(i, 1); g.beginPath(); g.moveTo(cx, cy); g.lineTo(p[0], p[1]); g.strokeStyle = 'rgba(74,168,255,.18)'; g.stroke(); });
    const fg = g.createRadialGradient(cx, cy, 0, cx, cy, R);
    fg.addColorStop(0, 'rgba(74,168,255,.55)'); fg.addColorStop(1, 'rgba(138,92,255,.4)');
    g.beginPath();
    stats.forEach((s, i) => { const p = pt(i, Math.max(0.04, (s.v / 100) * prog)); if (i) g.lineTo(p[0], p[1]); else g.moveTo(p[0], p[1]); });
    g.closePath(); g.fillStyle = fg; g.shadowColor = 'rgba(74,168,255,.9)'; g.shadowBlur = 18; g.fill();
    g.shadowBlur = 0; g.strokeStyle = '#7cc4ff'; g.lineWidth = 2; g.stroke();
    g.fillStyle = '#e8f1ff'; g.font = '600 12px Rajdhani, system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    stats.forEach((s, i) => {
      const d = pt(i, Math.max(0.04, (s.v / 100) * prog)); g.beginPath(); g.arc(d[0], d[1], 3.2, 0, 6.283); g.fillStyle = '#fff'; g.fill();
      const p = pt(i, 1.24); g.fillStyle = '#9cc8ff'; g.fillText(s.k, p[0], p[1]);
    });
  }
  function animRadar(stats) {
    cancelAnimationFrame(radarAnim);
    if (reduce) { drawRadar(stats, 1); return; }
    const t0 = performance.now();
    const step = (now) => { const k = clamp((now - t0) / 900, 0, 1); drawRadar(stats, 1 - Math.pow(1 - k, 3)); if (k < 1) radarAnim = requestAnimationFrame(step); };
    radarAnim = requestAnimationFrame(step);
  }

  function render() {
    const msg = $('#sysMsg');
    if (!ready()) { if (msg) { msg.hidden = false; msg.textContent = 'The System is starting up…'; } return; }
    if (msg) msg.hidden = true;
    ensureQuests();
    const h = H(), li = SF.levelInfo(SF.xpTotal()), stats = computeStats();
    const power = Math.round(stats.reduce((t, s) => t + s.v, 0));

    $('#sysName').textContent = ($('#username') && $('#username').textContent) || 'Hunter';
    $('#sysSub').textContent = RANK_TITLES[h.rank];
    const rk = $('#sysRank'); rk.className = 'sys-rank rank-' + h.rank; rk.firstElementChild.textContent = h.rank;

    $('#sysStatus').innerHTML =
      '<div class="lv-row"><span class="lv-num">LV ' + li.level + '</span><span class="lv-name">' + esc(li.name) + '</span><span class="lv-power">POWER <b>' + power + '</b></span></div>' +
      bar(li.pct, 'xp') + '<small class="dim">' + li.xp + ' XP, ' + (li.next - li.xp) + ' to the next level</small>';
    $('#sysStats').innerHTML = stats.map((s) => '<div class="stat-row"><span>' + s.k + '</span>' + bar(s.v / 100) + '<b>' + Math.round(s.v) + '</b></div>').join('');
    animRadar(stats);

    // quests
    const q = h.quests, ts = todayStats();
    const fmtV = (x, v) => (x.id === 'tasks' ? Math.min(v, x.target) + ' / ' + x.target : fmtShort(Math.min(v, x.target)) + ' / ' + fmtShort(x.target));
    let qh = q.list.map((x) => {
      const v = questValue(x, ts);
      return '<div class="q' + (x.done ? ' done' : '') + '"><span class="q-box">' + SF.ico('check') + '</span><div class="q-body"><b>' + esc(x.label) + '</b>' + bar(v / x.target) + '<small>' + fmtV(x, v) + '</small></div><span class="q-xp">+' + Math.round(x.xp * questMult()) + ' XP</span></div>';
    }).join('');
    if (q.penalty) {
      const v = ts.clean;
      qh += '<div class="q penalty' + (q.penalty.done ? ' done' : '') + '"><span class="q-box">' + SF.ico(q.penalty.done ? 'check' : 'lock') + '</span><div class="q-body"><b>Penalty quest: 25 minutes with no distractions</b>' + bar(v / q.penalty.target, 'red') + '<small>' + (q.penalty.done ? 'Cleared' : 'Until cleared, quest XP is halved and shadow bonuses are off') + '</small></div></div>';
    }
    qh += '<small class="dim">' + (q.allClear ? 'Daily clear achieved. Come back tomorrow.' : 'Clear all three for a +100 XP bonus. New quests every day.') + '</small>';
    $('#sysQuests').innerHTML = qh;

    // trial
    const ri = RANKS.indexOf(h.rank), nr = RANKS[ri + 1];
    let th;
    if (!nr) th = '<p class="dim">You stand at the top. There is no higher rank.</p>';
    else {
      const need = TRIALS[nr];
      if (h.trial) th = '<p><b>Rank ' + nr + ' trial is open.</b> Start a focus session and stay in this tab for ' + need.min + ' minutes.</p><button class="btn btn-solid btn-sm" data-go="focus">Go to focus</button>';
      else if (li.level >= need.level) th = '<p>You are ready for the <b>Rank ' + nr + '</b> trial: one ' + need.min + '-minute session without leaving the tab.</p><button class="btn btn-solid btn-sm" data-trial="' + nr + '">Accept trial</button>';
      else th = '<p class="dim">Rank ' + nr + ' trial unlocks at level ' + need.level + ' (you are level ' + li.level + ').</p>' + bar(li.level / need.level);
    }
    $('#sysTrial').innerHTML = th;

    // gates
    const gl = h.gates.slice().sort((a, b) => (a.status === 'active' ? 0 : 1) - (b.status === 'active' ? 0 : 1));
    $('#gateList').innerHTML = gl.length ? gl.map((gt) => {
      const st = gateState(gt), act = gt.status === 'active';
      const info = act
        ? 'HP ' + fmtShort(st.left) + ' / ' + fmtShort(st.max) + (st.regen ? ' (+' + fmtShort(st.regen) + ' regrown)' : '') + (st.daysLeft != null ? ' · ' + (st.daysLeft < 0 ? 'exam passed' : st.daysLeft === 0 ? 'exam today' : st.daysLeft + ' days left') : '')
        : gt.status === 'cleared' ? 'Cleared' : 'Collapsed';
      return '<article class="gate ' + gt.status + ' rank-' + gateRank(gt.hours) + '"><canvas class="gate-cv" width="150" height="150" data-gid="' + esc(gt.id) + '"></canvas><div class="gate-info"><div class="gate-top"><span class="gate-rank">' + gateRank(gt.hours) + '</span><h3>' + esc(gt.subject) + '</h3><button class="mini-btn danger" data-drop="' + esc(gt.id) + '" aria-label="Remove gate">' + SF.ico('x') + '</button></div>' + bar(act ? st.frac : gt.status === 'cleared' ? 0 : 1, 'red') + '<small class="dim">' + esc(info) + '</small>' + (act ? '<button class="btn btn-solid btn-sm" data-fight="' + esc(gt.id) + '">Enter gate</button>' : '') + '</div></article>';
    }).join('') : '<p class="dim">No gates yet. Open one for the subject you fear most.</p>';

    // legion list
    let bx = 0, bq = 0;
    h.shadows.forEach((id) => { const sh = SHADOWS.find((s) => s.id === id); if (sh) { bx += sh.bonus.xp || 0; bq += sh.bonus.quest || 0; } });
    $('#sysLegionList').innerHTML = '<p class="legion-sum">' + h.shadows.length + ' / ' + SHADOWS.length + ' shadows · legion bonus: <b>+' + Math.round(bx * 100) + '% session XP</b>, <b>+' + Math.round(bq * 100) + '% quest XP</b></p>' +
      '<div class="legion-cards">' + SHADOWS.map((sh) => {
        const on = h.shadows.includes(sh.id);
        return '<div class="lc' + (on ? '' : ' locked') + '"><b>' + (on ? esc(sh.name) : '???') + '</b><span>' + (on ? esc(sh.title) : esc(sh.hint)) + '</span><em>' + (on ? esc(bonusText(sh.bonus)) : 'Locked') + '</em></div>';
      }).join('') + '</div>';
    $('#legionEmpty').hidden = h.shadows.length > 0;
    startLoop();
  }

  // ------------------------------------------------------------
  // animated canvases (legion + gate bosses) while the page is open
  // ------------------------------------------------------------
  let raf = 0, last = 0;
  const embers = [];
  for (let i = 0; i < 34; i++) embers.push({ x: Math.random(), y: Math.random(), v: 0.0004 + Math.random() * 0.0012, r: 0.6 + Math.random() * 1.8, p: Math.random() * 6 });

  function drawLegion(t) {
    const cv = $('#legion'); if (!cv) return;
    const wrap = cv.parentNode, dpr = Math.min(window.devicePixelRatio || 1, 2);
    const cw = wrap.clientWidth, ch = wrap.clientHeight;
    if (cv.width !== Math.round(cw * dpr) || cv.height !== Math.round(ch * dpr)) { cv.width = Math.round(cw * dpr); cv.height = Math.round(ch * dpr); }
    const g = cv.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, cw, ch);
    const sky = g.createLinearGradient(0, 0, 0, ch); sky.addColorStop(0, 'rgba(20,8,48,0)'); sky.addColorStop(1, 'rgba(90,40,180,.28)');
    g.fillStyle = sky; g.fillRect(0, 0, cw, ch);
    embers.forEach((m) => { m.y -= m.v * 16; if (m.y < 0) { m.y = 1; m.x = Math.random(); } g.globalAlpha = 0.35 + 0.3 * Math.sin(t * 2 + m.p); g.fillStyle = '#c4b5fd'; g.beginPath(); g.arc(m.x * cw, m.y * ch, m.r, 0, 6.283); g.fill(); });
    g.globalAlpha = 1;
    const list = H().shadows.map((id) => SHADOWS.find((s) => s.id === id)).filter(Boolean).sort((a, b) => b.scale - a.scale);
    const n = list.length;
    if (n) {
      const spacing = Math.min(150, cw / (n + 0.6)), base = ch * 0.62;
      const pos = list.map((sh, k) => ({ sh: sh, k: k, off: (k % 2 ? -1 : 1) * Math.ceil(k / 2) * spacing }));
      pos.slice().reverse().forEach((p) => {
        const depth = p.k === 0 ? 1 : 0.9, hh = clamp(base * p.sh.scale * depth, 60, ch * 0.78);
        drawFigure(g, cw / 2 + p.off, ch * 0.9 - (p.k ? ch * 0.03 : 0), hh, { kind: p.sh.kind, eye: p.sh.eye, t: t + p.k, alpha: p.k ? 0.92 : 1 });
      });
    }
    const fog = g.createLinearGradient(0, ch * 0.7, 0, ch); fog.addColorStop(0, 'rgba(120,60,220,0)'); fog.addColorStop(1, 'rgba(120,60,220,.4)');
    g.fillStyle = fog; g.fillRect(0, ch * 0.7, cw, ch * 0.3);
  }
  function drawBosses(t) {
    const h = H();
    $$('.gate-cv').forEach((cv) => {
      const gt = h.gates.find((x) => x.id === cv.dataset.gid); if (!gt) return;
      const g = cv.getContext('2d'), st = gateState(gt), act = gt.status === 'active';
      g.clearRect(0, 0, cv.width, cv.height);
      const hh = 96 + 26 * (act ? st.frac : 0);
      drawFigure(g, cv.width / 2, cv.height - 8, hh, { boss: true, t: t, alpha: act ? 1 : 0.35 });
    });
  }
  function loop(now) {
    raf = 0;
    if (document.body.dataset.page !== 'system' || document.hidden) return;
    if (now - last > 33) { last = now; const t = now / 1000; drawLegion(t); drawBosses(t); }
    raf = requestAnimationFrame(loop);
  }
  function startLoop() { if (!raf) raf = requestAnimationFrame(loop); }

  // ------------------------------------------------------------
  // events + init
  // ------------------------------------------------------------
  let wired = false;
  function wire() {
    if (wired) return;
    wired = true;
    const page = $('#page-system');
    if (!page) return;
    page.addEventListener('click', (e) => {
      const tr = e.target.closest('[data-trial]');
      if (tr) {
        const h = H(), nr = tr.dataset.trial;
        h.trial = { rank: nr, min: TRIALS[nr].min, accepted: new Date().toISOString() }; save();
        notice('Trial accepted', ['Rank ' + nr + ': one ' + TRIALS[nr].min + '-minute session, no leaving the tab'], 'warn');
        SF.navigate('focus');
        return;
      }
      const fight = e.target.closest('[data-fight]');
      if (fight) {
        const gt = H().gates.find((x) => x.id === fight.dataset.fight);
        if (gt && SF.focusOn) SF.focusOn(gt.subject);
        return;
      }
      const drop = e.target.closest('[data-drop]');
      if (drop) {
        if (!confirm('Remove this gate? Your study history is not affected.')) return;
        const h = H(); h.gates = h.gates.filter((x) => x.id !== drop.dataset.drop); save(); render();
      }
    });
    $('#gateForm').addEventListener('submit', (e) => {
      e.preventDefault();
      const f = e.target, h = H();
      const subject = f.subject.value.trim(), hours = clamp(parseFloat(f.hours.value) || 0, 1, 300);
      if (!subject) { notice('Gate', ['Name the subject first'], 'warn'); return; }
      if (h.gates.filter((x) => x.status === 'active').length >= 6) { notice('Gate', ['You can hold 6 open gates at once'], 'warn'); return; }
      h.gates.push({ id: Date.now().toString(36) + Math.random().toString(36).slice(2, 5), subject: subject, hours: hours, exam: f.exam.value || null, created: new Date().toISOString(), status: 'active' });
      save(); f.reset(); f.hours.value = 10;
      notice('Gate opened', [subject + ': a rank ' + gateRank(hours) + ' boss appears'], 'level');
      render();
    });
  }

  function init() {
    wire();
    if (!S.settings) return;
    inited = true;
    const r = ensureQuests();
    H();
    if (r) {
      if (r.first) notice('System', ['You have awakened.', 'Daily quests are now tracking your progress.'], 'level');
      else notice('Daily quests', ['New quests have arrived.', 'Clear all three for a bonus.'], 'quest');
      if (r.penalty) setTimeout(() => notice('Warning', ['You missed yesterday\'s quests.', 'Penalty quest issued.'], 'warn'), 900);
    }
    setTimeout(check, 1200);
    if (SF.realm) SF.realm.hud();
  }

  SF.system = {
    init: init, render: render, check: check, onStart: onStart, onSession: onSession, levelUp: levelUp,
    rank: () => (ready() ? H().rank : 'E'),
    drawFigure: drawFigure,
    legion: () => (ready() ? H().shadows.map((id) => SHADOWS.find((x) => x.id === id)).filter(Boolean).sort((a, b) => b.scale - a.scale) : []),
    gates: () => (ready() ? H().gates.filter((x) => x.status === 'active').map((x) => Object.assign({}, x, { frac: gateState(x).frac })) : [])
  };
})();

/* ============================================================
   POLISH  -  custom cursor, magnetic buttons, scroll reveal,
   and the hero's "scroll for more" control.
   ============================================================ */
(function () {
  'use strict';
  const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const fine = window.matchMedia && window.matchMedia('(hover: hover) and (pointer: fine)').matches;

  // ---------- custom cursor ----------
  if (fine && !reduce) {
    const dot = document.getElementById('cursorDot'), ring = document.getElementById('cursorRing');
    if (dot && ring) {
      document.documentElement.classList.add('has-cursor');
      let rx = -100, ry = -100, tx = -100, ty = -100, raf = 0;
      const move = () => { rx += (tx - rx) * 0.18; ry += (ty - ry) * 0.18; dot.style.transform = 'translate(' + tx + 'px,' + ty + 'px)'; ring.style.transform = 'translate(' + rx + 'px,' + ry + 'px)'; raf = requestAnimationFrame(move); };
      document.addEventListener('pointermove', (e) => { tx = e.clientX; ty = e.clientY; if (!raf) raf = requestAnimationFrame(move); });
      document.addEventListener('pointerdown', () => ring.classList.add('on'));
      document.addEventListener('pointerup', () => ring.classList.remove('on'));
      document.addEventListener('pointerover', (e) => { if (e.target.closest('a, button, input, [role="tab"], .task, [data-go]')) ring.classList.add('on'); });
      document.addEventListener('pointerout', (e) => { if (e.target.closest('a, button, input, [role="tab"], .task, [data-go]')) ring.classList.remove('on'); });
    }
  }

  // ---------- magnetic buttons ----------
  if (fine && !reduce) {
    const SEL = '.btn-solid, .big-btn, .dock a, .hero-scroll';
    document.addEventListener('pointermove', (e) => {
      const el = e.target.closest(SEL);
      document.querySelectorAll(SEL).forEach((b) => { if (b !== el) b.style.transform = ''; });
      if (!el) return;
      const r = el.getBoundingClientRect(), mx = e.clientX - (r.left + r.width / 2), my = e.clientY - (r.top + r.height / 2);
      if (Math.hypot(mx, my) > Math.max(r.width, r.height) * 0.9) { el.style.transform = ''; return; }
      el.style.transform = 'translate(' + (mx * 0.22).toFixed(1) + 'px,' + (my * 0.22).toFixed(1) + 'px)';
    });
    document.addEventListener('pointerleave', () => { document.querySelectorAll(SEL).forEach((b) => { b.style.transform = ''; }); });
  }

  // ---------- scroll reveal ----------
  if ('IntersectionObserver' in window) {
    const io = new IntersectionObserver((entries) => {
      entries.forEach((en) => { if (en.isIntersecting) { en.target.classList.add('in'); io.unobserve(en.target); } });
    }, { threshold: 0.14, rootMargin: '0px 0px -60px 0px' });
    const tag = () => document.querySelectorAll('.tile:not(.reveal):not(.in), .panel:not(.reveal):not(.in)').forEach((el, i) => {
      el.classList.add('reveal'); el.style.transitionDelay = Math.min(i * 45, 260) + 'ms';
      io.observe(el);
    });
    tag();
    new MutationObserver(tag).observe(document.getElementById('app') || document.body, { childList: true, subtree: true });
  }

  // ---------- hero scroll cue ----------
  const cue = document.getElementById('heroScroll');
  if (cue) cue.addEventListener('click', () => { const b = document.querySelector('.bento'); if (b) b.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' }); });
})();