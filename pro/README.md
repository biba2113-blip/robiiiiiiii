# Pro

Ta feuille du jour : priorités, personnes à rappeler, tâches à faire, ce que tu évites, et un horaire relié à ton calendrier.
Une app web installable sur iPhone et Mac, hébergée sur Cloudflare, plus un petit assistant pour le Mac.

## Ce que fait Pro

**La feuille (étape 1)**
- Quatre sections, trois couleurs (orange Robiii, bleu ImmoMulti, vert perso). Cocher raye la ligne et la descend en bas.
- Vider ta tête : tu dictes ou écris tout d'un coup, l'outil sépare en tâches, tu confirmes le lot une fois.
- L'horaire : tes tâches placées autour de tes rendez-vous, le souper à 18 h, le quart de la journée gardé libre. Les blocs se glissent.
- Le calendrier iCloud : tes rendez-vous entrent, tes blocs y sont écrits avec une alerte. Des appels bout à bout ne sonnent qu'une fois.
- Le soir : le bilan, le tri de chaque tâche non faite, quatre questions pour ne rien oublier, tes heures du lendemain.
- La réserve : ce qui n'a pas de jour, à revoir le dimanche.

**Le temps réel et les notifications (étape 2)**
- Un tap sur une tâche : « je suis là-dessus ». Le chrono suit, et un second tap le met en pause.
- Le bouton Imprévu : la tâche en cours se met en pause, le temps de l'imprévu est compté à part, puis la tâche reprend.
- Le mode appels : tes personnes à rappeler une à la fois, avec rejoint, message laissé ou rappeler demain.
- Les notifications de Pro : à l'heure prévue, « tu dépasses », échéances, et le rappel du soir à 22 h. Chaque type se coupe dans ⚙.
- Ce qui revient : paies, taxes, renouvellements. Tu l'entres une fois, la tâche revient avec sa vraie échéance.
- Le bilan du soir : prévu contre fait, par type de travail. Après cinq tâches mesurées, Pro connaît ton rythme.

**L'assistant du Mac (étape 3)**
- Chaque minute, il note quelle app est au premier plan, et le site dans un navigateur. Rien d'autre : ni le contenu, ni ce que tu tapes.
- Sans tâche en cours pendant 10 minutes, le temps passe « hors feuille ». YouTube, les réseaux sociaux et les nouvelles comptent toujours hors feuille.
- Budget épuisé (60 minutes par défaut) : une fenêtre de rappel, avec trois choix. « Continuer quand même » fonctionne toujours et paraît au bilan.
- Le miroir du dimanche : trois constats sur ta semaine, un seul ajustement.

Pas encore bâti : déléguer une tâche, « En attente de », et les branchements au CRM, au Hub et à Gmail.

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

Le script te connecte à Cloudflare, crée la base, met Pro en ligne, fabrique les clés des notifications et affiche ton lien privé.

Ensuite :

1. Ouvre le lien dans Safari sur ton iPhone, puis Partager, « Sur l'écran d'accueil ». Sur le Mac : Fichier, « Ajouter au Dock ».
2. Ouvre Pro **depuis l'icône** de l'écran d'accueil, puis ⚙, Notifications, « Activer sur cet appareil ». Sur iPhone, les notifications ne fonctionnent que dans l'app installée.
3. Pour l'assistant du Mac :

```bash
npm run assistant:install
```

macOS te demandera d'autoriser l'assistant à connaître l'app au premier plan, puis le site ouvert dans ton navigateur. Pour le retirer : `npm run assistant:remove`.

Le lien privé est gardé dans `.pro-lien` (hors du dépôt). Quiconque l'obtient voit tes tâches : ne le partage pas.
Pour en changer : supprime `.pro-lien` et relance `npm run setup`.

## Mettre à jour

```bash
git pull
```

```bash
npm install && npm run deploy
```

Après une mise à jour, Pro se recharge seule à sa prochaine ouverture, même installée sur l'écran d'accueil de l'iPhone.
La date de la version en ligne est affichée dans ⚙, avec un bouton « Recharger Pro maintenant ».

## Les grosses journées : l'ordre, les flèches, le filtre

