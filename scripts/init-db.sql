-- AutoScore Live — PostgreSQL schema
-- Run once:  psql "$DATABASE_URL" < scripts/init-db.sql

-- ── Tables ───────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS events (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name       TEXT NOT NULL,
  date       TEXT NOT NULL,
  is_current BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS cars (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id        UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  registration_id INTEGER NOT NULL,
  owner_info      TEXT NOT NULL DEFAULT '',
  make            TEXT NOT NULL DEFAULT '',
  model           TEXT NOT NULL DEFAULT '',
  year            INTEGER NOT NULL DEFAULT 0,
  color           TEXT NOT NULL DEFAULT '',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (event_id, registration_id)
);

CREATE TABLE IF NOT EXISTS judges (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id   UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  email      TEXT NOT NULL,
  password   TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS scores (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  car_id     UUID NOT NULL REFERENCES cars(id) ON DELETE CASCADE,
  judge_id   UUID NOT NULL REFERENCES judges(id) ON DELETE CASCADE,
  event_id   UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  score      NUMERIC(4,1),
  notes      TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (car_id, judge_id)
);

-- ── Indexes ──────────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS cars_event_id_idx    ON cars(event_id);
CREATE INDEX IF NOT EXISTS judges_event_id_idx  ON judges(event_id);
CREATE INDEX IF NOT EXISTS scores_event_id_idx  ON scores(event_id);
CREATE INDEX IF NOT EXISTS scores_judge_id_idx  ON scores(judge_id);
CREATE INDEX IF NOT EXISTS scores_car_id_idx    ON scores(car_id);

-- ── LISTEN/NOTIFY triggers ───────────────────────────────────────────────────
-- Each INSERT/UPDATE/DELETE fires pg_notify('autoscore_changes', payload).
-- The Express SSE endpoint listens and pushes these to connected browsers,
-- replicating Firebase's onSnapshot behaviour.

CREATE OR REPLACE FUNCTION autoscore_notify_change()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  rec       json;
  event_id_val text;
BEGIN
  rec := row_to_json(COALESCE(NEW, OLD));

  -- events rows have no event_id column; use id instead
  IF TG_TABLE_NAME = 'events' THEN
    event_id_val := rec->>'id';
  ELSE
    event_id_val := rec->>'event_id';
  END IF;

  PERFORM pg_notify(
    'autoscore_changes',
    json_build_object(
      'table',    TG_TABLE_NAME,
      'action',   TG_OP,
      'id',       rec->>'id',
      'event_id', event_id_val
    )::text
  );
  RETURN COALESCE(NEW, OLD);
END;
$$;

-- Drop and recreate triggers so this script is idempotent
DROP TRIGGER IF EXISTS events_notify  ON events;
DROP TRIGGER IF EXISTS cars_notify    ON cars;
DROP TRIGGER IF EXISTS judges_notify  ON judges;
DROP TRIGGER IF EXISTS scores_notify  ON scores;

CREATE TRIGGER events_notify
  AFTER INSERT OR UPDATE OR DELETE ON events
  FOR EACH ROW EXECUTE FUNCTION autoscore_notify_change();

CREATE TRIGGER cars_notify
  AFTER INSERT OR UPDATE OR DELETE ON cars
  FOR EACH ROW EXECUTE FUNCTION autoscore_notify_change();

CREATE TRIGGER judges_notify
  AFTER INSERT OR UPDATE OR DELETE ON judges
  FOR EACH ROW EXECUTE FUNCTION autoscore_notify_change();

CREATE TRIGGER scores_notify
  AFTER INSERT OR UPDATE OR DELETE ON scores
  FOR EACH ROW EXECUTE FUNCTION autoscore_notify_change();
