CREATE TABLE tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  section TEXT NOT NULL DEFAULT 'faire',   -- priorite | rappel | faire
  company TEXT NOT NULL DEFAULT 'perso',   -- robiii | immo | perso
  nature TEXT NOT NULL DEFAULT 'autre',    -- obligation | attend | avance | autre
  day TEXT,                                -- AAAA-MM-JJ ; NULL = réserve
  due_date TEXT,
  est_minutes INTEGER NOT NULL DEFAULT 30,
  start_min INTEGER,                       -- minutes depuis minuit
  pinned INTEGER NOT NULL DEFAULT 0,       -- 1 = heure choisie à la main
  status TEXT NOT NULL DEFAULT 'todo',     -- todo | done | deleted
  done_at TEXT,
  pushed_count INTEGER NOT NULL DEFAULT 0,
  first_step TEXT,
  contact TEXT,
  cal_uid TEXT,
  cal_sig TEXT,
  sort REAL NOT NULL DEFAULT 0,
  source TEXT NOT NULL DEFAULT 'manuel',
  created_at TEXT NOT NULL
);
CREATE INDEX idx_tasks_day ON tasks(day, status);
CREATE INDEX idx_tasks_due ON tasks(due_date, status);

CREATE TABLE days (
  date TEXT PRIMARY KEY,
  work_start INTEGER NOT NULL,
  work_end INTEGER NOT NULL,
  evening_work INTEGER NOT NULL DEFAULT 0,
  evening_end INTEGER,
  prepared_at TEXT
);

CREATE TABLE captures (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  raw_text TEXT NOT NULL,
  parsed_json TEXT,
  engine TEXT,
  source TEXT NOT NULL DEFAULT 'app',
  default_day TEXT,
  created_at TEXT NOT NULL,
  confirmed_at TEXT
);

CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
