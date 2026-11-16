// Calendrier iCloud par CalDAV : lire les rendez-vous, écrire les blocs de Pro avec une alerte.
// Sans ICLOUD_USER et ICLOUD_APP_PASSWORD, tout est simplement désactivé.
import { toLocal, toUtc, addDays, TZ } from './time.js';

export const configured = (env) => Boolean(env.ICLOUD_USER && env.ICLOUD_APP_PASSWORD);

const auth = (env) => 'Basic ' + btoa(`${env.ICLOUD_USER}:${env.ICLOUD_APP_PASSWORD}`);

async function dav(env, method, url, { depth, body, type = 'application/xml; charset=utf-8', headers = {} } = {}) {
  const res = await fetch(url, {
    method,
    headers: {
      Authorization: auth(env),
      ...(depth != null ? { Depth: String(depth) } : {}),
      ...(body ? { 'Content-Type': type } : {}),
      ...headers,
    },
    body,
    redirect: 'follow',
  });
  const text = await res.text();
  if (res.status === 401) throw new Error('iCloud refuse le mot de passe d’application');
  if (res.status >= 400 && !(method === 'DELETE' && res.status === 404)) {
    throw new Error(`calendrier : ${method} a répondu ${res.status}`);
  }
  return { status: res.status, text, url: res.url || url };
}

// Lecture XML minimale : les préfixes d'espace de noms varient d'un serveur à l'autre.
const inner = (xml, name) => {
  const m = xml.match(new RegExp(`<(?:[\\w-]+:)?${name}(?:\\s[^>]*)?>([\\s\\S]*?)</(?:[\\w-]+:)?${name}>`, 'i'));
  return m ? m[1] : null;
};
const blocks = (xml, name) =>
  [...xml.matchAll(new RegExp(`<(?:[\\w-]+:)?${name}(?:\\s[^>]*)?>([\\s\\S]*?)</(?:[\\w-]+:)?${name}>`, 'gi'))].map((m) => m[1]);
const unxml = (s) =>
  s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#13;/g, '')
    .replace(/&amp;/g, '&');
const hrefOf = (xml, name) => {
  const b = inner(xml, name);
  const h = b && inner(b, 'href');
  return h ? unxml(h).trim() : null;
};

/** Liste les calendriers d'événements du compte : [{ url, name }]. */
export async function listCalendars(env) {
  const base = env.CALDAV_URL || 'https://caldav.icloud.com';
  const ask = (props) =>
    `<?xml version="1.0" encoding="utf-8"?><d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"><d:prop>${props}</d:prop></d:propfind>`;

  const root = await dav(env, 'PROPFIND', base + '/', { depth: 0, body: ask('<d:current-user-principal/>') });
  const principal = hrefOf(root.text, 'current-user-principal');
  if (!principal) throw new Error('calendrier : compte introuvable');
  const principalUrl = new URL(principal, root.url).href;

  const home = await dav(env, 'PROPFIND', principalUrl, { depth: 0, body: ask('<c:calendar-home-set/>') });
  const homeHref = hrefOf(home.text, 'calendar-home-set');
  if (!homeHref) throw new Error('calendrier : dossier des calendriers introuvable');
  const homeUrl = new URL(homeHref, principalUrl).href;

  const list = await dav(env, 'PROPFIND', homeUrl, {
    depth: 1,
    body: ask('<d:displayname/><d:resourcetype/><c:supported-calendar-component-set/>'),
  });
  const out = [];
  for (const r of blocks(list.text, 'response')) {
    const type = inner(r, 'resourcetype') || '';
    if (!/<(?:[\w-]+:)?calendar[\s/>]/i.test(type)) continue;
    const comps = inner(r, 'supported-calendar-component-set') || '';
    if (comps && !/name=["']VEVENT["']/i.test(comps)) continue; // les rappels (VTODO) sont écartés
    const href = inner(r, 'href');
    if (!href) continue;
    out.push({ url: new URL(unxml(href).trim(), homeUrl).href, name: unxml(inner(r, 'displayname') || 'Calendrier').trim() });
  }
  return out;
}

async function setting(env, key) {
  return (await env.DB.prepare('SELECT value FROM settings WHERE key = ?').bind(key).first())?.value ?? null;
}
async function setSetting(env, key, value) {
  await env.DB.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .bind(key, String(value))
    .run();
}

/** L'adresse du calendrier choisi, trouvée une fois puis gardée. */
export async function calendarUrl(env) {
  const saved = await setting(env, 'cal_url');
  if (saved) return saved;
  const cals = await listCalendars(env);
  if (!cals.length) throw new Error('calendrier : aucun calendrier trouvé');
  await setSetting(env, 'cal_url', cals[0].url);
  await setSetting(env, 'cal_name', cals[0].name);
  return cals[0].url;
}

// ---- Lecture des rendez-vous ----

const stamp = (ts) => new Date(ts).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');

function unfold(ics) {
  return ics.replace(/\r\n/g, '\n').replace(/\n[ \t]/g, '');
}

function prop(lines, name) {
  const line = lines.find((l) => l.startsWith(name + ':') || l.startsWith(name + ';'));
  if (!line) return null;
  const i = line.indexOf(':');
  const params = {};
  for (const p of line.slice(name.length, i).split(';').filter(Boolean)) {
    const [k, v] = p.split('=');
    params[k.toUpperCase()] = (v || '').replace(/^"|"$/g, '');
  }
  return { value: line.slice(i + 1).trim(), params };
}

const untext = (s) => s.replace(/\\n/gi, ' ').replace(/\\([,;\\])/g, '$1');

/** Valeur DTSTART ou DTEND → { allDay, ts } ou { allDay, date }. */
function when(p) {
  const v = p.value;
  if (p.params.VALUE === 'DATE' || /^\d{8}$/.test(v)) {
    return { allDay: true, date: `${v.slice(0, 4)}-${v.slice(4, 6)}-${v.slice(6, 8)}` };
  }
  const m = v.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})?(Z)?$/);
  if (!m) return null;
  const date = `${m[1]}-${m[2]}-${m[3]}`;
  const min = +m[4] * 60 + +m[5];
  if (m[7]) return { allDay: false, ts: Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]) };
  let tz = p.params.TZID || TZ;
  try {
    return { allDay: false, ts: toUtc(date, min, tz) };
  } catch {
    return { allDay: false, ts: toUtc(date, min, TZ) }; // fuseau inconnu : on suppose Montréal
  }
}

