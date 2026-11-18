// Le bilan du soir, le miroir du dimanche, et le budget « hors feuille » nourri par l'assistant du Mac.
import { place, fmtDur, fmtTime, DEFAULTS } from '../public/plan.js';
import { toLocal, addDays } from './time.js';
import { minutesFor } from './track.js';

export const OFF_DEFAULTS = { off_budget: 60, off_grace: 10, off_snooze: 15 };
export const DEFAULT_DISTRACTIONS = [
  'youtube.com', 'facebook.com', 'instagram.com', 'tiktok.com', 'x.com', 'twitter.com', 'reddit.com', 'netflix.com', 'twitch.tv',
  'lapresse.ca', 'journaldemontreal.com', 'radio-canada.ca', 'tvanouvelles.ca', 'linkedin.com', 'pinterest.com', 'snapchat.com',
];

const GROUPS = { obligation: 'Obligations', attend: 'Quelqu’un attend', avance: 'Fait avancer une entreprise', autre: 'Le reste' };
const groupOf = (t) => (t.section === 'rappel' && t.nature === 'autre' ? 'attend' : t.nature in GROUPS ? t.nature : 'autre');

const all = async (env, sql, ...b) => (await env.DB.prepare(sql).bind(...b).all()).results;

export const isDistraction = (site, app, list = DEFAULT_DISTRACTIONS) => {
  const s = String(site || '').toLowerCase().replace(/^www\./, '');
  const a = String(app || '').toLowerCase();
  return list.some((d) => (s && (s === d || s.endsWith('.' + d))) || (a && a === d.split('.')[0]));
};

/**
 * Range une minute d'activité. Fonction pure.
 *  - une distraction compte toujours hors feuille ;
 *  - une tâche en cours : sur la feuille ; un imprévu : imprévu ;
 *  - rien en cours : libre pendant les premières minutes (grace), puis hors feuille.
 */
export function classifyMinute({ focusKind, site, app, inPro = false, freeStreak = 0, grace = OFF_DEFAULTS.off_grace, distractions }) {
  if (isDistraction(site, app, distractions)) return 'hors';
  if (inPro) return 'feuille';
  if (focusKind === 'task') return 'feuille';
  if (focusKind === 'imprevu') return 'imprevu';
  return freeStreak >= grace ? 'hors' : 'libre';
}

/** Faut-il afficher le rappel ? Seulement hors feuille, budget épuisé, et pas de rappel récent. */
export function shouldRemind({ kind, offMinutes, budget, minutesSinceLastPrompt, snooze = OFF_DEFAULTS.off_snooze }) {
  return kind === 'hors' && offMinutes >= budget && (minutesSinceLastPrompt == null || minutesSinceLastPrompt >= snooze);
}

async function numbers(env, keys) {
  const out = {};
  for (const r of await all(env, `SELECT key, value FROM settings WHERE key IN (${keys.map(() => '?').join(',')})`, ...keys)) out[r.key] = Number(r.value);
  return out;
}

/** Une minute rapportée par l'assistant du Mac. Retourne quoi afficher. */
export async function recordActivity(env, { app, site, inPro = false }) {
  const now = toLocal();
  const s = { ...OFF_DEFAULTS, ...(await numbers(env, ['off_budget', 'off_grace', 'off_snooze'])) };
  const open = await env.DB.prepare('SELECT kind, task_id FROM entries WHERE ended_at IS NULL ORDER BY id DESC LIMIT 1').first();

  // Minutes d'affilée sans tâche en cours, juste avant celle-ci.
  const recent = await all(env, 'SELECT minute, kind FROM activity WHERE day = ? AND minute < ? AND minute >= ? ORDER BY minute DESC', now.date, now.min, now.min - 30);
  let streak = 0;
  let expect = now.min - 1;
  for (const r of recent) {
    if (r.minute < expect - 2 || !['libre', 'hors'].includes(r.kind)) break; // un trou de plus de 2 minutes repart à zéro
    streak++;
    expect = r.minute - 1;
  }

  const kind = classifyMinute({ focusKind: open?.kind, site, app, inPro, freeStreak: streak, grace: s.off_grace });
  await env.DB.prepare('INSERT INTO activity (day, minute, app, site, kind) VALUES (?, ?, ?, ?, ?) ON CONFLICT(day, minute) DO UPDATE SET app = excluded.app, site = excluded.site, kind = excluded.kind')
    .bind(now.date, now.min, String(app || '').slice(0, 80), String(site || '').slice(0, 120), kind)
    .run();

  const off = (await env.DB.prepare("SELECT COUNT(*) AS n FROM activity WHERE day = ? AND kind = 'hors'").bind(now.date).first()).n;
  const last = await env.DB.prepare("SELECT at FROM journal WHERE day = ? AND kind IN ('remind', 'override') ORDER BY at DESC LIMIT 1").bind(now.date).first();
  const remind = shouldRemind({ kind, offMinutes: off, budget: s.off_budget, minutesSinceLastPrompt: last ? (Date.now() - last.at) / 60000 : null, snooze: s.off_snooze });
  let remaining = [];
  if (remind) {
    await env.DB.prepare("INSERT INTO journal (day, at, kind, detail) VALUES (?, ?, 'remind', ?)").bind(now.date, Date.now(), site || app || '').run();
    remaining = (await all(env, "SELECT title FROM tasks WHERE day = ? AND status = 'todo' AND kind != 'vie' ORDER BY (start_min IS NULL), start_min, sort LIMIT 3", now.date)).map((t) => t.title);
  }
  return { kind, off_minutes: off, budget: s.off_budget, remind, remaining };
}

