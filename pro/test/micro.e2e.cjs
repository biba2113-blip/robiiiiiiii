// Le bouton micro à l'écran, sur un Mac et un iPhone simulés, avec un faux micro. Demande Playwright (hors des dépendances du projet).
// Serveur local sans lien distant : npm run migrate:local && npx wrangler dev --local --port 8790
// La transcription elle-même (Whisper) n'est pas appelée ici : sa réponse est simulée.
const SHOTS = process.env.SHOTS || require('os').tmpdir();
const { chromium } = require('playwright');
const assert = require('assert');
const URL = 'http://localhost:8790/k/dev/';
const SAID = 'Rappeler Marc pour la visite du triplex, payer la facture du plombier avant jeudi';

(async () => {
  const b = await chromium.launch({ args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] });
  const errors = [];
  const mk = async (vp, { mic = true } = {}) => {
    const ctx = await b.newContext({ viewport: vp, deviceScaleFactor: 2, hasTouch: vp.width < 500, serviceWorkers: 'block', permissions: mic ? ['microphone'] : [] });
    const p = await ctx.newPage();
    p.on('console', (m) => m.type() === 'error' && !/502|Failed to load resource/.test(m.text()) && errors.push(m.text()));
    p.on('pageerror', (e) => errors.push(e.message));
    await p.goto(URL, { waitUntil: 'networkidle' });
    await p.waitForSelector('.box');
    return p;
  };

  for (const [name, vp] of [['mac', { width: 1280, height: 900 }], ['iphone', { width: 390, height: 844 }]]) {
    const p = await mk(vp);
    const sent = [];
    await p.route('**/api/transcribe', async (route) => {
      const req = route.request();
      sent.push({ type: req.headers()['content-type'], bytes: req.postDataBuffer()?.length || 0 });
      await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ text: SAID, seconds: 3 }) });
    });

    // 1. Le bouton est là, au repos.
    await p.waitForSelector('.mic[data-act="mic"]');
    assert.equal(await p.locator('.mic.rec').count(), 0);
    const box = await p.locator('.capture').boundingBox();
    assert.ok(box.width <= vp.width, 'la boîte ne déborde pas de l’écran');

    // 2. Un tap : ça enregistre, le temps avance.
    await p.click('.mic');
    await p.waitForSelector('.mic.rec');
    await p.waitForFunction(() => document.querySelector('.mic-time')?.textContent === '0:02');
    await p.screenshot({ path: `${SHOTS}/micro-enregistre-${name}.png` });

    // 3. Un second tap : l'audio part, le texte revient et va droit à la confirmation.
    await p.click('.mic.rec');
    await p.waitForSelector('.ccard');
    assert.equal(sent.length, 1, 'un seul envoi');
    assert.match(sent[0].type, /^audio\//, 'le corps est bien de l’audio');
    assert.ok(sent[0].bytes > 600, `enregistrement non vide (${sent[0].bytes} octets)`);
    assert.equal(await p.locator('.ccard').count(), 2, 'les deux tâches dictées sont comprises');
    assert.equal(await p.locator('.mic.rec, .mic.busy').count(), 0, 'le micro est revenu au repos');
    await p.screenshot({ path: `${SHOTS}/micro-confirmation-${name}.png` });

    // 4. Fermer sans ajouter : le texte dicté reste dans la boîte, rien n'est perdu.
    await p.keyboard.press('Escape');
    await p.waitForSelector('.veil', { state: 'detached' });
    assert.equal(await p.inputValue('#capture-text'), SAID);

    // 5. Dicter encore : le nouveau texte s'ajoute à la suite.
    await p.click('.mic');
    await p.waitForFunction(() => document.querySelector('.mic-time')?.textContent === '0:01');
    await p.click('.mic.rec');
    await p.waitForSelector('.ccard');
    await p.keyboard.press('Escape');
    await p.waitForSelector('.veil', { state: 'detached' });
    assert.equal(await p.inputValue('#capture-text'), `${SAID} ${SAID}`);

    // 6. Trop court : rien n'est envoyé.
    await p.fill('#capture-text', '');
    await p.click('.mic');
    await p.waitForSelector('.mic.rec');
    await p.click('.mic.rec');
    await p.waitForFunction(() => /Trop court/.test(document.querySelector('#toast')?.textContent || ''));
    assert.equal(sent.length, 2, 'pas d’envoi pour un enregistrement trop court');
    await p.waitForSelector('.mic[data-act="mic"]:not(.rec)');

    // 7. La transcription en panne (le serveur local n'a pas Whisper) : un message clair, le micro revient.
    await p.unroute('**/api/transcribe');
    await p.click('.mic');
    await p.waitForFunction(() => document.querySelector('.mic-time')?.textContent === '0:01');
    await p.click('.mic.rec');
    await p.waitForFunction(() => /transcription n’a pas fonctionné/.test(document.querySelector('#toast')?.textContent || ''));
    await p.waitForSelector('.mic[data-act="mic"]:not(.rec)');
    assert.equal(await p.locator('.veil').count(), 0);
    await p.context().close();
  }

  // 8. Micro refusé : un message, pas d'enregistrement.
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
  const p = await ctx.newPage();
  await p.addInitScript(() => {
    navigator.mediaDevices.getUserMedia = () => Promise.reject(new DOMException('refusé', 'NotAllowedError'));
  });
  await p.goto(URL, { waitUntil: 'networkidle' });
  await p.click('.mic');
  await p.waitForFunction(() => /Autorise le micro/.test(document.querySelector('#toast')?.textContent || ''));
  assert.equal(await p.locator('.mic.rec').count(), 0);

  await b.close();
  assert.deepEqual(errors, [], 'aucune erreur dans la console');
  console.log('Micro : parcours réussi sur Mac et iPhone simulés.');
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
