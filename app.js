(() => {
  'use strict';

  // ─── Constants ────────────────────────────────────────────────────────────
  const SPORT_TYPES = { endurance: 'Endurance', strength: 'Strength', mixed: 'Mixed' };
  const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];

  const DEFAULT = {
    version: 1,
    settings: { theme: 'dark', units: 'metric', weekStart: 1 },
    sports: [
      { id: 'run',   name: 'Running',       color: '#6ea8ff', type: 'endurance' },
      { id: 'cycle', name: 'Cycling',       color: '#4ade80', type: 'endurance' },
      { id: 'swim',  name: 'Swimming',      color: '#38bdf8', type: 'endurance' },
      { id: 'lift',  name: 'Weightlifting', color: '#f97316', type: 'strength'  },
      { id: 'climb', name: 'Climbing',      color: '#a78bfa', type: 'mixed'     }
    ],
    workouts: [], plans: [], goals: [], body: [], journal: []
  };

  let S = {};
  let currentView = 'dashboard';
  let filterSport = '';
  let calYear, calMonth;
  let wSearch = '';

  // ─── Storage ──────────────────────────────────────────────────────────────
  function load() {
    try { S = Object.assign({}, DEFAULT, JSON.parse(localStorage.getItem('tracktic') || '{}')); }
    catch { S = JSON.parse(JSON.stringify(DEFAULT)); }
    for (const k of Object.keys(DEFAULT)) if (S[k] === undefined) S[k] = DEFAULT[k];
  }
  const save = () => localStorage.setItem('tracktic', JSON.stringify(S));

  // ─── Utils ────────────────────────────────────────────────────────────────
  const uid = () => Math.random().toString(36).slice(2, 9) + Date.now().toString(36);
  const today = () => new Date().toISOString().slice(0, 10);
  const sport = id => S.sports.find(s => s.id === id) || {};
  const sportColor = id => sport(id).color || '#6ea8ff';
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

  function fmtDuration(min) {
    if (!min) return '—';
    const h = Math.floor(min / 60), m = Math.round(min % 60);
    return h ? `${h}h ${m}m` : `${m}m`;
  }
  function fmtDist(km) {
    if (!km) return '';
    if (S.settings.units === 'imperial') return `${(km * 0.621371).toFixed(1)} mi`;
    return km < 1 ? `${Math.round(km * 1000)}m` : `${km.toFixed(1)} km`;
  }
  function fmtPace(secPerKm) {
    if (!secPerKm) return '';
    let v = secPerKm;
    if (S.settings.units === 'imperial') v = v / 0.621371;
    const m = Math.floor(v / 60), s = Math.round(v % 60);
    return `${m}:${String(s).padStart(2,'0')}${S.settings.units === 'imperial' ? '/mi' : '/km'}`;
  }
  const calcPace = (km, min) => (km && min) ? (min * 60) / km : 0;
  const oneRM = (w, r) => (w && r) ? Math.round(w * (1 + r / 30)) : 0;

  function isoDay(d) { return d.toISOString().slice(0, 10); }
  function parseDate(s) { return new Date(s + 'T00:00:00'); }
  function daysBetween(a, b) { return Math.round((parseDate(b) - parseDate(a)) / 86400000); }

  // ─── Toast ────────────────────────────────────────────────────────────────
  let toastTimer;
  function toast(msg) {
    const el = document.getElementById('toast');
    el.textContent = msg; el.classList.remove('hidden');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.add('hidden'), 2400);
  }

  // ─── Modal ────────────────────────────────────────────────────────────────
  function openModal(title, html) {
    document.getElementById('modal-title').textContent = title;
    document.getElementById('modal-body').innerHTML = html;
    document.getElementById('modal').classList.remove('hidden');
  }
  const closeModal = () => document.getElementById('modal').classList.add('hidden');

  // ─── Router ───────────────────────────────────────────────────────────────
  const TITLES = {
    dashboard:'Dashboard', calendar:'Calendar', workouts:'Workouts', plans:'Plans',
    goals:'Goals', stats:'Stats', records:'Records', body:'Body',
    journal:'Journal', sports:'Sports', settings:'Settings'
  };
  const RENDERERS = {};

  function navigate(v) {
    currentView = v;
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.toggle('active', b.dataset.view === v));
    document.getElementById('view-title').textContent = TITLES[v] || v;
    document.getElementById('view').innerHTML = '';
    (RENDERERS[v] || (() => {}))();
    document.getElementById('sidebar').classList.remove('open');
  }

  function refreshFilter() {
    const sel = document.getElementById('sport-filter');
    sel.innerHTML = '<option value="">All sports</option>' +
      S.sports.map(s => `<option value="${s.id}">${esc(s.name)}</option>`).join('');
    sel.value = filterSport;
  }

  // ─── Helpers shared across views ──────────────────────────────────────────
  function weekBounds(date) {
    const ws = S.settings.weekStart;
    const d = new Date(date); d.setHours(0,0,0,0);
    const diff = ((d.getDay() - ws) + 7) % 7;
    const start = new Date(d); start.setDate(d.getDate() - diff);
    const end = new Date(start); end.setDate(start.getDate() + 6); end.setHours(23,59,59,999);
    return { start, end, ss: isoDay(start), es: isoDay(end) };
  }

  function calcStreak() {
    const dates = [...new Set(S.workouts.map(w => w.date))].sort().reverse();
    if (!dates.length) return 0;
    let streak = 0;
    let cur = new Date(); cur.setHours(0,0,0,0);
    const todayS = isoDay(cur);
    if (dates[0] !== todayS && daysBetween(dates[0], todayS) > 1) return 0;
    let prev = parseDate(dates[0]);
    streak = 1;
    for (let i = 1; i < dates.length; i++) {
      const d = parseDate(dates[i]);
      if (Math.round((prev - d) / 86400000) === 1) { streak++; prev = d; }
      else break;
    }
    return streak;
  }

  function getPlanSessions(rangeStart, rangeEnd) {
    const out = [];
    for (const plan of S.plans) {
      if (!plan.startDate || !plan.weeks) continue;
      const ps = parseDate(plan.startDate);
      for (let w = 0; w < plan.weeks; w++) {
        for (const sess of (plan.sessions || [])) {
          const d = new Date(ps);
          d.setDate(d.getDate() + w * 7 + (sess.dayOfWeek || 0));
          const ds = isoDay(d);
          if (ds >= rangeStart && ds <= rangeEnd) {
            out.push({ ...sess, date: ds, planId: plan.id, sportId: sess.sportId || plan.sportId });
          }
        }
      }
    }
    return out.sort((a, b) => a.date.localeCompare(b.date));
  }

  function goalPct(g) {
    const vals = g.progress || [];
    if (!vals.length) return 0;
    const latest = vals[vals.length - 1].value;
    return Math.max(0, Math.min(100, Math.round((latest / g.target) * 100)));
  }

  // ─── PR detection ─────────────────────────────────────────────────────────
  function detectPRs(w) {
    const prs = [];
    const sp = sport(w.sportId);
    const others = S.workouts.filter(x => x.id !== w.id && x.sportId === w.sportId);

    if (sp.type === 'endurance' || sp.type === 'mixed') {
      if (w.distance) {
        const best = Math.max(0, ...others.map(x => x.distance || 0));
        if (w.distance > best) prs.push({ label: `Longest ${sp.name}`, display: fmtDist(w.distance) });
      }
      if (w.pace && w.distance >= 1) {
        const peers = others.filter(x => x.pace && x.distance >= 1);
        const bestPace = peers.length ? Math.min(...peers.map(x => x.pace)) : Infinity;
        if (w.pace < bestPace) prs.push({ label: 'Best pace', display: fmtPace(w.pace) });
      }
      if (w.duration) {
        const best = Math.max(0, ...others.map(x => x.duration || 0));
        if (w.duration > best) prs.push({ label: 'Longest session', display: fmtDuration(w.duration) });
      }
    }
    if (sp.type === 'strength' && w.exercises) {
      const prevMap = {};
      for (const pw of others) for (const ex of (pw.exercises || [])) {
        const k = (ex.name || '').toLowerCase();
        const best = Math.max(0, ...(ex.sets || []).map(s => oneRM(s.weight, s.reps)));
        if (best && (!prevMap[k] || prevMap[k] < best)) prevMap[k] = best;
      }
      for (const ex of w.exercises) {
        const k = (ex.name || '').toLowerCase();
        const best = Math.max(0, ...(ex.sets || []).map(s => oneRM(s.weight, s.reps)));
        if (best && best > (prevMap[k] || 0)) prs.push({ label: `${ex.name} (est. 1RM)`, display: `${best} kg` });
      }
    }
    w._prs = prs;
  }

  function getAllRecords() {
    const recs = [];
    for (const sp of S.sports) {
      const wks = S.workouts.filter(w => w.sportId === sp.id);
      if (!wks.length) continue;
      if (sp.type === 'endurance' || sp.type === 'mixed') {
        const byDist = wks.filter(w => w.distance).sort((a,b) => b.distance - a.distance)[0];
        if (byDist) recs.push({ sportId: sp.id, label: 'Longest distance', display: fmtDist(byDist.distance), date: byDist.date });
        const byPace = wks.filter(w => w.pace && w.distance >= 1).sort((a,b) => a.pace - b.pace)[0];
        if (byPace) recs.push({ sportId: sp.id, label: 'Best pace', display: fmtPace(byPace.pace), date: byPace.date });
        const byDur = [...wks].sort((a,b) => (b.duration||0) - (a.duration||0))[0];
        if (byDur && byDur.duration) recs.push({ sportId: sp.id, label: 'Longest session', display: fmtDuration(byDur.duration), date: byDur.date });
      }
      if (sp.type === 'strength') {
        const byEx = {};
        for (const w of wks) for (const ex of (w.exercises || [])) {
          const k = (ex.name || '').toLowerCase();
          const best = Math.max(0, ...(ex.sets || []).map(s => oneRM(s.weight, s.reps)));
          if (best && (!byEx[k] || byEx[k].value < best)) byEx[k] = { value: best, name: ex.name, date: w.date };
        }
        for (const r of Object.values(byEx)) {
          recs.push({ sportId: sp.id, label: `${r.name} (est. 1RM)`, display: `${r.value} kg`, date: r.date });
        }
      }
    }
    return recs;
  }

  // ─── VIEW: Dashboard ──────────────────────────────────────────────────────
  RENDERERS.dashboard = function() {
    const el = document.getElementById('view');
    const { ss, es } = weekBounds(new Date());
    const filtered = S.workouts.filter(w => !filterSport || w.sportId === filterSport);
    const thisWeek = filtered.filter(w => w.date >= ss && w.date <= es);
    const totalDur = thisWeek.reduce((a, w) => a + (w.duration || 0), 0);
    const totalDist = thisWeek.reduce((a, w) => a + (w.distance || 0), 0);
    const streak = calcStreak();
    const upcoming = getPlanSessions(today(), isoDay(new Date(Date.now() + 7 * 86400000)));
    const activeGoals = S.goals.filter(g => !g.achieved);
    const recentPRs = [];
    for (const w of [...S.workouts].sort((a,b) => b.date.localeCompare(a.date))) {
      if (recentPRs.length >= 5) break;
      for (const pr of (w._prs || [])) recentPRs.push({ ...pr, sportId: w.sportId, date: w.date });
    }

    el.innerHTML = `
      <div class="grid cols-4" style="margin-bottom:18px">
        <div class="card"><h3>Sessions</h3><div class="kpi"><span class="big">${thisWeek.length}</span></div><div class="sub">This week</div></div>
        <div class="card"><h3>Duration</h3><div class="kpi"><span class="big">${fmtDuration(totalDur)}</span></div><div class="sub">This week</div></div>
        <div class="card"><h3>Distance</h3><div class="kpi"><span class="big">${fmtDist(totalDist) || '—'}</span></div><div class="sub">This week</div></div>
        <div class="card"><h3>Streak</h3><div class="kpi"><span class="big">${streak}</span></div><div class="sub">days in a row</div></div>
      </div>
      <div class="grid cols-2">
        <div>
          <div class="section-head"><h3>Upcoming sessions</h3></div>
          <div class="list">${upcoming.length ? upcoming.slice(0,5).map(s => {
            const sp = sport(s.sportId);
            return `<div class="list-item">
              <span class="tag dot" style="--sport-color:${sp.color}">${esc(s.date)}</span>
              <div class="row"><div><strong>${esc(s.title || 'Session')}</strong>
                <div class="meta">${esc(sp.name || '')}${s.duration ? ' · ' + fmtDuration(s.duration) : ''}${s.distance ? ' · ' + fmtDist(s.distance) : ''}</div>
              </div>
              <button class="ghost log-from-plan" data-sport="${s.sportId}" data-date="${s.date}" data-title="${esc(s.title||'')}" style="margin-left:auto">Log it</button>
              </div></div>`;
          }).join('') : '<p class="empty">No planned sessions. <a href="#" id="go-plans">Create a plan →</a></p>'}</div>
        </div>
        <div>
          <div class="section-head"><h3>Active goals</h3></div>
          <div class="list">${activeGoals.length ? activeGoals.slice(0,4).map(g => {
            const sp = sport(g.sportId), pct = goalPct(g);
            return `<div class="list-item" style="flex-direction:column;align-items:stretch;gap:6px">
              <div class="row-flex">
                <span class="tag dot" style="--sport-color:${sp.color}">${esc(sp.name || '')}</span>
                <strong>${esc(g.title)}</strong>
                <span class="muted" style="margin-left:auto">${esc(g.deadline)}</span>
              </div>
              <div class="progress"><span style="width:${pct}%"></span></div>
              <div class="meta">${pct}% · target: ${esc(g.target)}${g.unit ? ' ' + esc(g.unit) : ''}</div>
            </div>`;
          }).join('') : '<p class="empty">No active goals. <a href="#" id="go-goals">Set a goal →</a></p>'}</div>
        </div>
      </div>
      <div class="section-head"><h3>Recent records</h3></div>
      <div class="list">${recentPRs.length ? recentPRs.map(r => `
        <div class="list-item">
          <span class="tag dot" style="--sport-color:${sportColor(r.sportId)}">${esc(sport(r.sportId).name || '')}</span>
          <div class="row"><span><strong>${esc(r.label)}</strong>: ${esc(r.display)}</span>
          <span class="muted" style="margin-left:auto">${esc(r.date)}</span></div>
        </div>`).join('') : '<p class="empty">Log workouts to see PRs here.</p>'}
      </div>`;
    el.querySelector('#go-plans')?.addEventListener('click', e => { e.preventDefault(); navigate('plans'); });
    el.querySelector('#go-goals')?.addEventListener('click', e => { e.preventDefault(); navigate('goals'); });
    el.querySelectorAll('.log-from-plan').forEach(b => b.addEventListener('click', () => {
      openWorkoutModal(null, b.dataset.date, b.dataset.sport, b.dataset.title);
    }));
  };

  // ─── VIEW: Calendar ───────────────────────────────────────────────────────
  RENDERERS.calendar = function() {
    if (calYear === undefined) {
      const n = new Date(); calYear = n.getFullYear(); calMonth = n.getMonth();
    }
    renderCalendar();
  };

  function renderCalendar() {
    const el = document.getElementById('view');
    const monthStart = new Date(calYear, calMonth, 1);
    const monthEnd = new Date(calYear, calMonth + 1, 0);
    const monthPrefix = `${calYear}-${String(calMonth+1).padStart(2,'0')}`;
    const todayStr = today();

    const events = {};
    for (const w of S.workouts) {
      if (filterSport && w.sportId !== filterSport) continue;
      if (!w.date.startsWith(monthPrefix)) continue;
      (events[w.date] ||= []).push({ title: w.title || 'Workout', sportId: w.sportId, type: 'workout', id: w.id });
    }
    const monthStartStr = `${monthPrefix}-01`;
    const monthEndStr = `${monthPrefix}-${String(monthEnd.getDate()).padStart(2,'0')}`;
    for (const sess of getPlanSessions(monthStartStr, monthEndStr)) {
      if (filterSport && sess.sportId !== filterSport) continue;
      (events[sess.date] ||= []).push({ title: sess.title, sportId: sess.sportId, type: 'plan' });
    }

    const ws = S.settings.weekStart;
    const offset = ((monthStart.getDay() - ws) + 7) % 7;
    let cells = '';
    for (let i = 0; i < offset; i++) cells += '<div class="cal-cell dim"></div>';
    for (let d = 1; d <= monthEnd.getDate(); d++) {
      const ds = `${monthPrefix}-${String(d).padStart(2,'0')}`;
      const ev = events[ds] || [];
      const pills = ev.slice(0, 3).map(e => `<div class="pill ${e.type==='workout'?'done':''}" style="--sport-color:${sportColor(e.sportId)}">${esc(e.title)}</div>`).join('');
      cells += `<div class="cal-cell${ds === todayStr ? ' today' : ''}" data-date="${ds}">
        <div class="date">${d}</div>${pills}
        ${ev.length > 3 ? `<div class="meta">+${ev.length-3} more</div>` : ''}
      </div>`;
    }
    const dow = [...Array(7)].map((_, i) => `<div class="dow">${DAYS[(i+ws)%7]}</div>`).join('');

    el.innerHTML = `
      <div class="cal-head">
        <button class="ghost" id="cal-prev">◀</button>
        <strong>${MONTHS[calMonth]} ${calYear}</strong>
        <button class="ghost" id="cal-next">▶</button>
      </div>
      <div class="calendar">${dow}${cells}</div>
      <p class="muted" style="margin-top:10px;font-size:0.85rem">Click a day to log a workout. Striked-through pills are completed; solid pills are planned.</p>`;

    el.querySelector('#cal-prev').addEventListener('click', () => { if (--calMonth < 0) { calMonth = 11; calYear--; } renderCalendar(); });
    el.querySelector('#cal-next').addEventListener('click', () => { if (++calMonth > 11) { calMonth = 0; calYear++; } renderCalendar(); });
    el.querySelectorAll('.cal-cell:not(.dim)').forEach(c => c.addEventListener('click', () => openWorkoutModal(null, c.dataset.date)));
  }

  // ─── VIEW: Workouts ───────────────────────────────────────────────────────
  RENDERERS.workouts = function() {
    const el = document.getElementById('view');
    const q = wSearch.toLowerCase();
    const list = S.workouts
      .filter(w => !filterSport || w.sportId === filterSport)
      .filter(w => !q || (w.title || '').toLowerCase().includes(q) || (w.notes || '').toLowerCase().includes(q))
      .sort((a, b) => b.date.localeCompare(a.date));
    el.innerHTML = `
      <div class="section-head">
        <input id="w-search" placeholder="Search workouts…" value="${esc(wSearch)}" style="max-width:280px">
        <button class="primary" id="add-workout" style="width:auto">+ Log workout</button>
      </div>
      <div class="list">${list.length ? list.map(renderWorkoutRow).join('') : '<p class="empty">No workouts yet. Log your first!</p>'}</div>`;
    el.querySelector('#add-workout').addEventListener('click', () => openWorkoutModal());
    el.querySelector('#w-search').addEventListener('input', e => { wSearch = e.target.value; RENDERERS.workouts(); });
    el.querySelectorAll('.edit-workout').forEach(b => b.addEventListener('click', () => openWorkoutModal(b.dataset.id)));
    el.querySelectorAll('.del-workout').forEach(b => b.addEventListener('click', () => {
      if (confirm('Delete this workout?')) {
        S.workouts = S.workouts.filter(x => x.id !== b.dataset.id);
        save(); RENDERERS.workouts(); toast('Deleted.');
      }
    }));
  };

  function renderWorkoutRow(w) {
    const sp = sport(w.sportId);
    const prs = w._prs?.length ? `<span class="tag" style="color:var(--warn)">★ PR×${w._prs.length}</span>` : '';
    const dist = w.distance ? fmtDist(w.distance) : '';
    const pace = w.pace ? ' · ' + fmtPace(w.pace) : '';
    const meta = [w.duration ? fmtDuration(w.duration) : '', dist + pace, w.rpe ? `RPE ${w.rpe}` : ''].filter(Boolean).join(' · ');
    return `<div class="list-item">
      <span class="tag dot" style="--sport-color:${sp.color}">${esc(sp.name || w.sportId)}</span>
      <div class="row">
        <div style="flex:1;min-width:0">
          <div class="row-flex"><strong>${esc(w.title || 'Workout')}</strong>${prs}</div>
          <div class="meta">${esc(w.date)}${meta ? ' · ' + meta : ''}</div>
          ${w.notes ? `<div class="meta" style="margin-top:2px;font-style:italic">${esc(w.notes)}</div>` : ''}
        </div>
        <div class="actions">
          <button class="ghost edit-workout" data-id="${w.id}">Edit</button>
          <button class="danger del-workout" data-id="${w.id}">✕</button>
        </div>
      </div>
    </div>`;
  }

  // ─── Workout modal ────────────────────────────────────────────────────────
  function openWorkoutModal(id, preDate, preSportId, preTitle) {
    const w = id ? S.workouts.find(x => x.id === id) : null;
    const selSport = w?.sportId || preSportId || S.sports[0]?.id || '';
    const sportOpts = S.sports.map(s => `<option value="${s.id}" ${selSport === s.id ? 'selected' : ''}>${esc(s.name)}</option>`).join('');
    openModal(w ? 'Edit workout' : 'Log workout', `
      <form id="workout-form">
        <div class="field-row">
          <div class="field"><label>Sport</label><select id="wf-sport">${sportOpts}</select></div>
          <div class="field"><label>Date</label><input type="date" id="wf-date" value="${esc(w?.date || preDate || today())}" required></div>
        </div>
        <div class="field"><label>Title</label><input id="wf-title" value="${esc(w?.title || preTitle || '')}" placeholder="e.g. Easy run"></div>
        <div id="wf-sport-fields">${sportFields(selSport, w)}</div>
        <div class="field-row">
          <div class="field"><label>Duration (min)</label><input type="number" id="wf-duration" min="0" value="${w?.duration || ''}"></div>
          <div class="field"><label>RPE (1–10)</label><input type="number" id="wf-rpe" min="1" max="10" value="${w?.rpe || ''}"></div>
        </div>
        <div class="field"><label>Notes</label><textarea id="wf-notes">${esc(w?.notes || '')}</textarea></div>
        <div class="form-actions">
          <button type="button" class="ghost" id="wf-cancel">Cancel</button>
          <button type="submit" class="primary">Save</button>
        </div>
      </form>`);
    document.getElementById('wf-sport').addEventListener('change', e => {
      document.getElementById('wf-sport-fields').innerHTML = sportFields(e.target.value);
    });
    document.getElementById('wf-cancel').addEventListener('click', closeModal);
    document.getElementById('workout-form').addEventListener('submit', e => { e.preventDefault(); saveWorkout(w?.id); });
  }

  function sportFields(sportId, w) {
    const sp = sport(sportId);
    const t = sp.type || 'endurance';
    if (t === 'strength') {
      return `<div class="section-head" style="margin-top:4px"><h3 style="font-size:0.9rem">Exercises</h3>
        <button type="button" class="ghost" id="add-exercise" style="width:auto;padding:4px 10px">+ Exercise</button></div>
        <div id="exercise-list">${renderExercises(w?.exercises || [])}</div>`;
    }
    return `<div class="field-row">
      <div class="field"><label>Distance (km)</label><input type="number" id="wf-distance" step="0.01" min="0" value="${w?.distance ?? ''}"></div>
      <div class="field"><label>Elevation (m)</label><input type="number" id="wf-elevation" min="0" value="${w?.elevation ?? ''}"></div>
    </div>`;
  }

  function renderExercises(exs) {
    if (!exs.length) return '<p class="muted" style="font-size:0.85rem">No exercises yet. Click + Exercise.</p>';
    return exs.map((ex, i) => `
      <div class="exercise-row" data-i="${i}" style="border:1px solid var(--border);border-radius:8px;padding:10px;margin-bottom:8px">
        <div class="field-row">
          <div class="field"><label>Exercise</label><input class="ex-name" value="${esc(ex.name || '')}" placeholder="e.g. Bench press"></div>
          <button type="button" class="danger rem-ex" style="align-self:flex-end;margin-bottom:1px">Remove</button>
        </div>
        <div class="sets-list">${(ex.sets || []).map((s, si) => `
          <div class="field-row set-row" data-si="${si}">
            <div class="field"><label>Weight (kg)</label><input type="number" class="set-w" step="0.5" min="0" value="${s.weight ?? ''}"></div>
            <div class="field"><label>Reps</label><input type="number" class="set-r" min="0" value="${s.reps ?? ''}"></div>
          </div>`).join('')}</div>
        <button type="button" class="ghost add-set" style="width:auto;padding:4px 10px;margin-top:4px">+ Set</button>
      </div>`).join('');
  }

  function gatherExercises() {
    return [...document.querySelectorAll('#exercise-list .exercise-row')].map(row => {
      const name = row.querySelector('.ex-name').value;
      const ws = [...row.querySelectorAll('.set-w')];
      const rs = [...row.querySelectorAll('.set-r')];
      const sets = ws.map((el, i) => ({ weight: parseFloat(el.value) || 0, reps: parseInt(rs[i].value) || 0 })).filter(s => s.reps);
      return { name, sets };
    }).filter(ex => ex.name);
  }

  document.getElementById('modal-body').addEventListener('click', e => {
    if (e.target.id === 'add-exercise') {
      const cur = gatherExercises();
      cur.push({ name: '', sets: [{ weight: 0, reps: 0 }] });
      document.getElementById('exercise-list').innerHTML = renderExercises(cur);
    } else if (e.target.classList.contains('rem-ex')) {
      const cur = gatherExercises();
      const i = +e.target.closest('.exercise-row').dataset.i;
      cur.splice(i, 1);
      document.getElementById('exercise-list').innerHTML = renderExercises(cur);
    } else if (e.target.classList.contains('add-set')) {
      const cur = gatherExercises();
      const i = +e.target.closest('.exercise-row').dataset.i;
      if (cur[i]) cur[i].sets = [...(cur[i].sets || []), { weight: 0, reps: 0 }];
      document.getElementById('exercise-list').innerHTML = renderExercises(cur);
    }
  });

  function saveWorkout(id) {
    const sportId = document.getElementById('wf-sport').value;
    const sp = sport(sportId);
    const distEl = document.getElementById('wf-distance');
    const eleEl = document.getElementById('wf-elevation');
    const distance = distEl ? parseFloat(distEl.value) || 0 : 0;
    const elevation = eleEl ? parseInt(eleEl.value) || 0 : 0;
    const duration = parseInt(document.getElementById('wf-duration').value) || 0;
    const exercises = sp.type === 'strength' ? gatherExercises() : [];
    const w = {
      id: id || uid(),
      sportId,
      date: document.getElementById('wf-date').value,
      title: document.getElementById('wf-title').value || 'Workout',
      duration: duration || undefined,
      distance: distance || undefined,
      elevation: elevation || undefined,
      pace: calcPace(distance, duration) || undefined,
      rpe: parseInt(document.getElementById('wf-rpe').value) || undefined,
      notes: document.getElementById('wf-notes').value || undefined,
      exercises: exercises.length ? exercises : undefined,
    };
    if (id) {
      const idx = S.workouts.findIndex(x => x.id === id);
      if (idx >= 0) S.workouts[idx] = w;
    } else {
      S.workouts.unshift(w);
    }
    detectPRs(w);
    // also auto-update goal progress for matching sport based on best metric
    autoLogGoalProgress(w);
    save(); closeModal();
    toast(w._prs?.length ? `Saved! ★ ${w._prs.length} new PR${w._prs.length>1?'s':''}!` : 'Workout saved!');
    navigate(currentView);
  }

  function autoLogGoalProgress(w) {
    for (const g of S.goals) {
      if (g.sportId !== w.sportId || g.achieved) continue;
      const u = (g.unit || '').toLowerCase();
      let val = 0;
      if (u === 'km' || u === 'mi') val = w.distance || 0;
      else if (u === 'min' || u === 'minutes') val = w.duration || 0;
      else if (u === 'kg' && w.exercises) {
        for (const ex of w.exercises) for (const s of (ex.sets || [])) val = Math.max(val, oneRM(s.weight, s.reps));
      }
      if (val) {
        g.progress = [...(g.progress || []), { date: w.date, value: val }];
        if (val >= g.target) g.achieved = true;
      }
    }
  }

  // ─── VIEW: Plans ──────────────────────────────────────────────────────────
  RENDERERS.plans = function() {
    const el = document.getElementById('view');
    const plans = S.plans.filter(p => !filterSport || p.sportId === filterSport);
    el.innerHTML = `
      <div class="section-head"><h3>Training plans</h3><button class="primary" id="add-plan" style="width:auto">+ New plan</button></div>
      <div class="list">${plans.length ? plans.map(p => {
        const sp = sport(p.sportId);
        const sessCount = (p.sessions || []).length;
        const active = p.startDate && p.weeks;
        const endDate = active ? isoDay(new Date(parseDate(p.startDate).getTime() + p.weeks * 7 * 86400000)) : '';
        return `<div class="list-item" style="flex-direction:column;align-items:stretch;gap:6px">
          <div class="row">
            <span class="tag dot" style="--sport-color:${sp.color}">${esc(sp.name || '')}</span>
            <div style="flex:1;min-width:0">
              <strong>${esc(p.name)}</strong>
              <div class="meta">${p.weeks || 0} weeks · ${sessCount} sessions/week</div>
              <div class="meta" style="${active ? '' : 'color:var(--warn)'}">${active ? `Active: ${p.startDate} → ${endDate}` : 'Not activated'}</div>
            </div>
            <div class="actions">
              <button class="ghost edit-plan" data-id="${p.id}">Edit</button>
              <button class="ghost activate-plan" data-id="${p.id}">${active ? 'Reschedule' : 'Activate'}</button>
              <button class="danger del-plan" data-id="${p.id}">✕</button>
            </div>
          </div>
        </div>`;
      }).join('') : '<p class="empty">No plans yet. Plans schedule weekly sessions onto your calendar.</p>'}</div>`;
    el.querySelector('#add-plan').addEventListener('click', () => openPlanModal());
    el.querySelectorAll('.edit-plan').forEach(b => b.addEventListener('click', () => openPlanModal(b.dataset.id)));
    el.querySelectorAll('.del-plan').forEach(b => b.addEventListener('click', () => {
      if (confirm('Delete this plan?')) { S.plans = S.plans.filter(p => p.id !== b.dataset.id); save(); RENDERERS.plans(); toast('Plan deleted.'); }
    }));
    el.querySelectorAll('.activate-plan').forEach(b => b.addEventListener('click', () => openActivateModal(b.dataset.id)));
  };

  function openActivateModal(id) {
    const p = S.plans.find(x => x.id === id);
    openModal('Schedule plan', `
      <form id="act-form">
        <div class="field"><label>Start date</label><input type="date" id="ap-start" value="${p.startDate || today()}" required></div>
        <div class="field"><label>Number of weeks</label><input type="number" id="ap-weeks" min="1" max="52" value="${p.weeks || 4}" required></div>
        <div class="form-actions">
          <button type="button" class="ghost" id="ap-cancel">Cancel</button>
          <button type="submit" class="primary">Schedule</button>
        </div>
      </form>`);
    document.getElementById('ap-cancel').addEventListener('click', closeModal);
    document.getElementById('act-form').addEventListener('submit', e => {
      e.preventDefault();
      p.startDate = document.getElementById('ap-start').value;
      p.weeks = parseInt(document.getElementById('ap-weeks').value);
      save(); closeModal(); toast('Plan scheduled!'); RENDERERS.plans();
    });
  }

  function openPlanModal(id) {
    const p = id ? S.plans.find(x => x.id === id) : null;
    const sportOpts = S.sports.map(s => `<option value="${s.id}" ${(p?.sportId || '') === s.id ? 'selected' : ''}>${esc(s.name)}</option>`).join('');
    openModal(p ? 'Edit plan' : 'New plan', `
      <form id="plan-form">
        <div class="field"><label>Plan name</label><input id="pf-name" value="${esc(p?.name || '')}" placeholder="e.g. 10K base block" required></div>
        <div class="field-row">
          <div class="field"><label>Sport</label><select id="pf-sport">${sportOpts}</select></div>
          <div class="field"><label>Weeks</label><input type="number" id="pf-weeks" min="1" max="52" value="${p?.weeks || 4}"></div>
        </div>
        <div class="section-head" style="margin-top:6px"><h3 style="font-size:0.9rem">Weekly sessions</h3>
          <button type="button" class="ghost" id="add-session" style="width:auto;padding:4px 10px">+ Session</button></div>
        <div id="sessions-list">${(p?.sessions || []).map((s, i) => renderSessionRow(s, i)).join('')}</div>
        <div class="form-actions">
          <button type="button" class="ghost" id="pf-cancel">Cancel</button>
          <button type="submit" class="primary">Save plan</button>
        </div>
      </form>`);
    document.getElementById('pf-cancel').addEventListener('click', closeModal);
    document.getElementById('add-session').addEventListener('click', () => {
      const list = document.getElementById('sessions-list');
      const i = list.querySelectorAll('.plan-session').length;
      list.insertAdjacentHTML('beforeend', renderSessionRow({}, i));
    });
    document.getElementById('sessions-list').addEventListener('click', e => {
      if (e.target.classList.contains('rem-session')) e.target.closest('.plan-session').remove();
    });
    document.getElementById('plan-form').addEventListener('submit', e => { e.preventDefault(); savePlan(p?.id); });
  }

  function renderSessionRow(s, i) {
    return `<div class="plan-session" style="border:1px solid var(--border);border-radius:8px;padding:10px;margin-bottom:8px">
      <div class="field-row">
        <div class="field"><label>Day</label><select class="ps-dow">
          ${DAYS.map((d, di) => `<option value="${di}" ${s.dayOfWeek === di ? 'selected' : ''}>${d}</option>`).join('')}
        </select></div>
        <button type="button" class="danger rem-session" style="align-self:flex-end;margin-bottom:1px">Remove</button>
      </div>
      <div class="field"><label>Title</label><input class="ps-title" value="${esc(s.title || '')}" placeholder="e.g. Tempo run"></div>
      <div class="field-row">
        <div class="field"><label>Duration (min)</label><input type="number" class="ps-duration" min="0" value="${s.duration ?? ''}"></div>
        <div class="field"><label>Distance (km)</label><input type="number" class="ps-distance" step="0.1" min="0" value="${s.distance ?? ''}"></div>
      </div>
      <div class="field"><label>Notes</label><input class="ps-notes" value="${esc(s.notes || '')}" placeholder="Session notes…"></div>
    </div>`;
  }

  function savePlan(id) {
    const sessions = [...document.querySelectorAll('#sessions-list .plan-session')].map(el => ({
      dayOfWeek: parseInt(el.querySelector('.ps-dow').value) || 0,
      title: el.querySelector('.ps-title').value || 'Session',
      duration: parseInt(el.querySelector('.ps-duration').value) || undefined,
      distance: parseFloat(el.querySelector('.ps-distance').value) || undefined,
      notes: el.querySelector('.ps-notes').value || undefined,
    }));
    const existing = id ? S.plans.find(p => p.id === id) : null;
    const plan = {
      id: id || uid(),
      name: document.getElementById('pf-name').value,
      sportId: document.getElementById('pf-sport').value,
      weeks: parseInt(document.getElementById('pf-weeks').value) || 4,
      sessions,
      startDate: existing?.startDate,
    };
    if (id) { const idx = S.plans.findIndex(p => p.id === id); S.plans[idx] = plan; }
    else S.plans.push(plan);
    save(); closeModal(); toast('Plan saved!'); RENDERERS.plans();
  }

  // ─── VIEW: Goals ──────────────────────────────────────────────────────────
  RENDERERS.goals = function() {
    const el = document.getElementById('view');
    const goals = S.goals.filter(g => !filterSport || g.sportId === filterSport);
    el.innerHTML = `
      <div class="section-head"><h3>Goals</h3><button class="primary" id="add-goal" style="width:auto">+ New goal</button></div>
      <div class="list">${goals.length ? goals.map(g => {
        const sp = sport(g.sportId);
        const pct = goalPct(g);
        const latest = g.progress?.slice(-1)[0];
        return `<div class="list-item" style="flex-direction:column;align-items:stretch;gap:6px">
          <div class="row">
            <span class="tag dot" style="--sport-color:${sp.color}">${esc(sp.name || '')}</span>
            <div style="flex:1;min-width:0">
              <div class="row-flex"><strong>${esc(g.title)}</strong>${g.achieved ? '<span class="tag" style="color:var(--good)">✓ Achieved</span>' : ''}</div>
              <div class="meta">Target: ${esc(g.target)}${g.unit ? ' ' + esc(g.unit) : ''} by ${esc(g.deadline)}</div>
              ${latest ? `<div class="meta">Latest: ${esc(latest.value)}${g.unit ? ' ' + esc(g.unit) : ''} on ${esc(latest.date)}</div>` : ''}
            </div>
            <div class="actions">
              <button class="ghost log-progress" data-id="${g.id}">+ Progress</button>
              <button class="danger del-goal" data-id="${g.id}">✕</button>
            </div>
          </div>
          <div class="progress"><span style="width:${pct}%"></span></div>
          <div class="meta">${pct}% to target</div>
        </div>`;
      }).join('') : '<p class="empty">No goals yet. Set one to start tracking progress.</p>'}</div>`;
    el.querySelector('#add-goal').addEventListener('click', openGoalModal);
    el.querySelectorAll('.log-progress').forEach(b => b.addEventListener('click', () => openProgressModal(b.dataset.id)));
    el.querySelectorAll('.del-goal').forEach(b => b.addEventListener('click', () => {
      if (confirm('Delete goal?')) { S.goals = S.goals.filter(g => g.id !== b.dataset.id); save(); RENDERERS.goals(); }
    }));
  };

  function openGoalModal() {
    const sportOpts = S.sports.map(s => `<option value="${s.id}">${esc(s.name)}</option>`).join('');
    openModal('New goal', `
      <form id="goal-form">
        <div class="field"><label>Sport</label><select id="gf-sport">${sportOpts}</select></div>
        <div class="field"><label>Title</label><input id="gf-title" placeholder="e.g. Run a sub-22 5K" required></div>
        <div class="field-row">
          <div class="field"><label>Target value</label><input type="number" id="gf-target" step="any" min="0" required></div>
          <div class="field"><label>Unit</label><input id="gf-unit" placeholder="km, kg, min…"></div>
        </div>
        <div class="field"><label>Deadline</label><input type="date" id="gf-deadline" required></div>
        <p class="muted" style="font-size:0.82rem">Tip: progress with units <code>km</code>, <code>kg</code>, or <code>min</code> auto-fills from your workouts.</p>
        <div class="form-actions">
          <button type="button" class="ghost" id="gf-cancel">Cancel</button>
          <button type="submit" class="primary">Save goal</button>
        </div>
      </form>`);
    document.getElementById('gf-cancel').addEventListener('click', closeModal);
    document.getElementById('goal-form').addEventListener('submit', e => {
      e.preventDefault();
      S.goals.push({
        id: uid(),
        sportId: document.getElementById('gf-sport').value,
        title: document.getElementById('gf-title').value,
        target: parseFloat(document.getElementById('gf-target').value),
        unit: document.getElementById('gf-unit').value,
        deadline: document.getElementById('gf-deadline').value,
        progress: [], achieved: false,
      });
      save(); closeModal(); toast('Goal created!'); RENDERERS.goals();
    });
  }

  function openProgressModal(id) {
    const g = S.goals.find(x => x.id === id);
    openModal('Log progress', `
      <form id="prog-form">
        <p><strong>${esc(g.title)}</strong><br><span class="muted">Target: ${esc(g.target)}${g.unit ? ' ' + esc(g.unit) : ''}</span></p>
        <div class="field-row">
          <div class="field"><label>Value</label><input type="number" id="prog-val" step="any" required></div>
          <div class="field"><label>Date</label><input type="date" id="prog-date" value="${today()}"></div>
        </div>
        <div class="form-actions">
          <button type="button" class="ghost" id="prog-cancel">Cancel</button>
          <button type="submit" class="primary">Log</button>
        </div>
      </form>`);
    document.getElementById('prog-cancel').addEventListener('click', closeModal);
    document.getElementById('prog-form').addEventListener('submit', e => {
      e.preventDefault();
      const v = parseFloat(document.getElementById('prog-val').value);
      g.progress = [...(g.progress || []), { date: document.getElementById('prog-date').value, value: v }];
      if (v >= g.target) { g.achieved = true; toast('Goal achieved! 🎉'); } else toast('Progress logged.');
      save(); closeModal(); RENDERERS.goals();
    });
  }

  // ─── VIEW: Stats ──────────────────────────────────────────────────────────
  RENDERERS.stats = function() {
    const el = document.getElementById('view');
    el.innerHTML = `
      <div class="grid cols-2" style="margin-bottom:16px">
        <div class="card"><h3>Weekly volume — last 12 weeks (min)</h3><div id="vol-chart" class="chart"></div></div>
        <div class="card"><h3>Sessions by sport</h3><div id="sport-chart" class="chart"></div></div>
      </div>
      <div class="card" style="margin-bottom:16px">
        <h3>Activity heatmap — last year</h3>
        <div id="heatmap-wrap" style="overflow-x:auto;padding-bottom:4px"></div>
      </div>
      <div class="card"><h3>All-time totals</h3><div id="all-time"></div></div>`;
    drawVolChart();
    drawSportBars();
    drawHeatmap();
    drawAllTime();
  };

  function drawVolChart() {
    const weeks = [];
    const now = new Date(); now.setHours(0,0,0,0);
    const { start: thisWS } = weekBounds(now);
    for (let i = 11; i >= 0; i--) {
      const ws = new Date(thisWS); ws.setDate(thisWS.getDate() - i * 7);
      const we = new Date(ws); we.setDate(ws.getDate() + 6);
      const ss = isoDay(ws), es = isoDay(we);
      const total = S.workouts
        .filter(w => w.date >= ss && w.date <= es && (!filterSport || w.sportId === filterSport))
        .reduce((a, w) => a + (w.duration || 0), 0);
      weeks.push({ label: `${ws.getMonth()+1}/${ws.getDate()}`, value: total });
    }
    drawBars('vol-chart', weeks);
  }

  function drawSportBars() {
    const map = {};
    for (const w of S.workouts) {
      if (filterSport && w.sportId !== filterSport) continue;
      map[w.sportId] = (map[w.sportId] || 0) + 1;
    }
    const items = Object.entries(map).map(([id, c]) => ({ label: sport(id).name || id, value: c, color: sportColor(id) }));
    const el = document.getElementById('sport-chart');
    if (!items.length) { el.innerHTML = '<p class="empty">No workouts logged yet.</p>'; return; }
    const max = Math.max(...items.map(i => i.value));
    el.innerHTML = '<div style="display:flex;flex-direction:column;gap:10px;padding:12px 4px">' +
      items.map(i => `<div>
        <div class="row-flex" style="margin-bottom:4px"><span>${esc(i.label)}</span><span class="muted" style="margin-left:auto">${i.value}</span></div>
        <div class="progress"><span style="width:${(i.value/max*100).toFixed(1)}%;background:${i.color}"></span></div>
      </div>`).join('') + '</div>';
  }

  function drawBars(id, data) {
    const el = document.getElementById(id);
    if (!el) return;
    const max = Math.max(1, ...data.map(d => d.value));
    const W = el.clientWidth || 420, H = 200;
    const pad = { t: 12, r: 10, b: 28, l: 36 };
    const cW = W - pad.l - pad.r, cH = H - pad.t - pad.b;
    const slot = cW / data.length;
    const bw = Math.max(4, slot * 0.7);
    const grid = [0, 0.5, 1].map(f => {
      const y = pad.t + cH * (1 - f);
      return `<line x1="${pad.l}" y1="${y}" x2="${W-pad.r}" y2="${y}" stroke="var(--border)" stroke-dasharray="3"/>
        <text x="${pad.l-4}" y="${y}" text-anchor="end" dominant-baseline="middle">${Math.round(max*f)}</text>`;
    }).join('');
    const bars = data.map((d, i) => {
      const x = pad.l + i * slot + (slot - bw) / 2;
      const h = (d.value / max) * cH;
      const y = pad.t + cH - h;
      return `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${bw.toFixed(1)}" height="${Math.max(0,h).toFixed(1)}" rx="3" fill="url(#barGrad)"/>
        ${i % 2 === 0 ? `<text x="${(x+bw/2).toFixed(1)}" y="${H-8}" text-anchor="middle">${esc(d.label)}</text>` : ''}`;
    }).join('');
    el.innerHTML = `<svg width="100%" height="${H}" viewBox="0 0 ${W} ${H}" class="chart" preserveAspectRatio="none">
      <defs><linearGradient id="barGrad" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="var(--accent)"/><stop offset="100%" stop-color="var(--accent-2)"/>
      </linearGradient></defs>
      ${grid}${bars}
      <line x1="${pad.l}" y1="${pad.t+cH}" x2="${W-pad.r}" y2="${pad.t+cH}" class="axis"/>
    </svg>`;
  }

  function drawHeatmap() {
    const el = document.getElementById('heatmap-wrap');
    const counts = {};
    for (const w of S.workouts) {
      if (filterSport && w.sportId !== filterSport) continue;
      counts[w.date] = (counts[w.date] || 0) + 1;
    }
    const max = Math.max(1, ...Object.values(counts));
    const end = new Date(); end.setHours(0,0,0,0);
    const start = new Date(end); start.setDate(end.getDate() - 364);
    let html = '<div class="heatmap">';
    const d = new Date(start);
    while (d <= end) {
      const ds = isoDay(d);
      const c = counts[ds] || 0;
      const lvl = c === 0 ? 0 : c <= max * 0.25 ? 1 : c <= max * 0.5 ? 2 : c <= max * 0.75 ? 3 : 4;
      html += `<div class="day l${lvl}" title="${ds}: ${c} session${c !== 1 ? 's' : ''}"></div>`;
      d.setDate(d.getDate() + 1);
    }
    html += '</div>';
    el.innerHTML = html;
  }

  function drawAllTime() {
    const el = document.getElementById('all-time');
    const ws = filterSport ? S.workouts.filter(w => w.sportId === filterSport) : S.workouts;
    const total = ws.length;
    const totMin = ws.reduce((a, w) => a + (w.duration || 0), 0);
    const totKm = ws.reduce((a, w) => a + (w.distance || 0), 0);
    const breakdown = {};
    for (const w of ws) breakdown[w.sportId] = (breakdown[w.sportId] || 0) + 1;
    el.innerHTML = `<table>
      <tr><td>Total sessions</td><td><strong>${total}</strong></td></tr>
      <tr><td>Total training time</td><td><strong>${fmtDuration(totMin)}</strong></td></tr>
      <tr><td>Total distance</td><td><strong>${fmtDist(totKm) || '—'}</strong></td></tr>
      ${Object.entries(breakdown).map(([id, c]) => `<tr><td>${esc(sport(id).name || id)}</td><td>${c} sessions</td></tr>`).join('')}
    </table>`;
  }

  // ─── VIEW: Records ────────────────────────────────────────────────────────
  RENDERERS.records = function() {
    const el = document.getElementById('view');
    const recs = getAllRecords().filter(r => !filterSport || r.sportId === filterSport);
    el.innerHTML = `
      <div class="section-head"><h3>Personal records</h3></div>
      <div class="list">${recs.length ? recs.map(r => {
        const sp = sport(r.sportId);
        return `<div class="list-item">
          <span class="tag dot" style="--sport-color:${sp.color}">${esc(sp.name || '')}</span>
          <div class="row">
            <div><strong>${esc(r.label)}</strong><div class="meta">${esc(r.date)}</div></div>
            <span class="big" style="margin-left:auto;color:var(--warn)">${esc(r.display)}</span>
          </div>
        </div>`;
      }).join('') : '<p class="empty">Log workouts to see your records here.</p>'}</div>`;
  };

  // ─── VIEW: Body ───────────────────────────────────────────────────────────
  RENDERERS.body = function() {
    const el = document.getElementById('view');
    const entries = [...S.body].sort((a, b) => b.date.localeCompare(a.date));
    el.innerHTML = `
      <div class="section-head"><h3>Body metrics</h3><button class="primary" id="add-body" style="width:auto">+ Log measurement</button></div>
      <div class="card" style="margin-bottom:16px"><h3>Weight trend</h3><div id="weight-chart" class="chart"></div></div>
      <div class="list">${entries.length ? entries.map(e => `<div class="list-item">
        <span class="muted">${esc(e.date)}</span>
        <div class="row">
          ${e.weight ? `<span>⚖️ <strong>${esc(e.weight)} kg</strong></span>` : ''}
          ${e.bodyFat ? `<span>🩺 ${esc(e.bodyFat)}%</span>` : ''}
          ${e.restingHR ? `<span>❤️ ${esc(e.restingHR)} bpm</span>` : ''}
          ${e.notes ? `<span class="muted">${esc(e.notes)}</span>` : ''}
          <button class="danger del-body" data-id="${e.id}" style="margin-left:auto">✕</button>
        </div>
      </div>`).join('') : '<p class="empty">No measurements yet.</p>'}</div>`;
    el.querySelector('#add-body').addEventListener('click', openBodyModal);
    el.querySelectorAll('.del-body').forEach(b => b.addEventListener('click', () => {
      S.body = S.body.filter(e => e.id !== b.dataset.id); save(); RENDERERS.body();
    }));
    drawWeightChart();
  };

  function drawWeightChart() {
    const data = [...S.body].filter(e => e.weight).sort((a, b) => a.date.localeCompare(b.date));
    const el = document.getElementById('weight-chart');
    if (!el) return;
    if (!data.length) { el.innerHTML = '<p class="empty">Log a measurement to see your trend.</p>'; return; }
    const W = el.clientWidth || 420, H = 200;
    const pad = { t: 14, r: 10, b: 24, l: 40 };
    const cW = W - pad.l - pad.r, cH = H - pad.t - pad.b;
    const vals = data.map(d => d.weight);
    const min = Math.min(...vals) - 1, max = Math.max(...vals) + 1;
    const xS = i => pad.l + (i / (data.length - 1 || 1)) * cW;
    const yS = v => pad.t + cH - ((v - min) / (max - min || 1)) * cH;
    const points = data.map((d, i) => `${xS(i).toFixed(1)},${yS(d.weight).toFixed(1)}`).join(' ');
    const dots = data.map((d, i) => `<circle cx="${xS(i).toFixed(1)}" cy="${yS(d.weight).toFixed(1)}" r="3" class="dot"><title>${d.date}: ${d.weight} kg</title></circle>`).join('');
    const area = `M ${xS(0).toFixed(1)},${(pad.t+cH).toFixed(1)} ${data.map((d,i) => `L ${xS(i).toFixed(1)},${yS(d.weight).toFixed(1)}`).join(' ')} L ${xS(data.length-1).toFixed(1)},${(pad.t+cH).toFixed(1)} Z`;
    el.innerHTML = `<svg width="100%" height="${H}" viewBox="0 0 ${W} ${H}" class="chart" preserveAspectRatio="none">
      <path d="${area}" class="area"/>
      <polyline points="${points}" class="line"/>
      ${dots}
      <text x="${pad.l-4}" y="${yS(max).toFixed(1)}" text-anchor="end" dominant-baseline="middle">${max.toFixed(1)}</text>
      <text x="${pad.l-4}" y="${yS(min).toFixed(1)}" text-anchor="end" dominant-baseline="middle">${min.toFixed(1)}</text>
    </svg>`;
  }

  function openBodyModal() {
    openModal('Log body metrics', `
      <form id="body-form">
        <div class="field"><label>Date</label><input type="date" id="bf-date" value="${today()}"></div>
        <div class="field-row">
          <div class="field"><label>Weight (kg)</label><input type="number" id="bf-weight" step="0.1" min="0"></div>
          <div class="field"><label>Body fat (%)</label><input type="number" id="bf-bf" step="0.1" min="0" max="60"></div>
        </div>
        <div class="field"><label>Resting HR (bpm)</label><input type="number" id="bf-hr" min="30" max="120"></div>
        <div class="field"><label>Notes</label><input id="bf-notes"></div>
        <div class="form-actions">
          <button type="button" class="ghost" id="bf-cancel">Cancel</button>
          <button type="submit" class="primary">Save</button>
        </div>
      </form>`);
    document.getElementById('bf-cancel').addEventListener('click', closeModal);
    document.getElementById('body-form').addEventListener('submit', e => {
      e.preventDefault();
      S.body.push({
        id: uid(),
        date: document.getElementById('bf-date').value,
        weight: parseFloat(document.getElementById('bf-weight').value) || undefined,
        bodyFat: parseFloat(document.getElementById('bf-bf').value) || undefined,
        restingHR: parseInt(document.getElementById('bf-hr').value) || undefined,
        notes: document.getElementById('bf-notes').value || undefined,
      });
      save(); closeModal(); toast('Measurement saved!'); RENDERERS.body();
    });
  }

  // ─── VIEW: Journal ────────────────────────────────────────────────────────
  RENDERERS.journal = function() {
    const el = document.getElementById('view');
    const entries = [...S.journal].sort((a, b) => b.date.localeCompare(a.date));
    el.innerHTML = `
      <div class="section-head"><h3>Training journal</h3><button class="primary" id="add-journal" style="width:auto">+ New entry</button></div>
      <div class="list">${entries.length ? entries.map(e => `<div class="list-item" style="flex-direction:column;align-items:stretch">
        <div class="row-flex">
          <strong>${esc(e.date)}</strong>
          ${e.mood ? `<span title="Mood">😊 ${esc(e.mood)}/10</span>` : ''}
          ${e.sleep ? `<span title="Sleep">💤 ${esc(e.sleep)}h</span>` : ''}
          ${e.soreness ? `<span title="Soreness">💪 ${esc(e.soreness)}/10</span>` : ''}
          <button class="danger del-journal" data-id="${e.id}" style="margin-left:auto">✕</button>
        </div>
        ${e.text ? `<div style="margin-top:6px;font-size:0.93rem;white-space:pre-wrap">${esc(e.text)}</div>` : ''}
      </div>`).join('') : '<p class="empty">No journal entries yet.</p>'}</div>`;
    el.querySelector('#add-journal').addEventListener('click', openJournalModal);
    el.querySelectorAll('.del-journal').forEach(b => b.addEventListener('click', () => {
      S.journal = S.journal.filter(e => e.id !== b.dataset.id); save(); RENDERERS.journal();
    }));
  };

  function openJournalModal() {
    openModal('Journal entry', `
      <form id="journal-form">
        <div class="field"><label>Date</label><input type="date" id="jf-date" value="${today()}"></div>
        <div class="field-row">
          <div class="field"><label>Mood (1–10)</label><input type="number" id="jf-mood" min="1" max="10"></div>
          <div class="field"><label>Sleep (hrs)</label><input type="number" id="jf-sleep" min="0" max="24" step="0.5"></div>
        </div>
        <div class="field"><label>Soreness (1–10)</label><input type="number" id="jf-soreness" min="1" max="10"></div>
        <div class="field"><label>Notes</label><textarea id="jf-text" placeholder="How did today go?"></textarea></div>
        <div class="form-actions">
          <button type="button" class="ghost" id="jf-cancel">Cancel</button>
          <button type="submit" class="primary">Save</button>
        </div>
      </form>`);
    document.getElementById('jf-cancel').addEventListener('click', closeModal);
    document.getElementById('journal-form').addEventListener('submit', e => {
      e.preventDefault();
      S.journal.push({
        id: uid(),
        date: document.getElementById('jf-date').value,
        mood: parseInt(document.getElementById('jf-mood').value) || undefined,
        sleep: parseFloat(document.getElementById('jf-sleep').value) || undefined,
        soreness: parseInt(document.getElementById('jf-soreness').value) || undefined,
        text: document.getElementById('jf-text').value || undefined,
      });
      save(); closeModal(); toast('Entry saved!'); RENDERERS.journal();
    });
  }

  // ─── VIEW: Sports ─────────────────────────────────────────────────────────
  RENDERERS.sports = function() {
    const el = document.getElementById('view');
    el.innerHTML = `
      <div class="section-head"><h3>Sports</h3><button class="primary" id="add-sport" style="width:auto">+ Add sport</button></div>
      <div class="list">${S.sports.map(s => `<div class="list-item">
        <span style="width:18px;height:18px;border-radius:50%;background:${s.color};display:inline-block;flex-shrink:0"></span>
        <div class="row">
          <div style="flex:1"><strong>${esc(s.name)}</strong><div class="meta">${SPORT_TYPES[s.type] || s.type}</div></div>
          <div class="actions">
            <button class="ghost edit-sport" data-id="${s.id}">Edit</button>
            <button class="danger del-sport" data-id="${s.id}">✕</button>
          </div>
        </div>
      </div>`).join('')}</div>`;
    el.querySelector('#add-sport').addEventListener('click', () => openSportModal());
    el.querySelectorAll('.edit-sport').forEach(b => b.addEventListener('click', () => openSportModal(b.dataset.id)));
    el.querySelectorAll('.del-sport').forEach(b => b.addEventListener('click', () => {
      const used = S.workouts.some(w => w.sportId === b.dataset.id) || S.plans.some(p => p.sportId === b.dataset.id) || S.goals.some(g => g.sportId === b.dataset.id);
      if (used && !confirm('This sport is in use by workouts/plans/goals. Delete anyway?')) return;
      if (!used && !confirm('Delete this sport?')) return;
      S.sports = S.sports.filter(s => s.id !== b.dataset.id);
      save(); RENDERERS.sports(); refreshFilter();
    }));
  };

  function openSportModal(id) {
    const s = id ? S.sports.find(x => x.id === id) : null;
    openModal(s ? 'Edit sport' : 'Add sport', `
      <form id="sport-form">
        <div class="field"><label>Name</label><input id="sf-name" value="${esc(s?.name || '')}" required></div>
        <div class="field-row">
          <div class="field"><label>Type</label><select id="sf-type">
            ${Object.entries(SPORT_TYPES).map(([v, l]) => `<option value="${v}" ${s?.type === v ? 'selected' : ''}>${l}</option>`).join('')}
          </select></div>
          <div class="field"><label>Color</label><input type="color" id="sf-color" value="${s?.color || '#6ea8ff'}"></div>
        </div>
        <p class="muted" style="font-size:0.82rem">Type controls which fields appear when logging a workout (distance vs. exercises).</p>
        <div class="form-actions">
          <button type="button" class="ghost" id="sf-cancel">Cancel</button>
          <button type="submit" class="primary">Save</button>
        </div>
      </form>`);
    document.getElementById('sf-cancel').addEventListener('click', closeModal);
    document.getElementById('sport-form').addEventListener('submit', e => {
      e.preventDefault();
      const sp = {
        id: id || uid(),
        name: document.getElementById('sf-name').value,
        type: document.getElementById('sf-type').value,
        color: document.getElementById('sf-color').value,
      };
      if (id) { const idx = S.sports.findIndex(x => x.id === id); S.sports[idx] = sp; }
      else S.sports.push(sp);
      save(); closeModal(); toast('Sport saved!'); RENDERERS.sports(); refreshFilter();
    });
  }

  // ─── VIEW: Settings ───────────────────────────────────────────────────────
  RENDERERS.settings = function() {
    const el = document.getElementById('view');
    el.innerHTML = `
      <div class="card" style="max-width:520px;display:flex;flex-direction:column;gap:14px">
        <h3 style="margin:0">Preferences</h3>
        <div class="field"><label>Units</label><select id="set-units">
          <option value="metric" ${S.settings.units === 'metric' ? 'selected' : ''}>Metric (km, kg)</option>
          <option value="imperial" ${S.settings.units === 'imperial' ? 'selected' : ''}>Imperial (mi)</option>
        </select></div>
        <div class="field"><label>Week starts on</label><select id="set-weekstart">
          <option value="0" ${S.settings.weekStart === 0 ? 'selected' : ''}>Sunday</option>
          <option value="1" ${S.settings.weekStart === 1 ? 'selected' : ''}>Monday</option>
        </select></div>
        <button class="primary" id="save-settings" style="width:auto">Save preferences</button>
      </div>
      <div class="card" style="max-width:520px;margin-top:16px;display:flex;flex-direction:column;gap:12px">
        <h3 style="margin:0">Data</h3>
        <p class="muted" style="margin:0;font-size:0.85rem">Your data is stored locally in this browser. Export regularly to back up.</p>
        <div class="row-flex">
          <button class="ghost" id="export-data">⬇ Export JSON</button>
          <label class="ghost" style="cursor:pointer;padding:8px 12px;border:1px solid var(--border);border-radius:8px">
            ⬆ Import JSON <input type="file" id="import-file" accept=".json" style="display:none">
          </label>
        </div>
        <button class="danger" id="clear-data" style="width:auto;align-self:flex-start">Clear all data</button>
      </div>`;
    el.querySelector('#save-settings').addEventListener('click', () => {
      S.settings.units = document.getElementById('set-units').value;
      S.settings.weekStart = parseInt(document.getElementById('set-weekstart').value);
      save(); toast('Settings saved!');
    });
    el.querySelector('#export-data').addEventListener('click', () => {
      const blob = new Blob([JSON.stringify(S, null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `tracktic-backup-${today()}.json`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    });
    el.querySelector('#import-file').addEventListener('change', e => {
      const f = e.target.files[0]; if (!f) return;
      const reader = new FileReader();
      reader.onload = ev => {
        try {
          const data = JSON.parse(ev.target.result);
          S = Object.assign({}, DEFAULT, data);
          save(); toast('Data imported!'); refreshFilter(); navigate('dashboard');
        } catch { toast('Invalid JSON file.'); }
      };
      reader.readAsText(f);
    });
    el.querySelector('#clear-data').addEventListener('click', () => {
      if (confirm('Delete ALL data permanently? This cannot be undone.')) {
        S = JSON.parse(JSON.stringify(DEFAULT));
        save(); toast('Data cleared.'); refreshFilter(); navigate('dashboard');
      }
    });
  };

  // ─── Boot / wire up ───────────────────────────────────────────────────────
  document.getElementById('quick-add').addEventListener('click', () => openWorkoutModal());
  document.getElementById('nav').addEventListener('click', e => {
    if (e.target.classList.contains('nav-btn')) navigate(e.target.dataset.view);
  });
  document.getElementById('menu-toggle').addEventListener('click', () => {
    document.getElementById('sidebar').classList.toggle('open');
  });
  document.getElementById('modal-close').addEventListener('click', closeModal);
  document.getElementById('modal').addEventListener('click', e => {
    if (e.target.id === 'modal') closeModal();
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') closeModal();
  });
  document.getElementById('theme-toggle').addEventListener('click', () => {
    const isLight = document.documentElement.dataset.theme === 'light';
    document.documentElement.dataset.theme = isLight ? '' : 'light';
    S.settings.theme = isLight ? 'dark' : 'light';
    save();
    if (RENDERERS[currentView]) navigate(currentView);
  });
  document.getElementById('sport-filter').addEventListener('change', e => {
    filterSport = e.target.value; navigate(currentView);
  });

  load();
  if (S.settings.theme === 'light') document.documentElement.dataset.theme = 'light';
  // Backfill missing PRs / ids on load (one-time per data load)
  for (const w of S.workouts) if (!w._prs) detectPRs(w);
  for (const e of S.body) if (!e.id) e.id = uid();
  for (const e of S.journal) if (!e.id) e.id = uid();
  save();
  refreshFilter();
  navigate('dashboard');
})();
