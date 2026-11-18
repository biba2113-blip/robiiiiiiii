import test from 'node:test';
import assert from 'node:assert/strict';
import { place, rank, sortTasks, freeWindows, mostAvoided, fmtTime, fmtDur, flexOrder, shownOrder, moveInOrder, reasonOf, nowNext } from '../public/plan.js';

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

// ---- L'ordre de la journée, choisi à la main ----

/** Place les tâches et rend la liste avec leurs heures, comme le fait le serveur. */
const laidOut = (tasks, day = DAY) => {
  const res = place(tasks, day, [], undefined, { today: TODAY });
  const at = new Map(res.placed.map((p) => [p.id, p.start_min]));
  return tasks.map((t) => (t.kind === 'vie' || (t.pinned && t.start_min != null) ? t : { ...t, start_min: at.get(t.id) ?? null }));
};
/** Applique un déplacement : la suite rendue devient l'ordre à la main, puis on replace. */
const applyMove = (tasks, id, to) => {
  const seq = moveInOrder(tasks, id, to, TODAY);
  if (!seq) return null;
  return laidOut(tasks.map((t) => (seq.includes(t.id) ? { ...t, manual: seq.indexOf(t.id), pinned: t.id === id ? 0 : t.pinned } : t)));
};
const byTime = (tasks) => tasks.filter((t) => t.start_min != null && t.kind !== 'vie').sort((a, b) => a.start_min - b.start_min).map((t) => t.id);

test("sans rien toucher, l'ordre est celui de Pro ; une tâche montée garde sa place", () => {
  const tasks = laidOut([T(1), T(2, { nature: 'obligation' }), T(3, { section: 'rappel' }), T(4, { nature: 'avance' })]);
  assert.deepEqual(byTime(tasks), [2, 3, 4, 1], "obligation, quelqu'un attend, fait avancer, le reste");
  const up = applyMove(tasks, 1, { dir: 'up' });
  assert.deepEqual(byTime(up), [2, 3, 1, 4]);
  const first = applyMove(up, 1, { dir: 'first' });
  assert.deepEqual(byTime(first), [1, 2, 3, 4]);
  const down = applyMove(first, 2, { dir: 'down' });
  assert.deepEqual(byTime(down), [1, 3, 2, 4]);
  assert.equal(moveInOrder(first, 1, { dir: 'up' }, TODAY), null, 'la première ne monte pas plus haut');
  assert.equal(moveInOrder(first, 4, { dir: 'down' }, TODAY), null, 'la dernière ne descend pas plus bas');
});

test('glisser une tâche devant une autre, ou à la fin', () => {
  const tasks = laidOut([T(1), T(2), T(3), T(4)]);
  assert.deepEqual(byTime(applyMove(tasks, 4, { before: 2 })), [1, 4, 2, 3]);
  assert.deepEqual(byTime(applyMove(tasks, 1, { before: 4 })), [2, 3, 1, 4]);
  assert.deepEqual(byTime(applyMove(tasks, 1, { before: null })), [2, 3, 4, 1]);
  assert.equal(moveInOrder(tasks, 2, { before: 99 }, TODAY), null);
});

test("l'ordre à la main tient autour des blocs fixes, et une nouvelle tâche arrive à la fin", () => {
  const gym = T(60, { kind: 'vie', start_min: 600, est_minutes: 60, pinned: 1 });
  const rdv = T(61, { start_min: 540, est_minutes: 30, pinned: 1 }); // une tâche à heure fixée, 9 h
  let tasks = laidOut([T(1, { est_minutes: 60 }), T(2, { est_minutes: 60 }), T(3, { est_minutes: 60 }), gym, rdv]);
  tasks = applyMove(tasks, 3, { dir: 'first' });
  assert.deepEqual(flexOrder(tasks, TODAY).map((t) => t.id), [3, 1, 2]);
  assert.equal(tasks.find((t) => t.id === 61).start_min, 540, "l'heure fixée ne bouge pas");
  assert.equal(tasks.find((t) => t.id === 60).start_min, 600);
  const withNew = laidOut([...tasks, T(9, { nature: 'obligation' })]);
  assert.deepEqual(flexOrder(withNew, TODAY).map((t) => t.id), [3, 1, 2, 9], 'la nouvelle ne bouscule pas ton ordre');
});

test('une tâche à heure fixée qu’on monte redevient libre et prend sa place dans la suite', () => {
  const tasks = laidOut([T(1), T(2), T(3, { start_min: 900, pinned: 1 })]); // la 3 est fixée à 15 h
  assert.deepEqual(shownOrder(tasks, TODAY).map((t) => t.id), [1, 2]);
  const moved = applyMove(tasks, 3, { dir: 'up' });
  assert.equal(moved.find((t) => t.id === 3).pinned, 0);
  assert.deepEqual(byTime(moved), [1, 3, 2]);
});

test('un moment hors travail ne se range pas dans l’ordre du travail', () => {
  const tasks = laidOut([T(1), T(70, { kind: 'vie', est_minutes: 60 })]);
  assert.equal(moveInOrder(tasks, 70, { dir: 'up' }, TODAY), null);
});

test('le mot affiché dit pourquoi la tâche est là', () => {
  assert.equal(reasonOf(T(1, { due_date: '2026-11-17' }), TODAY), 'Échéance proche');
  assert.equal(reasonOf(T(1, { nature: 'obligation' }), TODAY), 'Obligation');
  assert.equal(reasonOf(T(1, { section: 'rappel' }), TODAY), 'Quelqu’un attend');
  assert.equal(reasonOf(T(1, { nature: 'avance' }), TODAY), 'Fait avancer');
  assert.equal(reasonOf(T(1), TODAY), '');
  assert.equal(reasonOf(T(1, { pushed_count: 2 }), TODAY), 'Tu la repousses');
  assert.equal(reasonOf(T(1, { manual: 0, nature: 'obligation' }), TODAY), 'Placée par toi');
  assert.equal(reasonOf(T(1, { pinned: 1, start_min: 600 }), TODAY), 'Heure fixée');
});

test('maintenant et ensuite', () => {
  const blocks = [{ start: 480, end: 540 }, { start: 540, end: 600 }, { start: 660, end: 720 }];
  assert.deepEqual(nowNext(blocks, 500), { now: 0, next: 1 });
  assert.deepEqual(nowNext(blocks, 620), { now: -1, next: 2 }, 'dans un trou : seulement la suivante');
  assert.deepEqual(nowNext(blocks, 400), { now: -1, next: 0 });
  assert.deepEqual(nowNext(blocks, 800), { now: -1, next: -1 });
});
