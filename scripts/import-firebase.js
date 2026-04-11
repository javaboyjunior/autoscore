#!/usr/bin/env node
/**
 * Import Firebase export into PostgreSQL.
 *
 * Usage:
 *   DATABASE_URL=postgresql://autoscore:PASSWORD@localhost:5432/autoscore \
 *   node scripts/import-firebase.js
 *
 * Run AFTER init-db.sql has been applied and the database is empty.
 * Safe to re-run: uses ON CONFLICT DO NOTHING (no-op on duplicates).
 */

'use strict';

const path = require('path');
const { Pool } = require('pg');
const data = require('./firebase-export.json');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

// Firebase IDs that exist in scores but not in the cars array — skip them.
const ORPHANED_CAR_IDS = new Set(['TDNbNkvYknhuNA7je9nD']);

async function main() {
  const client = await pool.connect();

  // Maps Firebase string ID → PostgreSQL UUID
  const eventMap  = new Map();
  const carMap    = new Map();
  const judgeMap  = new Map();

  try {
    await client.query('BEGIN');

    // ── Events ──────────────────────────────────────────────────────────────
    console.log(`Inserting ${data.events.length} events…`);
    for (const e of data.events) {
      const { rows } = await client.query(
        `INSERT INTO events (name, date, is_current)
         VALUES ($1, $2, $3)
         ON CONFLICT DO NOTHING
         RETURNING id`,
        [e.name, e.date, e.isCurrent ?? false],
      );
      if (rows.length) {
        eventMap.set(e.id, rows[0].id);
      } else {
        // Row already existed — fetch its id
        const { rows: existing } = await client.query(
          `SELECT id FROM events WHERE name = $1 AND date = $2`,
          [e.name, e.date],
        );
        if (existing.length) eventMap.set(e.id, existing[0].id);
      }
    }
    console.log(`  eventMap: ${eventMap.size} entries`);

    // ── Cars ─────────────────────────────────────────────────────────────────
    console.log(`Inserting ${data.cars.length} cars…`);
    let carsSkipped = 0;
    for (const c of data.cars) {
      const pgEventId = eventMap.get(c.eventId);
      if (!pgEventId) {
        console.warn(`  SKIP car ${c.id}: unknown eventId ${c.eventId}`);
        carsSkipped++;
        continue;
      }
      const { rows } = await client.query(
        `INSERT INTO cars (event_id, registration_id, owner_info, make, model, year, color)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (event_id, registration_id) DO UPDATE
           SET owner_info = EXCLUDED.owner_info,
               make       = EXCLUDED.make,
               model      = EXCLUDED.model,
               year       = EXCLUDED.year,
               color      = EXCLUDED.color
         RETURNING id`,
        [
          pgEventId,
          parseInt(c.registrationId, 10),
          c.ownerInfo  ?? '',
          c.make       ?? '',
          c.model      ?? '',
          parseInt(c.year, 10) || 0,
          c.color      ?? '',
        ],
      );
      if (rows.length) carMap.set(c.id, rows[0].id);
    }
    console.log(`  carMap: ${carMap.size} entries, skipped: ${carsSkipped}`);

    // ── Judges ───────────────────────────────────────────────────────────────
    console.log(`Inserting ${data.judges.length} judges…`);
    let judgesSkipped = 0;
    for (const j of data.judges) {
      const pgEventId = eventMap.get(j.eventId);
      if (!pgEventId) {
        console.warn(`  SKIP judge ${j.id}: unknown eventId ${j.eventId}`);
        judgesSkipped++;
        continue;
      }
      const { rows } = await client.query(
        `INSERT INTO judges (event_id, name, email, password)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT DO NOTHING
         RETURNING id`,
        [pgEventId, j.name, j.email ?? '', j.password ?? ''],
      );
      if (rows.length) {
        judgeMap.set(j.id, rows[0].id);
      } else {
        const { rows: existing } = await client.query(
          `SELECT id FROM judges WHERE event_id = $1 AND email = $2`,
          [pgEventId, j.email ?? ''],
        );
        if (existing.length) judgeMap.set(j.id, existing[0].id);
      }
    }
    console.log(`  judgeMap: ${judgeMap.size} entries, skipped: ${judgesSkipped}`);

    // ── Scores ───────────────────────────────────────────────────────────────
    console.log(`Inserting ${data.scores.length} scores…`);
    let scoresSkipped = 0;
    for (const s of data.scores) {
      if (ORPHANED_CAR_IDS.has(s.carId)) {
        scoresSkipped++;
        continue;
      }

      const pgCarId   = carMap.get(s.carId);
      const pgJudgeId = judgeMap.get(s.judgeId);
      const pgEventId = eventMap.get(s.eventId);

      if (!pgCarId || !pgJudgeId || !pgEventId) {
        console.warn(
          `  SKIP score ${s.id}: missing` +
          (!pgCarId   ? ` carId(${s.carId})`   : '') +
          (!pgJudgeId ? ` judgeId(${s.judgeId})` : '') +
          (!pgEventId ? ` eventId(${s.eventId})` : ''),
        );
        scoresSkipped++;
        continue;
      }

      await client.query(
        `INSERT INTO scores (car_id, judge_id, event_id, score, notes)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (car_id, judge_id) DO UPDATE
           SET score      = EXCLUDED.score,
               notes      = EXCLUDED.notes,
               updated_at = NOW()`,
        [pgCarId, pgJudgeId, pgEventId, s.score ?? null, s.notes ?? ''],
      );
    }
    console.log(`  inserted/updated: ${data.scores.length - scoresSkipped}, skipped: ${scoresSkipped}`);

    await client.query('COMMIT');
    console.log('\nImport complete.');

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Import failed — rolled back:', err.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

main();
