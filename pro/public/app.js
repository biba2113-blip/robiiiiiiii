// Pro : l'écran. Une feuille du jour, une boîte pour vider ta tête, un tri le soir.
import { freeWindows, sortTasks, fmtTime, fmtDur, daysBetween } from './plan.js';

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
  const [h, m] = String(v || '').split(':').map(Number);
  return Number.isFinite(h) ? h * 60 + (m || 0) : null;
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
  S.data = data;
  S.date = data.date;
  render();
  if (data.date === data.today && data.triage.length && !S.triageSeen && !modalRoot.firstChild) {
    S.triageSeen = true;
    openTriage(data.triage, { to: data.today, title: 'Ce qui restait des autres jours' });
  }
}

// ---- La feuille ----

const isAvoided = (t) => t.status === 'todo' && t.pushed_count >= 2;

function metaOf(t, { withTime = true } = {}) {
  const d = S.data;
  const bits = [];
  if (withTime && t.start_min != null && t.status === 'todo') bits.push(fmtTime(t.start_min));
  if (t.due_date) {
    const n = daysBetween(d.today, t.due_date);
    bits.push(n < 0 ? 'Échéance dépassée' : n === 0 ? "Échéance aujourd'hui" : `Échéance ${dayLabel(t.due_date).toLowerCase()}`);
  }
  if (t.pushed_count === 1) bits.push('Reportée 1 fois');
  if (t.pushed_count > 1) bits.push(`Reportée ${t.pushed_count} fois`);
  if (t.section !== 'rappel' || !bits.length) bits.push(fmtDur(t.est_minutes));
  return bits.join(' · ');
}

function rowHtml(t, { num, avoid = false } = {}) {
  const done = t.status === 'done';
  const lead = num ? `<span class="num">${num}</span>` : '';
  let extra = '';
  if (avoid) {
    extra = t.first_step
      ? `<span class="chip">Premier pas : ${esc(t.first_step)}</span>`
      : `<button class="chip chip-btn" data-act="first-step" data-id="${t.id}">Trouver un premier pas de 10 minutes</button>`;
  }
  return `<div class="row${done ? ' done' : ''}" data-id="${t.id}">
    ${lead}<button class="cb${done ? ' on' : ''}" data-act="check" aria-label="${done ? 'Décocher' : 'Cocher'} : ${esc(t.title)}"></button>
    <div class="t" data-act="edit" role="button" tabindex="0"><span class="tt">${esc(t.title)}</span><small>${esc(metaOf(t))}</small>${extra}</div>
    <i class="dot c-${t.company}" title="${COMPANIES[t.company]}"></i>
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
    <h2>${SECTIONS[section]}<span class="count">${todo.length || ''}</span></h2>
    ${ordered.map((t, i) => rowHtml(t, { num: section === 'priorite' ? i + 1 : 0 })).join('')}
    ${done.map((t) => rowHtml(t)).join('')}
    ${tasks.length ? '' : `<p class="empty">${empty}</p>`}${hint}
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
  const rows = [];
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

  const allDay = d.events.filter((e) => e.allDay);
  const unplaced = d.tasks.filter((t) => t.status === 'todo' && t.start_min == null);
  const hours = `${fmtTime(d.day.work_start)} à ${fmtTime(d.day.work_end)}${d.day.evening_work ? `, puis jusqu'à ${fmtTime(d.day.evening_end)}` : ''}`;

  const line = (r) => {
    if (r.kind === 'rdv') return `<div class="blk rdv">${esc(r.title)}<small>Rendez-vous · jusqu'à ${fmtTime(r.end)}</small></div>`;
    if (r.kind === 'souper') return `<div class="blk plain">Souper</div>`;
    if (r.kind === 'libre') return `<div class="blk free">Libre pour les imprévus<small>jusqu'à ${fmtTime(r.end)}</small></div>`;
    const t = r.task;
    return `<div class="blk c-${t.company}${t.status === 'done' ? ' done' : ''}" data-act="edit" data-id="${t.id}" role="button" tabindex="0">${t.section === 'rappel' ? 'Appel : ' : ''}${esc(t.title)}<small>${fmtDur(t.est_minutes)}${t.pinned ? ' · heure fixée' : ''}</small></div>`;
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
  if (d.date === d.today && d.dow === 0 && d.reserve_count) {
    out.push(`<button class="banner" data-act="reserve">C'est dimanche : revois ta réserve (${d.reserve_count})<span>Revoir</span></button>`);
  }
  if (d.calendar.on && d.calendar.error) {
    out.push(`<button class="banner warn" data-act="settings">Calendrier : ${esc(d.calendar.error)}<span>Voir</span></button>`);
  }
  return out.join('');
}

