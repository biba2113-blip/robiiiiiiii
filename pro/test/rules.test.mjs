import test from 'node:test';
import assert from 'node:assert/strict';
import { parseWithRules, nextWeekday } from '../src/rules.js';
import { sanitize } from '../src/parse.js';
import { toLocal, toUtc, addDays, dow } from '../src/time.js';

const CTX = { today: '2026-11-16', defaultDay: '2026-11-16' }; // un lundi

test('les heures de Montréal, été comme hiver', () => {
  assert.deepEqual(toLocal(Date.UTC(2026, 10, 16, 14, 30)), { date: '2026-11-16', min: 9 * 60 + 30, dow: 1 }); // UTC-5
  assert.deepEqual(toLocal(Date.UTC(2026, 6, 1, 14, 30)), { date: '2026-07-01', min: 10 * 60 + 30, dow: 3 }); // UTC-4
  assert.equal(toUtc('2026-11-16', 9 * 60 + 30), Date.UTC(2026, 10, 16, 14, 30));
  assert.equal(toUtc('2026-07-01', 10 * 60 + 30), Date.UTC(2026, 6, 1, 14, 30));
  assert.equal(addDays('2026-11-30', 1), '2026-12-01');
  assert.equal(dow('2026-11-16'), 1);
});

test('le prochain jour de semaine', () => {
  assert.equal(nextWeekday('2026-11-16', 5), '2026-11-20'); // vendredi
  assert.equal(nextWeekday('2026-11-16', 1), '2026-11-23'); // lundi prochain, pas aujourd'hui
});

test('une dictée en vrac est séparée et classée', () => {
  const items = parseWithRules(
    "Rappeler le propriétaire du six logements, envoyer le bail signé, payer l'assurance avant vendredi, fermer le mois d'octobre pour Robiii demain",
    CTX,
  );
  assert.equal(items.length, 4);
  const [a, b, c, d] = items;
  assert.equal(a.section, 'rappel');
  assert.equal(a.company, 'immo');
  assert.equal(a.est_minutes, 10);
  assert.equal(b.company, 'immo');
  assert.equal(b.section, 'faire');
  assert.equal(c.due_date, '2026-11-20');
  assert.equal(c.section, 'priorite');
  assert.equal(c.nature, 'obligation');
  assert.equal(d.company, 'robiii');
  assert.equal(d.day, '2026-11-17');
});

test('une liste sur plusieurs lignes', () => {
  const items = parseWithRules('- appeler Marc\n- commande du détaillant\n- renouveler les plaques', CTX);
  assert.deepEqual(items.map((i) => i.section), ['rappel', 'faire', 'priorite']);
  assert.deepEqual(items.map((i) => i.company), ['perso', 'robiii', 'perso']);
  assert.equal(items[0].title, 'Appeler Marc');
});

test('le nettoyage refuse les valeurs inventées', () => {
  const t = sanitize({ title: '  Test  ', section: 'nimporte', company: 'x', nature: 'y', day: 'demain', due_date: '31 nov', est_minutes: 9999 }, CTX);
  assert.deepEqual(t, { title: 'Test', section: 'faire', company: 'perso', nature: 'autre', day: '2026-11-16', due_date: null, est_minutes: 480, contact: null });
  assert.equal(sanitize({ title: '' }, CTX), null);
  assert.equal(sanitize({ title: 'x', day: null }, CTX).day, null); // la réserve
  assert.equal(sanitize({ title: 'x', day: '2026-11-01' }, CTX).day, '2026-11-16'); // jamais dans le passé
});
