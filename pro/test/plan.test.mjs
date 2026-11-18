import test from 'node:test';
import assert from 'node:assert/strict';
import { place, rank, sortTasks, freeWindows, mostAvoided, fmtTime, fmtDur } from '../public/plan.js';

const T = (id, o = {}) => ({ id, title: 't' + id, section: 'faire', nature: 'autre', status: 'todo', est_minutes: 30, pushed_count: 0, pinned: 0, start_min: null, sort: id, due_date: null, ...o });
const DAY = { work_start: 480, work_end: 1080, evening_work: 0, evening_end: 1260 };
const TODAY = '2026-11-16';

test("l'ordre de tri : échéance, obligation, quelqu'un attend, avance, reste", () => {
  const tasks = [
    T(1),
    T(2, { nature: 'avance' }),
    T(3, { section: 'rappel' }),
    T(4, { nature: 'obligation' }),
    T(5, { due_date: '2026-11-18' }),
    T(6, { due_date: '2026-11-30' }),
  ];
  assert.deepEqual(sortTasks(tasks, TODAY).map((t) => t.id), [5, 4, 3, 2, 6, 1]);
  assert.equal(rank(T(9, { due_date: '2026-11-19' }), TODAY), 0);
  assert.equal(rank(T(9, { due_date: '2026-11-20' }), TODAY), 4);
});

test('les fenêtres libres excluent le souper et les rendez-vous', () => {
  const day = { ...DAY, work_end: 1140, evening_work: 1, evening_end: 1260 };
  const free = freeWindows(day, [{ start_min: 600, end_min: 660 }]);
  assert.deepEqual(free, [[480, 600], [660, 1080], [1140, 1260]]);
});

test('aucun bloc ne chevauche un rendez-vous, le souper ou un autre bloc', () => {
  const tasks = Array.from({ length: 12 }, (_, i) => T(i + 1, { est_minutes: [10, 30, 45, 60][i % 4] }));
  const events = [{ start_min: 600, end_min: 660 }, { start_min: 840, end_min: 930 }];
  const res = place(tasks, DAY, events, undefined, { today: TODAY });
  const blocks = res.placed.map((p) => ({ s: p.start_min, e: p.start_min + tasks.find((t) => t.id === p.id).est_minutes }));
  for (const b of blocks) {
    assert.ok(b.s >= 480 && b.e <= 1080, 'dans les heures de travail');
    for (const ev of events) assert.ok(b.e <= ev.start_min || b.s >= ev.end_min, 'pas sur un rendez-vous');
  }
  blocks.sort((a, b) => a.s - b.s);
  for (let i = 1; i < blocks.length; i++) assert.ok(blocks[i].s >= blocks[i - 1].e, 'pas de chevauchement');
});

test('le quart de la journée reste libre pour les imprévus', () => {
  const tasks = Array.from({ length: 20 }, (_, i) => T(i + 1, { est_minutes: 60 }));
  const res = place(tasks, DAY, [], undefined, { today: TODAY });
  assert.equal(res.available, 600);
  assert.equal(res.capacity, 450);
  const used = res.placed.length * 60;
  assert.ok(used <= 450, `placé ${used} min sur 450`);
  assert.ok(res.unplaced.length > 0 && res.overflow);
  assert.ok(res.free.length >= 1, 'au moins un bloc libre');
});

test('la tâche la plus reportée passe en premier bloc', () => {
  const tasks = [T(1, { due_date: '2026-11-17' }), T(2, { pushed_count: 2 }), T(3, { pushed_count: 4, est_minutes: 60 })];
  assert.equal(mostAvoided(tasks).id, 3);
  const res = place(tasks, DAY, [], undefined, { today: TODAY });
  assert.equal(res.placed.find((p) => p.id === 3).start_min, 480);
});

test('une heure choisie à la main ne bouge pas, les autres contournent', () => {
  const tasks = [T(1, { pinned: 1, start_min: 480, est_minutes: 60 }), T(2), T(3)];
  const res = place(tasks, DAY, [], undefined, { today: TODAY });
  assert.equal(res.placed.find((p) => p.id === 1).start_min, 480);
  for (const id of [2, 3]) assert.ok(res.placed.find((p) => p.id === id).start_min >= 540);
});

test("en cours de journée, rien ne se place dans le passé", () => {
  const res = place([T(1), T(2)], DAY, [], undefined, { today: TODAY, fromMin: 13 * 60 + 12 });
  for (const p of res.placed) assert.ok(p.start_min >= 13 * 60 + 15);
});

test('les tâches faites ne sont pas replacées', () => {
  const res = place([T(1, { status: 'done' }), T(2)], DAY, [], undefined, { today: TODAY });
  assert.deepEqual(res.placed.map((p) => p.id), [2]);
});

test("l'affichage des heures et des durées", () => {
  assert.equal(fmtTime(510), '8 h 30');
  assert.equal(fmtTime(600), '10 h');
  assert.equal(fmtDur(45), '45 min');
  assert.equal(fmtDur(90), '1 h 30');
});

test('un moment hors travail avec une heure raccourcit la journée, sans compter dans le prévu', () => {
  // Journée de 6 h à 18 h ; « voir ma blonde » de 17 h à 22 h.
  const day = { work_start: 360, work_end: 1080, evening_work: 0, evening_end: 1260 };
  const blonde = T(50, { kind: 'vie', start_min: 1020, est_minutes: 300, pinned: 1 });
  const without = place([T(1), T(2)], day, [], undefined, { today: TODAY });
  const withIt = place([T(1), T(2), blonde], day, [], undefined, { today: TODAY });
  assert.equal(without.available - withIt.available, 60, "une heure de travail en moins : de 17 h à 18 h");
  assert.equal(withIt.planned, 60, 'le moment ne compte pas dans le temps prévu');
  assert.ok(!withIt.placed.some((p) => p.id === 50) && !withIt.unplaced.includes(50), 'il garde son heure, rien ne le déplace');
  for (const p of withIt.placed) assert.ok(p.start_min + 30 <= 1020, 'aucune tâche après 17 h');
  assert.ok(withIt.free.every(([, b]) => b <= 1020), 'le temps libre s’arrête à 17 h');
});

test('le gym en pleine journée fait un trou, les tâches se placent autour', () => {
  const gym = T(60, { kind: 'vie', start_min: 600, est_minutes: 60, pinned: 1 }); // 10 h à 11 h
  const tasks = Array.from({ length: 6 }, (_, i) => T(i + 1, { est_minutes: 45 }));
  const res = place([...tasks, gym], DAY, [], undefined, { today: TODAY });
  for (const p of res.placed) assert.ok(p.start_min + 45 <= 600 || p.start_min >= 660, `la tâche ${p.id} évite le gym`);
  assert.equal(res.planned, 270);
});

test('un moment hors travail sans heure n’est ni placé ni compté', () => {
  const amis = T(70, { kind: 'vie', est_minutes: 120 });
  const res = place([T(1), amis], DAY, [], undefined, { today: TODAY });
  assert.equal(res.planned, 30);
  assert.deepEqual(res.unplaced, []);
  assert.deepEqual(res.placed.map((p) => p.id), [1]);
  assert.equal(res.available, place([T(1)], DAY, [], undefined, { today: TODAY }).available);
});
