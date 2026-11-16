import test from 'node:test';
import assert from 'node:assert/strict';
import { createECDH, hkdfSync, createDecipheriv, generateKeyPairSync, verify, createPublicKey } from 'node:crypto';
import { encrypt, b64u, vapidAuth } from '../src/push.js';

// Vecteur de l'annexe A de la RFC 8291.
const V = {
  plaintext: 'When I grow up, I want to be a watermelon',
  asPrivate: 'yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw',
  asPublic: 'BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8',
  uaPublic: 'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4',
  auth: 'BTBZMqHH6r4Tts7J_aSIgg',
  salt: 'DGv6ra1nlYgDCS1FRnbzlw',
  body: 'DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN',
};

test('le chiffrement reproduit le vecteur de la RFC 8291', async () => {
  const pub = b64u.dec(V.asPublic);
  const jwk = { kty: 'EC', crv: 'P-256', d: V.asPrivate, x: b64u.enc(pub.slice(1, 33)), y: b64u.enc(pub.slice(33, 65)) };
  const privateKey = await crypto.subtle.importKey('jwk', jwk, { name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const publicKey = await crypto.subtle.importKey('raw', pub, { name: 'ECDH', namedCurve: 'P-256' }, true, []);
  const body = await encrypt(V.plaintext, V.uaPublic, V.auth, { salt: b64u.dec(V.salt), localKeys: { privateKey, publicKey } });
  assert.equal(b64u.enc(body), V.body);
});

test("un message chiffré se déchiffre avec la clé de l'appareil (chemin indépendant)", async () => {
  const ua = createECDH('prime256v1');
  ua.generateKeys();
  const auth = Buffer.from(crypto.getRandomValues(new Uint8Array(16)));
  const message = JSON.stringify({ title: '9 h · 3 personnes à rappeler', body: 'Propriétaire, librairie, garage' });
  const body = Buffer.from(await encrypt(message, b64u.enc(ua.getPublicKey()), b64u.enc(auth)));

  const salt = body.subarray(0, 16);
  assert.equal(body.readUInt32BE(16), 4096);
  const idlen = body[20];
  const asPublic = body.subarray(21, 21 + idlen);
  const cipher = body.subarray(21 + idlen);
  const shared = ua.computeSecret(asPublic);
  const ikm = Buffer.from(hkdfSync('sha256', shared, auth, Buffer.concat([Buffer.from('WebPush: info\0'), ua.getPublicKey(), asPublic]), 32));
  const cek = Buffer.from(hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16));
  const nonce = Buffer.from(hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12));
  const d = createDecipheriv('aes-128-gcm', cek, nonce);
  d.setAuthTag(cipher.subarray(cipher.length - 16));
  const plain = Buffer.concat([d.update(cipher.subarray(0, cipher.length - 16)), d.final()]);
  assert.equal(plain[plain.length - 1], 2);
  assert.equal(plain.subarray(0, -1).toString(), message);
});

test("l'en-tête VAPID porte un jeton signé et valide", async () => {
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const jwk = privateKey.export({ format: 'jwk' });
  const pubJwk = publicKey.export({ format: 'jwk' });
  const raw = Buffer.concat([Buffer.from([4]), Buffer.from(pubJwk.x, 'base64url'), Buffer.from(pubJwk.y, 'base64url')]);
  const env = { VAPID_PRIVATE_JWK: JSON.stringify(jwk), VAPID_PUBLIC: b64u.enc(raw), VAPID_SUBJECT: 'mailto:test@example.com' };
  const header = await vapidAuth(env, 'https://web.push.apple.com/abc/def', Date.UTC(2026, 10, 16));
  const [, token, k] = header.match(/^vapid t=([^,]+), k=(.+)$/);
  assert.equal(k, env.VAPID_PUBLIC);
  const [h, p, s] = token.split('.');
  const claims = JSON.parse(Buffer.from(p, 'base64url').toString());
  assert.equal(claims.aud, 'https://web.push.apple.com');
  assert.equal(claims.sub, 'mailto:test@example.com');
  assert.ok(claims.exp > Date.UTC(2026, 10, 16) / 1000 && claims.exp <= Date.UTC(2026, 10, 17) / 1000);
  const ok = verify('sha256', Buffer.from(`${h}.${p}`), { key: createPublicKey({ key: pubJwk, format: 'jwk' }), dsaEncoding: 'ieee-p1363' }, Buffer.from(s, 'base64url'));
  assert.ok(ok, 'signature ES256 valide');
});
