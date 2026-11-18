// Pro : l'écran. Une feuille du jour, une boîte pour vider ta tête, un tri le soir.
import { freeWindows, sortTasks, fmtTime, fmtDur, daysBetween, isLife } from './plan.js';
import { cheerFor } from './cheer.js';

const $ = (sel, root = document) => root.querySelector(sel);
const app = $('#app');
const modalRoot = $('#modal-root');
const S = { data: null, date: null, triageSeen: false, busy: false };

const SECTIONS = { priorite: 'Priorités', rappel: 'À rappeler', faire: 'À faire' };
const COMPANIES = { robiii: 'Robiii', immo: 'ImmoMulti', perso: 'Perso' };
const DURATIONS = [5, 10, 15, 30, 45, 60, 90, 120];
const DAY_SHORT = ['Dim', 'Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam'];
const DAY_LONG = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];

const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

// ---- Dates ----

const addDays = (date, n) => {
  const d = new Date(date + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const dowOf = (date) => new Date(date + 'T12:00:00Z').getUTCDay();
const longDate = (date) =>
  new Intl.DateTimeFormat('fr-CA', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' }).format(new Date(date + 'T12:00:00Z'));
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

function dayLabel(date, today = S.data.today) {
  if (date === null) return 'Réserve';
  const n = daysBetween(today, date);
  if (n === 0) return "Aujourd'hui";
  if (n === 1) return 'Demain';
  if (n === -1) return 'Hier';
  if (n > 1 && n < 7) return cap(DAY_LONG[dowOf(date)]);
  return new Intl.DateTimeFormat('fr-CA', { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(date + 'T12:00:00Z'));
}
const toTimeInput = (min) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
const fromTimeInput = (v) => {
  const m = String(v || '').match(/^(\d{1,2}):(\d{2})/);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null; // un champ vide n'est pas minuit
};

// ---- Serveur ----

async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch('api/' + path, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Le serveur a répondu ${res.status}`);
  return data;
}

function toast(msg, ms = 2600) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.add('on');
  clearTimeout(toast.t);
  toast.t = setTimeout(() => el.classList.remove('on'), ms);
}

async function guard(fn) {
  try {
    return await fn();
  } catch (err) {
    toast(err.message || 'Ça n’a pas fonctionné. Réessaie.', 4000);
    return null;
  }
}

async function load(date = S.date, opts = {}) {
  const q = new URLSearchParams();
  if (date) q.set('date', date);
  if (opts.fresh) q.set('fresh', '1');
  const data = await guard(() => api('sheet?' + q));
  if (!data) return;
  // Une nouvelle version a été mise en ligne depuis que cette page est ouverte : on la charge, sans rien te faire perdre.
  if (data.version) {
    S.version ??= data.version;
    if (data.version !== S.version && canReload()) return location.reload();
  }
  S.data = data;
  S.date = data.date;
  render();
  if (data.date === data.today && data.triage.length && !S.triageSeen && !modalRoot.firstChild) {
    S.triageSeen = true;
    openTriage(data.triage, { to: data.today, title: 'Ce qui restait des autres jours' });
  }
}

/** Recharger sans rien casser : pas de fenêtre ouverte, pas de texte en attente, pas d'enregistrement ni de glissement. */
const canReload = () => !modalRoot.firstChild && !$('#capture-text')?.value.trim() && mic.state === 'idle' && !drag && !S.busy;

// ---- La feuille ----

const isAvoided = (t) => t.status === 'todo' && t.pushed_count >= 2;

/** « 17 h à 22 h » pour un moment qui a une heure. */
const span = (t) => `${fmtTime(t.start_min)} à ${fmtTime((t.start_min + t.est_minutes) % 1440)}`;

function metaOf(t) {
  const d = S.data;
  const bits = [];
  const tracked = d.tracked?.[t.id] || 0;
  if (isLife(t)) {
    bits.push(t.start_min != null ? span(t) : 'Sans heure : ne prend pas de place à l’horaire');
    if (t.note) bits.push(t.note);
    return bits.join(' · ');
  }
  if (d.focus?.task_id === t.id) bits.push('En cours');
  if (t.status === 'done') {
    if (t.actual_minutes) bits.push(`Fait en ${fmtDur(t.actual_minutes)}`);
  } else {
    if (t.start_min != null) bits.push(fmtTime(t.start_min));
    if (tracked) bits.push(`${fmtDur(tracked)} dessus`);
  }
  if (t.due_date) {
    const n = daysBetween(d.today, t.due_date);
    bits.push(n < 0 ? 'Échéance dépassée' : n === 0 ? "Échéance aujourd'hui" : `Échéance ${dayLabel(t.due_date).toLowerCase()}`);
  }
  if (t.note) bits.push(t.note);
  if (t.pushed_count === 1) bits.push('Reportée 1 fois');
  if (t.pushed_count > 1) bits.push(`Reportée ${t.pushed_count} fois`);
  if (t.section !== 'rappel' || !bits.length) bits.push(fmtDur(t.est_minutes));
  return bits.join(' · ');
}

function rowHtml(t, { num, avoid = false } = {}) {
  const done = t.status === 'done';
  const cur = S.data.focus?.task_id === t.id;
  const lead = num ? `<span class="num">${num}</span>` : '';
  let extra = '';
  if (avoid) {
    extra = t.first_step
      ? `<span class="chip">Premier pas : ${esc(t.first_step)}</span>`
      : `<button class="chip chip-btn" data-act="first-step" data-id="${t.id}">Trouver un premier pas de 10 minutes</button>`;
  }
  return `<div class="row${done ? ' done' : ''}${cur ? ' current' : ''}" data-id="${t.id}">
    ${lead}<button class="cb${done ? ' on' : ''}" data-act="check" aria-label="${done ? 'Décocher' : 'Cocher'} : ${esc(t.title)}"></button>
    <div class="t" data-act="${done || isLife(t) ? 'edit' : 'focus'}" role="button" tabindex="0" aria-pressed="${cur}"><span class="tt">${esc(t.title)}</span><small>${esc(metaOf(t))}</small>${extra}</div>
    <i class="dot c-${t.company}" title="${COMPANIES[t.company]}"></i>
    ${done ? '' : `<button class="more" data-act="edit" aria-label="Modifier : ${esc(t.title)}">⋯</button>`}
    ${done || avoid ? '' : '<span class="grip" data-grip aria-hidden="true">⠿</span>'}
  </div>`;
}

function boxHtml(section, tasks) {
  const d = S.data;
  const todo = tasks.filter((t) => t.status === 'todo');
  const done = tasks.filter((t) => t.status === 'done');
  const ordered =
    section === 'priorite'
      ? sortTasks(todo, d.today)
      : [...todo].sort((a, b) => (a.start_min ?? 9999) - (b.start_min ?? 9999) || a.sort - b.sort);
  const empty = {
    priorite: 'Aucune priorité. Ce qui a une échéance ou une obligation montera ici.',
    rappel: 'Personne à rappeler.',
    faire: 'Rien à faire ici. Vide ta tête dans la boîte en bas.',
  }[section];
  const hint = section === 'priorite' && todo.length > 5 ? `<p class="hint warn">Plus de 5 priorités : glisse les moins pressantes vers À faire.</p>` : '';
  return `<section class="box" data-drop="section:${section}">
    <h2>${SECTIONS[section]}<span class="count">${todo.length || ''}</span>${section === 'rappel' && todo.length ? '<button class="link" data-act="calls">Mode appels</button>' : ''}</h2>
    ${ordered.map((t, i) => rowHtml(t, { num: section === 'priorite' ? i + 1 : 0 })).join('')}
    ${done.map((t) => rowHtml(t)).join('')}
    ${tasks.length ? '' : `<p class="empty">${empty}</p>`}${hint}
  </section>`;
}

/** Hors travail : blonde, amis, gym. Avec une heure, le moment réserve sa place à l'horaire. */
function lifeHtml(list) {
  const todo = list.filter((t) => t.status === 'todo').sort((a, b) => (a.start_min ?? 9999) - (b.start_min ?? 9999) || a.sort - b.sort);
  const done = list.filter((t) => t.status === 'done');
  return `<section class="box life" data-drop="life:1">
    <h2>Hors travail<span class="count">${todo.length || ''}</span></h2>
    ${todo.map((t) => rowHtml(t)).join('')}${done.map((t) => rowHtml(t)).join('')}
    ${list.length ? '' : '<p class="empty">Blonde, amis, gym. Dis-le avec l’heure, par exemple « voir ma blonde de 17 h à 22 h » : ton horaire de travail s’arrête autour.</p>'}
  </section>`;
}

function avoidHtml(tasks) {
  const list = tasks.filter(isAvoided).sort((a, b) => b.pushed_count - a.pushed_count);
  return `<section class="box avoid">
    <h2>Ce que j'évite<span class="count">${list.length || ''}</span></h2>
    ${list.map((t) => rowHtml(t, { avoid: true })).join('')}
    ${list.length ? '' : '<p class="empty">Rien que tu repousses. Une tâche reportée deux fois arrive ici, avec son premier pas.</p>'}
  </section>`;
}

function scheduleHtml() {
  const d = S.data;
  const isToday = d.date === d.today;
  let rows = [];
  for (const ev of d.events) if (!ev.allDay) rows.push({ t: ev.start_min, kind: 'rdv', title: ev.title, end: ev.end_min });
  for (const t of d.tasks) if (t.start_min != null && t.status === 'todo') rows.push({ t: t.start_min, kind: 'task', task: t });
  const sup = d.settings;
  rows.push({ t: sup.supper_start, kind: 'souper', end: sup.supper_start + sup.supper_min });

  // Les trous d'au moins 30 minutes dans les heures de travail : gardés pour les imprévus.
  let free = freeWindows(d.day, d.events, d.settings);
  for (const t of d.tasks.filter((x) => x.status === 'todo' && x.start_min != null)) {
    const s = t.start_min;
    const e = s + t.est_minutes;
    free = free.flatMap(([a, b]) => (e <= a || s >= b ? [[a, b]] : [[a, s], [e, b]].filter(([x, y]) => y > x)));
  }
  for (const [a, b] of free) {
    const from = isToday ? Math.max(a, Math.ceil(d.now_min / 5) * 5) : a;
    if (b - from >= 30) rows.push({ t: from, kind: 'libre', end: b });
  }
  rows.sort((x, y) => x.t - y.t || (x.kind === 'rdv' ? -1 : 1));

  // Des appels placés bout à bout deviennent un seul bloc.
  const merged = [];
  for (const r of rows) {
    const last = merged[merged.length - 1];
    const isCall = r.kind === 'task' && r.task.section === 'rappel';
    if (isCall && last?.kind === 'calls' && last.end === r.t) {
      last.tasks.push(r.task);
      last.end = r.t + r.task.est_minutes;
    } else if (isCall) merged.push({ t: r.t, kind: 'calls', tasks: [r.task], end: r.t + r.task.est_minutes });
    else merged.push(r);
  }
  rows = merged.map((r) => (r.kind === 'calls' && r.tasks.length === 1 ? { t: r.t, kind: 'task', task: r.tasks[0] } : r));

  const allDay = d.events.filter((e) => e.allDay);
  const unplaced = d.tasks.filter((t) => t.status === 'todo' && t.start_min == null && !isLife(t));
  const hours = `${fmtTime(d.day.work_start)} à ${fmtTime(d.day.work_end)}${d.day.evening_work ? `, puis jusqu'à ${fmtTime(d.day.evening_end)}` : ''}`;

  const line = (r) => {
    if (r.kind === 'rdv') return `<div class="blk rdv">${esc(r.title)}<small>Rendez-vous · jusqu'à ${fmtTime(r.end)}</small></div>`;
    if (r.kind === 'souper') return `<div class="blk plain">Souper</div>`;
    if (r.kind === 'libre') return `<div class="blk free">Libre pour les imprévus<small>jusqu'à ${fmtTime(r.end)}</small></div>`;
    if (r.kind === 'calls') {
      return `<div class="blk calls" data-act="calls" role="button" tabindex="0">${r.tasks.length} personnes à rappeler<small>${esc(r.tasks.map((t) => t.contact || t.title).join(' · '))}</small><small class="go">Ouvrir le mode appels</small></div>`;
    }
    const t = r.task;
    const cur = d.focus?.task_id === t.id;
    if (isLife(t)) {
      return `<div class="blk life" data-id="${t.id}">
      <div class="bt" data-act="edit" role="button" tabindex="0">${esc(t.title)}<small>Hors travail · jusqu'à ${fmtTime((t.start_min + t.est_minutes) % 1440)}</small></div>
      <span class="grip" data-grip aria-hidden="true">⠿</span></div>`;
    }
    return `<div class="blk task c-${t.company}${cur ? ' current' : ''}" data-id="${t.id}">
      <div class="bt" data-act="edit" role="button" tabindex="0">${t.section === 'rappel' ? 'Appel : ' : ''}${esc(t.title)}<small>${cur ? 'En cours · ' : ''}${fmtDur(t.est_minutes)}${t.pinned ? ' · heure fixée' : ''}</small></div>
      <span class="grip" data-grip aria-hidden="true">⠿</span></div>`;
  };

  return `<section class="box horaire">
    <h2>Horaire<button class="link" data-act="hours">${esc(hours)}</button></h2>
    ${allDay.length ? `<p class="allday">${allDay.map((e) => `<span>${esc(e.title)}</span>`).join('')}</p>` : ''}
    ${rows.map((r) => `<div class="hr" data-drop="time:${r.t}"><time>${fmtTime(r.t)}</time>${line(r)}</div>`).join('')}
    ${
      unplaced.length
        ? `<div class="unplaced"><h3>Pas de place à l'horaire (${unplaced.length})</h3>
           ${unplaced.map((t) => `<div class="blk c-${t.company}" data-act="edit" data-id="${t.id}" role="button" tabindex="0">${esc(t.title)}<small>${fmtDur(t.est_minutes)}</small></div>`).join('')}
           <p class="hint">Glisse-les vers Demain, ou raccourcis une durée.</p></div>`
        : ''
    }
    <div class="hr-actions"><button class="btn ghost" data-act="replan">Replacer ma journée</button></div>
  </section>`;
}

function bannersHtml() {
  const d = S.data;
  const out = [];
  if (d.inbox.length) {
    out.push(`<button class="banner" data-act="inbox">${d.inbox.length === 1 ? 'Une dictée à confirmer' : `${d.inbox.length} dictées à confirmer`}<span>Ouvrir</span></button>`);
  }
  if (d.date === d.today && d.triage.length) {
    out.push(`<button class="banner" data-act="triage">${d.triage.length} tâche${d.triage.length > 1 ? 's' : ''} des autres jours à trier<span>Trier</span></button>`);
  }
  if (d.date === d.today && d.dow === 0) {
    out.push(`<button class="banner" data-act="mirror">C'est dimanche : ton miroir de la semaine et ta réserve (${d.reserve_count})<span>Voir</span></button>`);
  }
  if (d.calendar.on && d.calendar.error) {
    out.push(`<button class="banner warn" data-act="settings">Calendrier : ${esc(d.calendar.error)}<span>Voir</span></button>`);
  }
  return out.join('');
}

const elapsed = (since) => fmtDur(Math.max(0, Math.round((Date.now() - since) / 60000)));

function render() {
  const d = S.data;
  const tasks = d.tasks.filter((t) => !isLife(t));
  const total = tasks.length;
  const done = tasks.filter((t) => t.status === 'done').length;
  const pct = total ? Math.round((done / total) * 100) : 0;
  const buffer = d.summary.available - d.summary.capacity;
  const over = d.summary.planned - d.summary.capacity;
  const real = d.pace && d.pace >= 1.2 ? ` · à ton rythme, plutôt ${fmtDur(Math.round((d.summary.planned * d.pace) / 5) * 5)}` : '';
  const load = d.summary.overflow
    ? `<span class="warn">Ça déborde de ${fmtDur(Math.ceil(over / 5) * 5)}. Glisse des tâches vers demain.</span>`
    : `Prévu ${fmtDur(d.summary.planned)} sur ${fmtDur(d.summary.capacity)}${real} · ${fmtDur(buffer)} gardées pour les imprévus`;
  const off = d.off?.active
    ? `<span class="${d.off.minutes >= d.off.budget ? 'warn' : ''}">Hors feuille : ${fmtDur(d.off.minutes)} sur ${fmtDur(d.off.budget)}</span>`
    : '';
  const by = (s) => tasks.filter((t) => t.section === s);
  const keep = $('#capture-text')?.value || '';
  const f = d.focus;
  const isToday = d.date === d.today;
  const nowbar = f
    ? `<div class="nowbar ${f.kind}"><i class="pulse"></i><span class="nb-t">${f.kind === 'imprevu' ? 'Imprévu' : 'En cours'}${f.kind === 'imprevu' && f.title === 'Imprévu' ? '' : ` : <strong>${esc(f.title)}</strong>`}</span>
        <span class="nb-time" data-since="${f.started_at}">${elapsed(f.started_at)}</span>
        <button class="pill" data-act="stop">${f.kind === 'imprevu' ? "Fin de l'imprévu" : 'Pause'}</button></div>`
    : '';

  app.innerHTML = `
    <header class="top">
      <div class="title">
        <button class="icon" data-act="prev" aria-label="Jour précédent">‹</button>
        <h1>${esc(cap(longDate(d.date)))}</h1>
        <button class="icon" data-act="next" aria-label="Jour suivant">›</button>
        ${isToday ? '' : `<button class="pill" data-act="today">Revenir à aujourd'hui</button>`}
      </div>
      <div class="actions">
        ${isToday && f?.kind !== 'imprevu' ? `<button class="pill alert" data-act="imprevu">Imprévu</button>` : ''}
        <button class="pill" data-act="reserve">Réserve${d.reserve_count ? ` · ${d.reserve_count}` : ''}</button>
        ${isToday ? `<button class="pill strong" data-act="evening">Préparer demain</button>` : ''}
        <button class="icon" data-act="settings" aria-label="Réglages">⚙</button>
      </div>
      ${nowbar}
      <div class="prog${total && done === total ? ' full' : ''}"><div class="prog-bar"><i style="width:${pct}%"></i></div><span>${total ? `${done} sur ${total} faite${done > 1 ? 's' : ''}` : 'Feuille vide'}</span></div>
      <div class="sub"><span class="load">${load}</span>${off}
        <span class="legend"><span><i class="dot c-robiii"></i>Robiii</span><span><i class="dot c-immo"></i>ImmoMulti</span><span><i class="dot c-perso"></i>Perso</span></span>
      </div>
    </header>
    <div id="banners">${bannersHtml()}</div>
    <main class="grid">
      ${scheduleHtml()}
      <div class="boxes">${boxHtml('priorite', by('priorite'))}${boxHtml('rappel', by('rappel'))}${boxHtml('faire', by('faire'))}${lifeHtml(d.tasks.filter(isLife))}${avoidHtml(tasks)}</div>
    </main>
    <form class="capture${mic.state === 'idle' ? '' : ' is-rec'}" id="capture">
      <textarea id="capture-text" rows="1" placeholder="${capturePlaceholder()}" aria-label="Ajouter des tâches"></textarea>
      ${micHtml()}
      <button class="send" type="submit" aria-label="Ajouter">Ajouter</button>
    </form>`;
  const ta = $('#capture-text');
  ta.value = keep;
  autoGrow(ta);
}

// ---- Le micro : tu appuies, tu parles, tu appuies encore. Le texte part se faire classer. ----

const MIC_MAX_MS = 5 * 60000; // un enregistrement oublié s'arrête seul après 5 minutes
const MIC_TYPES = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/webm'];
const MIC_ICON = `<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path fill="currentColor" d="M12 15a3.5 3.5 0 0 0 3.5-3.5v-6a3.5 3.5 0 0 0-7 0v6A3.5 3.5 0 0 0 12 15Z"/><path fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" d="M5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v3"/></svg>`;
let mic = { state: 'idle' };

const micSupported = () => Boolean(S.data?.mic && navigator.mediaDevices?.getUserMedia && window.MediaRecorder);
const micClock = () => {
  const s = Math.floor((Date.now() - mic.started) / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

function micHtml() {
  if (!micSupported()) return '';
  if (mic.state === 'rec')
    return `<button class="mic rec" type="button" data-act="mic" aria-label="Arrêter et transcrire"><i></i><span class="mic-time">${micClock()}</span></button>`;
  if (mic.state === 'busy') return `<button class="mic busy" type="button" disabled aria-label="Transcription en cours">…</button>`;
  return `<button class="mic" type="button" data-act="mic" aria-label="Dicter">${MIC_ICON}</button>`;
}
// Sur un petit écran, la boîte est étroite : un texte court, et le bouton « Ajouter » s'efface pendant qu'on dicte.
const capturePlaceholder = () =>
  mic.state === 'rec' ? 'Je t’écoute…' : mic.state === 'busy' ? 'Je transcris…' : innerWidth < 520 ? 'Vide ta tête…' : "Vide ta tête : dicte ou écris tout d'un coup…";
function paintMic() {
  const el = $('.mic');
  if (el) el.outerHTML = micHtml();
  $('#capture')?.classList.toggle('is-rec', mic.state !== 'idle');
  const ta = $('#capture-text');
  if (ta) ta.placeholder = capturePlaceholder();
}
function resetMic() {
  clearInterval(mic.tick);
  clearTimeout(mic.limit);
  mic.stream?.getTracks().forEach((t) => t.stop());
  mic = { state: 'idle' };
  paintMic();
}

async function startMic() {
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
  } catch (err) {
    const denied = err?.name === 'NotAllowedError' || err?.name === 'SecurityError';
    return toast(denied ? 'Autorise le micro pour Pro dans les réglages de ton appareil.' : 'Aucun micro trouvé sur cet appareil.', 4500);
  }
  const type = MIC_TYPES.find((t) => MediaRecorder.isTypeSupported(t));
  let recorder;
  try {
    recorder = new MediaRecorder(stream, { ...(type ? { mimeType: type } : {}), audioBitsPerSecond: 48000 });
  } catch {
    stream.getTracks().forEach((t) => t.stop());
    return toast('Cet appareil ne peut pas enregistrer ici. Sers-toi du micro du clavier.', 4500);
  }
  const chunks = [];
  recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  recorder.onstop = () => finishMic(chunks, recorder.mimeType || type || 'audio/mp4');
  recorder.onerror = () => stopMic();
  recorder.start();
  mic = {
    state: 'rec',
    recorder,
    stream,
    started: Date.now(),
    tick: setInterval(() => {
      const el = $('.mic-time');
      if (el) el.textContent = micClock();
    }, 500),
    limit: setTimeout(stopMic, MIC_MAX_MS),
  };
  paintMic();
}

function stopMic() {
  if (mic.state !== 'rec') return;
  clearInterval(mic.tick);
  clearTimeout(mic.limit);
  mic.state = 'busy';
  paintMic();
  try {
    mic.recorder.stop(); // la suite se passe dans finishMic
  } catch {
    resetMic();
  }
}

async function finishMic(chunks, type) {
  const seconds = (Date.now() - mic.started) / 1000;
  mic.stream?.getTracks().forEach((t) => t.stop());
  const blob = new Blob(chunks, { type });
  if (seconds < 1 || blob.size < 600) {
    resetMic();
    return toast('Trop court. Appuie, parle, puis appuie encore pour finir.', 4000);
  }
  let data;
  try {
    const res = await fetch('api/transcribe', { method: 'POST', headers: { 'Content-Type': type.split(';')[0] }, body: blob });
    data = await res.json().catch(() => ({}));
    if (!res.ok) data = { error: data.error || `Le serveur a répondu ${res.status}` };
  } catch {
    data = { error: 'Pas de réseau : la dictée n’a pas pu partir. Réessaie.' };
  }
  resetMic();
  if (data.error) return toast(data.error, 4500);
  if (!data.text) return toast("Je n'ai rien entendu. Réessaie plus près du micro.", 4000);
  const ta = $('#capture-text');
  if (!ta) return;
  ta.value = (ta.value.trim() ? ta.value.trim() + ' ' : '') + data.text;
  autoGrow(ta);
  // Le texte part tout de suite se faire classer ; tu confirmes ou corriges à l'écran suivant.
  if (!modalRoot.firstChild && !S.busy) $('#capture').requestSubmit();
}

// Le chrono de la barre « En cours » avance sans recharger la feuille.
setInterval(() => {
  const el = $('.nb-time');
  if (el) el.textContent = elapsed(Number(el.dataset.since));
}, 15000);

function autoGrow(ta) {
  ta.style.height = 'auto';
  ta.style.height = Math.min(ta.scrollHeight, 180) + 'px';
}

// ---- Fenêtres ----

function openModal(html, { wide = false } = {}) {
  const replaced = onModalClose; // une fenêtre remplacée par une autre compte comme fermée
  onModalClose = null;
  replaced?.();
  modalRoot.innerHTML = `<div class="veil" data-act="close-veil"><div class="modal${wide ? ' wide' : ''}" role="dialog" aria-modal="true">${html}</div></div>`;
  document.body.classList.add('locked');
  const focus = $('.modal [autofocus]', modalRoot);
  if (focus) focus.focus();
  return $('.modal', modalRoot);
}
// Une fenêtre peut se fermer de trois façons : ses boutons, Échap, ou un tap à côté.
// Celle qui attend une réponse l'apprend ici, sinon elle attendrait pour toujours.
let onModalClose = null;
function closeModal() {
  const done = onModalClose;
  onModalClose = null;
  modalRoot.innerHTML = '';
  document.body.classList.remove('locked');
  done?.();
}

const chips = (name, options, value) =>
  `<div class="chips" data-chips="${name}">${options
    .map(([v, label, cls = '']) => `<button type="button" class="chipsel${String(v) === String(value) ? ' on' : ''} ${cls}" data-v="${esc(v)}">${label}</button>`)
    .join('')}</div>`;
const chipValue = (root, name) => $(`[data-chips="${name}"] .on`, root)?.dataset.v;

modalRoot.addEventListener('click', (e) => {
  const c = e.target.closest('.chipsel');
  if (c) {
    for (const b of c.parentElement.children) b.classList.toggle('on', b === c);
    c.parentElement.dispatchEvent(new CustomEvent('chips', { bubbles: true }));
    return;
  }
  if (e.target.matches('[data-act="close-veil"]') || e.target.closest('[data-act="close"]')) closeModal();
});

// Modifier une tâche
function openEdit(id) {
  const d = S.data;
  const t = d.tasks.find((x) => x.id === id);
  if (!t) return;
  const dayVal = t.day === d.today ? 'today' : t.day === addDays(d.today, 1) ? 'tomorrow' : t.day === null ? 'reserve' : 'other';
  const m = openModal(`
    <h2>Modifier</h2>
    <label class="field"><span>${isLife(t) ? 'Moment' : 'Tâche'}</span><input id="e-title" value="${esc(t.title)}"></label>
    <div class="field"><span>Compte dans</span>${chips('kind', [['tache', 'Mon travail'], ['vie', 'Hors travail']], isLife(t) ? 'vie' : 'tache')}</div>
    <div class="field" id="e-section"${isLife(t) ? ' hidden' : ''}><span>Section</span>${chips('section', Object.entries(SECTIONS), t.section)}</div>
    <div class="field"><span>Entreprise</span>${chips('company', Object.entries(COMPANIES).map(([k, v]) => [k, `<i class="dot c-${k}"></i>${v}`]), t.company)}</div>
    <div class="field"><span>Jour</span>${chips('day', [['today', "Aujourd'hui"], ['tomorrow', 'Demain'], ['reserve', 'Réserve'], ['other', 'Autre date']], dayVal)}
      <input type="date" id="e-date" value="${t.day || ''}" min="${d.today}" ${dayVal === 'other' ? '' : 'hidden'}></div>
    <div class="field"><span>Durée</span>${chips('dur', DURATIONS.map((n) => [n, fmtDur(n)]), DURATIONS.includes(t.est_minutes) ? t.est_minutes : '')}</div>
    <div class="field two"><label><span>Début</span><input type="time" id="e-time" step="300" value="${t.start_min != null ? toTimeInput(t.start_min) : ''}"></label>
      <label><span>Fin (facultatif)</span><input type="time" id="e-end" step="300" value="${t.start_min != null && (isLife(t) || !DURATIONS.includes(t.est_minutes)) ? toTimeInput((t.start_min + t.est_minutes) % 1440) : ''}"></label></div>
    <label class="field half" id="e-duebox"${isLife(t) ? ' hidden' : ''}><span>Échéance</span><input type="date" id="e-due" value="${t.due_date || ''}"></label>
    <label class="field"><span>Téléphone (pour le mode appels)</span><input type="tel" id="e-phone" value="${esc(t.phone || '')}" placeholder="450 555-0123"></label>
    <p class="hint">Laisse le début vide pour que l'outil place la tâche. Une heure choisie ne bouge plus. Un moment hors travail avec une heure réserve sa place : le travail se range autour.</p>
    <div class="foot"><button class="btn danger" data-do="delete">Supprimer</button><span class="grow"></span><button class="btn ghost" data-act="close">Annuler</button><button class="btn" data-do="save">Enregistrer</button></div>`);
  m.addEventListener('chips', () => {
    $('#e-date', m).hidden = chipValue(m, 'day') !== 'other';
    const life = chipValue(m, 'kind') === 'vie';
    $('#e-section', m).hidden = life;
    $('#e-duebox', m).hidden = life;
  });
  m.addEventListener('click', async (e) => {
    const act = e.target.closest('[data-do]')?.dataset.do;
    if (!act) return;
    if (act === 'delete') {
      await guard(() => api(`tasks/${id}`, { method: 'DELETE' }));
    } else {
      const dv = chipValue(m, 'day');
      const day = dv === 'today' ? d.today : dv === 'tomorrow' ? addDays(d.today, 1) : dv === 'reserve' ? null : $('#e-date', m).value || t.day;
      const time = fromTimeInput($('#e-time', m).value);
      const kind = chipValue(m, 'kind') === 'vie' ? 'vie' : 'tache';
      const body = {
        title: $('#e-title', m).value,
        section: chipValue(m, 'section'),
        company: chipValue(m, 'company'),
        due_date: kind === 'vie' ? null : $('#e-due', m).value || null,
        phone: $('#e-phone', m).value.trim() || null,
      };
      if (kind !== (t.kind || 'tache')) body.kind = kind;
      // Une heure de fin donne la durée ; sinon ce sont les boutons de durée.
      const end = fromTimeInput($('#e-end', m).value);
      const range = time != null && end != null ? (end > time ? end - time : end + 1440 - time) : 0;
      const dur = range && range <= 900 ? range : Number(chipValue(m, 'dur'));
      if (dur && dur !== t.est_minutes) body.est_minutes = dur;
      if (day !== t.day) body.day = day;
      if (time !== t.start_min && !(time === null && t.start_min != null && !t.pinned)) body.start_min = time;
      await guard(() => api(`tasks/${id}`, { method: 'PATCH', body }));
    }
    closeModal();
    load();
  });
}

// Confirmer ce que l'outil a compris
function confirmCardHtml(it, i, open) {
  const d = S.data;
  const dayOpts = [[d.today, "Aujourd'hui"], [addDays(d.today, 1), 'Demain'], ['', 'Réserve']];
  if (it.day && !dayOpts.some(([v]) => v === it.day)) dayOpts.splice(2, 0, [it.day, dayLabel(it.day)]);
  const durs = DURATIONS.includes(it.est_minutes) ? DURATIONS : [...DURATIONS, it.est_minutes].sort((a, b) => a - b);
  const edit = open
    ? `<div class="cedit">
        <div class="field"><span>Compte dans</span>${chips('kind', [['tache', 'Mon travail'], ['vie', 'Hors travail']], it.kind === 'vie' ? 'vie' : 'tache')}</div>
        ${it.kind === 'vie' ? '' : `<div class="field"><span>Section</span>${chips('section', Object.entries(SECTIONS), it.section)}</div>`}
        <div class="field"><span>Entreprise</span>${chips('company', Object.entries(COMPANIES).map(([k, v]) => [k, `<i class="dot c-${k}"></i>${v}`]), it.company)}</div>
        <div class="field"><span>Jour</span>${chips('day', dayOpts, it.day ?? '')}</div>
        <div class="field"><span>Durée</span>${chips('est_minutes', durs.map((n) => [n, fmtDur(n)]), it.est_minutes)}</div>
      </div>`
    : '';
  return `<div class="ccard c-${it.company}${it.kind === 'vie' ? ' life' : ''}${open ? ' open' : ''}" data-i="${i}">
    <div class="chead">
      <textarea class="ctitle" data-f="title" rows="1" aria-label="Tâche">${esc(it.title)}</textarea>
      <button type="button" class="cx" data-rm aria-label="Retirer cette tâche">✕</button>
    </div>
    ${it.note ? `<p class="cnote">${esc(it.note)}</p>` : ''}
    <button type="button" class="csum" data-toggle aria-expanded="${open}">
      <span class="csum-items">
        <span class="sec">${it.kind === 'vie' ? 'Hors travail' : SECTIONS[it.section]}</span>
        <span><i class="dot c-${it.company}"></i>${COMPANIES[it.company]}</span>
        <span>${esc(dayLabel(it.day))}</span>
        <span>${it.start_min != null && it.day ? (it.kind === 'vie' ? span(it) : `${fmtTime(it.start_min)} · ${fmtDur(it.est_minutes)}`) : fmtDur(it.est_minutes)}</span>
        ${it.due_date ? `<span class="due">Échéance ${esc(dayLabel(it.due_date).toLowerCase())}</span>` : ''}
      </span>
      <span class="chev">${open ? 'Fermer' : 'Corriger'}</span>
    </button>
    ${edit}
  </div>`;
}

/** Ouvre la confirmation. Résout avec le nombre de tâches ajoutées (0 si annulé). */
function openConfirm(parsed, { said } = {}) {
  return new Promise((resolve) => {
    const items = parsed.items.map((it) => ({ ...it }));
    let openIdx = null;
    const note =
      parsed.engine === 'regles'
        ? `<p class="hint warnhint">${
            parsed.note
              ? `Claude n'a pas répondu (${esc(parsed.note)}).`
              : S.data.ai
                ? 'Le plafond mensuel de Claude est atteint.'
                : "Claude n'est pas branché."
          } J'ai seulement découpé tes phrases, sans les analyser. Corrige les titres au besoin.</p>`
        : '';
    const m = openModal(
      `<h2 id="ccount"></h2>
       ${said ? `<p class="said">« ${esc(said.length > 160 ? said.slice(0, 160) + '…' : said)} »</p>` : ''}
       ${note}
       <div id="crows"></div>
       <div class="foot sticky"><button class="btn ghost" data-do="cancel">Annuler</button><span class="grow"></span><button class="btn primary" data-do="add" autofocus></button></div>`,
      { wide: true },
    );
    onModalClose = () => resolve(0); // fermée sans réponse : rien n'est ajouté
    const addBtn = $('[data-do="add"]', m);
    const alive = () => items.filter(Boolean);
    const draw = () => {
      $('#crows', m).innerHTML = items.map((it, i) => (it ? confirmCardHtml(it, i, i === openIdx) : '')).join('');
      for (const ta of m.querySelectorAll('.ctitle')) autoGrow(ta);
      const n = alive().length;
      $('#ccount', m).textContent = n > 1 ? `${n} tâches à ajouter` : n === 1 ? 'Une tâche à ajouter' : 'Plus rien à ajouter';
      addBtn.textContent = n > 1 ? `Ajouter les ${n}` : n === 1 ? 'Ajouter' : 'Rien à ajouter';
      addBtn.disabled = !n;
    };
    draw();
    m.addEventListener('input', (e) => {
      const card = e.target.closest('.ccard');
      if (card && e.target.dataset.f === 'title') {
        items[+card.dataset.i].title = e.target.value.replace(/\n/g, ' ');
        autoGrow(e.target);
      }
    });
    m.addEventListener('chips', (e) => {
      const card = e.target.closest('.ccard');
      if (!card) return;
      const it = items[+card.dataset.i];
      const f = e.target.dataset.chips;
      const v = chipValue(card, f);
      it[f] = f === 'est_minutes' ? Number(v) : f === 'day' ? v || null : v;
      draw();
    });
    m.addEventListener('click', async (e) => {
      const card = e.target.closest('.ccard');
      if (card && e.target.closest('[data-rm]')) {
        items[+card.dataset.i] = null;
        if (openIdx === +card.dataset.i) openIdx = null;
        return draw();
      }
      if (card && e.target.closest('[data-toggle]')) {
        openIdx = openIdx === +card.dataset.i ? null : +card.dataset.i;
        return draw();
      }
      const act = e.target.closest('[data-do]')?.dataset.do;
      if (act === 'cancel') return closeModal();
      if (act === 'add') {
        addBtn.disabled = true;
        const res = await guard(() => api('tasks', { method: 'POST', body: { items: alive(), capture_id: parsed.capture_id, source: 'dictee' } }));
        resolve(res ? res.created : 0);
        closeModal();
      }
    });
  });
}

async function captureAndConfirm(text, defaultDay) {
  const parsed = await guard(() => api('parse', { method: 'POST', body: { text, default_day: defaultDay } }));
  if (!parsed) return 0;
  if (!parsed.items.length) {
    toast("Je n'ai trouvé aucune tâche là-dedans.");
    return 0;
  }
  return openConfirm(parsed, { said: text, defaultDay });
}

// Trier ce qui n'est pas fait, une tâche à la fois
function openTriage(tasks, { to, title, onDone } = {}) {
  const d = S.data;
  const list = [...tasks];
  const decisions = [];
  let i = 0;
  const reportLabel = to === d.today ? "Aujourd'hui" : 'Demain';
  const finish = async () => {
    if (decisions.length) await guard(() => api('triage', { method: 'POST', body: { decisions, to } }));
    closeModal();
    if (onDone) onDone();
    else load();
  };
  const show = () => {
    if (i >= list.length) return finish();
    const t = list[i];
    const m = openModal(`
      <p class="step">${esc(title || 'Le tri du soir')} · ${i + 1} sur ${list.length}</p>
      <div class="card"><i class="dot c-${t.company}"></i><div><strong>${esc(t.title)}</strong>
        <small>${esc(SECTIONS[t.section])} · ${esc(COMPANIES[t.company])}${t.day && t.day !== d.today ? ` · prévue ${esc(dayLabel(t.day).toLowerCase())}` : ''}${t.pushed_count ? ` · déjà reportée ${t.pushed_count} fois` : ''}</small></div></div>
      <div class="choices">
        <button class="btn" data-do="report" autofocus>${reportLabel}</button>
        <button class="btn ghost" data-do="reserve">Plus tard</button>
        <button class="btn danger" data-do="delete">Supprimer</button>
      </div>
      <div class="foot"><button class="btn ghost" data-do="stop">Arrêter le tri ici</button></div>`);
    m.addEventListener('click', (e) => {
      const act = e.target.closest('[data-do]')?.dataset.do;
      if (!act) return;
      if (act === 'stop') return finish();
      decisions.push({ id: t.id, action: act });
      i++;
      show();
    });
  };
  show();
}

// Les heures d'une journée
function hoursFields(day) {
  return `
    <div class="field two"><label><span>Je commence à</span><input type="time" id="h-start" step="300" value="${toTimeInput(day.work_start)}"></label>
      <label><span>Je finis à</span><input type="time" id="h-end" step="300" value="${toTimeInput(day.work_end)}"></label></div>
    <label class="check"><input type="checkbox" id="h-eve" ${day.evening_work ? 'checked' : ''}><span>Je travaille après le souper</span></label>
    <label class="field" id="h-eve-wrap" ${day.evening_work ? '' : 'hidden'}><span>Jusqu'à</span><input type="time" id="h-eve-end" step="300" value="${toTimeInput(day.evening_end ?? 21 * 60)}"></label>`;
}
function readHours(m) {
  return {
    work_start: fromTimeInput($('#h-start', m).value) ?? 480,
    work_end: fromTimeInput($('#h-end', m).value) ?? 1080,
    evening_work: $('#h-eve', m).checked,
    evening_end: fromTimeInput($('#h-eve-end', m).value) ?? 1260,
  };
}
function wireHours(m) {
  $('#h-eve', m).addEventListener('change', (e) => ($('#h-eve-wrap', m).hidden = !e.target.checked));
}

function openHours() {
  const d = S.data;
  const m = openModal(`<h2>Mes heures, ${esc(dayLabel(d.date).toLowerCase())}</h2>${hoursFields(d.day)}
    <p class="hint">Le souper est réservé à ${fmtTime(d.settings.supper_start)}. L'horaire se replace quand tu enregistres.</p>
    <div class="foot"><button class="btn ghost" data-act="close">Annuler</button><span class="grow"></span><button class="btn" data-do="save">Enregistrer</button></div>`);
  wireHours(m);
  $('[data-do="save"]', m).addEventListener('click', async () => {
    await guard(() => api(`days/${d.date}`, { method: 'PUT', body: readHours(m) }));
    closeModal();
    load();
  });
}

// Préparer demain : le tri, les quatre questions, les heures
const QUESTIONS = ['Qui dois-tu rappeler ?', "Qu'as-tu promis à quelqu'un ?", "Qu'est-ce qui arrive à échéance ?", 'Quelle paperasse traîne ?'];

async function openEvening() {
  const d = S.data;
  const tomorrow = addDays(d.today, 1);
  const left = d.tasks.filter((t) => t.status === 'todo' && !isLife(t));
  const stepQuestions = () => {
    const m = openModal(
      `<p class="step">Préparer demain · vide ta tête</p><h2>Quatre questions</h2>
       <p class="hint">Réponds à voix haute ou au clavier. Passe celles qui ne te disent rien.</p>
       ${QUESTIONS.map((q, i) => `<label class="field"><span>${esc(q)}</span><textarea rows="2" data-q="${i}"></textarea></label>`).join('')}
       <div class="foot"><button class="btn ghost" data-do="skip">Passer</button><span class="grow"></span><button class="btn" data-do="next">Continuer</button></div>`,
      { wide: true },
    );
    m.addEventListener('click', async (e) => {
      const act = e.target.closest('[data-do]')?.dataset.do;
      if (!act) return;
      const text = [...m.querySelectorAll('textarea')].map((t) => t.value.trim()).filter(Boolean).join('\n');
      if (act === 'next' && text) {
        e.target.disabled = true;
        e.target.textContent = 'Je classe…';
        await captureAndConfirm(text, tomorrow);
      }
      stepHours();
    });
  };
  const stepHours = async () => {
    const tm = await guard(() => api(`sheet?date=${tomorrow}`));
    const day = tm?.day || d.day;
    const m = openModal(`<p class="step">Préparer demain · tes heures</p><h2>${esc(cap(longDate(tomorrow)))}</h2>${hoursFields(day)}
      <div class="foot"><span class="grow"></span><button class="btn" data-do="save" autofocus>Monter ma feuille</button></div>`);
    wireHours(m);
    $('[data-do="save"]', m).addEventListener('click', async () => {
      await guard(() => api(`days/${tomorrow}`, { method: 'PUT', body: { ...readHours(m), prepared: true } }));
      closeModal();
      await load(tomorrow);
      toast('Ta feuille de demain est prête.');
    });
  };
  const stepTriage = () => {
    if (left.length) openTriage(left, { to: tomorrow, title: 'Préparer demain · ce qui reste', onDone: stepQuestions });
    else stepQuestions();
  };
  const b = await guard(() => api(`bilan?date=${d.today}`));
  if (!b) return stepTriage();
  const m = openModal(`<p class="step">Préparer demain · ta journée</p><h2>Prévu contre fait</h2>${bilanHtml(b)}
    <div class="foot"><button class="btn ghost" data-act="close">Fermer</button><span class="grow"></span><button class="btn" data-do="next" autofocus>Continuer</button></div>`);
  $('[data-do="next"]', m).addEventListener('click', stepTriage);
}

// La réserve et la revue du dimanche
async function openReserve() {
  const d = S.data;
  const res = await guard(() => api('reserve'));
  if (!res) return;
  const week = Array.from({ length: 7 }, (_, i) => addDays(d.today, i));
  const row = (t) => `<div class="rrow" data-id="${t.id}"><i class="dot c-${t.company}"></i><div class="rt"><strong>${esc(t.title)}</strong>
      <div class="chips">${week.map((dt, i) => `<button type="button" class="chipday" data-day="${dt}">${i === 0 ? 'Auj.' : i === 1 ? 'Dem.' : DAY_SHORT[dowOf(dt)]}</button>`).join('')}<button type="button" class="chipday x" data-del>Supprimer</button></div></div></div>`;
  const m = openModal(
    `<h2>La réserve</h2><p class="hint">Tout ce qui n'a pas de jour. Choisis ce qui entre dans ta semaine, garde le reste ou supprime.</p>
     <div id="rrows">${res.tasks.map(row).join('') || '<p class="empty">La réserve est vide.</p>'}</div>
     <div class="foot"><span class="grow"></span><button class="btn" data-act="close">Fermer</button></div>`,
    { wide: true },
  );
  let changed = false;
  m.addEventListener('click', async (e) => {
    const r = e.target.closest('.rrow');
    if (!r) return;
    const id = +r.dataset.id;
    const dayBtn = e.target.closest('[data-day]');
    if (dayBtn) await guard(() => api(`tasks/${id}`, { method: 'PATCH', body: { day: dayBtn.dataset.day } }));
    else if (e.target.closest('[data-del]')) await guard(() => api(`tasks/${id}`, { method: 'DELETE' }));
    else return;
    changed = true;
    r.remove();
    if (!$('.rrow', m)) $('#rrows', m).innerHTML = '<p class="empty">La réserve est vide.</p>';
  });
  new MutationObserver(() => {
    if (!modalRoot.firstChild && changed) load();
  }).observe(modalRoot, { childList: true });
}

// Les dictées arrivées par le raccourci
async function openInbox() {
  for (const cap of [...S.data.inbox]) {
    const parsed = await guard(() => api('parse', { method: 'POST', body: { capture_id: cap.id } }));
    if (!parsed) break;
    if (!parsed.items.length) {
      await guard(() => api(`inbox/${cap.id}`, { method: 'DELETE' }));
      continue;
    }
    const n = await openConfirm(parsed, { said: cap.raw_text });
    if (!n) {
      const m = openModal(`<h2>Garder cette dictée pour plus tard ?</h2><p class="said">« ${esc(cap.raw_text.slice(0, 220))} »</p>
        <div class="foot"><button class="btn danger" data-do="drop">La jeter</button><span class="grow"></span><button class="btn" data-do="keep" autofocus>La garder</button></div>`);
      const choice = await new Promise((r) => {
        onModalClose = () => r('keep'); // fermée sans choisir : on la garde
        m.addEventListener('click', (e) => e.target.dataset.do && r(e.target.dataset.do));
      });
      closeModal();
      if (choice === 'drop') await guard(() => api(`inbox/${cap.id}`, { method: 'DELETE' }));
      else break;
    }
  }
  load();
}

// Le bilan du soir : prévu contre fait
function bilanHtml(b) {
  const measured = b.measured > 0;
  const cell = (r) =>
    measured
      ? `<span class="${r.planned >= 30 && r.done < r.planned / 2 ? 'bad' : 'ok'}">${fmtDur(r.done)}</span>`
      : `<span>${r.checked} sur ${r.count}</span>`;
  const rows = b.rows.map((r) => `<div class="mrow"><span>${esc(r.label)}</span><span>${fmtDur(r.planned)}</span>${cell(r)}</div>`).join('');
  const imp = measured || b.imprevu.done ? `<div class="mrow"><span>Imprévus</span><span>${fmtDur(b.imprevu.planned)}</span><span>${fmtDur(b.imprevu.done)}</span></div>` : '';
  const off = b.off.active
    ? `<div class="mrow"><span>Hors feuille</span><span>${fmtDur(b.off.budget)}</span><span class="${b.off.minutes > b.off.budget ? 'bad' : 'ok'}">${fmtDur(b.off.minutes)}</span></div>`
    : '';
  const notes = [];
  if (b.off.overrides) notes.push(`« Continuer quand même » choisi ${b.off.overrides} fois.`);
  if (b.off.stops.length) notes.push(`Assistant du Mac fermé à ${b.off.stops.map(fmtTime).join(', ')}.`);
  if (b.pace && b.pace >= 1.2) notes.push(`Tes tâches prennent environ ${String(b.pace).replace('.', ',')} fois le temps prévu.`);
  return `<div class="bilan">
      <div class="mrow head"><span>Type de travail</span><span>Prévu</span><span>${measured ? 'Fait' : 'Coché'}</span></div>
      ${rows || '<p class="empty">Aucune tâche sur cette feuille.</p>'}${imp}${off}
    </div>
    <p class="callout">${esc(b.sentence)}</p>
    ${notes.length ? `<p class="hint">${notes.map(esc).join(' ')}</p>` : ''}`;
}

// Le miroir de la semaine
async function openMirror() {
  const mi = await guard(() => api('mirror'));
  if (!mi) return;
  const m = openModal(`<p class="step">Le miroir · ${esc(dayLabel(mi.from).toLowerCase())} au ${esc(longDate(mi.to))}</p>
    <h2>Ta semaine en trois constats</h2>
    <ol class="facts">${mi.facts.map((f) => `<li>${esc(f)}</li>`).join('')}</ol>
    <h3>Un seul ajustement</h3>
    <p class="callout">${esc(mi.adjust)}</p>
    <div class="foot"><button class="btn ghost" data-act="close">Fermer</button><span class="grow"></span>${S.data.reserve_count ? `<button class="btn" data-do="reserve">Revoir ma réserve (${S.data.reserve_count})</button>` : ''}</div>`);
  $('[data-do="reserve"]', m)?.addEventListener('click', () => {
    closeModal();
    openReserve();
  });
}

// Le mode appels : une personne à la fois
async function openCalls() {
  const d = S.data;
  const list = d.tasks.filter((t) => t.section === 'rappel' && t.status === 'todo').sort((a, b) => (a.start_min ?? 9999) - (b.start_min ?? 9999) || a.sort - b.sort);
  if (!list.length) return toast('Personne à rappeler.');
  let i = 0;
  const finish = async () => {
    await guard(() => api('focus/stop', { method: 'POST' }));
    closeModal();
    load();
  };
  const show = async () => {
    if (i >= list.length) return finish();
    const t = list[i];
    await guard(() => api('focus', { method: 'POST', body: { task_id: t.id, toggle: false } }));
    const digits = (t.phone || '').replace(/[^\d+]/g, '');
    const m = openModal(`
      <p class="step">Mode appels · ${i + 1} sur ${list.length}</p>
      <div class="card"><i class="dot c-${t.company}"></i><div><strong>${esc(t.contact || t.title)}</strong>
        <small>${esc(t.contact ? t.title : COMPANIES[t.company])}${t.note ? ` · ${esc(t.note)}` : ''}${t.pushed_count ? ` · attend depuis ${t.pushed_count} jour${t.pushed_count > 1 ? 's' : ''}` : ''}</small></div></div>
      ${digits ? `<a class="btn primary call" href="tel:${esc(digits)}">Appeler le ${esc(t.phone)}</a>` : `<p class="hint">Aucun numéro enregistré pour cette personne. Tu peux l'ajouter avec ⋯ sur la tâche.</p>`}
      <div class="choices">
        <button class="btn" data-do="joined">Rejoint</button>
        <button class="btn ghost" data-do="message">Message laissé</button>
        <button class="btn ghost" data-do="tomorrow">Rappeler demain</button>
      </div>
      <div class="foot"><button class="btn ghost" data-do="skip">Passer</button><span class="grow"></span><button class="btn ghost" data-do="end">Terminer</button></div>`);
    m.addEventListener('click', async (e) => {
      const act = e.target.closest('[data-do]')?.dataset.do;
      if (!act) return;
      if (act === 'end') return finish();
      if (act === 'joined') await guard(() => api(`tasks/${t.id}`, { method: 'PATCH', body: { status: 'done' } }));
      if (act === 'message') {
        const now = new Date();
        await guard(() => api(`tasks/${t.id}`, { method: 'PATCH', body: { note: `Message laissé à ${fmtTime(now.getHours() * 60 + now.getMinutes())}` } }));
      }
      if (act === 'tomorrow') await guard(() => api('triage', { method: 'POST', body: { decisions: [{ id: t.id, action: 'report' }], to: addDays(d.today, 1) } }));
      i++;
      show();
    });
  };
  show();
}

// Les notifications sur cet appareil
const pushSupported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
const keyBytes = (b64) => Uint8Array.from(atob(b64.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));

async function pushState() {
  if (!S.data.push.ready) return 'server';
  if (!pushSupported()) return 'unsupported';
  if (Notification.permission === 'denied') return 'denied';
  const reg = await navigator.serviceWorker.ready;
  return (await reg.pushManager.getSubscription()) ? 'on' : 'off';
}

async function enablePush() {
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') throw new Error('Les notifications sont refusées sur cet appareil. Autorise-les dans les réglages.');
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(S.data.push.public_key) });
  await api('push/subscribe', { method: 'POST', body: { subscription: sub.toJSON() } });
}

async function disablePush() {
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.getSubscription();
  if (!sub) return;
  await api('push/unsubscribe', { method: 'POST', body: { endpoint: sub.endpoint } });
  await sub.unsubscribe();
}

// Réglages
async function openSettings() {
  const d = S.data;
  const inboxUrl = new URL('api/inbox', location.href).href;
  const cal = !d.calendar.on
    ? `<p>Ton calendrier n'est pas encore branché. Il le sera à l'installation, avec ton mot de passe d'application iCloud.</p>`
    : d.calendar.error
      ? `<p class="hint warn">${esc(d.calendar.error)}</p><button class="btn ghost" data-do="cals">Choisir le calendrier</button>`
      : `<p>Branché sur « ${esc(d.calendar.name || 'ton calendrier')} ». Tes rendez-vous entrent, tes blocs y sont écrits avec une alerte.</p><button class="btn ghost" data-do="cals">Choisir un autre calendrier</button>`;
  const n = d.notif;
  const tick = (id, label, on) => `<label class="check"><input type="checkbox" id="${id}" ${on ? 'checked' : ''}><span>${label}</span></label>`;
  const m = openModal(
    `<h2>Réglages</h2>

     <h3>Version</h3>
     <p>${d.version_at ? `Mise en ligne ${esc(new Intl.DateTimeFormat('fr-CA', { weekday: 'long', day: 'numeric', month: 'long', hour: 'numeric', minute: '2-digit' }).format(new Date(d.version_at)))}.` : 'Copie locale.'} Pro se recharge seule après une mise à jour.</p>
     <button class="btn ghost" data-do="reload">Recharger Pro maintenant</button>

     <h3>Claude, pour comprendre ta dictée</h3>
     <p>${d.ai ? 'Une clé Claude est enregistrée.' : "Aucune clé Claude n'est enregistrée : tes phrases sont seulement découpées, pas analysées."}</p>
     <button class="btn ghost" data-do="ai-check">Tester Claude</button>
     <div id="ai-box"></div>

     <h3>Quand je coche une tâche</h3>
     <label class="check"><input type="checkbox" id="s-sound" ${soundOn() ? 'checked' : ''}><span>Jouer un son (sur cet appareil)</span></label>
     <label class="check"><input type="checkbox" id="s-anim" ${calm() ? '' : 'checked'}><span>Confettis et animations (sur cet appareil)</span></label>
     ${deviceCalm() ? `<p class="hint">Cet appareil est réglé sur « Réduire les animations ». Coche la case pour les voir quand même dans Pro.</p>` : ''}

     <h3>Notifications</h3>
     <div id="push-box"><p class="hint">Vérification…</p></div>
     ${tick('n-start', "À l'heure prévue d'une tâche ou d'un bloc d'appels", n.notif_start)}
     ${tick('n-over', 'Tu dépasses : 20 minutes après la fin prévue', n.notif_over)}
     ${tick('n-due', 'Échéances : trois jours avant, puis le matin même', n.notif_due)}
     ${tick('n-eve', 'Préparer demain, le soir', n.notif_evening)}
     <label class="field half"><span>Heure du rappel du soir</span><input type="time" id="n-evetime" step="300" value="${toTimeInput(n.evening_min)}"></label>

     <h3>Ce qui revient</h3>
     <p class="hint">Paies, taxes, renouvellements. Tu l'entres une fois : la tâche revient une semaine avant son échéance et monte dans tes priorités trois jours avant.</p>
     <div id="rec-list"><p class="hint">Chargement…</p></div>
     <div class="rec-form">
       <input id="r-title" placeholder="Ex. Remettre la TPS et la TVQ" aria-label="Ce qui revient">
       <div class="field two"><label><span>Revient</span><select id="r-every"><option value="week">Chaque semaine</option><option value="month" selected>Chaque mois</option><option value="quarter">Tous les 3 mois</option><option value="year">Chaque année</option></select></label>
         <label><span>Prochaine échéance</span><input type="date" id="r-due" min="${d.today}"></label></div>
       ${chips('r-company', Object.entries(COMPANIES).map(([k, v]) => [k, `<i class="dot c-${k}"></i>${v}`]), 'robiii')}
       <button class="btn ghost" data-do="rec-add">Ajouter</button>
     </div>

     <h3>Hors feuille, sur ton Mac</h3>
     <p>${d.off.active ? `L'assistant a rapporté de l'activité aujourd'hui, pour la dernière fois à ${fmtTime(d.off.last_seen)}.` : "L'assistant du Mac n'a rien rapporté aujourd'hui."}</p>
     <label class="field half"><span>Budget hors feuille par jour</span><select id="s-budget">${[30, 45, 60, 90, 120].map((v) => `<option value="${v}"${v === d.off.budget ? ' selected' : ''}>${fmtDur(v)}</option>`).join('')}</select></label>
     <p class="hint">Pour installer l'assistant, sur ton Mac, dans le dossier <code>pro</code> : <code>npm run assistant:install</code>. Il te demandera ton lien privé.</p>

     <h3>Calendrier</h3>${cal}<div id="cals"></div>

     <h3>Souper</h3>
     <div class="field two"><label><span>Heure</span><input type="time" id="s-sup" step="300" value="${toTimeInput(d.settings.supper_start)}"></label>
       <label><span>Durée</span><select id="s-supmin">${[30, 45, 60, 90].map((v) => `<option value="${v}"${v === d.settings.supper_min ? ' selected' : ''}>${fmtDur(v)}</option>`).join('')}</select></label></div>

     <h3>Ta semaine</h3>
     <button class="btn ghost" data-do="mirror">Voir le miroir de la semaine</button>

     <h3>Dicter sans ouvrir l'app</h3>
     <p class="hint">Dans l'app Raccourcis de ton iPhone : « Dicter du texte », puis « Obtenir le contenu de l'URL » en méthode POST, corps JSON avec la clé <code>text</code>. Adresse à utiliser :</p>
     <div class="copy"><code id="inbox-url">${esc(inboxUrl)}</code><button class="btn ghost" data-do="copy">Copier</button></div>
     <p class="hint">Cette adresse contient ton lien privé. Ne la partage pas.</p>
     <div class="foot sticky"><button class="btn ghost" data-act="close">Fermer</button><span class="grow"></span><button class="btn primary" data-do="save">Enregistrer</button></div>`,
    { wide: true },
  );

  const drawPush = async () => {
    const st = await pushState().catch(() => 'unsupported');
    $('#push-box', m).innerHTML = {
      server: `<p class="hint">Les notifications ne sont pas encore configurées sur le serveur. Elles le seront à la prochaine installation (<code>npm run setup</code>).</p>`,
      unsupported: `<p class="hint">Cet appareil ne peut pas recevoir de notifications ici. Sur iPhone, ajoute d'abord Pro à l'écran d'accueil, puis ouvre-la de là.</p>`,
      denied: `<p class="hint warn">Les notifications sont bloquées pour Pro dans les réglages de cet appareil.</p>`,
      on: `<p><strong>Activées sur cet appareil.</strong></p><div class="foot"><button class="btn ghost" data-do="push-test">Envoyer un essai</button><button class="btn ghost" data-do="push-off">Désactiver ici</button></div>`,
      off: `<button class="btn" data-do="push-on">Activer sur cet appareil</button>`,
    }[st];
  };
  const drawRec = async () => {
    const res = await guard(() => api('recurring'));
    $('#rec-list', m).innerHTML = res?.rules?.length
      ? res.rules.map((r) => `<div class="rec" data-rec="${r.id}"><i class="dot c-${r.company}"></i><span><strong>${esc(r.title)}</strong><small>${esc(res.every[r.every])} · prochaine échéance ${esc(dayLabel(r.next_due).toLowerCase())}</small></span><button class="cx" data-do="rec-del" aria-label="Retirer">✕</button></div>`).join('')
      : '<p class="empty">Rien pour l’instant.</p>';
  };
  drawPush();
  drawRec();
  $('#s-anim', m).addEventListener('change', (e) => {
    try {
      localStorage.setItem('pro_anim', e.target.checked ? '1' : '0');
    } catch {
      // stockage refusé : Pro continue de suivre le réglage de l'appareil
    }
    applyCalm();
    if (e.target.checked) celebrate(e.target, 40);
  });
  $('#s-sound', m).addEventListener('change', (e) => {
    try {
      localStorage.setItem('pro_son', e.target.checked ? '1' : '0');
    } catch {
      // stockage refusé : le son reste activé
    }
    chime('task');
  });

  m.addEventListener('click', async (e) => {
    const act = e.target.closest('[data-do]')?.dataset.do;
    if (act === 'copy') {
      try {
        await navigator.clipboard.writeText(inboxUrl);
        toast('Adresse copiée.');
      } catch {
        getSelection().selectAllChildren($('#inbox-url', m));
      }
    } else if (act === 'push-on') {
      await guard(enablePush);
      drawPush();
    } else if (act === 'push-off') {
      await guard(disablePush);
      drawPush();
    } else if (act === 'reload') {
      location.reload();
    } else if (act === 'ai-check') {
      const btn = e.target.closest('[data-do]');
      btn.disabled = true;
      btn.textContent = 'Essai en cours…';
      const res = await guard(() => api('ai/check', { method: 'POST' }));
      btn.disabled = false;
      btn.textContent = 'Tester Claude';
      if (res)
        $('#ai-box', m).innerHTML = res.ok
          ? `<p><strong>Claude répond.</strong> Ta dictée sera analysée${res.title ? ` (essai : « ${esc(res.title)} »)` : ''}.</p>`
          : `<p class="hint warn">${esc(res.why)}</p>${res.help ? `<p class="hint">${esc(res.help)}</p>` : ''}`;
    } else if (act === 'push-test') {
      const res = await guard(() => api('push/test', { method: 'POST' }));
      if (res) toast(res.sent ? 'Essai envoyé. Il devrait arriver dans quelques secondes.' : "L'essai n'a pas pu être envoyé.");
    } else if (act === 'rec-add') {
      const body = { title: $('#r-title', m).value, every: $('#r-every', m).value, next_due: $('#r-due', m).value, company: chipValue(m, 'r-company') };
      if (await guard(() => api('recurring', { method: 'POST', body }))) {
        $('#r-title', m).value = '';
        drawRec();
      }
    } else if (act === 'rec-del') {
      await guard(() => api(`recurring/${e.target.closest('[data-rec]').dataset.rec}`, { method: 'DELETE' }));
      drawRec();
    } else if (act === 'mirror') {
      closeModal();
      openMirror();
    } else if (act === 'cals') {
      const res = await guard(() => api('calendars'));
      $('#cals', m).innerHTML = res?.calendars?.length
        ? `<div class="chips">${res.calendars.map((c) => `<button type="button" class="chipday${c.url === res.current ? ' on' : ''}" data-cal="${esc(c.url)}" data-name="${esc(c.name)}">${esc(c.name)}</button>`).join('')}</div>`
        : `<p class="hint warn">${esc(res?.error || 'Aucun calendrier trouvé.')}</p>`;
    } else if (e.target.closest('[data-cal]')) {
      const b = e.target.closest('[data-cal]');
      await guard(() => api('settings', { method: 'PUT', body: { cal_url: b.dataset.cal, cal_name: b.dataset.name } }));
      closeModal();
      load(S.date, { fresh: true });
    } else if (act === 'save') {
      const on = (id) => ($(id, m).checked ? 1 : 0);
      await guard(() =>
        api('settings', {
          method: 'PUT',
          body: {
            supper_start: fromTimeInput($('#s-sup', m).value) ?? 1080,
            supper_min: Number($('#s-supmin', m).value),
            notif_start: on('#n-start'),
            notif_over: on('#n-over'),
            notif_due: on('#n-due'),
            notif_evening: on('#n-eve'),
            evening_min: fromTimeInput($('#n-evetime', m).value) ?? 1320,
            off_budget: Number($('#s-budget', m).value),
          },
        }),
      );
      await guard(() => api('plan', { method: 'POST', body: { date: S.date } }));
      closeModal();
      load();
    }
  });
}

// ---- Cocher ----

// Confettis et animations : par défaut Pro suit le réglage de l'appareil (« Réduire les animations »).
// Le choix fait dans ⚙ passe devant, appareil par appareil.
const deviceCalm = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const animPref = () => {
  try {
    return localStorage.getItem('pro_anim');
  } catch {
    return null;
  }
};
const calm = () => {
  const p = animPref();
  return p === '0' || (p == null && deviceCalm());
};
const applyCalm = () => document.documentElement.classList.toggle('calm', calm());
applyCalm();
const CONFETTI_COLORS = ['var(--robiii)', 'var(--immo)', 'var(--perso)', 'var(--accent)', 'var(--sun)', 'var(--good)'];

/** Des confettis qui jaillissent de la case cochée. */
function celebrate(el, count = 26) {
  if (calm()) return;
  const r = el.getBoundingClientRect();
  const big = count > 20;
  for (let i = 0; i < count; i++) {
    const p = document.createElement('i');
    p.className = 'confetti';
    const a = (Math.PI * 2 * i) / count + Math.random() * 0.4;
    const dist = (big ? 70 : 34) + Math.random() * (big ? 120 : 46);
    p.style.cssText = `left:${r.left + r.width / 2 - 4}px;top:${r.top + r.height / 2 - 4}px;background:${CONFETTI_COLORS[i % 6]};--dx:${Math.cos(a) * dist}px;--dy:${Math.sin(a) * dist - (big ? 40 : 14)}px;--rot:${Math.random() * 540 - 270}deg`;
    if (!big) p.style.animationDuration = '0.7s';
    document.body.append(p);
    setTimeout(() => p.remove(), 1100);
  }
}

/** La feuille est finie : une pluie de confettis sur tout l'écran. */
function shower() {
  if (calm()) return;
  for (let i = 0; i < 90; i++) {
    const p = document.createElement('i');
    p.className = 'confetti fall';
    const size = 6 + Math.random() * 6;
    p.style.cssText = `left:${Math.random() * 100}vw;top:-16px;width:${size}px;height:${size * (Math.random() > 0.5 ? 1 : 0.45)}px;background:${CONFETTI_COLORS[i % 6]};--drift:${Math.random() * 160 - 80}px;--rot:${Math.random() * 900 - 450}deg;animation-duration:${1.5 + Math.random() * 1.3}s;animation-delay:${Math.random() * 0.5}s`;
    document.body.append(p);
    setTimeout(() => p.remove(), 3500);
  }
}

// Le son : quelques notes fabriquées sur place, sans fichier. Réglable par appareil, dans ⚙.
const soundOn = () => {
  try {
    return localStorage.getItem('pro_son') !== '0';
  } catch {
    return true;
  }
};
let audio = null;
const CHIMES = {
  task: [[659.25, 0], [987.77, 0.075]], // deux notes qui montent
  big: [[523.25, 0], [659.25, 0.07], [783.99, 0.14], [1046.5, 0.21]], // une priorité : un accord qui grimpe
  day: [[523.25, 0], [659.25, 0.09], [783.99, 0.18], [1046.5, 0.27], [1318.5, 0.4], [1568, 0.52]], // la feuille est finie
};
function chime(kind = 'task') {
  if (!soundOn()) return;
  try {
    audio ||= new (window.AudioContext || window.webkitAudioContext)();
    if (audio.state === 'suspended') audio.resume();
    const t0 = audio.currentTime + 0.01;
    for (const [freq, at] of CHIMES[kind]) {
      const osc = audio.createOscillator();
      const gain = audio.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      const long = kind === 'task' ? 0.28 : 0.5;
      gain.gain.setValueAtTime(0.0001, t0 + at);
      gain.gain.exponentialRampToValueAtTime(0.16, t0 + at + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + at + long);
      osc.connect(gain).connect(audio.destination);
      osc.start(t0 + at);
      osc.stop(t0 + at + long + 0.05);
    }
  } catch {
    // pas de son sur cet appareil : le reste de la récompense suffit
  }
}

async function toggleCheck(id, rowEl) {
  const t = S.data.tasks.find((x) => x.id === id);
  if (!t) return;
  const toDone = t.status !== 'done';
  if (toDone && isLife(t)) {
    // Un moment hors travail : une petite fête, sans toucher au compte de la journée de travail.
    const cb = $('.cb', rowEl);
    rowEl.classList.add('checking');
    cb.classList.add('on');
    navigator.vibrate?.(12);
    chime('task');
    celebrate(cb, 12);
    toast('C’est fait. Ça compte aussi.');
  } else if (toDone) {
    const tasks = S.data.tasks.filter((x) => !isLife(x));
    const total = tasks.length;
    const done = tasks.filter((x) => x.status === 'done').length + 1;
    const avoided = isAvoided(t);
    const big = t.section === 'priorite' || avoided;
    const last = done === total;
    const cb = $('.cb', rowEl);
    rowEl.classList.add('checking');
    cb.classList.add('on');
    navigator.vibrate?.(last ? [20, 50, 20, 50, 40] : big ? [18, 40, 28] : 12);
    chime(last ? 'day' : big ? 'big' : 'task');
    celebrate(cb, big || last ? 40 : 12);
    if (last) shower();
    // La barre du jour avance tout de suite, sous tes yeux.
    const bar = $('.prog-bar i');
    if (bar) bar.style.width = `${Math.round((done / total) * 100)}%`;
    const prog = $('.prog');
    if (prog) {
      prog.classList.add('bump');
      prog.classList.toggle('full', last);
      $('span', prog).textContent = `${done} sur ${total} faite${done > 1 ? 's' : ''}`;
    }
    toast(cheerFor(t, { done, total, avoided }), last ? 4200 : 2400);
  }
  const saved = api(`tasks/${id}`, { method: 'PATCH', body: { status: toDone ? 'done' : 'todo' } });
  await Promise.all([guard(() => saved), new Promise((r) => setTimeout(r, toDone ? 950 : 0))]);
  load();
}

// ---- Glisser une tâche ----

let drag = null;
const dropbar = $('#dropbar');

document.addEventListener('pointerdown', (e) => {
  const grip = e.target.closest('[data-grip]');
  if (!grip) return;
  const row = grip.closest('[data-id]');
  e.preventDefault();
  grip.setPointerCapture(e.pointerId);
  const r = row.getBoundingClientRect();
  const ghost = row.cloneNode(true);
  ghost.classList.add('drag-ghost');
  ghost.style.width = r.width + 'px';
  document.body.append(ghost);
  row.classList.add('dragging');
  dropbar.hidden = false;
  document.body.classList.add('is-dragging');
  drag = { id: +row.dataset.id, row, ghost, dx: e.clientX - r.left, dy: e.clientY - r.top, target: null };
  moveDrag(e);
});

function moveDrag(e) {
  drag.ghost.style.transform = `translate(${e.clientX - drag.dx}px, ${e.clientY - drag.dy}px)`;
  const el = document.elementFromPoint(e.clientX, e.clientY);
  const target = el?.closest('[data-drop]') || null;
  if (target !== drag.target) {
    drag.target?.classList.remove('drop-on');
    target?.classList.add('drop-on');
    drag.target = target;
  }
  if (e.clientY < 90) scrollBy(0, -14);
  else if (e.clientY > innerHeight - 110) scrollBy(0, 14);
}

document.addEventListener('pointermove', (e) => drag && moveDrag(e));

async function endDrag(apply) {
  if (!drag) return;
  const { id, row, ghost, target } = drag;
  drag = null;
  ghost.remove();
  row.classList.remove('dragging');
  target?.classList.remove('drop-on');
  dropbar.hidden = true;
  document.body.classList.remove('is-dragging');
  if (!apply || !target) return;
  const t = S.data.tasks.find((x) => x.id === id);
  const [kind, val] = target.dataset.drop.split(':');
  let body = null;
  if (kind === 'section' && isLife(t)) body = { kind: 'tache', section: val };
  else if (kind === 'section' && val !== t.section) body = { section: val };
  if (kind === 'life' && !isLife(t)) body = { kind: 'vie' };
  if (kind === 'time') body = { start_min: Number(val) };
  if (kind === 'day') body = { day: val === 'reserve' ? null : addDays(S.data.today, 1) };
  if (!body) return;
  await guard(() => api(`tasks/${id}`, { method: 'PATCH', body }));
  if (kind === 'day') toast(val === 'reserve' ? 'Rangée dans la réserve.' : 'Déplacée à demain.');
  load();
}
document.addEventListener('pointerup', () => endDrag(true));
document.addEventListener('pointercancel', () => endDrag(false));

// ---- Les gestes ----

app.addEventListener('click', async (e) => {
  const el = e.target.closest('[data-act]');
  if (!el) return;
  const act = el.dataset.act;
  const row = el.closest('[data-id]');
  const id = row ? +row.dataset.id : null;
  const d = S.data;
  if (act === 'check') return toggleCheck(id, row);
  if (act === 'edit') return openEdit(id);
  if (act === 'focus') {
    await guard(() => api('focus', { method: 'POST', body: { task_id: id } }));
    return load();
  }
  if (act === 'stop') {
    await guard(() => api('focus/stop', { method: 'POST' }));
    return load();
  }
  if (act === 'imprevu') {
    await guard(() => api('imprevu', { method: 'POST', body: {} }));
    toast("Imprévu en cours. Touche « Fin de l'imprévu » quand c'est réglé.");
    return load();
  }
  if (act === 'mic') return mic.state === 'rec' ? stopMic() : mic.state === 'idle' ? startMic() : null;
  if (act === 'calls') return openCalls();
  if (act === 'mirror') return openMirror();
  if (act === 'prev') return load(addDays(d.date, -1));
  if (act === 'next') return load(addDays(d.date, 1));
  if (act === 'today') return load(d.today);
  if (act === 'hours') return openHours();
  if (act === 'evening') return openEvening();
  if (act === 'reserve') return openReserve();
  if (act === 'settings') return openSettings();
  if (act === 'inbox') return openInbox();
  if (act === 'triage') return openTriage(d.triage, { to: d.today, title: 'Ce qui restait des autres jours' });
  if (act === 'replan') {
    el.disabled = true;
    await guard(() => api('plan', { method: 'POST', body: { date: d.date, unpin: false } }));
    return load();
  }
  if (act === 'first-step') {
    el.disabled = true;
    el.textContent = 'Je cherche…';
    await guard(() => api(`tasks/${el.dataset.id}/first-step`, { method: 'POST' }));
    return load();
  }
});

app.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && e.target.matches('.t, .bt, .blk[data-act]')) e.target.click();
  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && e.target.id === 'capture-text') $('#capture').requestSubmit();
});
app.addEventListener('input', (e) => e.target.id === 'capture-text' && autoGrow(e.target));

app.addEventListener('submit', async (e) => {
  if (e.target.id !== 'capture') return;
  e.preventDefault();
  if (S.busy) return;
  const ta = $('#capture-text');
  const text = ta.value.trim();
  if (!text) return ta.focus();
  const btn = $('.send');
  S.busy = true;
  btn.disabled = true;
  btn.textContent = 'Je classe…';
  const d = S.data;
  const n = await captureAndConfirm(text, d.date >= d.today ? d.date : d.today);
  S.busy = false;
  if (n) {
    $('#capture-text').value = '';
    toast(n > 1 ? `${n} tâches ajoutées.` : 'Tâche ajoutée.');
  }
  await load();
});

document.addEventListener('keydown', (e) => e.key === 'Escape' && modalRoot.firstChild && closeModal());
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') return stopMic();
  if (document.visibilityState === 'visible' && S.data && !modalRoot.firstChild && !drag) load(S.date === S.data.today ? null : S.date);
});

if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
load();
