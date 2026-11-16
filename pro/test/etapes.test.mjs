import test from 'node:test';
import assert from 'node:assert/strict';
import { dueNotifications, callRun } from '../src/notify.js';
import { addMonths, advance, instancesDue } from '../src/recurring.js';
import { classifyMinute, shouldRemind, isDistraction } from '../src/bilan.js';
import { icsFor } from '../src/caldav.js';

const T = (id, o = {}) => ({ id, title: 't' + id, section: 'faire', nature: 'autre', status: 'todo', est_minutes: 30, start_min: null, due_date: null, ...o });
const DAY = { work_start: 480 };
const keys = (list) => list.map((n) => n.key.split(':')[0] + ':' + n.title);

test("à l'heure prévue : une notification au début du bloc, une seule fois", () => {
  const tasks = [T(1, { start_min: 540, title: 'Soumission triplex' }), T(2, { start_min: 600 })];
  const at = (min) => dueNotifications({ now: { date: '2026-11-16', min }, tasks, day: DAY });
  assert.deepEqual(keys(at(540)), ['start:9 h · Soumission triplex']);
  assert.equal(at(539).length, 0, 'rien avant l’heure');
  assert.equal(at(543)[0].key, at(540)[0].key, 'une minute sautée est rattrapée avec la même clé');
  assert.equal(at(546).length, 0, 'plus rien après 5 minutes');
});

test('les appels bout à bout ne sonnent qu’une fois', () => {
  const calls = [
    T(1, { section: 'rappel', start_min: 540, est_minutes: 10, title: 'Rappeler A' }),
    T(2, { section: 'rappel', start_min: 550, est_minutes: 10, title: 'Rappeler B' }),
    T(3, { section: 'rappel', start_min: 560, est_minutes: 10, title: 'Rappeler C' }),
    T(4, { section: 'rappel', start_min: 700, est_minutes: 10, title: 'Rappeler D' }),
  ];
  assert.deepEqual(callRun(calls[0], calls), { first: true, count: 3 });
  assert.equal(callRun(calls[1], calls).first, false);
  const all = [540, 550, 560, 700].flatMap((min) => dueNotifications({ now: { date: 'd', min }, tasks: calls, day: DAY, settings: { notif_over: 0 } }));
  assert.deepEqual(all.map((n) => n.title), ['9 h · 3 personnes à rappeler', '11 h 40 · Rappeler D']);
});

test('tu dépasses : 20 minutes après la fin prévue, si ce n’est pas coché', () => {
  const tasks = [T(1, { start_min: 540, est_minutes: 30, title: 'Compta' }), T(2, { start_min: 540, est_minutes: 30, status: 'done' })];
  const n = dueNotifications({ now: { date: 'd', min: 590 }, tasks, day: DAY });
  assert.deepEqual(n.map((x) => [x.key, x.body]), [['over:d:1:540', 'Encore dessus, ou on déplace la suite ?']]);
});

test('échéances : trois jours avant, puis le matin même, au début de la journée', () => {
  const dueTasks = [T(1, { due_date: '2026-11-16', title: 'Payer la TPS' }), T(2, { due_date: '2026-11-19', title: "Payer l'assurance" }), T(3, { due_date: '2026-11-17' })];
  const n = dueNotifications({ now: { date: '2026-11-16', min: 480 }, tasks: [], dueTasks, day: DAY });
  assert.deepEqual(n.map((x) => x.title), ["Aujourd'hui : Payer la TPS", "Jeudi : Payer l'assurance"]);
  assert.equal(dueNotifications({ now: { date: '2026-11-16', min: 700 }, tasks: [], dueTasks, day: DAY }).length, 0);
});

