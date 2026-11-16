import { test } from 'node:test';
import assert from 'node:assert/strict';
import { transcribe, cleanTranscript, TranscribeError, MODEL, MAX_AUDIO_BYTES } from '../src/transcribe.js';

const bytes = (n) => new Uint8Array(n).fill(7).buffer;
const fakeAI = (reply) => {
  const calls = [];
  return {
    calls,
    run: async (model, input) => {
      calls.push({ model, input });
      if (reply instanceof Error) throw reply;
      return reply;
    },
  };
};

test('le texte de Whisper est nettoyé', () => {
  assert.equal(cleanTranscript('  Rappeler   Marc\n demain. '), 'Rappeler Marc demain.');
  assert.equal(cleanTranscript(''), '');
  assert.equal(cleanTranscript(' ... '), '');
  assert.equal(cleanTranscript(undefined), '');
});

test('ce que Whisper invente sur du silence est écarté, pas une vraie phrase', () => {
  assert.equal(cleanTranscript("Sous-titres réalisés par la communauté d'Amara.org"), '');
  assert.equal(cleanTranscript("Merci d'avoir regardé cette vidéo !"), '');
  const real = 'Rappeler le monteur pour les sous-titres de la vidéo Robiii, envoyer la soumission à Julie et payer les taxes avant vendredi.';
  assert.equal(cleanTranscript(real), real);
});

test("l'audio part en base64, en français, au bon modèle", async () => {
  const AI = fakeAI({ text: ' Appeler Marc demain. ', transcription_info: { duration: 12.4 } });
  const out = await transcribe({ AI }, new Uint8Array([1, 2, 3, 250]).buffer);
  assert.deepEqual(out, { text: 'Appeler Marc demain.', seconds: 12 });
  assert.equal(AI.calls.length, 1);
  assert.equal(AI.calls[0].model, MODEL);
  assert.equal(AI.calls[0].input.audio, Buffer.from([1, 2, 3, 250]).toString('base64'));
  assert.equal(AI.calls[0].input.language, 'fr');
  assert.equal(AI.calls[0].input.task, 'transcribe');
  assert.match(AI.calls[0].input.initial_prompt, /Robiii/);
});

test('un silence rend un texte vide, sans erreur', async () => {
  assert.deepEqual(await transcribe({ AI: fakeAI({ text: '' }) }, bytes(2000)), { text: '', seconds: 0 });
  assert.deepEqual(await transcribe({ AI: fakeAI({}) }, bytes(2000)), { text: '', seconds: 0 });
});

test('les refus : pas de lien vers Workers AI, vide, trop gros, panne', async () => {
  const status = async (p) => {
    try {
      await p;
    } catch (err) {
      assert.ok(err instanceof TranscribeError);
      return err.status;
    }
    assert.fail('aurait dû refuser');
  };
  assert.equal(await status(transcribe({}, bytes(10))), 503);
  const AI = fakeAI({ text: 'x' });
  assert.equal(await status(transcribe({ AI }, bytes(0))), 400);
  assert.equal(await status(transcribe({ AI }, bytes(MAX_AUDIO_BYTES + 1))), 413);
  assert.equal(AI.calls.length, 0, 'rien n’est envoyé quand la demande est refusée');
  const origError = console.error;
  console.error = () => {};
  try {
    assert.equal(await status(transcribe({ AI: fakeAI(new Error('panne')) }, bytes(10))), 502);
  } finally {
    console.error = origError;
  }
});
