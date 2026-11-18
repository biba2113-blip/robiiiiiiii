-- Les moments hors travail (voir ma blonde, des amis, le gym).
-- Avec une heure, ils réservent leur place à l'horaire ; sans heure, ils restent à part.
-- Dans les deux cas, ils ne comptent pas dans le temps de travail.
ALTER TABLE tasks ADD COLUMN kind TEXT NOT NULL DEFAULT 'tache';   -- tache | vie
