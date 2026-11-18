// Les moments hors travail à l'écran : dictée, boîte, horaire, coche, glisser, modification. Demande Playwright.
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

  const mac = await open({ width: 1280, height: 900 });
  const today = (await api(mac, 'sheet')).today;
  const tomorrow = new Date(Date.parse(today + 'T12:00:00Z') + 86400000).toISOString().slice(0, 10);
  // Trois tâches de travail pour demain, journée de 8 h à 18 h.
  await api(mac, 'tasks', 'POST', { items: ['Fermer le mois', 'Préparer la soumission', 'Valider le catalogue'].map((title) => ({ title, day: tomorrow, est_minutes: 60 })) });
  await mac.click('[data-act="next"]');
  await mac.waitForFunction(() => document.querySelectorAll('.horaire .blk.task').length === 3);
  const before = await api(mac, `sheet?date=${tomorrow}`);

  // 1. La boîte existe et explique quoi dire.
  assert.match(await mac.locator('.box.life').innerText(), /voir ma blonde de 17 h à 22 h/);

  // 2. Dictée : un moment avec une plage, un avec une heure, un sans heure.
  await mac.fill('#capture-text', 'Voir ma blonde de 17 h à 22 h. Gym à midi, une heure. Souper avec des amis.');
  await mac.click('.send');
  await mac.waitForSelector('.ccard');
  assert.equal(await mac.locator('.ccard.life').count(), 3);
  const cards = await mac.locator('.ccard').allInnerTexts();
  assert.match(cards[0], /Hors travail[\s\S]*17 h à 22 h/);
  assert.match(cards[1], /Hors travail[\s\S]*12 h à 13 h/);
  await mac.screenshot({ path: SHOTS + '/hors-travail-confirmation-mac.png' });
  await mac.click('[data-do="add"]');
  await mac.waitForSelector('.veil', { state: 'detached' });
  await mac.waitForFunction(() => document.querySelectorAll('.box.life .row').length === 3);

  // 3. L'horaire : deux blocs réservés, le travail rangé autour, rien après 17 h, le prévu inchangé.
  const after = await api(mac, `sheet?date=${tomorrow}`);
  assert.equal(before.summary.available - after.summary.available, 120, 'deux heures de travail en moins : midi à 13 h, et 17 h à 18 h');
  assert.equal(after.summary.planned, before.summary.planned, 'le temps prévu ne compte que le travail');
  const life = after.tasks.filter((t) => t.kind === 'vie');
  assert.deepEqual(life.map((t) => [t.title, t.start_min, t.est_minutes]).sort(), [['Gym', 720, 60], ['Souper avec des amis', null, 60], ['Voir ma blonde', 1020, 300]].sort());
  for (const t of after.tasks.filter((t) => t.kind !== 'vie' && t.start_min != null)) {
    const end = t.start_min + t.est_minutes;
    assert.ok(end <= 720 || (t.start_min >= 780 && end <= 1020), `« ${t.title} » évite le gym et s'arrête avant 17 h`);
  }
  assert.equal(await mac.locator('.horaire .blk.life').count(), 2);
  assert.equal(await mac.locator('.horaire .unplaced').count(), 0, 'le moment sans heure n’est pas « sans place à l’horaire »');
  assert.match(await mac.locator('.prog').innerText(), /0 sur 3/, 'le compte de la journée ne porte que sur le travail');
  await mac.screenshot({ path: SHOTS + '/hors-travail-feuille-mac.png' });

  // 4. Cocher un moment : une petite fête, le compte de travail ne bouge pas.
  await mac.locator('.box.life .row', { hasText: 'Gym' }).locator('.cb').click();
  await mac.waitForFunction(() => /Ça compte aussi/.test(document.querySelector('#toast').textContent));
  await mac.waitForFunction(() => document.querySelectorAll('.box.life .row.done').length === 1);
  assert.match(await mac.locator('.prog').innerText(), /0 sur 3/);

  // 5. Donner une heure au moment sans heure, par sa fiche : il réserve sa place.
  await mac.locator('.box.life .row', { hasText: 'Souper avec des amis' }).locator('.tt').click();
  await mac.waitForSelector('.modal');
  assert.ok(await mac.locator('#e-section').isHidden(), 'pas de section pour un moment hors travail');
  await mac.fill('#e-time', '14:00');
  await mac.fill('#e-end', '15:30');
  await mac.click('[data-do="save"]');
  await mac.waitForFunction(() => document.querySelectorAll('.horaire .blk.life').length === 2); // le gym est coché, donc blonde + souper
  const amis = (await api(mac, `sheet?date=${tomorrow}`)).tasks.find((t) => /amis/.test(t.title));
  assert.deepEqual([amis.start_min, amis.est_minutes, amis.pinned], [840, 90, 1]);

  // 6. Une tâche de travail passe hors travail par sa fiche, puis revient.
  await mac.locator('.boxes .row', { hasText: 'Valider le catalogue' }).locator('.more').click();
  await mac.locator('.modal [data-chips="kind"] [data-v="vie"]').click();
  assert.ok(await mac.locator('#e-section').isHidden());
  await mac.click('[data-do="save"]');
  await mac.waitForFunction(() => /Valider le catalogue/.test(document.querySelector('.box.life').textContent));
  assert.match(await mac.locator('.prog').innerText(), /0 sur 2/);
  await mac.locator('.box.life .row', { hasText: 'Valider le catalogue' }).locator('.more').click();
  await mac.locator('.modal [data-chips="kind"] [data-v="tache"]').click();
  await mac.click('[data-do="save"]');
  await mac.waitForFunction(() => !/Valider le catalogue/.test(document.querySelector('.box.life').textContent));
  assert.match(await mac.locator('.prog').innerText(), /0 sur 3/);
  const back = (await api(mac, `sheet?date=${tomorrow}`)).tasks.find((t) => /Valider/.test(t.title));
  assert.deepEqual([back.kind, back.est_minutes], ['tache', 60], 'l’aller-retour ne change pas la durée');
  assert.ok(back.start_min != null, 'la tâche retrouve une place à l’horaire');

  // 6 bis. Modifier une tâche sans heure ne lui en invente pas une (un champ vide n'est pas minuit).
  await mac.click('[data-act="reserve"]');
  await mac.waitForSelector('.modal');
  await mac.keyboard.press('Escape');
  const lone = (await api(mac, 'tasks', 'POST', { items: [{ title: 'Tâche sans heure', day: tomorrow, est_minutes: 600 }] })) && (await api(mac, `sheet?date=${tomorrow}`)).tasks.find((t) => t.title === 'Tâche sans heure');
  assert.equal(lone.start_min, null, 'dix heures de travail ne rentrent pas : pas de place');
  await mac.click('[data-act="today"]');
  await mac.click('[data-act="next"]');
  await mac.locator('.horaire .unplaced .blk', { hasText: 'Tâche sans heure' }).click();
  await mac.fill('#e-title', 'Tâche sans heure, renommée');
  await mac.click('[data-do="save"]');
  await mac.waitForFunction(() => /renommée/.test(document.querySelector('.horaire').textContent));
  const renamed = (await api(mac, `sheet?date=${tomorrow}`)).tasks.find((t) => /renommée/.test(t.title));
  assert.deepEqual([renamed.start_min, renamed.pinned, renamed.est_minutes], [null, 0, 600]);
  await api(mac, `tasks/${renamed.id}`, 'DELETE');

  // 7. iPhone : la boîte et les blocs s'affichent sans déborder.
  const phone = await open({ width: 390, height: 844 });
  await phone.click('[data-act="next"]');
  await phone.waitForSelector('.box.life .row');
  await phone.waitForLoadState('networkidle');
  await phone.waitForTimeout(300);
  assert.ok((await phone.evaluate(() => document.documentElement.scrollWidth)) <= 390, 'pas de défilement horizontal');
  await phone.locator('.box.life').scrollIntoViewIfNeeded();
  await phone.screenshot({ path: SHOTS + '/hors-travail-iphone.png' });
  await phone.locator('.horaire').scrollIntoViewIfNeeded();
  await phone.screenshot({ path: SHOTS + '/hors-travail-horaire-iphone.png' });

  await b.close();
  assert.deepEqual(errs, []);
  console.log('Hors travail : parcours réussi sur Mac et iPhone simulés.');
})().catch((e) => { console.error(e); process.exit(1); });
