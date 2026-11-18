// Quoi notifier, et quand. La décision est une fonction pure ; l'envoi se fait chaque minute.
import { fmtTime } from '../public/plan.js';
import { toLocal, addDays, dow } from './time.js';
import { broadcast, pushReady } from './push.js';

const DAY_NAMES = ['Dimanche', 'Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi'];
const WINDOW = 5; // minutes de rattrapage si une minute a été sautée

export const NOTIF_DEFAULTS = { notif_start: 1, notif_over: 1, notif_due: 1, notif_evening: 1, evening_min: 22 * 60 };

const inWindow = (t, now) => t != null && t <= now && t > now - WINDOW;

/** Les appels placés bout à bout forment un bloc : on ne sonne qu'une fois, au premier. */
export function callRun(task, tasks) {
  if (task.section !== 'rappel') return { first: true, count: 1 };
  const calls = tasks.filter((t) => t.section === 'rappel' && t.status === 'todo' && t.start_min != null);
  const first = !calls.some((t) => t.id !== task.id && t.start_min + t.est_minutes === task.start_min);
  let count = 1;
  let end = task.start_min + task.est_minutes;
  for (;;) {
    const next = calls.find((t) => t.start_min === end && t.id !== task.id);
    if (!next) break;
    count++;
    end = next.start_min + next.est_minutes;
  }
  return { first, count };
}

/**
 * Les notifications dues à cet instant.
 * ctx : { now: {date, min}, tasks (du jour), dueTasks (échéance aujourd'hui ou dans 3 jours),
 *         day, settings, tomorrowPrepared }
 * Retourne [{ key, title, body }]. La clé sert à ne jamais envoyer deux fois.
 */
export function dueNotifications(ctx) {
  const { now, tasks, dueTasks = [], day, tomorrowPrepared = false } = ctx;
  const s = { ...NOTIF_DEFAULTS, ...ctx.settings };
  const todo = tasks.filter((t) => t.status === 'todo');
  const out = [];

  if (s.notif_start) {
    for (const t of todo.filter((x) => inWindow(x.start_min, now.min))) {
      const run = callRun(t, todo);
      if (!run.first) continue;
      const hour = fmtTime(t.start_min);
      const title =
        t.section !== 'rappel' ? `${hour} · ${t.title}` : run.count > 1 ? `${hour} · ${run.count} personnes à rappeler` : `${hour} · ${t.title}`;
      const body = t.kind === 'vie' ? "C'est l'heure. Le travail attendra." : t.section === 'rappel' ? 'Ouvre le mode appels.' : "C'est l'heure de commencer.";
      out.push({ key: `start:${now.date}:${t.id}:${t.start_min}`, title, body });
    }
  }

  if (s.notif_over) {
    for (const t of todo.filter((x) => x.kind !== 'vie' && x.start_min != null && inWindow(x.start_min + x.est_minutes + 20, now.min))) {
      if (!callRun(t, todo).first) continue;
      out.push({ key: `over:${now.date}:${t.id}:${t.start_min}`, title: t.title, body: 'Encore dessus, ou on déplace la suite ?' });
    }
  }

  if (s.notif_due && inWindow(day.work_start, now.min)) {
    for (const t of dueTasks) {
      if (t.status !== 'todo' || !t.due_date) continue;
      if (t.due_date === now.date) out.push({ key: `due:${t.id}:${t.due_date}:0`, title: `Aujourd'hui : ${t.title}`, body: "C'est la date limite." });
      else if (t.due_date === addDays(now.date, 3)) {
        out.push({ key: `due:${t.id}:${t.due_date}:3`, title: `${DAY_NAMES[dow(t.due_date)]} : ${t.title}`, body: 'Date limite dans trois jours.' });
      }
    }
  }

  if (s.notif_evening && inWindow(s.evening_min, now.min) && !tomorrowPrepared) {
    const n = todo.filter((t) => t.kind !== 'vie').length;
    out.push({
      key: `evening:${now.date}`,
      title: 'Préparer demain',
      body: n ? `${n} tâche${n > 1 ? 's' : ''} à trier, puis ta feuille de demain.` : 'Tout est coché. Monte ta feuille de demain.',
    });
  }
  return out;
}

/** Appelé chaque minute par Cloudflare. */
export async function runNotifications(env) {
  if (!pushReady(env)) return 0;
  const subs = await env.DB.prepare('SELECT COUNT(*) AS n FROM push_subs').first();
  if (!subs.n) return 0;

  const now = toLocal();
  const all = async (sql, ...b) => (await env.DB.prepare(sql).bind(...b).all()).results;
  const settings = {};
  for (const r of await all("SELECT key, value FROM settings WHERE key LIKE 'notif_%' OR key = 'evening_min' OR key IN ('work_start')")) settings[r.key] = Number(r.value);
  const day = (await env.DB.prepare('SELECT * FROM days WHERE date = ?').bind(now.date).first()) || { work_start: 8 * 60 };
  const tomorrow = await env.DB.prepare('SELECT prepared_at FROM days WHERE date = ?').bind(addDays(now.date, 1)).first();

  const due = dueNotifications({
    now,
    tasks: await all("SELECT * FROM tasks WHERE day = ? AND status = 'todo'", now.date),
    dueTasks: await all("SELECT * FROM tasks WHERE status = 'todo' AND due_date IN (?, ?)", now.date, addDays(now.date, 3)),
    day,
    settings,
    tomorrowPrepared: Boolean(tomorrow?.prepared_at),
  });

  let n = 0;
  for (const msg of due) {
    // L'insertion échoue si la clé existe déjà : c'est ce qui empêche le doublon.
    const ins = await env.DB.prepare('INSERT OR IGNORE INTO sent (key, at) VALUES (?, ?)').bind(msg.key, Date.now()).run();
    if (!ins.meta.changes) continue;
    await broadcast(env, { title: msg.title, body: msg.body, tag: msg.key });
    n++;
  }
  if (now.min % 60 === 0) await env.DB.prepare('DELETE FROM sent WHERE at < ?').bind(Date.now() - 8 * 86400000).run();
  return n;
}