- **Dans l'ordre.** Sur iPhone, l'horaire passe en premier : la journée du haut vers le bas, avec une case à cocher sur chaque bloc.
  Un bouton en haut alterne entre « Dans l'ordre » et « Par section ». Sur Mac, les deux sont côte à côte.
- **Pourquoi là.** Chaque bloc dit pourquoi il est placé ainsi : échéance proche, obligation, quelqu'un attend, fait avancer.
  Aujourd'hui, le bloc en cours porte « Maintenant » et le suivant « Ensuite ».
- **Monter, descendre.** Les flèches ↑ ↓ changent l'ordre d'une tâche ; glisser une tâche sur une autre la range juste avant.
  Dès que tu touches à l'ordre, c'est le tien pour la journée : une nouvelle tâche arrive à la fin.
  « Reprendre l'ordre proposé par Pro » l'efface.
- **Filtre.** Un tap sur Robiii, ImmoMulti ou Perso en haut ne montre que ce groupe ; « Tout voir » revient à la journée entière.

## Hors travail : blonde, amis, gym

Ces moments ne sont pas du travail et ne comptent pas dans le temps prévu de la journée.

- **Avec une heure** (« voir ma blonde de 17 h à 22 h », « gym à midi, une heure ») : le moment réserve sa place à l'horaire,
  le travail se range autour, et la journée de travail raccourcit d'autant. Il est écrit au calendrier comme les autres blocs.
- **Sans heure** (« souper avec des amis ») : il reste dans la boîte « Hors travail », sans prendre de place.
  Non coché, il suit sur le lendemain sans passer par le tri du soir.
- Pour changer d'avis : dans la fiche d'une tâche, « Compte dans : Mon travail / Hors travail », ou en la glissant dans la boîte.
- Une heure dite pour une tâche de travail (« appeler Marc à 14 h ») la fixe aussi à cette heure.

## Le bouton micro

Dans la boîte du bas : un tap pour parler, un second pour finir. Le texte part se faire classer et tu confirmes comme d'habitude.
Fermer la confirmation sans ajouter garde le texte dans la boîte.

- La transcription se fait avec Whisper (`@cf/openai/whisper-large-v3-turbo`) par Workers AI, sur ton propre compte Cloudflare.
  L'audio n'est gardé nulle part.
- Un enregistrement s'arrête seul après 5 minutes.
- Le coût se compte en fractions de cent par minute, et Workers AI a une allocation gratuite chaque jour. Vérifie les tarifs à jour dans ton tableau de bord Cloudflare.
- Le micro du clavier fonctionne toujours, et ne passe pas par Whisper.

## Dicter sans ouvrir l'app (raccourci iPhone)

Le raccourci est à créer à la main, dans l'app Raccourcis, avec deux actions :

1. **Dicter du texte**.
2. **Obtenir le contenu de l'URL** : méthode POST, corps de requête JSON, un champ `text` qui reçoit le texte dicté.
   L'adresse est affichée dans Pro, sous ⚙, « Dicter sans ouvrir l'app ».

Assigne le raccourci au bouton Action ou dis « Dis Siri » suivi de son nom. La dictée attend ta confirmation dans Pro.

## Claude et les coûts

- Claude analyse ce que tu dictes : il sort les actions, leur donne un titre court et garde le contexte dans une note.
  Sans clé Claude, des règles simples découpent seulement tes phrases, et la confirmation l'indique en rouge.
  Pour brancher la clé : `npx wrangler secret put ANTHROPIC_API_KEY` dans ce dossier (la clé se tape dans le Terminal, jamais ailleurs).
  Il faut une clé API créée dans console.anthropic.com, sur un compte qui a des crédits ; un abonnement claude.ai n'en fournit pas.
  Dans Pro, ⚙ puis « Tester Claude » fait un vrai essai et dit pourquoi ça échoue.
- Les règles de secours comprennent le style télégraphique (« Faire, offre, 4 logements, 30 minutes environ. » : une tâche de 30 minutes) et les durées dictées.

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