function durationMin(v) {
  const m = v.match(/^P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/);
  if (!m) return 60;
  return (+m[1] || 0) * 10080 + (+m[2] || 0) * 1440 + (+m[3] || 0) * 60 + (+m[4] || 0);
}

/** Texte iCalendar → rendez-vous du jour demandé. */
export function eventsFromIcs(ics, date) {
  const dayStart = toUtc(date, 0);
  const dayEnd = toUtc(addDays(date, 1), 0);
  const out = [];
  for (const body of unfold(ics).split('BEGIN:VEVENT').slice(1)) {
    const lines = body.split('END:VEVENT')[0].split('\n');
    const uid = prop(lines, 'UID')?.value || '';
    if (uid.startsWith('pro-')) continue; // un bloc écrit par Pro n'est pas un rendez-vous
    if (prop(lines, 'STATUS')?.value === 'CANCELLED') continue;
    const ds = prop(lines, 'DTSTART');
    if (!ds) continue;
    const start = when(ds);
    if (!start) continue;
    const title = untext(prop(lines, 'SUMMARY')?.value || 'Rendez-vous');

    if (start.allDay) {
      out.push({ uid, title, allDay: true, start_min: 0, end_min: 0 });
      continue;
    }
    const de = prop(lines, 'DTEND');
    const du = prop(lines, 'DURATION');
    const endAt = de ? when(de) : null;
    let s = start.ts;
    let e = endAt?.ts ?? s + (du ? durationMin(du.value) : 60) * 60000;
    // Événement répété que le serveur n'a pas déplié : on garde l'heure, sur le jour demandé.
    if ((s >= dayEnd || e <= dayStart) && prop(lines, 'RRULE')) {
      const len = e - s;
      s = toUtc(date, toLocal(s).min);
      e = s + len;
    }
    if (s >= dayEnd || e <= dayStart) continue;
    const a = toLocal(Math.max(s, dayStart));
    const b = e >= dayEnd ? { min: 1440 } : toLocal(e);
    out.push({ uid, title, allDay: false, start_min: a.min, end_min: Math.max(b.min, a.min + 5) });
  }
  return out.sort((x, y) => x.start_min - y.start_min);
}

/** Les rendez-vous du jour, lus dans iCloud. */
export async function fetchEvents(env, date) {
  const url = await calendarUrl(env);
  const from = stamp(toUtc(date, 0));
  const to = stamp(toUtc(addDays(date, 1), 0));
  const body = `<?xml version="1.0" encoding="utf-8"?>
<c:calendar-query xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
  <d:prop><d:getetag/><c:calendar-data><c:expand start="${from}" end="${to}"/></c:calendar-data></d:prop>
  <c:filter><c:comp-filter name="VCALENDAR"><c:comp-filter name="VEVENT"><c:time-range start="${from}" end="${to}"/></c:comp-filter></c:comp-filter></c:filter>
</c:calendar-query>`;
  const res = await dav(env, 'REPORT', url, { depth: 1, body });
  const events = [];
  const seen = new Set();
  for (const data of blocks(res.text, 'calendar-data')) {
    for (const ev of eventsFromIcs(unxml(data), date)) {
      const key = `${ev.uid}|${ev.start_min}`;
      if (!seen.has(key)) {
        seen.add(key);
        events.push(ev);
      }
    }
  }
  return events.sort((x, y) => x.start_min - y.start_min);
}

