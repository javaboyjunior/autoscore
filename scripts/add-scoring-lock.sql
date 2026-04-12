-- Add scoring_locked flag to events table.
-- Run once: db < scripts/add-scoring-lock.sql

ALTER TABLE events ADD COLUMN IF NOT EXISTS scoring_locked BOOLEAN NOT NULL DEFAULT FALSE;
