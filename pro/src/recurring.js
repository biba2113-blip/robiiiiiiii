// Ce qui revient : paies, taxes, renouvellements. Tu l'entres une fois, la tâche réapparaît avec sa vraie échéance.
import { addDays, nowIso } from './time.js';

export const EVERY = { week: 'Chaque semaine', month: 'Chaque mois', quarter: 'Tous les 3 mois', year: 'Chaque année' };
const LEAD_DAYS = 7; // la tâche est créée une semaine avant ; elle monte dans les priorités trois jours avant

/** Ajoute des mois à une date, en restant à la fin du mois si le jour n'existe pas (31 janvier + 1 mois = 28 février). */
export function addMonths(date, n) {
  const [y, m, d] = date.split('-').map(Number);
  const total = y * 12 + (m - 1) + n;
  const ny = Math.floor(total / 12);
  const nm = total % 12;
  const last = new Date(Date.UTC(ny, nm + 1, 0)).getUTCDate();
  return `${ny}-${String(nm + 1).padStart(2, '0')}-${String(Math.min(d, last)).padStart(2, '0')}`;
}

export function advance(date, every) {
  if (every === 'week') return addDays(date, 7);
  if (every === 'quarter') return addMonths(date, 3);
  if (every === 'year') return addMonths(date, 12);
  return addMonths(date, 1);
}

/** Les échéances à créer aujourd'hui pour une règle : [dates], et la prochaine échéance à retenir. */
export function instancesDue(rule, today) {
  const dates = [];
  let next = rule.next_due;
  for (let i = 0; i < 12 && addDays(next, -LEAD_DAYS) <= today; i++) {
    dates.push(next);
    next = advance(next, rule.every);
  }
  return { dates, next };
}

/** Crée les tâches dues. Appelé à chaque ouverture de la feuille ; sans effet s'il n'y a rien à créer. */
export async function generate(env, today) {
  const rules = (await env.DB.prepare('SELECT * FROM recurring WHERE active = 1').all()).results;
  let created = 0;
  for (const rule of rules) {
    const { dates, next } = instancesDue(rule, today);
    for (const due of dates) {
      const exists = await env.DB.prepare('SELECT 1 FROM tasks WHERE recurring_id = ? AND due_date = ?').bind(rule.id, due).first();
      if (exists) continue;
      await env.DB.prepare(
        `INSERT INTO tasks (title, section, company, nature, day, due_date, est_minutes, sort, source, recurring_id, created_at)
         VALUES (?, 'priorite', ?, 'obligation', NULL, ?, ?, ?, 'recurrent', ?, ?)`,
      )
        .bind(rule.title, rule.company, due, rule.est_minutes, Date.now() + created, rule.id, nowIso())
        .run();
      created++;
    }
    if (next !== rule.next_due) await env.DB.prepare('UPDATE recurring SET next_due = ? WHERE id = ?').bind(next, rule.id).run();
  }
  return created;
}
