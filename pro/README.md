# Pro

Ta feuille du jour : priorités, personnes à rappeler, tâches à faire, ce que tu évites, et un horaire relié à ton calendrier.
Étape 1 du plan de match. Une app web installable sur iPhone et Mac, hébergée sur Cloudflare.

## Ce que fait l'étape 1

- **La feuille** : quatre sections, trois couleurs (orange Robiii, bleu ImmoMulti, vert perso), cocher raye la ligne et la descend en bas.
- **Vider ta tête** : tu dictes ou écris tout d'un coup, l'outil sépare en tâches, tu confirmes le lot une fois.
- **L'horaire** : tes tâches placées autour de tes rendez-vous, le souper à 18 h, le quart de la journée gardé libre.
- **Le calendrier iCloud** : tes rendez-vous entrent, tes blocs y sont écrits avec une alerte.
- **Le soir** : tu décides pour chaque tâche non faite, quatre questions pour ne rien oublier, tes heures du lendemain.
- **La réserve** : ce qui n'a pas de jour, à revoir le dimanche.
- **Dicter sans ouvrir l'app** : un raccourci iPhone envoie ta phrase, tu confirmes plus tard.

Pas dans cette étape : notifications de Pro, temps réel, bouton Imprévu, mode appels, assistant du Mac.

## Installer (une seule fois, sur ton Mac)

Avant de commencer, crée deux accès. Tu les colleras quand le script te les demandera, jamais ailleurs.

1. **Une clé Claude réservée à Pro**, dans la console d'Anthropic, avec une limite de dépense mensuelle.
2. **Un mot de passe d'application iCloud**, sur le site de ton compte Apple (section connexion et sécurité).

Puis, dans le dossier `pro/` :

```bash
npm install
```

```bash
npm run setup
```

Le script te connecte à Cloudflare, crée la base, met Pro en ligne et affiche ton lien privé.
Ouvre ce lien dans Safari sur ton iPhone, puis Partager, « Sur l'écran d'accueil ». Sur le Mac : Fichier, « Ajouter au Dock ».

Le lien privé est gardé dans `.pro-lien` (hors du dépôt). Quiconque l'obtient voit tes tâches : ne le partage pas.
Pour en changer : supprime `.pro-lien` et relance `npm run setup`.

## Mettre à jour

```bash
git pull
```

```bash
npm install && npm run deploy
```

## Dicter sans ouvrir l'app (raccourci iPhone)

Dans l'app Raccourcis, crée un raccourci avec deux actions :

1. **Dicter du texte**.
2. **Obtenir le contenu de l'URL** : méthode POST, corps de requête JSON, un champ `text` qui reçoit le texte dicté.
   L'adresse est affichée dans Pro, sous ⚙, « Dicter sans ouvrir l'app ».

Assigne le raccourci au bouton Action ou dis « Dis Siri » suivi de son nom. La dictée attend ta confirmation dans Pro.

## Claude et les coûts

- Le modèle est réglé dans `wrangler.template.jsonc` (`CLAUDE_MODEL`, par défaut `claude-opus-5-5`).
  Une dictée coûte de l'ordre de quelques cents. Pour réduire beaucoup la facture, mets `claude-haiku-5-5` et relance `npm run deploy`.
- Deux plafonds : la limite de dépense que tu fixes sur la clé, et `AI_MONTHLY_CALLS` (1500 appels par mois par défaut).
  Au-delà, ou si Claude ne répond pas, des règles simples classent la dictée et rien n'est perdu.
- Si le modèle décline une demande, l'API relance sur un autre modèle dans le même appel (`fallbacks`).

## Développer

```bash
npm run migrate:local
```

```bash
npm run dev
```

L'app locale s'ouvre sur `http://localhost:8790/` (elle mène à `/k/dev/`). Les secrets locaux vont dans `.dev.vars` (hors du dépôt), créé tout seul avec la clé `dev`.
En ligne, sans `ACCESS_KEY`, Pro ne sert rien du tout.

```bash
npm test
```

| Fichier | Rôle |
|---|---|
| `src/index.js` | Routes et lien privé (`/k/<clé>/`, 404 sans la clé) |
| `public/plan.js` | Ordre de tri et placement à l'horaire, partagé par le serveur et l'app |
| `src/parse.js`, `src/rules.js` | La dictée devient des tâches : Claude, puis règles de secours |
| `src/caldav.js` | Lecture et écriture du calendrier iCloud (CalDAV) |
| `public/app.js`, `public/styles.css` | L'écran |
| `migrations/` | Les tables |
| `scripts/setup.mjs` | Installation sur Cloudflare |
| `test/` | Tests de la logique, et un parcours complet à l'écran (`parcours.e2e.cjs`, demande Playwright) |

## Ce qui a été vérifié, et ce qui ne l'a pas été

Vérifié : 20 tests de logique, le parcours complet sur Mac et iPhone simulés, et le calendrier contre un serveur CalDAV d'essai (Radicale).

Pas encore vérifié, faute d'accès : le vrai calendrier iCloud, un vrai appel à Claude avec une clé valide, et `npm run setup` sur un vrai compte Cloudflare.