function render() {
  const d = S.data;
  const tasks = d.tasks;
  const total = tasks.length;
  const done = tasks.filter((t) => t.status === 'done').length;
  const pct = total ? Math.round((done / total) * 100) : 0;
  const buffer = d.summary.available - d.summary.capacity;
  const over = d.summary.planned - d.summary.capacity;
  const load = d.summary.overflow
    ? `<span class="warn">Ça déborde de ${fmtDur(Math.ceil(over / 5) * 5)}. Glisse des tâches vers demain.</span>`
    : `Prévu ${fmtDur(d.summary.planned)} sur ${fmtDur(d.summary.capacity)} · ${fmtDur(buffer)} gardées pour les imprévus`;
  const by = (s) => tasks.filter((t) => t.section === s);
  const keep = $('#capture-text')?.value || '';

  app.innerHTML = `
    <header class="top">
      <div class="title">
        <button class="icon" data-act="prev" aria-label="Jour précédent">‹</button>
        <h1>${esc(cap(longDate(d.date)))}</h1>
        <button class="icon" data-act="next" aria-label="Jour suivant">›</button>
        ${d.date !== d.today ? `<button class="pill" data-act="today">Revenir à aujourd'hui</button>` : ''}
      </div>
      <div class="actions">
        <button class="pill" data-act="reserve">Réserve${d.reserve_count ? ` · ${d.reserve_count}` : ''}</button>
        ${d.date === d.today ? `<button class="pill strong" data-act="evening">Préparer demain</button>` : ''}
        <button class="icon" data-act="settings" aria-label="Réglages">⚙</button>
      </div>
      <div class="prog"><div class="prog-bar"><i style="width:${pct}%"></i></div><span>${total ? `${done} sur ${total} faite${done > 1 ? 's' : ''}` : 'Feuille vide'}</span></div>
      <div class="sub"><span class="load">${load}</span>
        <span class="legend"><span><i class="dot c-robiii"></i>Robiii</span><span><i class="dot c-immo"></i>ImmoMulti</span><span><i class="dot c-perso"></i>Perso</span></span>
      </div>
    </header>
    <div id="banners">${bannersHtml()}</div>
    <main class="grid">
      ${scheduleHtml()}
      <div class="boxes">${boxHtml('priorite', by('priorite'))}${boxHtml('rappel', by('rappel'))}${boxHtml('faire', by('faire'))}${avoidHtml(tasks)}</div>
    </main>
    <form class="capture" id="capture">
      <textarea id="capture-text" rows="1" placeholder="Vide ta tête : dicte ou écris tout d'un coup…" aria-label="Ajouter des tâches"></textarea>
      <button class="send" type="submit" aria-label="Ajouter">Ajouter</button>
    </form>`;
  const ta = $('#capture-text');
  ta.value = keep;
  autoGrow(ta);
}

function autoGrow(ta) {
  ta.style.height = 'auto';
  ta.style.height = Math.min(ta.scrollHeight, 180) + 'px';
}

// ---- Fenêtres ----

function openModal(html, { wide = false } = {}) {
  modalRoot.innerHTML = `<div class="veil" data-act="close-veil"><div class="modal${wide ? ' wide' : ''}" role="dialog" aria-modal="true">${html}</div></div>`;
  document.body.classList.add('locked');
  const focus = $('.modal [autofocus]', modalRoot);
  if (focus) focus.focus();
  return $('.modal', modalRoot);
}
function closeModal() {
  modalRoot.innerHTML = '';
  document.body.classList.remove('locked');
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
    <label class="field"><span>Tâche</span><input id="e-title" value="${esc(t.title)}"></label>
    <div class="field"><span>Section</span>${chips('section', Object.entries(SECTIONS), t.section)}</div>
    <div class="field"><span>Entreprise</span>${chips('company', Object.entries(COMPANIES).map(([k, v]) => [k, `<i class="dot c-${k}"></i>${v}`]), t.company)}</div>
    <div class="field"><span>Jour</span>${chips('day', [['today', "Aujourd'hui"], ['tomorrow', 'Demain'], ['reserve', 'Réserve'], ['other', 'Autre date']], dayVal)}
      <input type="date" id="e-date" value="${t.day || ''}" min="${d.today}" ${dayVal === 'other' ? '' : 'hidden'}></div>
    <div class="field"><span>Durée</span>${chips('dur', DURATIONS.map((n) => [n, fmtDur(n)]), DURATIONS.includes(t.est_minutes) ? t.est_minutes : '')}</div>
    <div class="field two"><label><span>Heure</span><input type="time" id="e-time" step="300" value="${t.start_min != null ? toTimeInput(t.start_min) : ''}"></label>
      <label><span>Échéance</span><input type="date" id="e-due" value="${t.due_date || ''}"></label></div>
    <p class="hint">Laisse l'heure vide pour que l'outil place la tâche. Une heure choisie ne bouge plus.</p>
    <div class="foot"><button class="btn danger" data-do="delete">Supprimer</button><span class="grow"></span><button class="btn ghost" data-act="close">Annuler</button><button class="btn" data-do="save">Enregistrer</button></div>`);
  m.addEventListener('chips', () => ($('#e-date', m).hidden = chipValue(m, 'day') !== 'other'));
  m.addEventListener('click', async (e) => {
    const act = e.target.closest('[data-do]')?.dataset.do;
    if (!act) return;
    if (act === 'delete') {
      await guard(() => api(`tasks/${id}`, { method: 'DELETE' }));
    } else {
      const dv = chipValue(m, 'day');
      const day = dv === 'today' ? d.today : dv === 'tomorrow' ? addDays(d.today, 1) : dv === 'reserve' ? null : $('#e-date', m).value || t.day;
      const time = fromTimeInput($('#e-time', m).value);
      const body = {
        title: $('#e-title', m).value,
        section: chipValue(m, 'section'),
        company: chipValue(m, 'company'),
        due_date: $('#e-due', m).value || null,
      };
      const dur = Number(chipValue(m, 'dur'));
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
function confirmRowHtml(it, i) {
  const d = S.data;
  const dayOpts = [[d.today, "Aujourd'hui"], [addDays(d.today, 1), 'Demain'], ['', 'Réserve']];
  if (it.day && !dayOpts.some(([v]) => v === it.day)) dayOpts.splice(2, 0, [it.day, dayLabel(it.day)]);
  const sel = (name, opts, val) =>
    `<select class="tag" data-f="${name}" aria-label="${name}">${opts.map(([v, l]) => `<option value="${esc(v)}"${String(v) === String(val ?? '') ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select>`;
  const durs = DURATIONS.includes(it.est_minutes) ? DURATIONS : [...DURATIONS, it.est_minutes].sort((a, b) => a - b);
  return `<div class="crow" data-i="${i}">
    <input class="ctitle" data-f="title" value="${esc(it.title)}" aria-label="Tâche">
    <div class="ctags">
      ${sel('section', Object.entries(SECTIONS), it.section)}
      <span class="tagwrap c-${it.company}"><i class="dot c-${it.company}"></i>${sel('company', Object.entries(COMPANIES), it.company)}</span>
      ${sel('day', dayOpts, it.day)}
      ${sel('est_minutes', durs.map((n) => [n, fmtDur(n)]), it.est_minutes)}
      ${it.due_date ? `<span class="tag due">Échéance ${esc(dayLabel(it.due_date).toLowerCase())}</span>` : ''}
      <button type="button" class="tag x" data-rm aria-label="Retirer">Retirer</button>
    </div>
  </div>`;
}

/** Ouvre la confirmation. Résout avec le nombre de tâches ajoutées (0 si annulé). */
function openConfirm(parsed, { said, defaultDay } = {}) {
  return new Promise((resolve) => {
    const items = parsed.items.map((it) => ({ ...it }));
    const note =
      parsed.engine === 'regles'
        ? `<p class="hint warn">Classé avec les règles simples${parsed.note ? ` (${esc(parsed.note)})` : S.data.ai ? '' : ' : Claude n’est pas encore branché'}. Vérifie les étiquettes.</p>`
        : '';
    const m = openModal(
      `<h2>Voici ce que j'ai compris</h2>
       ${said ? `<p class="said">« ${esc(said.length > 220 ? said.slice(0, 220) + '…' : said)} »</p>` : ''}
       ${note}
       <div id="crows">${items.map(confirmRowHtml).join('')}</div>
       <p class="hint">Touche une étiquette pour la changer.</p>
       <div class="foot"><button class="btn ghost" data-do="cancel">Annuler</button><span class="grow"></span><button class="btn" data-do="add" autofocus></button></div>`,
      { wide: true },
    );
    const addBtn = $('[data-do="add"]', m);
    const alive = () => items.filter(Boolean);
    const label = () => {
      const n = alive().length;
      addBtn.textContent = n > 1 ? `Ajouter les ${n}` : n === 1 ? 'Ajouter' : 'Rien à ajouter';
      addBtn.disabled = !n;
    };
    label();
    m.addEventListener('input', (e) => {
      const row = e.target.closest('.crow');
      const f = e.target.dataset.f;
      if (!row || !f) return;
      const it = items[+row.dataset.i];
      const v = e.target.value;
      it[f] = f === 'est_minutes' ? Number(v) : f === 'day' ? v || null : v;
      if (f === 'company') {
        const wrap = e.target.closest('.tagwrap');
        wrap.className = `tagwrap c-${v}`;
        $('.dot', wrap).className = `dot c-${v}`;
      }
    });
    m.addEventListener('click', async (e) => {
      const rm = e.target.closest('[data-rm]');
      if (rm) {
        const row = rm.closest('.crow');
        items[+row.dataset.i] = null;
        row.remove();
        return label();
      }
      const act = e.target.closest('[data-do]')?.dataset.do;
      if (act === 'cancel') {
        closeModal();
        return resolve(0);
      }
      if (act === 'add') {
        addBtn.disabled = true;
        const res = await guard(() => api('tasks', { method: 'POST', body: { items: alive(), capture_id: parsed.capture_id, source: 'dictee' } }));
        closeModal();
        resolve(res ? res.created : 0);
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
  const left = d.tasks.filter((t) => t.status === 'todo');
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
  if (left.length) openTriage(left, { to: tomorrow, title: 'Préparer demain · ce qui reste', onDone: stepQuestions });
  else stepQuestions();
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
      const choice = await new Promise((r) => m.addEventListener('click', (e) => e.target.dataset.do && r(e.target.dataset.do)));
      closeModal();
      if (choice === 'drop') await guard(() => api(`inbox/${cap.id}`, { method: 'DELETE' }));
      else break;
    }
  }
  load();
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
  const m = openModal(
    `<h2>Réglages</h2>
     <h3>Calendrier</h3>${cal}<div id="cals"></div>
     <h3>Souper</h3>
     <div class="field two"><label><span>Heure</span><input type="time" id="s-sup" step="300" value="${toTimeInput(d.settings.supper_start)}"></label>
       <label><span>Durée</span><select id="s-supmin">${[30, 45, 60, 90].map((n) => `<option value="${n}"${n === d.settings.supper_min ? ' selected' : ''}>${fmtDur(n)}</option>`).join('')}</select></label></div>
     <h3>Dicter sans ouvrir l'app</h3>
     <p class="hint">Dans l'app Raccourcis de ton iPhone : « Dicter du texte », puis « Obtenir le contenu de l'URL » en méthode POST, corps JSON avec la clé <code>text</code>. Adresse à utiliser :</p>
     <div class="copy"><code id="inbox-url">${esc(inboxUrl)}</code><button class="btn ghost" data-do="copy">Copier</button></div>
     <p class="hint">Cette adresse contient ton lien privé. Ne la partage pas.</p>
     <div class="foot"><button class="btn ghost" data-act="close">Fermer</button><span class="grow"></span><button class="btn" data-do="save">Enregistrer</button></div>`,
    { wide: true },
  );
  m.addEventListener('click', async (e) => {
    const act = e.target.closest('[data-do]')?.dataset.do;
    if (act === 'copy') {
      try {
        await navigator.clipboard.writeText(inboxUrl);
        toast('Adresse copiée.');
      } catch {
        getSelection().selectAllChildren($('#inbox-url', m));
      }
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
      await guard(() => api('settings', { method: 'PUT', body: { supper_start: fromTimeInput($('#s-sup', m).value) ?? 1080, supper_min: Number($('#s-supmin', m).value) } }));
      await guard(() => api('plan', { method: 'POST', body: { date: S.date } }));
      closeModal();
      load();
    }
  });
}

// ---- Cocher ----

function celebrate(el) {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const r = el.getBoundingClientRect();
  const colors = ['var(--robiii)', 'var(--immo)', 'var(--perso)', 'var(--accent)', 'var(--sun)'];
  for (let i = 0; i < 26; i++) {
    const p = document.createElement('i');
    p.className = 'confetti';
    const a = (Math.PI * 2 * i) / 26 + Math.random() * 0.4;
    const dist = 60 + Math.random() * 90;
    p.style.cssText = `left:${r.left + 12}px;top:${r.top + 12}px;background:${colors[i % 5]};--dx:${Math.cos(a) * dist}px;--dy:${Math.sin(a) * dist - 40}px;--rot:${Math.random() * 540 - 270}deg`;
    document.body.append(p);
    setTimeout(() => p.remove(), 1100);
  }
}

async function toggleCheck(id, rowEl) {
  const t = S.data.tasks.find((x) => x.id === id);
  if (!t) return;
  const toDone = t.status !== 'done';
  if (toDone) {
    rowEl.classList.add('checking');
    $('.cb', rowEl).classList.add('on');
    navigator.vibrate?.(toDone && (t.section === 'priorite' || isAvoided(t)) ? [18, 40, 28] : 12);
    if (t.section === 'priorite' || isAvoided(t)) celebrate($('.cb', rowEl));
  }
  const saved = api(`tasks/${id}`, { method: 'PATCH', body: { status: toDone ? 'done' : 'todo' } });
  await Promise.all([guard(() => saved), new Promise((r) => setTimeout(r, toDone ? 520 : 0))]);
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
  if (kind === 'section' && val !== t.section) body = { section: val };
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
  if (e.key === 'Enter' && e.target.matches('[data-act="edit"]')) e.target.click();
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
  if (document.visibilityState === 'visible' && S.data && !modalRoot.firstChild && !drag) load(S.date === S.data.today ? null : S.date);
});

if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
load();
