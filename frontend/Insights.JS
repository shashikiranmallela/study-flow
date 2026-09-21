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