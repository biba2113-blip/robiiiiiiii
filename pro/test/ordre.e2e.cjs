// L'ordre de la journée à l'écran : raisons, flèches, glisser devant une autre, cocher depuis l'horaire,
// filtre par entreprise, vue « Dans l'ordre » sur iPhone. Demande Playwright (hors des dépendances du projet).
// Serveur local avec une base semée de quelques tâches : npx wrangler dev --local --port 8790
// Le parcours se joue sur la feuille de demain, pour ne pas dépendre de l'heure qu'il est.
const SHOTS = process.env.SHOTS || require('os').tmpdir();
const { chromium } = require('playwright');
const assert = require('assert');
const URL = 'http://localhost:8790/k/dev/';
(async () => {
  const b = await chromium.launch();
  const errs = [];
  const open = async (vp) => {
    const ctx = await b.newContext({ viewport: vp, deviceScaleFactor: 2, hasTouch: vp.width < 500, serviceWorkers: 'block' });
    const p = await ctx.newPage();
    p.on('pageerror', (e) => errs.push(e.message));
    p.on('console', (m) => m.type() === 'error' && errs.push(m.text()));
    await p.goto(URL, { waitUntil: 'networkidle' });
    await p.waitForSelector('.box');
    return p;
  };
  const api = (p, path, method = 'GET', body) => p.evaluate(async ([path, method, body]) => (await fetch('api/' + path, { method, headers: body ? { 'content-type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined })).json(), [path, method, body]);
  const order = (p) => p.locator('.horaire .blk.task .tt').allInnerTexts();
  const settle = async (p) => { await p.waitForLoadState('networkidle'); await p.waitForTimeout(250); };

  const mac = await open({ width: 1280, height: 900 });
  const today = (await api(mac, 'sheet')).today;
  const tomorrow = new Date(Date.parse(today + 'T12:00:00Z') + 86400000).toISOString().slice(0, 10);
  await api(mac, 'tasks', 'POST', {
    items: [
      { title: 'Ranger le bureau', day: tomorrow, est_minutes: 30, company: 'perso' },
      { title: 'Payer les taxes', day: tomorrow, est_minutes: 30, company: 'robiii', nature: 'obligation', section: 'priorite' },
      { title: 'Rappeler Julie', day: tomorrow, est_minutes: 10, company: 'immo', section: 'rappel' },
      { title: 'Envoyer la soumission', day: tomorrow, est_minutes: 30, company: 'immo', nature: 'avance' },
    ],
  });
  await mac.click('[data-act="next"]');
  await mac.waitForFunction(() => document.querySelectorAll('.horaire .blk.task').length === 4);

  // 1. L'ordre de Pro, avec le mot qui l'explique.
  assert.deepEqual(await order(mac), ['Payer les taxes', 'Appel : Rappeler Julie', 'Envoyer la soumission', 'Ranger le bureau']);
  const smalls = await mac.locator('.horaire .blk.task small').allInnerTexts();
  assert.match(smalls[0], /Obligation/);
  assert.match(smalls[1], /Quelqu’un attend/);
  assert.match(smalls[2], /Fait avancer/);
  assert.ok(await mac.locator('.horaire .blk.task').first().locator('[data-act="up"]').isDisabled(), 'la première ne monte pas');
  assert.ok(await mac.locator('.horaire .blk.task').last().locator('[data-act="down"]').isDisabled(), 'la dernière ne descend pas');
  assert.equal(await mac.locator('[data-act="auto-order"]').count(), 0);

  // 2. Les flèches : monter la dernière deux fois.
  const up = async (title) => { await mac.locator('.horaire .blk.task', { hasText: title }).locator('[data-act="up"]').click(); await settle(mac); };
  await up('Ranger le bureau');
  assert.deepEqual(await order(mac), ['Payer les taxes', 'Appel : Rappeler Julie', 'Ranger le bureau', 'Envoyer la soumission']);
  await up('Ranger le bureau');
  assert.deepEqual(await order(mac), ['Payer les taxes', 'Ranger le bureau', 'Appel : Rappeler Julie', 'Envoyer la soumission']);
  assert.match(await mac.locator('.horaire .blk.task', { hasText: 'Ranger le bureau' }).locator('small').innerText(), /Placée par toi/);
  await mac.screenshot({ path: SHOTS + '/ordre-mac.png' });

  // 3. Glisser une tâche sur une autre : elle se range juste avant.
  const grip = await mac.locator('.horaire .blk.task', { hasText: 'Envoyer la soumission' }).locator('.grip').boundingBox();
  const target = await mac.locator('.horaire .hr', { hasText: 'Payer les taxes' }).boundingBox();
  await mac.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2);
  await mac.mouse.down();
  await mac.mouse.move(target.x + 200, target.y + target.height / 2, { steps: 8 });
  await mac.mouse.up();
  await settle(mac);
  assert.deepEqual(await order(mac), ['Envoyer la soumission', 'Payer les taxes', 'Ranger le bureau', 'Appel : Rappeler Julie']);

  // 4. Une nouvelle tâche arrive à la fin : elle ne bouscule pas l'ordre choisi.
  await api(mac, 'tasks', 'POST', { items: [{ title: 'Remettre la TPS', day: tomorrow, est_minutes: 30, company: 'robiii', nature: 'obligation' }] });
  await mac.click('[data-act="replan"]');
  await settle(mac);
  assert.equal((await order(mac)).at(-1), 'Remettre la TPS');

  // 5. Reprendre l'ordre proposé par Pro.
  await mac.click('[data-act="auto-order"]');
  await settle(mac);
  assert.deepEqual(await order(mac), ['Payer les taxes', 'Remettre la TPS', 'Appel : Rappeler Julie', 'Envoyer la soumission', 'Ranger le bureau']);
  assert.equal(await mac.locator('[data-act="auto-order"]').count(), 0);

  // 6. Cocher depuis l'horaire.
  await mac.locator('.horaire .blk.task', { hasText: 'Remettre la TPS' }).locator('.cb').click();
  await mac.waitForFunction(() => document.querySelectorAll('.horaire .blk.task').length === 4);
  assert.match(await mac.locator('.prog').innerText(), /1 sur 5/);

  // 7. Le filtre par entreprise.
  assert.match(await mac.locator('.fchip[data-v="immo"]').innerText(), /ImmoMulti\s*2/);
  await mac.click('.fchip[data-v="immo"]');
  assert.deepEqual(await order(mac), ['Appel : Rappeler Julie', 'Envoyer la soumission']);
  assert.equal(await mac.locator('.boxes .row').count(), 2, 'les sections ne montrent que ImmoMulti');
  assert.equal(await mac.locator('.horaire .blk.free').count(), 0);
  assert.match(await mac.locator('.prog').innerText(), /1 sur 5/, 'le compte de la journée reste entier');
  await mac.screenshot({ path: SHOTS + '/ordre-filtre-mac.png' });
  await mac.click('.fchip[data-v=""]');
  assert.equal((await order(mac)).length, 4);

  // 8. Démarrer le chrono depuis la fiche d'une tâche d'aujourd'hui.
  await mac.click('[data-act="today"]');
  await settle(mac);
  await mac.locator('.boxes .row:not(.done) .more').first().click();
  await mac.click('.modal [data-do="focus"]');
  await mac.waitForSelector('.nowbar');
  await mac.click('.nowbar [data-act="stop"]');
  await mac.waitForSelector('.nowbar', { state: 'detached' });

  // 9. iPhone : la journée dans l'ordre d'abord, les sections ensuite ; le choix reste.
  const phone = await open({ width: 390, height: 844 });
  await phone.click('[data-act="next"]');
  await phone.waitForSelector('.horaire .blk.task');
  await settle(phone);
  const y = async (sel) => (await phone.locator(sel).first().boundingBox()).y;
  assert.ok((await y('.horaire')) < (await y('.boxes')), "l'horaire est en premier");
  assert.ok((await phone.evaluate(() => document.documentElement.scrollWidth)) <= 390, 'pas de défilement horizontal');
  await phone.screenshot({ path: SHOTS + '/ordre-iphone.png' });
  await phone.click('.views [data-v="sections"]');
  assert.ok((await y('.horaire')) > (await y('.boxes')), 'les sections passent devant');
  await phone.reload({ waitUntil: 'networkidle' });
  await phone.waitForSelector('.views');
  assert.ok(await phone.locator('.views [data-v="sections"].on').count(), 'le choix est gardé sur l’appareil');
  await phone.click('.views [data-v="ordre"]');
  // Les flèches au doigt.
  await phone.click('[data-act="next"]');
  await phone.waitForSelector('.horaire .blk.task');
  await settle(phone);
  const before = await order(phone);
  await phone.locator('.horaire .blk.task').nth(1).locator('[data-act="up"]').tap();
  await settle(phone);
  const after = await order(phone);
  assert.deepEqual(after.slice(0, 2), [before[1], before[0]]);

  await b.close();
  assert.deepEqual(errs, []);
  console.log('Ordre : parcours réussi sur Mac et iPhone simulés.');
})().catch((e) => { console.error(e); process.exit(1); });
