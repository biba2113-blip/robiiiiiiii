// Fabrique wrangler.jsonc (gardé hors du dépôt) à partir du modèle, avec l'identifiant de ta base.
//   node scripts/config.mjs            garde l'identifiant déjà en place, ou met un identifiant local
//   node scripts/config.mjs <id>       inscrit cet identifiant
//   node scripts/config.mjs --check    refuse de continuer si la base n'a pas encore été créée
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const target = path.join(root, 'wrangler.jsonc');
const LOCAL = '00000000-0000-0000-0000-000000000000';
const args = process.argv.slice(2);
const check = args.includes('--check');
const given = args.find((a) => /^[0-9a-f-]{36}$/i.test(a));

let current = null;
if (existsSync(target)) current = readFileSync(target, 'utf8').match(/"database_id":\s*"([^"]+)"/)?.[1] ?? null;
const id = given || current || LOCAL;

if (check && id === LOCAL) {
  console.error('La base de Pro n’existe pas encore sur Cloudflare. Lance d’abord : npm run setup');
  process.exit(1);
}
const template = readFileSync(path.join(root, 'wrangler.template.jsonc'), 'utf8');
writeFileSync(target, template.replace('__DATABASE_ID__', id));

// En local, l'app s'ouvre avec la clé « dev ». Le fichier reste hors du dépôt.
const devVars = path.join(root, '.dev.vars');
if (!existsSync(devVars)) writeFileSync(devVars, 'ACCESS_KEY=dev\n');
