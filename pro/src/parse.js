// La dictée devient des tâches : Claude d'abord, les règles de secours ensuite.
import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import { z } from 'zod';
import { parseWithRules } from './rules.js';
import { addDays, dow } from './time.js';

const DAY_NAMES = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
const DEFAULT_MODEL = 'claude-opus-5-5';
const FALLBACK_BETA = 'server-side-fallback-2026-07-01';

const TaskList = z.object({
  tasks: z.array(
    z.object({
      title: z.string(),
      note: z.string().nullable(),
      section: z.enum(['priorite', 'rappel', 'faire']),
      company: z.enum(['robiii', 'immo', 'perso']),
      nature: z.enum(['obligation', 'attend', 'avance', 'autre']),
      day: z.string().nullable(),
      due_date: z.string().nullable(),
      est_minutes: z.number(),
      contact: z.string().nullable(),
      phone: z.string().nullable(),
    }),
  ),
});

const FirstStep = z.object({ first_step: z.string() });

function systemPrompt({ today, defaultDay }) {
  const week = Array.from({ length: 8 }, (_, i) => {
    const d = addDays(today, i);
    return `${DAY_NAMES[dow(d)]} ${d}`;
  }).join(', ');
  return `Tu es le filtre entre la tête d'un entrepreneur québécois et sa feuille de tâches du jour. Il a un TDAH, mène plusieurs entreprises et vide sa tête à voix haute.
Tu reçois la transcription brute de ce qu'il vient de dire : du français parlé, avec des hésitations, des répétitions, des détours, du contexte raconté, et parfois des mots mal transcrits (quand le sens est clair, écris le bon mot).

Ton travail est de comprendre ce qu'il a à faire, pas de recopier ce qu'il a dit. Sa feuille se lit d'un coup d'œil : chaque ligne doit être une action claire qu'il peut commencer sans réécouter sa dictée.

Comment découper :
- Une tâche par action distincte. Quand il raconte une situation, sors les actions qu'elle contient. « Le locataire du 2 m'a appelé, y'a pu de chauffage, faudrait que je trouve un plombier pis que je le rappelle pour lui dire quand » donne deux tâches : « Trouver un plombier pour le chauffage du 2 » et « Rappeler le locataire du 2 ».
- Quand il résume un gros morceau en une phrase (« faut que je règle le financement du six-logements »), garde une seule tâche au titre clair, et mets dans sa note les deux ou trois étapes concrètes qu'il a mentionnées ou qui s'imposent d'évidence. Sa feuille déborde vite : n'ajoute pas de tâches pour des étapes qu'il n'a pas dites.
- Ce qui n'est pas une action (une réflexion, une plainte, une explication) ne devient pas une tâche. Si ça éclaire une tâche, mets-le dans sa note ; sinon laisse-le tomber.
- S'il se reprend ou se répète, garde sa dernière version, une seule fois.

Aujourd'hui : ${DAY_NAMES[dow(today)]} ${today}. Les prochains jours : ${week}.

Pour chaque tâche :
- title : l'action, en commençant par un verbe à l'infinitif, en 3 à 8 mots, sans la date ni le jour et sans « faut que je » (« Rappeler le notaire », « Envoyer le bail signé à Julie »). Garde les noms propres tels qu'il les dit.
- note : le contexte utile qui ne tient pas dans le titre (la raison, un montant, une adresse, les étapes d'un gros morceau), en une phrase courte de 140 caractères au plus. null quand le titre suffit.
- section : « rappel » pour une personne à rappeler, appeler ou relancer ; « priorite » pour ce qui a une échéance proche, une obligation, ou ce qu'il dit important ou urgent ; « faire » pour le reste.
- company : « robiii » (Robiii : produits, commandes, détaillants, fournisseurs, catalogue, Hub) ; « immo » (ImmoMulti, Opale Capital, Opti Loyer : immeubles, locataires, propriétaires, baux, notaire, visites, financement, soumissions de travaux) ; « perso » pour la vie personnelle et tout ce qui n'est clairement ni l'un ni l'autre.
- nature : « obligation » (argent à payer, taxes, paies, comptabilité, légal, renouvellements) ; « attend » (quelqu'un attend après lui) ; « avance » (fait avancer une vente, un financement, une acquisition) ; « autre ».
- day : le jour où la faire, AAAA-MM-JJ. S'il ne dit rien, mets ${defaultDay}. « un jour », « éventuellement », « quand j'aurai le temps » donnent null.
- due_date : seulement s'il donne une vraie date limite (« avant vendredi », « pour le 30 »), AAAA-MM-JJ. Sinon null.
- est_minutes : ton estimation réaliste, parmi 5, 10, 15, 30, 45, 60, 90, 120. Un appel vaut 10.
- contact : le nom de la personne ou de l'entreprise à joindre pour un rappel, sinon null.
- phone : le numéro de téléphone s'il le dicte, en chiffres, sinon null.`;
}

