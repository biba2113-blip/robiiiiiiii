// Le moment où on coche, sur iPhone simulé : tâche ordinaire, priorité, dernière tâche de la feuille, son.
// Puis « Réduire les animations » et la mise à jour automatique. Demande Playwright (hors des dépendances du projet).
// Serveur local avec une base semée de quelques tâches : npx wrangler dev --local --port 8790
const { chromium } = require('playwright');
const assert = require('assert');
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, serviceWorkers: 'block' });
  const p = await ctx.newPage();
  const errs = []; p.on('pageerror', (e) => errs.push(e.message)); p.on('console', (m) => m.type() === 'error' && errs.push(m.text()));
  await p.addInitScript(() => { window.__notes = 0; const C = window.AudioContext; const o = C.prototype.createOscillator; C.prototype.createOscillator = function () { window.__notes++; return o.call(this); }; });
  await p.goto('http://localhost:8790/k/dev/', { waitUntil: 'networkidle' });
  await p.waitForSelector('.row');
  const SHOTS = process.env.SHOTS || require('os').tmpdir();
  const shot = (n) => p.screenshot({ path: `${SHOTS}/cocher-${n}.png` });

  // Une tâche ordinaire (section « À faire »)
  const row = p.locator('.box[data-drop="section:faire"] .row:not(.done)').first();
  await row.locator('.cb').click();
  await p.waitForTimeout(140); await shot('1-rebond');
  await p.waitForTimeout(260); await shot('2-raye');
  assert.match(await p.locator('#toast').textContent(), /sur \d+\.|Plus qu|moitié/);
  assert.equal(await p.evaluate(() => window.__notes), 2, 'deux notes pour une tâche ordinaire');
  await p.waitForTimeout(1200);

  // Une priorité : plus de notes, plus de confettis
  const prio = p.locator('.box[data-drop="section:priorite"] .row:not(.done)').first();
  await prio.locator('.cb').click();
  await p.waitForTimeout(220); await shot('3-priorite');
  assert.equal(await p.evaluate(() => window.__notes), 6, 'quatre notes de plus pour une priorité');
  assert.ok((await p.locator('.confetti').count()) >= 30);
  await p.waitForTimeout(1400);

  // Tout cocher : la dernière déclenche la pluie
  for (;;) {
    const left = await p.locator('.boxes .row:not(.done) .cb').count();
    if (!left) break;
    await p.locator('.boxes .row:not(.done) .cb').first().click();
    if (left === 1) { await p.waitForTimeout(700); await shot('4-feuille-terminee'); assert.match(await p.locator('#toast').textContent(), /Feuille terminée/); assert.ok((await p.locator('.confetti.fall').count()) > 50); }
    await p.waitForTimeout(1300);
  }
  assert.ok(await p.locator('.prog.full').count(), 'la barre reste verte quand tout est fait');
  await shot('5-apres');

  // Le son se coupe dans les réglages
  await p.click('[data-act="settings"]');
  await p.uncheck('#s-sound');
  assert.equal(await p.evaluate(() => localStorage.getItem('pro_son')), '0');
  assert.match(await p.locator('.modal').innerText(), /Mise en ligne/);
  await ctx.close();

  // Appareil réglé sur « Réduire les animations » : pas de confettis, sauf si on les demande dans ⚙.
  const calmCtx = await b.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, serviceWorkers: 'block', reducedMotion: 'reduce' });
  const q = await calmCtx.newPage();
  q.on('pageerror', (e) => errs.push(e.message));
  await q.goto('http://localhost:8790/k/dev/', { waitUntil: 'networkidle' });
  assert.ok(await q.evaluate(() => document.documentElement.classList.contains('calm')));
  const undo = async () => { await q.locator('.boxes .row.done .cb').first().click(); await q.waitForSelector('.boxes .row:not(.done) .cb'); };
  await undo();
  await q.locator('.boxes .row:not(.done) .cb').first().click();
  await q.waitForTimeout(150);
  assert.equal(await q.locator('.confetti').count(), 0, 'aucun confetti quand l’appareil réduit les animations');
  await q.waitForTimeout(1300);
  await q.click('[data-act="settings"]');
  assert.match(await q.locator('.modal').innerText(), /Réduire les animations/);
  await q.check('#s-anim');
  assert.ok((await q.locator('.confetti').count()) >= 30, 'un aperçu des confettis dès qu’on coche la case');
  assert.ok(!(await q.evaluate(() => document.documentElement.classList.contains('calm'))));
  await q.keyboard.press('Escape');
  await undo();
  await q.waitForTimeout(1200);
  await q.locator('.boxes .row:not(.done) .cb').first().click();
  await q.waitForTimeout(150);
  assert.ok((await q.locator('.confetti').count()) >= 12, 'les confettis reviennent une fois demandés');
  await q.waitForTimeout(1300);
  await calmCtx.close();

  // Une nouvelle version est mise en ligne pendant que l'app est ouverte : elle se recharge seule, sauf si tu écris.
  const upCtx = await b.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
  const u = await upCtx.newPage();
  let version = 'v1';
  await u.route('**/api/sheet*', async (route) => {
    const res = await route.fetch();
    await route.fulfill({ response: res, json: { ...(await res.json()), version } });
  });
  await u.goto('http://localhost:8790/k/dev/', { waitUntil: 'networkidle' });
  await u.evaluate(() => { window.__same = true; });
  version = 'v2';
  await u.fill('#capture-text', 'une idée en cours');
  await u.click('[data-act="next"]');
  await u.waitForTimeout(600);
  assert.equal(await u.evaluate(() => window.__same), true, 'pas de rechargement pendant que tu écris');
  assert.equal(await u.inputValue('#capture-text'), 'une idée en cours');
  await u.fill('#capture-text', '');
  await u.click('[data-act="prev"]');
  await u.waitForFunction(() => window.__same === undefined);
  await u.waitForSelector('.box');
  await upCtx.close();

  await b.close();
  assert.deepEqual(errs, []);
  console.log('Cocher : tout passe.');
})().catch((e) => { console.error(e); process.exit(1); });
