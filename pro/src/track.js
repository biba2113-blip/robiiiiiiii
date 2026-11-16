// Le chrono : « je suis là-dessus », l'imprévu, et le temps réel de chaque tâche.
import { toLocal } from './time.js';

const MAX_MS = 3 * 60 * 60000; // un chrono oublié est coupé à 3 heures

const openEntry = (env) => env.DB.prepare('SELECT * FROM entries WHERE ended_at IS NULL ORDER BY id DESC LIMIT 1').first();

async function close(env, e, at = Date.now()) {
  const end = Math.min(at, e.started_at + MAX_MS);
  await env.DB.prepare('UPDATE entries SET ended_at = ? WHERE id = ?').bind(end, e.id).run();
  if (e.kind === 'task' && e.task_id) {
    const sum = await env.DB.prepare('SELECT COALESCE(SUM(ended_at - started_at), 0) AS ms FROM entries WHERE task_id = ? AND ended_at IS NOT NULL')
      .bind(e.task_id)
      .first();
    await env.DB.prepare('UPDATE tasks SET actual_minutes = ? WHERE id = ?').bind(Math.round(sum.ms / 60000), e.task_id).run();
  }
}

const start = (env, kind, { taskId = null, label = null, resume = null } = {}) =>
  env.DB.prepare('INSERT INTO entries (day, kind, task_id, label, started_at, resume_task_id) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(toLocal().date, kind, taskId, label, Date.now(), resume)
    .run();

/** Ce sur quoi tu es en ce moment, ou null. */
export async function current(env) {
  const e = await openEntry(env);
  if (!e) return null;
  if (Date.now() - e.started_at > MAX_MS) {
    await close(env, e);
    return null;
  }
  if (e.kind === 'imprevu') return { kind: 'imprevu', task_id: null, title: e.label || 'Imprévu', company: null, started_at: e.started_at };
  const t = await env.DB.prepare('SELECT id, title, company, status FROM tasks WHERE id = ?').bind(e.task_id).first();
  if (!t || t.status !== 'todo') {
    await close(env, e);
    return null;
  }
  return { kind: 'task', task_id: t.id, title: t.title, company: t.company, started_at: e.started_at };
}

/** Un tap sur une tâche : elle devient la tâche en cours. Un second tap la met en pause. */
export async function focus(env, taskId, { toggle = true } = {}) {
  const cur = await openEntry(env);
  if (cur) {
    if (cur.kind === 'task' && cur.task_id === taskId && !toggle) return; // déjà dessus
    await close(env, cur);
    if (cur.kind === 'task' && cur.task_id === taskId) return;
  }
  const t = await env.DB.prepare("SELECT id FROM tasks WHERE id = ? AND status = 'todo'").bind(taskId).first();
  if (t) await start(env, 'task', { taskId });
}

/** Pause. Après un imprévu, la tâche d'avant reprend toute seule. */
export async function stop(env) {
  const cur = await openEntry(env);
  if (!cur) return;
  await close(env, cur);
  if (cur.kind === 'imprevu' && cur.resume_task_id) {
    const t = await env.DB.prepare("SELECT id FROM tasks WHERE id = ? AND status = 'todo'").bind(cur.resume_task_id).first();
    if (t) await start(env, 'task', { taskId: t.id });
  }
}

/** Un imprévu arrive : la tâche en cours se met en pause, le temps de l'imprévu est compté à part. */
export async function imprevu(env, label = null) {
  const cur = await openEntry(env);
  if (cur?.kind === 'imprevu') return;
  if (cur) await close(env, cur);
  await start(env, 'imprevu', { label: label ? String(label).slice(0, 120) : null, resume: cur?.kind === 'task' ? cur.task_id : null });
}

/** Une tâche cochée ou supprimée arrête son chrono. */
export async function onTaskClosed(env, taskId) {
  const cur = await openEntry(env);
  if (cur?.kind === 'task' && cur.task_id === taskId) await close(env, cur);
}

/** Minutes mesurées un jour donné : { byTask: { id: minutes }, imprevu: minutes }. Le chrono en cours compte jusqu'à maintenant. */
export async function minutesFor(env, day) {
  const rows = (await env.DB.prepare('SELECT * FROM entries WHERE day = ?').bind(day).all()).results;
  const byTask = {};
  let imp = 0;
  const now = Date.now();
  for (const e of rows) {
    const ms = Math.min(e.ended_at ?? now, e.started_at + MAX_MS) - e.started_at;
    if (e.kind === 'imprevu') imp += ms;
    else if (e.task_id) byTask[e.task_id] = (byTask[e.task_id] || 0) + ms;
  }
  for (const k of Object.keys(byTask)) byTask[k] = Math.round(byTask[k] / 60000);
  return { byTask, imprevu: Math.round(imp / 60000) };
}