/** Le hors feuille d'une journée : minutes, budget, où ça s'est passé, et ce que l'assistant a noté. */
export async function offSummary(env, date) {
  const s = { ...OFF_DEFAULTS, ...(await numbers(env, ['off_budget'])) };
  const rows = await all(env, 'SELECT app, site, kind, minute FROM activity WHERE day = ?', date);
  const off = rows.filter((r) => r.kind === 'hors');
  const count = {};
  for (const r of off) {
    const k = (r.site || r.app || 'Autre').replace(/^www\./, '');
    count[k] = (count[k] || 0) + 1;
  }
  const top = Object.entries(count).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([name, minutes]) => ({ name, minutes }));
  const journal = await all(env, 'SELECT at, kind, detail FROM journal WHERE day = ? ORDER BY at', date);
  return {
    active: rows.length > 0,
    minutes: off.length,
    budget: s.off_budget,
    top,
    overrides: journal.filter((j) => j.kind === 'override').length,
    stops: journal.filter((j) => j.kind === 'assistant_stop').map((j) => toLocal(j.at).min),
    last_seen: rows.length ? Math.max(...rows.map((r) => r.minute)) : null,
  };
}

const median = (arr) => {
  const a = [...arr].sort((x, y) => x - y);
  return a.length % 2 ? a[(a.length - 1) / 2] : (a[a.length / 2 - 1] + a[a.length / 2]) / 2;
};

/** Ton rythme : rapport entre le temps réel et le temps prévu, sur tes dernières tâches mesurées. Null tant qu'il y en a moins de 5. */
export async function pace(env) {
  const rows = await all(env, "SELECT est_minutes, actual_minutes FROM tasks WHERE status = 'done' AND kind != 'vie' AND actual_minutes >= 2 ORDER BY done_at DESC LIMIT 30");
  if (rows.length < 5) return null;
  return Math.min(2.5, Math.max(0.5, Math.round(median(rows.map((r) => r.actual_minutes / r.est_minutes)) * 10) / 10));
}

/** Le bilan d'une journée : prévu contre fait, par type de travail. */
export async function bilan(env, date, { day, events = [], settings = DEFAULTS } = {}) {
  const tasks = await all(env, "SELECT * FROM tasks WHERE day = ? AND status != 'deleted' AND kind != 'vie'", date);
  const tracked = await minutesFor(env, date);
  const off = await offSummary(env, date);
  const rows = Object.entries(GROUPS).map(([key, label]) => {
    const list = tasks.filter((t) => groupOf(t) === key);
    return {
      key,
      label,
      planned: list.reduce((n, t) => n + t.est_minutes, 0),
      done: list.reduce((n, t) => n + (tracked.byTask[t.id] || 0), 0),
      count: list.length,
      checked: list.filter((t) => t.status === 'done').length,
    };
  }).filter((r) => r.count);

  const cap = day ? place(tasks, day, events, settings) : null;
  const measured = rows.reduce((n, r) => n + r.done, 0) + tracked.imprevu;
  const total = tasks.length;
  const checked = tasks.filter((t) => t.status === 'done').length;

  // Une phrase, tirée des chiffres.
  let sentence;
  const worst = rows.filter((r) => r.planned >= 30 && r.done < r.planned / 2).sort((a, b) => b.planned - b.done - (a.planned - a.done))[0];
  if (off.active && off.minutes > off.budget) {
    const where = off.top.map((t) => t.name).slice(0, 2).join(' et ');
    sentence = `${fmtDur(off.minutes)} hors feuille${where ? `, surtout dans ${where}` : ''}.${worst ? ` ${worst.label} : ${fmtDur(worst.done)} sur ${fmtDur(worst.planned)} prévues.` : ''}`;
  } else if (!measured) {
    sentence = total ? `${checked} tâche${checked > 1 ? 's' : ''} cochée${checked > 1 ? 's' : ''} sur ${total}. Aucun temps mesuré : touche une tâche pour lancer son chrono.` : 'Feuille vide aujourd’hui.';
  } else if (worst) {
    sentence = `${worst.label} : ${fmtDur(worst.done)} sur ${fmtDur(worst.planned)} prévues. Demain, ça passe en premier.`;
  } else {
    sentence = `${checked} sur ${total} cochées, et le temps mesuré suit le plan.`;
  }

  return {
    date,
    rows,
    imprevu: { planned: cap ? cap.available - cap.capacity : 0, done: tracked.imprevu },
    off,
    total,
    checked,
    measured,
    sentence,
    pace: await pace(env),
  };
}

