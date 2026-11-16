// Pro : le serveur. Tout vit sous le lien privé /k/<clé>/ ; sans la clé, 404.
import { place, DEFAULTS } from '../public/plan.js';
import { toLocal, addDays, dow, nowIso } from './time.js';
import { parseDump, firstStep, sanitize } from './parse.js';
import { configured, eventsFor, syncTasks, listCalendars } from './caldav.js';
import { current, focus, stop, imprevu, onTaskClosed, minutesFor } from './track.js';
import { runNotifications, NOTIF_DEFAULTS } from './notify.js';
import { broadcast, pushReady } from './push.js';
import { generate, EVERY } from './recurring.js';
import { bilan, mirror, recordActivity, offSummary, pace, OFF_DEFAULTS } from './bilan.js';

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
const notFound = () => new Response('Introuvable', { status: 404 });
const bad = (msg, status = 400) => json({ error: msg }, status);
const isDate = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);

/** Comparaison en temps constant, pour ne rien révéler de la clé. */
function sameKey(a, b) {
  const x = new TextEncoder().encode(a);
  const y = new TextEncoder().encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ (y[i % (y.length || 1)] ?? 0);
  return diff === 0;
}

// ---- Accès aux données ----

const all = async (env, sql, ...binds) => (await env.DB.prepare(sql).bind(...binds).all()).results;
const first = (env, sql, ...binds) => env.DB.prepare(sql).bind(...binds).first();
const run = (env, sql, ...binds) => env.DB.prepare(sql).bind(...binds).run();

const SETTING_KEYS = ['supper_start', 'supper_min', 'buffer_pct', 'cal_url', 'cal_name', 'notif_start', 'notif_over', 'notif_due', 'notif_evening', 'evening_min', 'off_budget'];

async function getSettings(env) {
  const rows = await all(env, `SELECT key, value FROM settings WHERE key IN (${SETTING_KEYS.map(() => '?').join(',')})`, ...SETTING_KEYS);
  const s = { ...DEFAULTS, ...NOTIF_DEFAULTS, ...OFF_DEFAULTS };
  for (const r of rows) s[r.key] = ['cal_url', 'cal_name'].includes(r.key) ? r.value : Number(r.value);
  return s;
}

async function getDay(env, date, settings) {
  const row = await first(env, 'SELECT * FROM days WHERE date = ?', date);
  if (row) return { ...row, prepared: Boolean(row.prepared_at) };
  return {
    date,
    work_start: settings.work_start,
    work_end: settings.work_end,
    evening_work: 0,
    evening_end: settings.evening_end,
    prepared: false,
  };
}

const tasksOf = (env, date) => all(env, "SELECT * FROM tasks WHERE day = ? AND status != 'deleted' ORDER BY sort, id", date);

// ---- La feuille ----

