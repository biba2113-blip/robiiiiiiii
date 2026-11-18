// Règles de secours : séparer et classer une dictée sans IA.
// Moins précis que Claude, mais rien n'est perdu si l'appel échoue.
import { addDays, dow } from './time.js';

const norm = (s) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');

const DAYS = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];

const ROBIII = /robiii|commande|detaillant|catalogue|fournisseur|grossiste|librairie|hub\b|expedition|inventaire/;
const IMMO = /immo|opale|opti ?loyer|bail|baux|locataire|proprietaire|immeuble|logement|plex|notaire|visite|loyer|hypothe|centris|soumission|entrepreneur|tal\b/;
const CALL = /^(rappeler|appeler|telephoner|rejoindre|relancer|texter)\b/;
const OBLIG = /compta|tps|tvq|taxe|impot|paie\b|paies|payer|facture|assurance|renouvel|permis|plaque|fermer le mois|remise|declaration|rapport d'impot/;
const AVANCE = /soumission|offre|financement|acquisition|vente|vendre|pitch|investisseur|negoci/;

/** Prochaine date (à partir d'aujourd'hui) qui tombe ce jour de semaine. */
export function nextWeekday(today, target) {
  const delta = (target - dow(today) + 7) % 7;
  return addDays(today, delta === 0 ? 7 : delta);
}