/** Le miroir du dimanche : trois constats sur les sept derniers jours, un seul ajustement. */
export async function mirror(env, today) {
  const from = addDays(today, -6);
  const tasks = await all(env, "SELECT * FROM tasks WHERE day >= ? AND day <= ? AND status != 'deleted' AND kind != 'vie'", from, today);
  const entries = await all(env, 'SELECT * FROM entries WHERE day >= ? AND day <= ? AND ended_at IS NOT NULL', from, today);
  const act = await all(env, "SELECT minute, app, site FROM activity WHERE day >= ? AND day <= ? AND kind = 'hors'", from, today);
  const pushed = await all(env, "SELECT title, pushed_count, company, nature, section FROM tasks WHERE status = 'todo' AND pushed_count >= 2 ORDER BY pushed_count DESC LIMIT 3");

  const total = tasks.length;
  const checked = tasks.filter((t) => t.status === 'done').length;
  const byCompany = { robiii: 0, immo: 0, perso: 0 };
  let imprevu = 0;
  const taskById = Object.fromEntries(tasks.map((t) => [t.id, t]));
  for (const e of entries) {
    const min = (e.ended_at - e.started_at) / 60000;
    if (e.kind === 'imprevu') imprevu += min;
    else if (taskById[e.task_id]) byCompany[taskById[e.task_id].company] += min;
  }
  const measured = byCompany.robiii + byCompany.immo + byCompany.perso;

  const hours = {};
  const places = {};
  for (const a of act) {
    const h = Math.floor(a.minute / 60);
    hours[h] = (hours[h] || 0) + 1;
    const k = (a.site || a.app || 'Autre').replace(/^www\./, '');
    places[k] = (places[k] || 0) + 1;
  }
  const peak = Object.entries(hours).sort((a, b) => b[1] - a[1])[0];
  const top = Object.entries(places).sort((a, b) => b[1] - a[1]).slice(0, 2).map(([k]) => k);

  const facts = [];
  facts.push(total ? `Tu as coché ${checked} tâche${checked > 1 ? 's' : ''} sur ${total} cette semaine (${Math.round((checked / total) * 100)} %).` : 'Aucune tâche sur tes feuilles cette semaine.');
  if (pushed.length) facts.push(`Tu repousses surtout : ${pushed.map((p) => `« ${p.title} » (${p.pushed_count} fois)`).join(', ')}.`);
  if (act.length >= 30) {
    facts.push(`${fmtDur(act.length)} hors feuille${peak ? `, surtout vers ${fmtTime(Number(peak[0]) * 60)}` : ''}${top.length ? `, dans ${top.join(' et ')}` : ''}.`);
  } else if (measured >= 30) {
    const pct = (k) => Math.round((byCompany[k] / measured) * 100);
    facts.push(`Ton temps mesuré : ${pct('immo')} % ImmoMulti, ${pct('robiii')} % Robiii, ${pct('perso')} % perso${imprevu >= 15 ? `, plus ${fmtDur(Math.round(imprevu))} d'imprévus` : ''}.`);
  }

  let adjust;
  if (pushed.length) adjust = `Cette semaine, le premier bloc de chaque jour va à « ${pushed[0].title} », pour 10 minutes.`;
  else if (peak && act.length >= 30) adjust = `Place une tâche courte et précise à ${fmtTime(Number(peak[0]) * 60)}, l'heure où tu décroches le plus.`;
  else if (total && checked / total < 0.5) adjust = 'Mets moins de tâches par jour : la moitié reste sur la feuille.';
  else adjust = 'Garde le même rythme.';

  return { from, to: today, facts: facts.slice(0, 3), adjust, total, checked, off_minutes: act.length, measured: Math.round(measured), imprevu: Math.round(imprevu) };
}