L'app locale tourne sans lien distant (`--local`) : tout fonctionne sauf la transcription du bouton micro, qui répond par un message d'erreur.
Elle s'ouvre sur `http://localhost:8790/` (elle mène à `/k/dev/`). Les secrets locaux vont dans `.dev.vars` (hors du dépôt), créé tout seul avec la clé `dev`.
En ligne, sans `ACCESS_KEY`, Pro ne sert rien du tout.

```bash
npm test
```

| Fichier | Rôle |
|---|---|
| `src/index.js` | Routes, lien privé (`/k/<clé>/`, 404 sans la clé), horloge des notifications |
| `public/plan.js` | Ordre de tri et placement à l'horaire, partagé par le serveur et l'app |
| `src/parse.js`, `src/rules.js` | La dictée devient des tâches : Claude, puis règles de secours |
| `src/transcribe.js` | Le bouton micro : l'enregistrement devient du texte (Whisper, Workers AI) |
| `src/caldav.js` | Lecture et écriture du calendrier iCloud (CalDAV) |
| `src/track.js` | Le chrono et l'imprévu |
| `src/notify.js`, `src/push.js` | Quoi notifier et quand ; chiffrement et envoi (Web Push) |
| `src/recurring.js` | Ce qui revient |
| `src/bilan.js` | Bilan du soir, miroir de la semaine, budget hors feuille |
| `assistant/` | L'assistant du Mac et son installation |
| `public/app.js`, `public/styles.css`, `public/sw.js` | L'écran, et la réception des notifications |
| `migrations/` | Les tables |
| `scripts/setup.mjs` | Installation sur Cloudflare |
| `test/` | Tests de la logique, et cinq parcours à l'écran (`parcours.e2e.cjs`, `micro.e2e.cjs`, `cocher.e2e.cjs`, `hors-travail.e2e.cjs`, `ordre.e2e.cjs`, demandent Playwright ; `parcours` se joue de jour, il lui faut du temps libre à l'horaire d'aujourd'hui) |

## Ce qui a été vérifié, et ce qui ne l'a pas été

Vérifié :
- 55 tests de logique, dont le chiffrement des notifications contre le vecteur officiel de la RFC 8291.
- Le parcours complet à l'écran, sur Mac et iPhone simulés : dictée, confirmation, cocher, glisser, chrono, imprévu, mode appels, bilan, tri du soir, réserve, ce qui revient.
- La chaîne des notifications en local, de l'horloge jusqu'au message déchiffré par un faux appareil, sans doublon.
- Le calendrier contre un serveur CalDAV d'essai (Radicale).
- Le moment où on coche, sur iPhone simulé : case, trait, confettis, notes jouées, barre du jour, message, et la pluie quand la feuille est finie. Le son lui-même n'a pas été écouté.
- Les moments hors travail, sur Mac et iPhone simulés : dictée, blocs à l'horaire, travail rangé autour, coche, fiche, aller-retour travail / hors travail.
- L'ordre de la journée, sur Mac et iPhone simulés : raisons affichées, flèches, glisser devant une autre, reprise de l'ordre de Pro, coche depuis l'horaire, filtre par entreprise, choix de vue gardé sur l'appareil.
- La mise à jour automatique (simulée en changeant la version renvoyée par le serveur) et le réglage « Confettis et animations » sur un appareil qui réduit les animations.
- Le bouton micro à l'écran, sur Mac et iPhone simulés, avec un faux micro : enregistrement, envoi de l'audio, confirmation, micro refusé, panne de transcription.

Pas encore vérifié, faute d'accès :
- **L'assistant du Mac.** Il n'a jamais tourné : il est écrit pour macOS et a été développé sous Linux. Attends-toi à des ajustements au premier essai.
- **La transcription elle-même.** Whisper n'a jamais été appelé pour vrai, ni l'enregistrement fait sur un vrai iPhone (format audio différent de celui du test).
- Une vraie notification reçue sur un iPhone ou un Mac.
- Le vrai calendrier iCloud.
- Un vrai appel à Claude avec une clé valide. La consigne qui lui demande d'analyser la dictée (actions courtes, contexte en note) n'a donc jamais été essayée sur le vrai modèle.
- `npm run setup` sur un vrai compte Cloudflare.
