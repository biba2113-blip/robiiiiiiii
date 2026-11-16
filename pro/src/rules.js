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

function clean(title) {
  const t = title.trim().replace(/^[-•*\d.)\s]+/, '').replace(/[.;,]+$/, '').trim();
  return t.charAt(0).toUpperCase() + t.slice(1);
}

export function parseWithRules(text, { today, defaultDay }) {
  const pieces = text
    .split(/\n+|;|\s+puis\s+|,\s+(?:et\s+)?|\.\s+|\s+et aussi\s+/i)
    .map((s) => s.trim())
    .filter((s) => s.length > 2);

  return pieces.map((piece) => {
    const raw = clean(piece);
    const n = norm(raw);
    const isCall = CALL.test(n);
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
      est_minutes: isCall ? 10 : 30,
      contact: contact || null,
    };
  });
}
