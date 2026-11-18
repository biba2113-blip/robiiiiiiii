// Ordre de tri et placement à l'horaire. Fonctions pures, partagées par le serveur et l'app.

export const DEFAULTS = {
  supper_start: 18 * 60, // souper à 18 h
  supper_min: 60,
  buffer_pct: 25, // part de la journée gardée libre pour les imprévus
  work_start: 8 * 60,
  work_end: 18 * 60,
  evening_end: 21 * 60,
};

const SNAP = 5;
const up = (n) => Math.ceil(n / SNAP) * SNAP;

export function daysBetween(a, b) {
  return Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400000);
}

/** Rang d'une tâche : 0 échéance proche, 1 obligation, 2 quelqu'un attend, 3 fait avancer, 4 le reste. */
export function rank(t, today) {
  if (t.due_date && daysBetween(today, t.due_date) <= 3) return 0;
  if (t.nature === 'obligation') return 1;
  if (t.nature === 'attend' || t.section === 'rappel') return 2;
  if (t.nature === 'avance') return 3;
  return 4;
}

/** Tri pour l'affichage et le placement. */
export function sortTasks(tasks, today) {
  return [...tasks].sort(
    (a, b) =>
      rank(a, today) - rank(b, today) ||
      (a.due_date || '9999').localeCompare(b.due_date || '9999') ||
      a.sort - b.sort ||
      a.id - b.id,
  );
}

/** La tâche la plus reportée (2 fois ou plus) passe en premier bloc. */
export function mostAvoided(tasks) {
  return tasks
    .filter((t) => t.status === 'todo' && t.pushed_count >= 2)
    .sort((a, b) => b.pushed_count - a.pushed_count || a.id - b.id)[0];
}

/** Un moment hors travail (blonde, amis, gym) : il ne compte pas dans le temps de travail. */
export const isLife = (t) => t.kind === 'vie';

/** Les moments hors travail qui ont une heure : ils occupent l'horaire comme un rendez-vous. */
export function lifeBlocks(tasks) {
  return tasks.filter((t) => isLife(t) && t.start_min != null).map((t) => ({ start_min: t.start_min, end_min: t.start_min + t.est_minutes, allDay: false }));
}

/** Retire un intervalle occupé d'une liste d'intervalles libres. */
function subtract(free, s, e) {
  const out = [];
  for (const [a, b] of free) {
    if (e <= a || s >= b) out.push([a, b]);
    else {
      if (s > a) out.push([a, s]);
      if (e < b) out.push([e, b]);
    }
  }
  return out;
}

/** Fenêtres de travail du jour, sans le souper ni les rendez-vous. */
export function freeWindows(day, events = [], settings = DEFAULTS) {
  const s = { ...DEFAULTS, ...settings };
  let free = [[day.work_start, day.work_end]];
  if (day.evening_work) {
    const from = Math.max(day.work_end, s.supper_start + s.supper_min);
    const to = day.evening_end ?? s.evening_end;
    if (to > from) free.push([from, to]);
  }
  free = subtract(free, s.supper_start, s.supper_start + s.supper_min);
  for (const ev of events) if (!ev.allDay) free = subtract(free, ev.start_min, ev.end_min);
  return free.filter(([a, b]) => b - a >= SNAP);
}

const total = (iv) => iv.reduce((n, [a, b]) => n + (b - a), 0);

/**
 * Place les tâches du jour.
 * - les moments hors travail qui ont une heure réservent leur place et raccourcissent la journée de travail ;
 *   ceux qui n'ont pas d'heure ne sont pas placés ; aucun ne compte dans le temps prévu ;
 * - les tâches épinglées (heure choisie à la main) ne bougent pas ;
 * - la plus reportée passe en premier, puis l'ordre de tri ;
 * - une part de la journée reste libre pour les imprévus, en deux blocs (milieu et fin).
 * Retourne { placed: [{id, start_min}], unplaced: [id], free: [[a,b]], planned, capacity, overflow }.
 */
export function place(tasks, day, events = [], settings = DEFAULTS, opts = {}) {
  const s = { ...DEFAULTS, ...settings };
  const today = opts.today || '0000-00-00';
  const todo = tasks.filter((t) => t.status === 'todo' && !isLife(t));
  let free = freeWindows(day, [...events, ...lifeBlocks(tasks)], s);
  const available = total(free);
  const buffer = Math.round((available * s.buffer_pct) / 100 / SNAP) * SNAP;
  const capacity = available - buffer;

  const placed = [];
  const pinned = todo.filter((t) => t.pinned && t.start_min != null);
  for (const t of pinned) {
    placed.push({ id: t.id, start_min: t.start_min });
    free = subtract(free, t.start_min, t.start_min + t.est_minutes);
  }

  // Rien ne se place dans le passé quand on replanifie en cours de journée.
  if (opts.fromMin != null) free = subtract(free, 0, up(opts.fromMin));

  // Bloc libre du milieu : la moitié de la réserve, autour du milieu de ce qui reste.
  const buffers = [];
  const half = Math.floor(buffer / 2 / SNAP) * SNAP;
  if (half >= 15) {
    const remaining = total(free);
    let walk = remaining / 2 - half / 2;
    for (const [a, b] of free) {
      if (walk < b - a) {
        const start = up(a + Math.max(0, walk));
        const end = Math.min(b, start + half);
        if (end - start >= 15) {
          buffers.push([start, end]);
          free = subtract(free, start, end);
        }
        break;
      }
      walk -= b - a;
    }
  }

  const flex = todo.filter((t) => !(t.pinned && t.start_min != null));
  const first = mostAvoided(flex);
  const ordered = sortTasks(flex.filter((t) => t !== first), today);
  if (first) ordered.unshift(first);

  const unplaced = [];
  let budget = capacity - pinned.reduce((n, t) => n + t.est_minutes, 0);
  for (const t of ordered) {
    const dur = Math.max(SNAP, up(t.est_minutes));
    const slot = budget >= dur ? free.find(([a, b]) => b - up(a) >= dur) : null;
    if (!slot) {
      unplaced.push(t.id);
      continue;
    }
    const start = up(slot[0]);
    placed.push({ id: t.id, start_min: start });
    free = subtract(free, slot[0], start + dur);
    budget -= dur;
  }

  // Ce qui reste libre en fin de journée complète la réserve pour les imprévus.
  const tail = free.filter(([a, b]) => b - a >= 15).pop();
  if (tail) buffers.push(tail);

  const planned = todo.reduce((n, t) => n + t.est_minutes, 0);
  return {
    placed,
    unplaced,
    free: buffers.sort((a, b) => a[0] - b[0]),
    planned,
    capacity,
    available,
    overflow: planned > capacity,
  };
}

export function fmtTime(min) {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h} h ${String(m).padStart(2, '0')}` : `${h} h`;
}

export function fmtDur(min) {
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h} h ${String(m).padStart(2, '0')}` : `${h} h`;
}
