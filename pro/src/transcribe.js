// Le bouton micro : l'enregistrement devient du texte, avec Whisper sur ton propre compte Cloudflare.
// L'audio n'est gardé nulle part : il est transcrit, puis oublié.
import { Buffer } from 'node:buffer';

export const MODEL = '@cf/openai/whisper-large-v3-turbo';
export const MAX_AUDIO_BYTES = 8 * 1024 * 1024; // environ 5 minutes au débit demandé par l'app, avec de la marge

// Quelques mots de ton vocabulaire, pour que Whisper les écrive correctement.
const HINT = 'Robiii, ImmoMulti, Opale Capital, Opti Loyer. Rappeler un client, envoyer la soumission, faire les paies, payer les taxes.';

// Ce que Whisper invente parfois quand il n'entend que du silence.
const GHOSTS = [/sous-?titr/i, /amara\.org/i, /merci d'avoir regard/i, /abonnez-vous/i];

/** Nettoie le texte rendu par Whisper. Rend '' quand il n'y a rien d'utile. */
export function cleanTranscript(text) {
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  if (!t || !/[\p{L}\p{N}]/u.test(t)) return '';
  if (t.length < 80 && GHOSTS.some((g) => g.test(t))) return '';
  return t;
}

export class TranscribeError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

/** Transcrit un enregistrement (ArrayBuffer). Rend { text, seconds }. */
export async function transcribe(env, bytes) {
  if (!env.AI) throw new TranscribeError('Le micro n’est pas encore branché : relance npm run deploy.', 503);
  if (!bytes || !bytes.byteLength) throw new TranscribeError('Enregistrement vide.', 400);
  if (bytes.byteLength > MAX_AUDIO_BYTES) throw new TranscribeError('Enregistrement trop long : coupe-le en deux.', 413);
  let out;
  try {
    out = await env.AI.run(MODEL, {
      audio: Buffer.from(bytes).toString('base64'),
      task: 'transcribe',
      language: 'fr',
      vad_filter: true,
      initial_prompt: HINT,
    });
  } catch (err) {
    console.error('transcription', err);
    throw new TranscribeError('La transcription n’a pas fonctionné. Réessaie, ou sers-toi du micro du clavier.', 502);
  }
  return { text: cleanTranscript(out?.text), seconds: Math.round(out?.transcription_info?.duration || 0) };
}