/** Compte les appels du mois et refuse au-delà du plafond de l'app. */
async function underCap(env) {
  const month = new Date().toISOString().slice(0, 7);
  const key = `ai_calls_${month}`;
  const cap = Number(env.AI_MONTHLY_CALLS || 1500);
  const row = await env.DB.prepare('SELECT value FROM settings WHERE key = ?').bind(key).first();
  const used = Number(row?.value || 0);
  if (used >= cap) return false;
  await env.DB.prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
  )
    .bind(key, String(used + 1))
    .run();
  return true;
}

async function ask(env, system, user, schema) {
  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY, timeout: 20_000, maxRetries: 0 });
  const response = await client.beta.messages.parse({
    model: env.CLAUDE_MODEL || DEFAULT_MODEL,
    max_tokens: 16000,
    betas: [FALLBACK_BETA],
    fallbacks: 'default', // si le modèle décline, l'API relance sur un autre dans le même appel
    output_config: { effort: 'low', format: betaZodOutputFormat(schema) },
    system,
    messages: [{ role: 'user', content: user }],
  });
  if (response.stop_reason === 'refusal') throw new Error('refus du modèle');
  if (response.stop_reason === 'max_tokens') throw new Error('réponse coupée');
  if (!response.parsed_output) throw new Error('réponse illisible');
  return response.parsed_output;
}

const SECTIONS = ['priorite', 'rappel', 'faire'];
const COMPANIES = ['robiii', 'immo', 'perso'];
const NATURES = ['obligation', 'attend', 'avance', 'autre'];
const isDate = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);

/** Nettoie une tâche, d'où qu'elle vienne (Claude, règles ou l'app). */
export function sanitize(t, { today, defaultDay }) {
  const title = String(t.title || '').trim().slice(0, 200);
  if (!title) return null;
  const day = t.day === null ? null : isDate(t.day) ? t.day : (defaultDay ?? today);
  return {
    title,
    section: SECTIONS.includes(t.section) ? t.section : 'faire',
    company: COMPANIES.includes(t.company) ? t.company : 'perso',
    nature: NATURES.includes(t.nature) ? t.nature : 'autre',
    day: day && day < today ? today : day,
    due_date: isDate(t.due_date) ? t.due_date : null,
    est_minutes: Math.min(480, Math.max(5, Math.round(Number(t.est_minutes) || 30))),
    contact: t.contact ? String(t.contact).trim().slice(0, 120) : null,
    phone: t.phone && /\d{7,}/.test(String(t.phone).replace(/\D/g, '')) ? String(t.phone).trim().slice(0, 30) : null,
    note: t.note ? String(t.note).replace(/\s+/g, ' ').trim().slice(0, 160) || null : null,
  };
}

/** Texte dicté → { engine: 'claude' | 'regles', items, note? }. */
export async function parseDump(env, text, ctx) {
  const clean = (list) => list.map((t) => sanitize(t, ctx)).filter(Boolean);
  if (env.ANTHROPIC_API_KEY && (await underCap(env))) {
    try {
      const out = await ask(env, systemPrompt(ctx), text, TaskList);
      const items = clean(out.tasks);
      if (items.length) return { engine: 'claude', items };
    } catch (err) {
      const why =
        err instanceof Anthropic.AuthenticationError
          ? 'clé Claude refusée'
          : err instanceof Anthropic.RateLimitError
            ? 'limite Claude atteinte'
            : err instanceof Anthropic.APIConnectionError
              ? 'Claude injoignable'
              : err instanceof Anthropic.APIError
                ? `erreur Claude ${err.status}`
                : String(err.message || err);
      return { engine: 'regles', items: clean(parseWithRules(text, ctx)), note: why };
    }
  }
  return { engine: 'regles', items: clean(parseWithRules(text, ctx)) };
}

const GENERIC_STEP = 'Travaille dessus 10 minutes, sans viser à finir.';

/** Le premier pas de 10 minutes d'une tâche que tu repousses. */
export async function firstStep(env, task) {
  if (!env.ANTHROPIC_API_KEY || !(await underCap(env))) return GENERIC_STEP;
  try {
    const out = await ask(
      env,
      `Un entrepreneur repousse une tâche parce qu'elle est plate, trop grosse ou floue.
Propose le tout premier geste concret, faisable en 10 minutes ou moins, qui la met en marche.
Une seule phrase courte à l'infinitif, en français québécois simple, sans encouragement ni explication.
Exemple pour « Fermer le mois d'octobre » : « Ouvrir le relevé bancaire d'octobre. »`,
      `Tâche : ${task.title}`,
      FirstStep,
    );
    return out.first_step.trim().slice(0, 160) || GENERIC_STEP;
  } catch {
    return GENERIC_STEP;
  }
}