async function sheet(env, date, { fresh = false } = {}) {
  const now = toLocal();
  const today = now.date;
  const settings = await getSettings(env);

  // Une échéance dans trois jours ou moins monte toute seule dans les priorités.
  // Une tâche de la réserve arrive sur aujourd'hui ; une tâche déjà placée sur un jour y reste.
  await generate(env, today); // ce qui revient : crée les tâches dont l'échéance approche
  const soon = addDays(today, 3);
  await env.DB.batch([
    env.DB.prepare(
      "UPDATE tasks SET section = 'priorite' WHERE status = 'todo' AND due_date IS NOT NULL AND due_date <= ? AND section = 'faire'",
    ).bind(soon),
    env.DB.prepare("UPDATE tasks SET day = ? WHERE status = 'todo' AND due_date IS NOT NULL AND due_date <= ? AND day IS NULL").bind(today, soon),
  ]);

  const [day, tasks, cal] = await Promise.all([getDay(env, date, settings), tasksOf(env, date), eventsFor(env, date, { fresh })]);
  const triage =
    date === today ? await all(env, "SELECT * FROM tasks WHERE status = 'todo' AND day IS NOT NULL AND day < ? ORDER BY day, sort", today) : [];
  const reserve = await first(env, "SELECT COUNT(*) AS n FROM tasks WHERE status = 'todo' AND day IS NULL");
  const inbox = await all(env, "SELECT id, raw_text, created_at FROM captures WHERE source = 'raccourci' AND confirmed_at IS NULL ORDER BY id");
  const summary = place(tasks, day, cal.events, settings, { today });
  const lastError = await first(env, "SELECT value FROM settings WHERE key = 'cal_last_error'");
  const track = await minutesFor(env, date);

  return {
    today,
    now_min: now.min,
    date,
    dow: dow(date),
    day,
    settings: { supper_start: settings.supper_start, supper_min: settings.supper_min, buffer_pct: settings.buffer_pct },
    tasks,
    events: cal.events,
    calendar: {
      on: configured(env),
      ok: cal.ok,
      error: cal.error || (lastError ? JSON.parse(lastError.value).error : null),
      name: settings.cal_name || null,
    },
    triage,
    reserve_count: reserve.n,
    inbox,
    summary: { planned: summary.planned, capacity: summary.capacity, available: summary.available, overflow: summary.overflow },
    ai: Boolean(env.ANTHROPIC_API_KEY),
    focus: await current(env),
    tracked: track.byTask,
    imprevu_min: track.imprevu,
    pace: await pace(env),
    off: await offSummary(env, date),
    push: { ready: pushReady(env), public_key: env.VAPID_PUBLIC || null },
    notif: {
      notif_start: settings.notif_start, notif_over: settings.notif_over, notif_due: settings.notif_due,
      notif_evening: settings.notif_evening, evening_min: settings.evening_min,
    },
  };
}

/** Replace les tâches d'une journée, puis met le calendrier d'accord. */
async function replan(env, ctx, date) {
  const now = toLocal();
  if (date < now.date) return;
  const settings = await getSettings(env);
  const [day, tasks, cal] = await Promise.all([getDay(env, date, settings), tasksOf(env, date), eventsFor(env, date)]);
  const res = place(tasks, day, cal.events, settings, { today: now.date, fromMin: date === now.date ? now.min : null });
  const stmts = [
    ...res.placed.map((p) => env.DB.prepare('UPDATE tasks SET start_min = ? WHERE id = ?').bind(p.start_min, p.id)),
    ...res.unplaced.map((id) => env.DB.prepare('UPDATE tasks SET start_min = NULL WHERE id = ?').bind(id)),
  ];
  if (stmts.length) await env.DB.batch(stmts);
  ctx.waitUntil(tasksOf(env, date).then((fresh) => syncTasks(env, fresh)));
}

async function replanMany(env, ctx, dates) {
  for (const d of new Set(dates.filter(Boolean))) await replan(env, ctx, d);
}

// ---- Les tâches ----

