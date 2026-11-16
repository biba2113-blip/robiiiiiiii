#!/usr/bin/env node
// L'assistant du Mac de Pro.
// Chaque minute, il note quelle app est au premier plan (et le site, dans un navigateur) et l'envoie à Pro.
// Il ne lit ni le contenu des fenêtres ni ce que tu tapes.
// Quand ton budget hors feuille est épuisé, il affiche un rappel avec trois choix.
//
// Écrit pour macOS. Lancé par npm run assistant:install, qui le garde en marche.
import { execFile } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';

const CONFIG = path.join(homedir(), '.pro-assistant.json');
const TICK_MS = 60_000;
const IDLE_SECONDS = 120; // après 2 minutes sans clavier ni souris, la minute ne compte pas

let base;
try {
  base = JSON.parse(readFileSync(CONFIG, 'utf8')).url;
  if (!/^https?:\/\/.+\/k\/[^/]+\/$/.test(base)) throw new Error('lien invalide');
} catch (err) {
  console.error(`Configuration introuvable ou invalide (${CONFIG}) : ${err.message}. Lance : npm run assistant:install`);
  process.exit(1);
}
const proHost = new URL(base).host;

const run = (cmd, args, timeout = 8000) =>
  new Promise((resolve) => {
    execFile(cmd, args, { timeout }, (err, stdout) => resolve(err ? '' : String(stdout).trim()));
  });
const osa = (script, timeout) => run('osascript', ['-e', script], timeout);

async function post(route, body) {
  try {
    const res = await fetch(base + 'api/' + route, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    });
    return res.ok ? await res.json() : null;
  } catch {
    return null; // hors ligne : on réessaiera à la prochaine minute
  }
}

/** Secondes depuis le dernier geste au clavier ou à la souris. */
async function idleSeconds() {
  const out = await run('ioreg', ['-c', 'IOHIDSystem']);
  const m = out.match(/"HIDIdleTime"\s*=\s*(\d+)/);
  return m ? Number(m[1]) / 1e9 : 0;
}

// Comment demander l'adresse de l'onglet actif à chaque navigateur.
const BROWSERS = {
  Safari: 'tell application "Safari" to get URL of front document',
  'Google Chrome': 'tell application "Google Chrome" to get URL of active tab of front window',
  'Brave Browser': 'tell application "Brave Browser" to get URL of active tab of front window',
  'Microsoft Edge': 'tell application "Microsoft Edge" to get URL of active tab of front window',
  Arc: 'tell application "Arc" to get URL of active tab of front window',
  Vivaldi: 'tell application "Vivaldi" to get URL of active tab of front window',
};

async function frontmost() {
  const app = await osa('tell application "System Events" to get name of first application process whose frontmost is true');
  let site = '';
  if (BROWSERS[app]) {
    const url = await osa(BROWSERS[app]);
    try {
      site = new URL(url).host;
    } catch {
      site = '';
    }
  }
  return { app, site };
}

let prompting = false;

/** Le rappel : une fenêtre au premier plan, trois choix, qui se ferme seule après 30 secondes. */
async function remind(info) {
  if (prompting) return;
  prompting = true;
  const esc = (s) => String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  const left = info.remaining?.length ? `\n\nIl te reste : ${info.remaining.join(' · ')}.` : '';
  const text = `${info.off_minutes} minutes hors feuille aujourd'hui (budget : ${info.budget}).${left}`;
  const answer = await osa(
    `tell application "System Events" to activate
     display dialog "${esc(text)}" with title "Pro" buttons {"Continuer quand même", "C'est un imprévu", "Reprendre une tâche"} default button "Reprendre une tâche" giving up after 30`,
    40_000,
  );
  prompting = false;
  if (/Reprendre une tâche/.test(answer)) await run('open', [base]);
  else if (/imprévu/.test(answer)) await post('imprevu', {});
  else if (/Continuer quand même/.test(answer)) await post('assistant/event', { kind: 'override' });
}

async function tick() {
  if ((await idleSeconds()) > IDLE_SECONDS) return;
  const { app, site } = await frontmost();
  if (!app || app === 'loginwindow' || app === 'ScreenSaverEngine') return; // écran verrouillé
  const info = await post('activity', { app, site, in_pro: site === proHost });
  if (info?.remind) remind(info);
}

async function quit() {
  await post('assistant/event', { kind: 'stop' });
  process.exit(0);
}
process.on('SIGTERM', quit);
process.on('SIGINT', quit);

await post('assistant/event', { kind: 'start' });
tick();
setInterval(tick, TICK_MS);
