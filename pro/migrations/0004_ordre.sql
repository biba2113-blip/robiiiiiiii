-- L'ordre choisi à la main dans une journée : la position de la tâche parmi celles qui n'ont pas d'heure fixe.
-- NULL : Pro la place selon son propre ordre (échéance, obligation, quelqu'un attend, fait avancer, le reste).
ALTER TABLE tasks ADD COLUMN manual INTEGER;
