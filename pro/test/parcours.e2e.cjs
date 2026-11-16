// Parcours complet à l'écran, sur un Mac et un iPhone simulés. Demande Playwright (hors des dépendances du projet).
// 1) base locale vide + serveur : npm run migrate:local && npm run dev
// 2) semer quelques tâches, puis : node test/parcours.e2e.cjs
// Les captures vont dans le dossier donné par SHOTS (par défaut : le dossier temporaire du système).
const SHOTS = process.env.SHOTS || require('os').tmpdir();
const { chromium } = require('playwright');
const assert = require('assert');
const URL = 'http://localhost:8790/k/dev/';
(async () => {
  const b = await chromium.launch();
  const errors = [];
  const mk = async (vp, scheme = 'light') => {
    const ctx = await b.newContext({ viewport: vp, colorScheme: scheme, deviceScaleFactor: 2, hasTouch: vp.width < 500, serviceWorkers: 'block' });
    const p = await ctx.newPage();
    p.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
    p.on('pageerror', (e) => errors.push(e.message));
    await p.goto(URL, { waitUntil: 'networkidle' });
    await p.waitForSelector('.box');
    return p;
  };
  const api = async (p, path, method = 'GET', body) => p.evaluate(async ([path, method, body]) => (await fetch('api/' + path, { method, headers: body ? { 'content-type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined })).json(), [path, method, body]);

  // --- Mac ---
  const mac = await mk({ width: 1280, height: 900 });

  // 1. Vider ma tête -> confirmation -> ajout
  await mac.fill('#capture-text', 'Rappeler Marc pour la visite, payer la facture du plombier avant jeudi, commande du détaillant demain');
  await mac.click('.send');
  await mac.waitForSelector('.ccard');
  assert.equal(await mac.locator('.ccard').count(), 3, 'trois tâches comprises');
  await mac.locator('.ccard').nth(0).locator('[data-toggle]').click();
  await mac.locator('.ccard.open [data-chips="company"] [data-v="immo"]').click();
  await mac.waitForTimeout(380); await mac.screenshot({ path: SHOTS + '/2-confirmation-mac.png' });
  await mac.click('[data-do="add"]');
  await mac.waitForSelector('.veil', { state: 'detached' });
  await mac.waitForFunction(() => document.querySelectorAll('.boxes .row').length >= 10);
  let sheet = await api(mac, 'sheet');
  const marc = sheet.tasks.find((t) => /Marc/.test(t.title));
  assert.equal(marc.company, 'immo', "l'étiquette changée est enregistrée");
  assert.equal(marc.section, 'rappel');
  assert.ok(!sheet.tasks.find((t) => /détaillant/.test(t.title)), 'la tâche dite « demain » n’est pas sur aujourd’hui');

  // 2. Cocher : la ligne se raye puis descend en bas de sa section
  const firstPrio = mac.locator('.box[data-drop="section:priorite"] .row').first();
  const prioTitle = await firstPrio.locator('.tt').textContent();
  await firstPrio.locator('.cb').click();
  await mac.waitForFunction((t) => { const rows = [...document.querySelectorAll('.box[data-drop="section:priorite"] .row')]; return rows.length && rows[rows.length - 1].classList.contains('done') && rows[rows.length - 1].textContent.includes(t); }, prioTitle);
  assert.match(await mac.locator('.prog span').textContent(), /^1 sur/);

  // 3. Glisser une tâche de « À faire » vers « À rappeler »
  const src = mac.locator('.box[data-drop="section:faire"] .row').first();
  const moved = await src.locator('.tt').textContent();
  const grip = await src.locator('.grip').boundingBox();
  const dst = await mac.locator('.box[data-drop="section:rappel"]').boundingBox();
  await mac.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2);
  await mac.mouse.down();
  await mac.mouse.move(dst.x + 80, dst.y + 60, { steps: 12 });
  await mac.waitForTimeout(380); await mac.screenshot({ path: SHOTS + '/3-glisser-mac.png' });
  await mac.mouse.up();
  await mac.waitForFunction((t) => document.querySelector('.box[data-drop="section:rappel"]').textContent.includes(t), moved);

  // 4. Glisser une tâche sur une heure de l'horaire : elle prend cette heure et ne bouge plus
  const src2 = mac.locator('.box[data-drop="section:faire"] .row').first();
  const id2 = Number(await src2.getAttribute('data-id'));
  const g2 = await src2.locator('.grip').boundingBox();
  const slot = mac.locator('.hr:has(.blk.free)').first();
  const slotTime = Number((await slot.getAttribute('data-drop')).split(':')[1]);
  const sb = await slot.boundingBox();
  await mac.mouse.move(g2.x + 4, g2.y + 4);
  await mac.mouse.down();
  await mac.mouse.move(sb.x + 200, sb.y + 20, { steps: 12 });
  await mac.mouse.up();
  await mac.waitForTimeout(600);
  sheet = await api(mac, 'sheet');
  const pinned = sheet.tasks.find((t) => t.id === id2);
  assert.equal(pinned.start_min, slotTime, 'la tâche a pris l’heure visée');
  assert.equal(pinned.pinned, 1);
  const todo = sheet.tasks.filter((t) => t.status === 'todo' && t.start_min != null).sort((a, b) => a.start_min - b.start_min);
  for (let i = 1; i < todo.length; i++) assert.ok(todo[i].start_min >= todo[i - 1].start_min + todo[i - 1].est_minutes, 'aucun chevauchement après le déplacement');

  // 5. Modifier : durée et jour
  await mac.locator('.box[data-drop="section:priorite"] .row .t').first().click();
  await mac.waitForSelector('.modal');
  await mac.waitForTimeout(380); await mac.screenshot({ path: SHOTS + '/4-modifier-mac.png' });
  await mac.click('[data-chips="dur"] [data-v="60"]');
  await mac.click('[data-do="save"]');
  await mac.waitForSelector('.veil', { state: 'detached' });
  await mac.waitForTimeout(400);
  await mac.waitForTimeout(380); await mac.screenshot({ path: SHOTS + '/1-feuille-mac.png', fullPage: false });

  // --- iPhone ---
  const ph = await mk({ width: 390, height: 844 });
  await ph.waitForTimeout(380); await ph.screenshot({ path: SHOTS + '/5-feuille-iphone.png' });
  const order = await ph.evaluate(() => [...document.querySelectorAll('.grid .box h2')].map((h) => ({ t: h.firstChild.textContent.trim(), y: h.getBoundingClientRect().top })).sort((a, b) => a.y - b.y).map((x) => x.t));
  assert.deepEqual(order, ['Priorités', 'À rappeler', 'À faire', "Ce que j'évite", 'Horaire'], 'sur iPhone, les priorités d’abord');

  // 6. Préparer demain : tri, questions, heures
  await ph.click('[data-act="evening"]');
  await ph.waitForSelector('.choices');
  await ph.waitForTimeout(380); await ph.screenshot({ path: SHOTS + '/6-tri-iphone.png' });
  const total = Number((await ph.locator('.step').textContent()).match(/sur (\d+)/)[1]);
  for (let i = 0; i < total; i++) {
    await ph.click(i === 1 ? '[data-do="reserve"]' : i === 2 ? '[data-do="delete"]' : '[data-do="report"]');
    await ph.waitForTimeout(60);
  }
  await ph.waitForSelector('textarea[data-q="0"]');
  await ph.fill('textarea[data-q="0"]', 'Le notaire');
  await ph.fill('textarea[data-q="3"]', 'Classer les reçus de Robiii');
  await ph.waitForTimeout(380); await ph.screenshot({ path: SHOTS + '/7-questions-iphone.png' });
  await ph.click('[data-do="next"]');
  await ph.waitForSelector('.ccard');
  await ph.click('[data-do="add"]');
  await ph.waitForSelector('#h-start');
  await ph.fill('#h-start', '07:30');
  await ph.check('#h-eve');
  await ph.waitForTimeout(380); await ph.screenshot({ path: SHOTS + '/8-heures-iphone.png' });
  await ph.click('[data-do="save"]');
  await ph.waitForSelector('.veil', { state: 'detached' });
  await ph.waitForFunction(() => /mardi/i.test(document.querySelector('h1').textContent));
  await ph.waitForTimeout(500);
  await ph.waitForTimeout(380); await ph.screenshot({ path: SHOTS + '/9-demain-iphone.png', fullPage: true });

  const tomorrowDate = sheet.today.replace(/\d\d$/, (d) => String(+d + 1).padStart(2, '0'));
  const tom = await api(ph, 'sheet?date=' + tomorrowDate);
  assert.equal(tom.day.work_start, 450);
  assert.equal(tom.day.evening_work, 1);
  assert.ok(tom.tasks.every((t) => t.status !== 'todo' || t.start_min == null || t.start_min >= 450), 'rien avant 7 h 30');
  assert.ok(tom.tasks.some((t) => t.pushed_count === 1), 'les reports sont comptés');
  assert.ok(tom.tasks.some((t) => /notaire/i.test(t.title)), 'les réponses aux questions sont sur la feuille de demain');
  const today2 = await api(ph, 'sheet');
  assert.equal(today2.tasks.filter((t) => t.status === 'todo').length, 0, 'plus rien à faire aujourd’hui après le tri');
  assert.equal(today2.reserve_count, 1, 'une tâche est partie dans la réserve');

  // 7. La réserve
  await ph.click('[data-act="reserve"]');
  await ph.waitForSelector('.rrow');
  await ph.waitForTimeout(380); await ph.screenshot({ path: SHOTS + '/10-reserve-iphone.png' });
  await ph.click('[data-act="close"]');


  // 8. Le lendemain matin : ce qui restait d'hier est proposé au tri, et une tâche reportée 2 fois arrive dans « Ce que j'évite »
  const ph2 = await mk({ width: 390, height: 844 }, 'dark');
  const t1 = (await api(ph2, 'sheet?date=' + tomorrowDate)).tasks.find((t) => t.pushed_count === 1 && t.status === 'todo');
  await api(ph2, 'triage', 'POST', { decisions: [{ id: t1.id, action: 'report' }], to: tomorrowDate });
  await api(ph2, 'inbox', 'POST', { text: 'rappeler le garage, acheter des timbres' });
  await ph2.goto(URL + '?', { waitUntil: 'networkidle' });
  await ph2.click('[data-act="next"]');
  await ph2.waitForFunction(() => /mardi/i.test(document.querySelector('h1').textContent));
  await ph2.waitForSelector('.avoid .row');
  assert.match(await ph2.locator('.avoid .row').first().textContent(), /Reportée 2 fois/);
  await ph2.locator('.avoid').scrollIntoViewIfNeeded();
  await ph2.waitForTimeout(300); await ph2.screenshot({ path: SHOTS + '/11-evite-iphone-sombre.png' });
  await ph2.click('[data-act="today"]');
  await ph2.waitForSelector('[data-act="inbox"]');
  await ph2.click('[data-act="inbox"]');
  await ph2.waitForSelector('.ccard');
  assert.equal(await ph2.locator('.ccard').count(), 2, 'la dictée du raccourci donne deux tâches');
  await ph2.waitForTimeout(380); await ph2.screenshot({ path: SHOTS + '/12-dictee-iphone-sombre.png' });
  await ph2.click('[data-do="add"]');
  await ph2.waitForSelector('.veil', { state: 'detached' });
  await ph2.waitForFunction(() => !document.querySelector('[data-act="inbox"]'));

  await b.close();
  console.log(errors.length ? 'ERREURS CONSOLE:\n' + errors.join('\n') : 'parcours complet réussi, aucune erreur console');
})().catch((e) => { console.error('ÉCHEC:', e.message); process.exit(1); });
