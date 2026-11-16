// Installe (ou retire) l'assistant du Mac de Pro.
//   npm run assistant:install     demande ton lien privé, puis garde l'assistant en marche
//   npm run assistant:remove      l'arrête et le retire
import { execFileSync, spawnSync } from 'node:child_process';
import { writeFileSync, existsSync, readFileSync, rmSync, mkdirSync, chmodSync } from 'node:fs';
import { homedir, platform, userInfo } from 'node:os';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import readline from 'node:readline';

const LABEL = 'com.pro.assistant';
const here = path.dirname(fileURLToPath(import.meta.url));
const script = path.join(here, 'pro-assistant.mjs');
const config = path.join(homedir(), '.pro-assistant.json');
const agents = path.join(homedir(), 'Library', 'LaunchAgents');
const plist = path.join(agents, `${LABEL}.plist`);
const domain = `gui/${userInfo().uid}`;

if (platform() !== 'darwin') {
  console.error("L'assistant fonctionne seulement sur un Mac.");
  process.exit(1);
}

const launchctl = (...args) => spawnSync('launchctl', args, { encoding: 'utf8' });

function remove() {
  launchctl('bootout', domain, plist);
  for (const f of [plist, config]) if (existsSync(f)) rmSync(f);
  console.log("L'assistant est arrêté et retiré.");
}

if (process.argv.includes('--remove')) {
  remove();
  process.exit(0);
}

const ask = (q) =>
  new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(q, (a) => {
      rl.close();
      resolve(a.trim());
    });
  });

// Le lien privé : celui gardé par npm run setup, sinon on le demande.
let url = '';
const saved = path.join(here, '..', '.pro-lien');
if (existsSync(saved)) url = readFileSync(saved, 'utf8').trim();
if (!/^https:\/\/.+\/k\/[^/]+\/$/.test(url)) url = await ask('Colle ton lien privé de Pro (il finit par /k/…/) : ');
if (!url.endsWith('/')) url += '/';
if (!/^https?:\/\/.+\/k\/[^/]+\/$/.test(url)) {
  console.error('Ce lien ne ressemble pas à un lien privé de Pro.');
  process.exit(1);
}

writeFileSync(config, JSON.stringify({ url }, null, 2));
chmodSync(config, 0o600); // lisible par toi seulement : il contient ton lien privé

const xml = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
mkdirSync(agents, { recursive: true });
writeFileSync(
  plist,
  `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array><string>${xml(process.execPath)}</string><string>${xml(script)}</string></array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>30</integer>
  <key>StandardErrorPath</key><string>${xml(path.join(homedir(), 'Library', 'Logs', 'pro-assistant.log'))}</string>
</dict>
</plist>
`,
);

launchctl('bootout', domain, plist); // au cas où une ancienne version tourne
const res = launchctl('bootstrap', domain, plist);
if (res.status !== 0) {
  console.error(`macOS a refusé de démarrer l'assistant :\n${res.stderr || res.stdout}`);
  process.exit(1);
}

// Un premier essai tout de suite, pour que macOS affiche ses demandes d'autorisation pendant que tu es là.
try {
  execFileSync('osascript', ['-e', 'tell application "System Events" to get name of first application process whose frontmost is true'], { timeout: 20000 });
} catch {
  console.log('macOS n’a pas encore autorisé la lecture de l’app au premier plan.');
}

console.log(`
L'assistant est en marche. Il redémarre tout seul avec ton Mac.

macOS va te demander deux autorisations, à accepter :
  1. contrôler « System Events », pour connaître l'app au premier plan ;
  2. contrôler ton navigateur, pour connaître le site ouvert (une fois par navigateur).
Si tu as refusé par erreur : Réglages Système, Confidentialité et sécurité, Automatisation.

Pour le retirer : npm run assistant:remove
Son journal d'erreurs : ~/Library/Logs/pro-assistant.log`);
