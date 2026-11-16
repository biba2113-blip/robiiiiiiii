// Ce que Pro te dit juste après que tu as coché une tâche.
const CHEERS = ['Une de moins.', 'Rayée.', 'Ça avance.', 'Et hop.', 'Réglé.'];

/** Ce que tu lis juste après avoir coché. */
export function cheerFor(t, { done, total, avoided = false, pick = Math.random() } = {}) {
  const left = total - done;
  if (left === 0) return 'Feuille terminée. Bravo !';
  const lead = avoided
    ? 'Tu la repoussais, c’est fait.'
    : t.section === 'priorite'
      ? 'Priorité réglée.'
      : t.section === 'rappel'
        ? 'Appel fait.'
        : CHEERS[Math.floor(pick * CHEERS.length) % CHEERS.length];
  const tail = left <= 3 ? (left === 1 ? 'Plus qu’une.' : `Plus que ${left}.`) : done * 2 === total || done * 2 === total + 1 ? 'La moitié est faite.' : `${done} sur ${total}.`;
  return `${lead} ${tail}`;
}