function findDates(n, today) {
  let day;
  let due;
  if (/\bapres[- ]demain\b/.test(n)) day = addDays(today, 2);
  else if (/\bdemain\b/.test(n)) day = addDays(today, 1);
  else if (/\baujourd'?hui\b/.test(n)) day = today;
  for (let i = 0; i < 7; i++) {
    if (new RegExp(`\\b(avant|pour|d'ici|au plus tard)( le)? ${DAYS[i]}\\b`).test(n)) due = nextWeekday(today, i);
    else if (!day && new RegExp(`\\b${DAYS[i]}\\b`).test(n)) day = nextWeekday(today, i);
  }
  return { day, due };
}

// Le français parlé : ce qui ouvre une phrase sans rien dire, et les tournures « faut que je… ».
const FILLER = /^(?:(?:euh+|bon|ben|ok|okay|ah oui|oui|aussi|ensuite|après ça|apres ça|pis|puis|et|alors|donc|fait que|sinon)(?:[\s,]+|$))+/i;
const MUST_INF = /^(?:il\s+)?(?:faut|faudrait|faudra)\s+(?:aussi\s+)?(?=\S+(?:er|ir|re|oir)\b)|^(?:je\s+(?:dois|devrais|veux|voudrais|vais)|j'ai\s+à)\s+(?:aussi\s+)?/i;
const MUST_SUBJ = /^(?:il\s+)?(?:faut|faudrait|faudra)\s+(?:aussi\s+)?que\s+(?:je\s+|j')/i;
// « faut que j'appelle » → « Appeler » : les verbes les plus courants de ses dictées.
const TO_INF = {
  appelle: 'appeler', rappelle: 'rappeler', relance: 'relancer', texte: 'texter', envoie: 'envoyer', paie: 'payer', paye: 'payer',
  fasse: 'faire', aille: 'aller', regarde: 'regarder', vérifie: 'vérifier', commande: 'commander', prépare: 'préparer',
  réserve: 'réserver', achète: 'acheter', trouve: 'trouver', signe: 'signer', ferme: 'fermer', règle: 'régler', finisse: 'finir',
  passe: 'passer', renouvelle: 'renouveler', confirme: 'confirmer', réponde: 'répondre', écrive: 'écrire', valide: 'valider',
};

/** Retire les tournures parlées du début d'une phrase et remet le verbe à l'infinitif quand c'est possible. */
export function unspoken(piece) {
  let t = piece.trim().replace(FILLER, '');
  if (MUST_SUBJ.test(t)) {
    t = t.replace(MUST_SUBJ, '');
    const [verb, ...rest] = t.split(/\s+/);
    const inf = TO_INF[verb.toLowerCase()];
    if (inf) t = [inf, ...rest].join(' ');
  } else t = t.replace(MUST_INF, '');
  return t.trim();
}

function clean(title) {
  // Retire une puce ou un numéro de liste (« 1. », « 2) »), jamais un vrai nombre (« 4 logements »).
  const t = title.trim().replace(/^(?:[-•*]\s*|\d+[.)]\s+)+/, '').replace(/[.;,]+$/, '').trim();
  return t.charAt(0).toUpperCase() + t.slice(1);
}

// Une durée dite en fin de tâche : « 30 minutes environ », « une heure », « 1 heure et demie ».
// « heure » après « à », « avant », « vers »… est une heure du jour, pas une durée.
const DURATION = new RegExp(
  String.raw`(?:^|[\s,]+)(?:environ\s+)?(?:(\d+)\s*(?:minutes?|mins?)|(?<!(?<!\p{L})(?:à|a|avant|vers|pour|après|apres|dès|des)\s)(\d+|une?)\s+heures?(\s+et\s+demie?)?|(?:une\s+)?(demi[- ]heure))(?:\s+environ)?$`,
  'iu',
);

/** Sépare la durée dite à la fin d'un morceau : { text, minutes } (minutes null s'il n'y en a pas). */
export function takeDuration(piece) {
  const t = piece.trim().replace(/[.;,]+$/, '');
  const m = t.match(DURATION);
  if (!m) return { text: t, minutes: null };
  let minutes;
  if (m[1]) minutes = Number(m[1]);
  else if (m[2]) minutes = (/^une?$/i.test(m[2]) ? 1 : Number(m[2])) * 60 + (m[3] ? 30 : 0);
  else minutes = 30;
  return { text: t.slice(0, m.index).replace(/[\s,]+$/, ''), minutes };
}

// Une heure dite : « de 17 h à 22 h », « entre 9 h et 10 h 30 », « 17h-22h », « à 14 h », « vers midi ».
const HOUR = String.raw`(midi|minuit|\d{1,2}\s*h(?:eures?)?\s*(?:\d{2})?)`;
const RANGE = new RegExp(String.raw`(?:\b(?:de|entre)\s+)?${HOUR}\s*(?:à|a|-|et|jusqu'à|jusqu'a)\s*${HOUR}`, 'i');
const AT = new RegExp(String.raw`(?:^|\s)(?:à|a|vers|pour)\s+${HOUR}(?=$|[\s,.])`, 'i');
const toMin = (h) => {
  const n = norm(h);
  if (n === 'midi') return 720;
  if (n === 'minuit') return 0;
  const m = n.match(/^(\d{1,2})\s*h(?:eures?)?\s*(\d{2})?$/);
  return m && Number(m[1]) < 24 && Number(m[2] || 0) < 60 ? Number(m[1]) * 60 + Number(m[2] || 0) : null;
};

/** Sépare l'heure dite du reste : { text, start, minutes } (start en minutes depuis minuit, minutes = durée d'une plage). */
export function takeTime(piece) {
  const tidy = (t) => t.replace(/\s{2,}/g, ' ').replace(/[\s,]+$/, '').trim();
  const r = piece.match(RANGE);
  if (r) {
    const a = toMin(r[1]);
    let b = toMin(r[2]);
    if (a != null && b != null) {
      if (b <= a) b += 720; // « de 9 h à 2 h » : l'après-midi
      if (b > a && b - a <= 900) return { text: tidy(piece.replace(RANGE, ' ')), start: a, minutes: b - a };
    }
  }
  const m = piece.match(AT);
  if (m) {
    const a = toMin(m[1]);
    if (a != null) return { text: tidy(piece.replace(AT, ' ')), start: a, minutes: null };
  }
  return { text: piece.trim(), start: null, minutes: null };
}

// Sa vie hors travail : ces moments ne comptent pas dans le temps de travail.
const LIFE = /\b(blonde|chum|copine|copain|amoureuse|amoureux|amis?|amies?|chums|gym|entrainement|m'entrainer|famille|parents|ma mere|mon pere|enfants?|cinema|hockey|yoga|jogging|course a pied|massage|5 a 7|anniversaire|fete|souper avec|diner avec|dejeuner avec|sortie|chalet)\b/;

const words = (s) => s.split(/\s+/).filter(Boolean).length;

/**
 * Coupe une dictée en morceaux, un par tâche : [{ raw, minutes, start }].
 * Une phrase se coupe aux virgules, sauf quand elle est dictée en style télégraphique :
 * la transcription met alors une virgule entre chaque mot (« Faire, offre, 4 logements, Saint-Jérôme, 30 minutes environ. »),
 * et la phrase entière est une seule tâche.
 */
export function splitDump(text) {
  const out = [];
  const sentences = text.replace(/\s*,?\s*\bslash\b\s*,?\s*/gi, '/').split(/\n+|;|[.!?…]+(?:\s+|$)/);
  for (const sentence of sentences) {
    const parts = sentence
      .split(/,\s+(?:et\s+)?|\s+(?:et\s+)?(?:puis|pis|ensuite|après ça)\s+|\s+et aussi\s+/i)
      .map((p) => {
        const time = takeTime(unspoken(p));
        const dur = takeDuration(time.text);
        return { text: dur.text, minutes: dur.minutes ?? time.minutes, start: time.start };
      })
      .filter((p) => p.text || p.minutes != null);
    if (!parts.length) continue;
    const pureDuration = parts.some((p) => !p.text);
    const oneWord = parts.filter((p) => p.text && words(p.text) === 1).length;
    if (pureDuration || oneWord >= 2) {
      const raw = parts.map((p) => p.text).filter(Boolean).join(' ');
      const minutes = parts.findLast((p) => p.minutes != null)?.minutes ?? null;
      const start = parts.find((p) => p.start != null)?.start ?? null;
      if (raw.length > 2) out.push({ raw, minutes, start });
    } else for (const p of parts) if (p.text.length > 2) out.push({ raw: p.text, minutes: p.minutes, start: p.start });
  }
  return out;
}

export function parseWithRules(text, { today, defaultDay }) {
  const pieces = splitDump(text);

  return pieces.map(({ raw: piece, minutes, start }) => {
    const raw = clean(piece);
    const n = norm(raw);
    const isCall = CALL.test(n);
    const life = !isCall && LIFE.test(n);
    const { day, due } = findDates(n, today);
    const company = ROBIII.test(n) ? 'robiii' : IMMO.test(n) ? 'immo' : 'perso';
    const nature = OBLIG.test(n) ? 'obligation' : isCall ? 'attend' : AVANCE.test(n) ? 'avance' : 'autre';
    const section = isCall ? 'rappel' : due || nature === 'obligation' ? 'priorite' : 'faire';
    const contact = isCall ? clean(raw.replace(/^\S+\s+/, '').replace(/\b(demain|aujourd'hui|lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche)\b.*$/i, '')) : null;
    return {
      title: clean(raw),
      section,
      company,
      nature,
      day: day ?? defaultDay ?? today,
      due_date: due ?? null,
      est_minutes: minutes ?? (isCall ? 10 : life ? 60 : 30),
      kind: life ? 'vie' : 'tache',
      start_min: start,
      contact: contact || null,
      phone: raw.match(/(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}/)?.[0] ?? null,
    };
  });
}
