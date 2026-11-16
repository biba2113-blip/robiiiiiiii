-- Étape 2 : temps réel, notifications, appels, ce qui revient. Étape 3 : assistant du Mac.
ALTER TABLE tasks ADD COLUMN actual_minutes INTEGER;   -- temps mesuré au chrono
ALTER TABLE tasks ADD COLUMN phone TEXT;
ALTER TABLE tasks ADD COLUMN note TEXT;                -- ex. « Message laissé à 9 h 12 »
ALTER TABLE tasks ADD COLUMN recurring_id INTEGER;

-- Le chrono : une ligne par période passée sur une tâche ou sur un imprévu.
CREATE TABLE entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  day TEXT NOT NULL,
  kind TEXT NOT NULL,                -- task | imprevu
  task_id INTEGER,
  label TEXT,
  started_at INTEGER NOT NULL,       -- millisecondes
  ended_at INTEGER,
  resume_task_id INTEGER             -- la tâche à reprendre après un imprévu
);
CREATE INDEX idx_entries_day ON entries(day);

-- Les appareils qui reçoivent les notifications.
CREATE TABLE push_subs (
  endpoint TEXT PRIMARY KEY,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  created_at TEXT NOT NULL
);

-- Ce qui a déjà été envoyé, pour ne jamais notifier deux fois.
CREATE TABLE sent (key TEXT PRIMARY KEY, at INTEGER NOT NULL);

-- Ce qui revient : paies, taxes, renouvellements.
CREATE TABLE recurring (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  company TEXT NOT NULL DEFAULT 'perso',
  est_minutes INTEGER NOT NULL DEFAULT 30,
  every TEXT NOT NULL,               -- week | month | quarter | year
  next_due TEXT NOT NULL,            -- prochaine échéance, AAAA-MM-JJ
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);

-- L'assistant du Mac : une ligne par minute active.
CREATE TABLE activity (
  day TEXT NOT NULL,
  minute INTEGER NOT NULL,
  app TEXT,
  site TEXT,
  kind TEXT NOT NULL,                -- feuille | libre | hors | imprevu
  PRIMARY KEY (day, minute)
);

-- Les événements à montrer au bilan : rappel affiché, « continuer quand même », assistant fermé.
CREATE TABLE journal (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  day TEXT NOT NULL,
  at INTEGER NOT NULL,
  kind TEXT NOT NULL,                -- remind | override | assistant_stop | assistant_start
  detail TEXT
);
CREATE INDEX idx_journal_day ON journal(day);
