import test from 'node:test';
import assert from 'node:assert/strict';
import { eventsFromIcs, icsFor } from '../src/caldav.js';

const wrap = (body) => `BEGIN:VCALENDAR\r\nVERSION:2.0\r\n${body}\r\nEND:VCALENDAR\r\n`;
const ev = (lines) => `BEGIN:VEVENT\r\n${lines.join('\r\n')}\r\nEND:VEVENT`;
const DATE = '2026-11-16';

test('un rendez-vous en UTC tombe à la bonne heure de Montréal', () => {
  const out = eventsFromIcs(wrap(ev(['UID:a1', 'DTSTART:20261116T150000Z', 'DTEND:20261116T160000Z', 'SUMMARY:Notaire'])), DATE);
  assert.deepEqual(out, [{ uid: 'a1', title: 'Notaire', allDay: false, start_min: 600, end_min: 660 }]);
});

test('un rendez-vous avec fuseau, une durée et un titre replié', () => {
  const ics = wrap(ev(['UID:a2', 'DTSTART;TZID=America/Montreal:20261116T140000', 'DURATION:PT1H30M', 'SUMMARY:Visite Saint-Lin\\, 2e ', ' étage']));
  const [e] = eventsFromIcs(ics, DATE);
  assert.equal(e.start_min, 840);
  assert.equal(e.end_min, 930);
  assert.equal(e.title, 'Visite Saint-Lin, 2e étage');
});

test('un fuseau différent est converti', () => {
  const [e] = eventsFromIcs(wrap(ev(['UID:a3', 'DTSTART;TZID=Europe/Paris:20261116T150000', 'DTEND;TZID=Europe/Paris:20261116T153000', 'SUMMARY:Appel'])), DATE);
  assert.equal(e.start_min, 9 * 60);
});

test('journée entière, annulé, autre jour et blocs de Pro', () => {
  const ics = wrap(
    [
      ev(['UID:j', 'DTSTART;VALUE=DATE:20261116', 'DTEND;VALUE=DATE:20261117', 'SUMMARY:Fête']),
      ev(['UID:c', 'DTSTART:20261116T150000Z', 'DTEND:20261116T160000Z', 'STATUS:CANCELLED', 'SUMMARY:Annulé']),
      ev(['UID:d', 'DTSTART:20261117T150000Z', 'DTEND:20261117T160000Z', 'SUMMARY:Demain']),
      ev(['UID:pro-12-abcd', 'DTSTART:20261116T140000Z', 'DTEND:20261116T143000Z', 'SUMMARY:Bloc']),
    ].join('\r\n'),
  );
  const out = eventsFromIcs(ics, DATE);
  assert.equal(out.length, 1);
  assert.equal(out[0].allDay, true);
});

test("un rendez-vous répété non déplié garde son heure sur le jour demandé", () => {
  const ics = wrap(ev(['UID:r', 'DTSTART;TZID=America/Toronto:20260105T093000', 'DTEND;TZID=America/Toronto:20260105T100000', 'RRULE:FREQ=WEEKLY;BYDAY=MO', 'SUMMARY:Équipe']));
  const [e] = eventsFromIcs(ics, DATE);
  assert.equal(e.start_min, 570);
  assert.equal(e.end_min, 600);
});

test('un bloc écrit par Pro : heure UTC, alerte, marque', () => {
  const ics = icsFor({ id: 7, title: 'Soumission; triplex', section: 'priorite', day: DATE, start_min: 660, est_minutes: 45 }, 'pro-7-x');
  assert.match(ics, /UID:pro-7-x/);
  assert.match(ics, /DTSTART:20261116T160000Z/);
  assert.match(ics, /DTEND:20261116T164500Z/);
  assert.ok(ics.includes('SUMMARY:Soumission\\; triplex'));
  assert.match(ics, /BEGIN:VALARM[\s\S]*TRIGGER:PT0M/);
  assert.equal(eventsFromIcs(ics, DATE).length, 0);
});