/** Rendez-vous du jour, avec une mémoire de 5 minutes pour ne pas appeler iCloud à chaque ouverture. */
export async function eventsFor(env, date, { fresh = false } = {}) {
  if (!configured(env)) return { ok: false, off: true, events: [] };
  const key = `cal_cache_${date}`;
  if (!fresh) {
    const cached = await setting(env, key);
    if (cached) {
      const c = JSON.parse(cached);
      if (Date.now() - c.at < 5 * 60000) return { ok: true, events: c.events };
    }
  }
  try {
    const events = await fetchEvents(env, date);
    await setSetting(env, key, JSON.stringify({ at: Date.now(), events }));
    return { ok: true, events };
  } catch (err) {
    return { ok: false, error: String(err.message || err), events: [] };
  }
}

// ---- Écriture des blocs ----

const esc = (s) => String(s).replace(/\\/g, '\\\\').replace(/([,;])/g, '\\$1').replace(/\n/g, '\\n');

export function icsFor(task, uid) {
  const start = toUtc(task.day, task.start_min);
  const end = start + task.est_minutes * 60000;
  const title = task.section === 'rappel' ? `📞 ${task.title}` : task.title;
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Pro//feuille du jour//FR',
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `DTSTAMP:${stamp(Date.now())}`,
    `DTSTART:${stamp(start)}`,
    `DTEND:${stamp(end)}`,
    `SUMMARY:${esc(title)}`,
    'DESCRIPTION:Bloc placé par Pro',
    `X-PRO-TASK:${task.id}`,
    'BEGIN:VALARM',
    'ACTION:DISPLAY',
    `DESCRIPTION:${esc(title)}`,
    'TRIGGER:PT0M',
    'END:VALARM',
    'END:VEVENT',
    'END:VCALENDAR',
    '',
  ].join('\r\n');
}

const wanted = (t) => t.status === 'todo' && t.day && t.start_min != null;
const signature = (t) => `${t.title}|${t.section}|${t.day}|${t.start_min}|${t.est_minutes}`;

/**
 * Met le calendrier d'accord avec une tâche : crée, déplace ou efface son bloc.
 * La tâche est relue dans la base juste avant et juste après l'appel au calendrier,
 * pour qu'une synchronisation lancée plus tôt n'écrase pas un changement plus récent.
 */
export async function syncTask(env, id, depth = 0) {
  if (!configured(env)) return;
  const read = () => env.DB.prepare('SELECT * FROM tasks WHERE id = ?').bind(id).first();
  const task = await read();
  if (!task) return;
  const url = await calendarUrl(env);
  if (wanted(task)) {
    const sig = signature(task);
    if (task.cal_uid && task.cal_sig === sig) return;
    const uid = task.cal_uid || `pro-${task.id}`; // toujours la même adresse : écrire deux fois ne crée pas de doublon
    await dav(env, 'PUT', `${url}${uid}.ics`, { body: icsFor(task, uid), type: 'text/calendar; charset=utf-8' });
    await env.DB.prepare('UPDATE tasks SET cal_uid = ?, cal_sig = ? WHERE id = ?').bind(uid, sig, id).run();
    const after = await read();
    if (depth < 2 && after && (!wanted(after) || signature(after) !== sig)) return syncTask(env, id, depth + 1);
  } else if (task.cal_uid) {
    await dav(env, 'DELETE', `${url}${task.cal_uid}.ics`);
    await env.DB.prepare('UPDATE tasks SET cal_uid = NULL, cal_sig = NULL WHERE id = ?').bind(id).run();
    const after = await read();
    if (depth < 2 && after && wanted(after)) return syncTask(env, id, depth + 1);
  }
}

/** Synchronise plusieurs tâches sans jamais faire échouer la requête de l'app. */
export async function syncTasks(env, tasks) {
  if (!configured(env)) return null;
  let failed = null;
  for (const t of tasks) {
    try {
      await syncTask(env, t.id ?? t);
    } catch (err) {
      failed = String(err.message || err);
    }
  }
  if (failed) await setSetting(env, 'cal_last_error', JSON.stringify({ at: Date.now(), error: failed }));
  else await env.DB.prepare("DELETE FROM settings WHERE key = 'cal_last_error'").run();
  return failed;
}