test('préparer demain : à 22 h, sauf si c’est déjà fait ou coupé', () => {
  const base = { now: { date: 'd', min: 22 * 60 }, tasks: [T(1), T(2)], day: DAY };
  assert.equal(dueNotifications(base)[0].body, '2 tâches à trier, puis ta feuille de demain.');
  assert.equal(dueNotifications({ ...base, tomorrowPrepared: true }).length, 0);
  assert.equal(dueNotifications({ ...base, settings: { notif_evening: 0 } }).length, 0);
  assert.equal(dueNotifications({ ...base, now: { date: 'd', min: 21 * 60 }, settings: { evening_min: 21 * 60 } }).length, 1);
});

test('ce qui revient : semaines, mois, fins de mois, trimestres', () => {
  assert.equal(addMonths('2026-01-31', 1), '2026-02-28');
  assert.equal(addMonths('2026-11-15', 3), '2027-02-15');
  assert.equal(advance('2026-11-16', 'week'), '2026-11-23');
  assert.equal(advance('2026-10-31', 'quarter'), '2027-01-31');
  assert.equal(advance('2028-02-29', 'year'), '2029-02-28');
  // créée 7 jours avant l'échéance, pas plus tôt
  assert.deepEqual(instancesDue({ next_due: '2026-11-30', every: 'month' }, '2026-11-22'), { dates: [], next: '2026-11-30' });
  assert.deepEqual(instancesDue({ next_due: '2026-11-30', every: 'month' }, '2026-11-23'), { dates: ['2026-11-30'], next: '2026-12-30' });
  // après une longue absence, les échéances manquées sont toutes créées
  assert.deepEqual(instancesDue({ next_due: '2026-11-02', every: 'week' }, '2026-11-16').dates, ['2026-11-02', '2026-11-09', '2026-11-16', '2026-11-23']);
});

test("l'assistant : sur la feuille, libre, puis hors feuille", () => {
  assert.equal(classifyMinute({ focusKind: 'task', app: 'Excel' }), 'feuille');
  assert.equal(classifyMinute({ focusKind: 'task', site: 'www.youtube.com' }), 'hors', 'une distraction compte même avec une tâche en cours');
  assert.equal(classifyMinute({ focusKind: 'imprevu', app: 'Mail' }), 'imprevu');
  assert.equal(classifyMinute({ focusKind: null, app: 'Terminal', freeStreak: 9 }), 'libre');
  assert.equal(classifyMinute({ focusKind: null, app: 'Terminal', freeStreak: 10 }), 'hors', 'après 10 minutes sans tâche en cours');
  assert.equal(classifyMinute({ focusKind: null, inPro: true, freeStreak: 30 }), 'feuille', 'préparer sa feuille dans Pro n’est pas hors feuille');
  assert.ok(isDistraction('m.facebook.com'));
  assert.ok(!isDistraction('notfacebook.com'));
  assert.ok(!isDistraction('claude.ai', 'Claude'));
});

test("l'écran de rappel : seulement budget épuisé, hors feuille, et pas trop souvent", () => {
  assert.equal(shouldRemind({ kind: 'hors', offMinutes: 59, budget: 60, minutesSinceLastPrompt: null }), false);
  assert.equal(shouldRemind({ kind: 'hors', offMinutes: 60, budget: 60, minutesSinceLastPrompt: null }), true);
  assert.equal(shouldRemind({ kind: 'feuille', offMinutes: 90, budget: 60, minutesSinceLastPrompt: null }), false);
  assert.equal(shouldRemind({ kind: 'hors', offMinutes: 90, budget: 60, minutesSinceLastPrompt: 6 }), false, 'pas de rappel dans les 15 minutes');
  assert.equal(shouldRemind({ kind: 'hors', offMinutes: 90, budget: 60, minutesSinceLastPrompt: 16 }), true);
});

test('un appel qui suit un autre est écrit au calendrier sans alerte', () => {
  const t = { id: 3, title: 'Rappeler B', section: 'rappel', day: '2026-11-16', start_min: 550, est_minutes: 10 };
  assert.ok(icsFor(t, 'pro-3').includes('BEGIN:VALARM'));
  assert.ok(!icsFor(t, 'pro-3', { alarm: false }).includes('BEGIN:VALARM'));
});
