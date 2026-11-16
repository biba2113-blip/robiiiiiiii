// Heures et dates, toujours dans le fuseau de Montréal.

export const TZ = 'America/Toronto'; // même fuseau que Montréal

function parts(ts, tz = TZ) {
  const f = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    weekday: 'short',
  });
  const o = {};
  for (const p of f.formatToParts(new Date(ts))) o[p.type] = p.value;
  return o;
}

/** Décalage du fuseau à cet instant, en millisecondes (négatif à Montréal). */
export function tzOffsetMs(ts, tz = TZ) {
  const p = parts(ts, tz);
  const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
  return asUtc - Math.floor(ts / 1000) * 1000;
}

/** Instant → { date: 'AAAA-MM-JJ', min: minutes depuis minuit, dow: 0 (dimanche) à 6 }. */
export function toLocal(ts = Date.now(), tz = TZ) {
  const p = parts(ts, tz);
  const dow = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(p.weekday);
  return { date: `${p.year}-${p.month}-${p.day}`, min: +p.hour * 60 + +p.minute, dow };
}

/** Date et minute locales → instant UTC en millisecondes. */
export function toUtc(date, min, tz = TZ) {
  const [y, m, d] = date.split('-').map(Number);
  const guess = Date.UTC(y, m - 1, d, 0, min);
  let ts = guess - tzOffsetMs(guess, tz);
  ts = guess - tzOffsetMs(ts, tz); // second passage pour les changements d'heure
  return ts;
}

export function addDays(date, n) {
  const d = new Date(date + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function dow(date) {
  return new Date(date + 'T12:00:00Z').getUTCDay();
}

export const nowIso = () => new Date().toISOString();
