// Installation de Pro sur ton compte Cloudflare. À lancer une seule fois : npm run setup
// Crée la base, pose tes secrets (jamais écrits dans le dépôt), met Pro en ligne et affiche ton lien privé.
import { spawnSync } from 'node:child_process';
import { randomBytes, generateKeyPairSync } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import readline from 'node:readline';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const linkFile = path.join(root, '.pro-lien');
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

function wrangler(args, { input, show = false } = {}) {
  const res = spawnSync('npx', ['wrangler', ...args], {
    cwd: root,
    input,
    encoding: 'utf8',
    stdio: show ? 'inherit' : ['pipe', 'pipe', 'pipe'],
  });
  return { ok: res.status === 0, out: `${res.stdout || ''}${res.stderr || ''}` };
}

function ask(question, { hidden = false } = {}) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    if (hidden) {
      // Ce que tu tapes ne s'affiche pas à l'écran.
      rl._writeToOutput = (s) => {
        if (s.includes(question)) rl.output.write(s);
      };
    }
    rl.question(question, (answer) => {
      rl.close();
      if (hidden) process.stdout.write('\n');
      resolve(answer.trim());
    });
  });
}

function secret(name, value) {
  const res = wrangler(['secret', 'put', name], { input: value + '\n' });
  if (!res.ok) throw new Error(`Impossible d’enregistrer ${name} :\n${res.out}`);
  console.log(`  ${name} enregistré.`);
}

const step = (n, text) => console.log(`\n${n}. ${text}`);

async function main() {
  console.log('Installation de Pro\n===================');

  step(1, 'Connexion à Cloudflare');
  if (!wrangler(['whoami']).ok) {
    console.log('  Une page va s’ouvrir dans ton navigateur pour te connecter.');
    if (!wrangler(['login'], { show: true }).ok) throw new Error('Connexion à Cloudflare annulée.');
  }
  console.log('  Connecté.');

  step(2, 'La base de données');
  let id = null;
  const created = wrangler(['d1', 'create', 'pro']);
  if (created.ok) id = created.out.match(UUID)?.[0] ?? null;
  if (!id) {
    const list = wrangler(['d1', 'list', '--json']);
    try {
      id = JSON.parse(list.out.slice(list.out.indexOf('['))).find((d) => d.name === 'pro')?.uuid ?? null;
    } catch {
      id = null;
    }
  }
  if (!id) throw new Error(`Impossible de créer ou de trouver la base « pro » :\n${created.out}`);
  console.log(`  Base prête (${id}).`);
  const cfg = spawnSync('node', ['scripts/config.mjs', id], { cwd: root, stdio: 'inherit' });
  if (cfg.status !== 0) throw new Error('Impossible d’écrire wrangler.jsonc.');
  if (!wrangler(['d1', 'migrations', 'apply', 'pro', '--remote'], { show: true }).ok) throw new Error('Les tables n’ont pas pu être créées.');

  step(3, 'Mise en ligne');
  const deployed = wrangler(['deploy']);
  if (!deployed.ok) throw new Error(`La mise en ligne a échoué :\n${deployed.out}`);
  const site = deployed.out.match(/https:\/\/[^\s]+\.workers\.dev/)?.[0] ?? null;
  console.log(`  En ligne${site ? ` : ${site}` : ''}.`);

  step(4, 'Ton lien privé');
  let key = existsSync(linkFile) ? readFileSync(linkFile, 'utf8').match(/\/k\/([^/\s]+)/)?.[1] : null;
  if (!key) key = randomBytes(24).toString('base64url');
  secret('ACCESS_KEY', key);

  step(5, 'Les notifications');
  const secrets = wrangler(['secret', 'list']).out;
  if (/VAPID_PRIVATE_JWK/.test(secrets)) console.log('  Clés déjà en place.');
  else {
    // Une paire de clés propre à ton installation : elle signe les notifications envoyées à tes appareils.
    const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
    const pub = publicKey.export({ format: 'jwk' });
    const raw = Buffer.concat([Buffer.from([4]), Buffer.from(pub.x, 'base64url'), Buffer.from(pub.y, 'base64url')]);
    secret('VAPID_PRIVATE_JWK', JSON.stringify(privateKey.export({ format: 'jwk' })));
    secret('VAPID_PUBLIC', raw.toString('base64url'));
  }

  step(6, 'Claude, pour comprendre ta dictée');
  console.log('  Colle la clé réservée à Pro (elle commence par sk-ant-). Entrée seule pour passer : les règles simples classeront en attendant.');
  const claude = await ask('  Clé Claude : ', { hidden: true });
  if (claude) secret('ANTHROPIC_API_KEY', claude);
  else console.log('  Passé. Tu pourras la poser plus tard : npx wrangler secret put ANTHROPIC_API_KEY');

  step(7, 'Ton calendrier iCloud');
  console.log('  Ton identifiant Apple (courriel) et le mot de passe d’application créé pour Pro. Entrée seule pour passer.');
  const user = await ask('  Identifiant Apple : ');
  if (user) {
    const pass = await ask('  Mot de passe d’application : ', { hidden: true });
    if (pass) {
      secret('VAPID_SUBJECT', `mailto:${user}`);
      secret('ICLOUD_USER', user);
      secret('ICLOUD_APP_PASSWORD', pass.replace(/\s+/g, ''));
    }
  } else console.log('  Passé. Pro fonctionne sans calendrier ; relance npm run setup pour le brancher.');

  const link = site ? `${site}/k/${key}/` : `/k/${key}/ (ajoute-le à l’adresse de ton Worker « pro »)`;
  writeFileSync(linkFile, link + '\n');
  console.log(`\nC’est prêt. Ton lien privé :\n\n  ${link}\n`);
  console.log('Ouvre-le sur ton iPhone dans Safari, puis Partager, « Sur l’écran d’accueil ».');
  console.log('Ensuite, dans Pro : ⚙, Notifications, « Activer sur cet appareil ».');
  console.log('Pour l’assistant du Mac : npm run assistant:install');
  console.log('Le lien est aussi gardé dans le fichier .pro-lien de ce dossier (hors du dépôt). Ne le partage pas.');
}

main().catch((err) => {
  console.error(`\nArrêt : ${err.message}`);
  process.exit(1);
});