async function createTasks(env, ctx, items, { source = 'manuel', captureId = null } = {}) {
  const today = toLocal().date;
  const clean = items.map((t) => sanitize(t, { today, defaultDay: today })).filter(Boolean);
  const stamp = Date.now();
  const stmts = clean.map((t, i) =>
    env.DB.prepare(
      `INSERT INTO tasks (title, section, company, nature, day, due_date, est_minutes, contact, phone, sort, source, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(t.title, t.section, t.company, t.nature, t.day, t.due_date, t.est_minutes, t.contact, t.phone, stamp + i, source, nowIso()),
  );
  if (stmts.length) await env.DB.batch(stmts);
  if (captureId) await run(env, 'UPDATE captures SET confirmed_at = ? WHERE id = ?', nowIso(), captureId);
  await replanMany(env, ctx, clean.map((t) => t.day));
  return clean.length;
}

const EDITABLE = ['title', 'section', 'company', 'nature', 'day', 'due_date', 'est_minutes', 'start_min', 'status', 'contact', 'phone', 'note', 'first_step', 'sort'];

async function patchTask(env, ctx, id, body) {
  const old = await first(env, 'SELECT * FROM tasks WHERE id = ?', id);
  if (!old || old.status === 'deleted') return null;
  const today = toLocal().date;
  const set = {};
  for (const k of EDITABLE) if (k in body) set[k] = body[k];

  if ('title' in set) {
    set.title = String(set.title || '').trim().slice(0, 200);
    if (!set.title) delete set.title;
  }
  if ('section' in set && !['priorite', 'rappel', 'faire'].includes(set.section)) delete set.section;
  if ('company' in set && !['robiii', 'immo', 'perso'].includes(set.company)) delete set.company;
  if ('nature' in set && !['obligation', 'attend', 'avance', 'autre'].includes(set.nature)) delete set.nature;
  if ('status' in set && !['todo', 'done', 'deleted'].includes(set.status)) delete set.status;
  if ('day' in set && set.day !== null && !isDate(set.day)) delete set.day;
  if ('due_date' in set && set.due_date !== null && !isDate(set.due_date)) delete set.due_date;
  if ('est_minutes' in set) set.est_minutes = Math.min(480, Math.max(5, Math.round(Number(set.est_minutes) || 30)));
  if ('sort' in set) set.sort = Number(set.sort) || 0;

  if (set.section === 'rappel' && (set.nature ?? old.nature) === 'autre') set.nature = 'attend';
  if ('status' in set) set.done_at = set.status === 'done' ? nowIso() : null;
  if (set.status === 'done' || set.status === 'deleted') await onTaskClosed(env, id); // arrête son chrono
  for (const k of ['phone', 'note', 'contact']) if (k in set) set[k] = set[k] ? String(set[k]).trim().slice(0, 160) : null;
  if ('start_min' in set) {
    if (set.start_min === null) set.pinned = 0;
    else {
      set.start_min = Math.min(1435, Math.max(0, Math.round(Number(set.start_min) / 5) * 5));
      set.pinned = 1; // une heure choisie à la main ne bouge plus
    }
  }
  if ('day' in set && set.day !== old.day && !('start_min' in set)) {
    set.start_min = null;
    set.pinned = 0;
  }

  const keys = Object.keys(set);
  if (keys.length) {
    await run(env, `UPDATE tasks SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`, ...keys.map((k) => set[k]), id);
  }
  const task = await first(env, 'SELECT * FROM tasks WHERE id = ?', id);

  const moves = ['day', 'est_minutes', 'start_min'].some((k) => k in set) || set.status === 'deleted' || set.status === 'todo';
  if (moves) await replanMany(env, ctx, [old.day, task.day].filter((d) => d && d >= today));
  // Le replacement ne voit que les tâches encore sur la feuille : les autres sont synchronisées ici.
  if (!moves || task.status !== 'todo' || !task.day) ctx.waitUntil(syncTasks(env, [task]));
  return first(env, 'SELECT * FROM tasks WHERE id = ?', id);
}

/** Le tri : chaque tâche non faite reçoit une décision. */
async function triage(env, ctx, { decisions = [], to }) {
  const today = toLocal().date;
  const target = isDate(to) && to >= today ? to : today;
  const touched = [];
  for (const d of decisions) {
    const t = await first(env, "SELECT * FROM tasks WHERE id = ? AND status = 'todo'", Number(d.id));
    if (!t) continue;
    if (d.action === 'report') {
      await run(env, 'UPDATE tasks SET day = ?, start_min = NULL, pinned = 0, pushed_count = pushed_count + 1 WHERE id = ?', target, t.id);
    } else if (d.action === 'reserve') {
      await run(env, 'UPDATE tasks SET day = NULL, start_min = NULL, pinned = 0 WHERE id = ?', t.id);
    } else if (d.action === 'delete') {
      await run(env, "UPDATE tasks SET status = 'deleted' WHERE id = ?", t.id);
    } else continue;
    touched.push(t.id);
  }
  if (touched.length) {
    const rows = await all(env, `SELECT * FROM tasks WHERE id IN (${touched.map(() => '?').join(',')})`, ...touched);
    ctx.waitUntil(syncTasks(env, rows.filter((t) => t.status !== 'todo' || !t.day)));
    // Ce qui vient d'être reporté pour la 2e fois reçoit son premier pas.
    ctx.waitUntil(
      (async () => {
        for (const t of rows.filter((r) => r.status === 'todo' && r.pushed_count >= 2 && !r.first_step)) {
          await run(env, 'UPDATE tasks SET first_step = ? WHERE id = ?', await firstStep(env, t), t.id);
        }
      })(),
    );
  }
  await replanMany(env, ctx, [target]);
  return touched.length;
}

// ---- Les routes ----

async function api(req, env, ctx, path, url) {
  const m = req.method;
  const body = ['POST', 'PUT', 'PATCH'].includes(m) ? await req.json().catch(() => ({})) : {};
  const today = toLocal().date;
  let r;

  if (path === 'sheet' && m === 'GET') {
    const date = isDate(url.searchParams.get('date')) ? url.searchParams.get('date') : today;
    return json(await sheet(env, date, { fresh: url.searchParams.has('fresh') }));
  }

  if (path === 'parse' && m === 'POST') {
    let text = String(body.text || '').trim();
    let captureId = Number(body.capture_id) || null;
    const defaultDay = isDate(body.default_day) && body.default_day >= today ? body.default_day : today;
    if (captureId) {
      const cap = await first(env, 'SELECT * FROM captures WHERE id = ?', captureId);
      if (!cap) return bad('Dictée introuvable', 404);
      text = cap.raw_text;
    }
    if (!text) return bad('Rien à comprendre');
    if (text.length > 6000) return bad('Texte trop long : coupe-le en deux');
    if (!captureId) {
      const ins = await run(env, "INSERT INTO captures (raw_text, source, default_day, created_at) VALUES (?, 'app', ?, ?)", text, defaultDay, nowIso());
      captureId = ins.meta.last_row_id;
    }
    const out = await parseDump(env, text, { today, defaultDay });
    await run(env, 'UPDATE captures SET parsed_json = ?, engine = ? WHERE id = ?', JSON.stringify(out.items), out.engine, captureId);
    return json({ capture_id: captureId, ...out });
  }

  if (path === 'tasks' && m === 'POST') {
    if (!Array.isArray(body.items) || !body.items.length) return bad('Aucune tâche');
    const n = await createTasks(env, ctx, body.items.slice(0, 60), { source: body.source || 'manuel', captureId: Number(body.capture_id) || null });
    return json({ created: n });
  }

  if ((r = path.match(/^tasks\/(\d+)$/))) {
    if (m === 'PATCH') {
      const t = await patchTask(env, ctx, Number(r[1]), body);
      return t ? json(t) : bad('Tâche introuvable', 404);
    }
    if (m === 'DELETE') {
      const t = await patchTask(env, ctx, Number(r[1]), { status: 'deleted' });
      return t ? json({ ok: true }) : bad('Tâche introuvable', 404);
    }
  }

  if ((r = path.match(/^tasks\/(\d+)\/first-step$/)) && m === 'POST') {
    const t = await first(env, 'SELECT * FROM tasks WHERE id = ?', Number(r[1]));
    if (!t) return bad('Tâche introuvable', 404);
    const step = await firstStep(env, t);
    await run(env, 'UPDATE tasks SET first_step = ? WHERE id = ?', step, t.id);
    return json({ first_step: step });
  }

  if (path === 'plan' && m === 'POST') {
    const date = isDate(body.date) ? body.date : today;
    if (body.unpin) await run(env, "UPDATE tasks SET pinned = 0 WHERE day = ? AND status = 'todo'", date);
    await replan(env, ctx, date);
    return json(await sheet(env, date));
  }

  if ((r = path.match(/^days\/(\d{4}-\d{2}-\d{2})$/)) && m === 'PUT') {
    const clampMin = (v, d) => Math.min(1440, Math.max(0, Math.round(Number(v ?? d) / 5) * 5));
    const ws = clampMin(body.work_start, DEFAULTS.work_start);
    const we = Math.max(ws + 30, clampMin(body.work_end, DEFAULTS.work_end));
    await run(
      env,
      `INSERT INTO days (date, work_start, work_end, evening_work, evening_end, prepared_at) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(date) DO UPDATE SET work_start = excluded.work_start, work_end = excluded.work_end,
         evening_work = excluded.evening_work, evening_end = excluded.evening_end,
         prepared_at = COALESCE(excluded.prepared_at, days.prepared_at)`,
      r[1],
      ws,
      we,
      body.evening_work ? 1 : 0,
      clampMin(body.evening_end, DEFAULTS.evening_end),
      body.prepared ? nowIso() : null,
    );
    await replan(env, ctx, r[1]);
    return json({ ok: true });
  }

  if (path === 'triage' && m === 'POST') return json({ done: await triage(env, ctx, body) });

  if (path === 'reserve' && m === 'GET') {
    return json({ tasks: await all(env, "SELECT * FROM tasks WHERE status = 'todo' AND day IS NULL ORDER BY created_at") });
  }

  if (path === 'inbox' && m === 'POST') {
    const text = String(body.text || '').trim().slice(0, 6000);
    if (!text) return bad('Rien reçu');
    await run(env, "INSERT INTO captures (raw_text, source, created_at) VALUES (?, 'raccourci', ?)", text, nowIso());
    return json({ ok: true, message: 'Capté. À confirmer dans Pro.' }, 201);
  }
  if ((r = path.match(/^inbox\/(\d+)$/)) && m === 'DELETE') {
    await run(env, 'UPDATE captures SET confirmed_at = ? WHERE id = ?', nowIso(), Number(r[1]));
    return json({ ok: true });
  }

  if (path === 'calendars' && m === 'GET') {
    if (!configured(env)) return json({ on: false, calendars: [] });
    try {
      return json({ on: true, calendars: await listCalendars(env), current: (await getSettings(env)).cal_url || null });
    } catch (err) {
      return json({ on: true, calendars: [], error: String(err.message || err) });
    }
  }

  if (path === 'settings' && m === 'PUT') {
    for (const k of SETTING_KEYS) {
      if (!(k in body)) continue;
      const v = ['cal_url', 'cal_name'].includes(k) ? String(body[k]).slice(0, 500) : String(Math.round(Number(body[k]) || 0));
      if (k === 'off_budget' && (Number(v) < 5 || Number(v) > 480)) continue;
      await run(env, 'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', k, v);
    }
    if ('cal_url' in body) await run(env, "DELETE FROM settings WHERE key LIKE 'cal_cache_%'");
    return json({ ok: true });
  }

  // ---- Étape 2 : le chrono ----
  if (path === 'focus' && m === 'POST') {
    await focus(env, Number(body.task_id), { toggle: body.toggle !== false });
    return json({ focus: await current(env) });
  }
  if (path === 'focus/stop' && m === 'POST') {
    await stop(env);
    return json({ focus: await current(env) });
  }
  if (path === 'imprevu' && m === 'POST') {
    await imprevu(env, body.label);
    return json({ focus: await current(env) });
  }

  if (path === 'bilan' && m === 'GET') {
    const date = isDate(url.searchParams.get('date')) ? url.searchParams.get('date') : today;
    const settings = await getSettings(env);
    const [day, cal] = await Promise.all([getDay(env, date, settings), eventsFor(env, date)]);
    return json(await bilan(env, date, { day, events: cal.events, settings }));
  }
  if (path === 'mirror' && m === 'GET') return json(await mirror(env, today));

  // ---- Ce qui revient ----
  if (path === 'recurring' && m === 'GET') {
    return json({ rules: await all(env, 'SELECT * FROM recurring WHERE active = 1 ORDER BY next_due'), every: EVERY });
  }
  if (path === 'recurring' && m === 'POST') {
    const title = String(body.title || '').trim().slice(0, 200);
    if (!title || !isDate(body.next_due) || !(body.every in EVERY)) return bad('Il manque le titre, la fréquence ou la prochaine échéance');
    const company = ['robiii', 'immo', 'perso'].includes(body.company) ? body.company : 'perso';
    const est = Math.min(480, Math.max(5, Math.round(Number(body.est_minutes) || 30)));
    await run(env, 'INSERT INTO recurring (title, company, est_minutes, every, next_due, created_at) VALUES (?, ?, ?, ?, ?, ?)', title, company, est, body.every, body.next_due, nowIso());
    await generate(env, today);
    return json({ ok: true }, 201);
  }
  if ((r = path.match(/^recurring\/(\d+)$/)) && m === 'DELETE') {
    await run(env, 'UPDATE recurring SET active = 0 WHERE id = ?', Number(r[1]));
    return json({ ok: true });
  }

  // ---- Notifications ----
  if (path === 'push/subscribe' && m === 'POST') {
    const sub = body.subscription || {};
    const okUrl = /^https:\/\//.test(sub.endpoint || '') || (env.ACCESS_KEY === 'dev' && /^http:\/\/127\.0\.0\.1:/.test(sub.endpoint || '')); // http seulement pour les tests locaux
    if (!okUrl || !sub.keys?.p256dh || !sub.keys?.auth) return bad('Abonnement incomplet');
    await run(env, 'INSERT INTO push_subs (endpoint, p256dh, auth, created_at) VALUES (?, ?, ?, ?) ON CONFLICT(endpoint) DO UPDATE SET p256dh = excluded.p256dh, auth = excluded.auth',
      sub.endpoint, sub.keys.p256dh, sub.keys.auth, nowIso());
    return json({ ok: true });
  }
  if (path === 'push/unsubscribe' && m === 'POST') {
    await run(env, 'DELETE FROM push_subs WHERE endpoint = ?', String(body.endpoint || ''));
    return json({ ok: true });
  }
  if (path === 'push/test' && m === 'POST') {
    if (!pushReady(env)) return bad('Les notifications ne sont pas configurées sur le serveur');
    return json(await broadcast(env, { title: 'Pro', body: 'Les notifications fonctionnent sur cet appareil.', tag: 'essai' }));
  }

  // ---- Étape 3 : l'assistant du Mac ----
  if (path === 'activity' && m === 'POST') {
    return json(await recordActivity(env, { app: body.app, site: body.site, inPro: Boolean(body.in_pro) }));
  }
  if (path === 'assistant/event' && m === 'POST') {
    const kind = { stop: 'assistant_stop', start: 'assistant_start', override: 'override' }[body.kind];
    if (!kind) return bad('Événement inconnu');
    await run(env, 'INSERT INTO journal (day, at, kind, detail) VALUES (?, ?, ?, ?)', today, Date.now(), kind, String(body.detail || '').slice(0, 120));
    return json({ ok: true });
  }

  return notFound();
}

function manifest() {
  return new Response(
    JSON.stringify({
      name: 'Pro',
      short_name: 'Pro',
      description: 'Ta feuille du jour.',
      start_url: './',
      scope: './',
      display: 'standalone',
      background_color: '#F3F4FA',
      theme_color: '#F3F4FA',
      lang: 'fr-CA',
      icons: [
        { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
        { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
      ],
    }),
    { headers: { 'Content-Type': 'application/manifest+json; charset=utf-8' } },
  );
}

export default {
  /** Chaque minute : envoyer les notifications dues. */
  async scheduled(event, env, ctx) {
    ctx.waitUntil(runNotifications(env).catch((err) => console.error('notifications', err)));
  },

  async fetch(req, env, ctx) {
    const url = new URL(req.url);
    // Sans clé d'accès configurée, rien n'est servi : l'app n'est jamais ouverte par défaut.
    if (!env.ACCESS_KEY) return new Response('Pro n’est pas encore configurée.', { status: 503 });
    // En développement local seulement (clé « dev »), la racine mène à l'app.
    if (env.ACCESS_KEY === 'dev' && url.pathname === '/') return Response.redirect(url.origin + '/k/dev/', 302);
    const m = url.pathname.match(/^\/k\/([^/]+)(\/.*)?$/);
    if (!m || !sameKey(m[1], env.ACCESS_KEY)) return notFound();
    if (m[2] === undefined) return Response.redirect(url.origin + url.pathname + '/', 301);
    const rest = m[2].slice(1);

    try {
      let res;
      if (rest.startsWith('api/')) res = await api(req, env, ctx, rest.slice(4), url);
      else if (rest === 'manifest.webmanifest') res = manifest();
      else res = await env.ASSETS.fetch(new Request(url.origin + '/' + rest, { method: 'GET', headers: req.headers }));
      res = new Response(res.body, res);
      res.headers.set('Referrer-Policy', 'no-referrer');
      res.headers.set('X-Robots-Tag', 'noindex, nofollow');
      return res;
    } catch (err) {
      console.error(err);
      return json({ error: 'Erreur du serveur', detail: String(err.message || err) }, 500);
    }
  },
};
