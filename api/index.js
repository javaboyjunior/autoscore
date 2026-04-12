'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

const express    = require('express');
const rateLimit  = require('express-rate-limit');
const { Pool }   = require('pg');
const crypto     = require('crypto');
const path       = require('path');

const app = express();

// Don't advertise the framework
app.disable('x-powered-by');

// Nginx sits in front
app.set('trust proxy', 1);

// ── Database ────────────────────────────────────────────────────────────────
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: /localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL || '')
    ? false
    : { rejectUnauthorized: false },
});

// ── GitHub webhook (raw body BEFORE express.json) ───────────────────────────
app.post('/hooks/deploy', express.raw({ type: 'application/json' }), (req, res) => {
  const secret = process.env.GITHUB_SECRET;
  if (!secret) {
    console.error('[webhook] GITHUB_SECRET not set');
    return res.status(500).send('Server misconfigured');
  }

  const sigHeader = req.headers['x-hub-signature-256'] || '';
  const expected  = 'sha256=' + crypto
    .createHmac('sha256', secret)
    .update(req.body)
    .digest('hex');

  if (
    sigHeader.length !== expected.length ||
    !crypto.timingSafeEqual(Buffer.from(sigHeader), Buffer.from(expected))
  ) {
    return res.status(401).send('Invalid signature');
  }

  if (req.headers['x-github-event'] !== 'push') return res.status(200).send('Ignored');

  let payload;
  try { payload = JSON.parse(req.body.toString()); } catch { return res.status(400).send('Bad JSON'); }
  if (payload.ref !== 'refs/heads/main') return res.status(200).send('Ignored');

  res.status(200).send('Deploying');

  const { exec } = require('child_process');
  const deployScript = path.join(__dirname, '../deploy.sh');
  const logPath      = '/home/ubuntu/.pm2/logs/deploy.log';
  exec(`bash "${deployScript}" >> "${logPath}" 2>&1`, {
    env: { ...process.env, PATH: '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:/usr/lib/node_modules/.bin' }
  }, (err) => {
    if (err) console.error('[webhook] Deploy failed:', err.message);
    else     console.log('[webhook] Deploy complete');
  });

  console.log('[webhook] Deploy triggered');
});

app.use(express.json());

// ── Static files (Vite build output) ───────────────────────────────────────
const DIST_DIR = path.join(__dirname, '../dist');
app.use(express.static(DIST_DIR, { index: false }));

// ── Rate limiters ───────────────────────────────────────────────────────────
const readLimiter = rateLimit({
  windowMs: 60 * 1000, max: 300,
  standardHeaders: true, legacyHeaders: false,
  keyGenerator: (req) => req.ip || '127.0.0.1',
  handler: (_req, res) => res.status(429).json({ error: 'Too many requests' }),
});

const writeLimiter = rateLimit({
  windowMs: 60 * 1000, max: 60,
  standardHeaders: true, legacyHeaders: false,
  keyGenerator: (req) => req.ip || '127.0.0.1',
  handler: (_req, res) => res.status(429).json({ error: 'Too many requests' }),
});

// Strict limiter for auth — 10 attempts per 15 minutes per IP
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, max: 10,
  standardHeaders: true, legacyHeaders: false,
  keyGenerator: (req) => req.ip || '127.0.0.1',
  handler: (_req, res) => res.status(429).json({ error: 'Too many login attempts — try again later' }),
});

// ── SSE — real-time change stream ───────────────────────────────────────────
// Keeps a dedicated pg client with LISTEN open. Any INSERT/UPDATE/DELETE on
// events/cars/judges/scores fires a pg_notify, which we forward to all
// connected browser clients as a Server-Sent Event.

const sseClients = new Set();

async function startNotifyListener() {
  // Use a dedicated connection (not the pool) for LISTEN
  const listenClient = new (require('pg').Client)({
    connectionString: process.env.DATABASE_URL,
    ssl: /localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL || '')
      ? false
      : { rejectUnauthorized: false },
  });

  try {
    await listenClient.connect();
    await listenClient.query('LISTEN autoscore_changes');
    console.log('[sse] PostgreSQL LISTEN ready');

    listenClient.on('notification', (msg) => {
      if (msg.channel !== 'autoscore_changes') return;
      const payload = msg.payload || '{}';
      for (const client of sseClients) {
        try {
          client.write(`data: ${payload}\n\n`);
        } catch {
          sseClients.delete(client);
        }
      }
    });

    listenClient.on('error', (err) => {
      console.error('[sse] pg LISTEN error:', err.message);
      setTimeout(startNotifyListener, 5000);
    });

    listenClient.on('end', () => {
      console.warn('[sse] pg LISTEN connection ended — reconnecting');
      setTimeout(startNotifyListener, 5000);
    });
  } catch (err) {
    console.error('[sse] Failed to connect LISTEN client:', err.message);
    setTimeout(startNotifyListener, 5000);
  }
}

// GET /api/stream — SSE endpoint
app.get('/api/stream', (req, res) => {
  res.writeHead(200, {
    'Content-Type':  'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection':    'keep-alive',
    'X-Accel-Buffering': 'no',   // disable Nginx buffering for SSE
  });

  // Send an initial heartbeat so the client knows it's connected
  res.write(': connected\n\n');

  // Keep-alive ping every 30 seconds
  const ping = setInterval(() => {
    try { res.write(': ping\n\n'); } catch { /* client gone */ }
  }, 30000);

  sseClients.add(res);

  req.on('close', () => {
    clearInterval(ping);
    sseClients.delete(res);
  });
});

// ── Events ──────────────────────────────────────────────────────────────────
app.get('/api/events', readLimiter, async (_req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT id, name, date, is_current AS "isCurrent", scoring_locked AS "scoringLocked" FROM events ORDER BY date DESC',
    );
    res.json(rows);
  } catch (err) {
    console.error('[GET /api/events]', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/api/events', writeLimiter, async (req, res) => {
  try {
    const { name, date, isCurrent } = req.body;
    if (!name || !date) return res.status(400).json({ error: 'name and date are required' });

    const { rows } = await pool.query(
      `INSERT INTO events (name, date, is_current) VALUES ($1, $2, $3)
       RETURNING id, name, date, is_current AS "isCurrent"`,
      [name.trim(), date, !!isCurrent],
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error('[POST /api/events]', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/events/:id/set-current — atomically clears all, sets one
app.put('/api/events/:id/set-current', writeLimiter, async (req, res) => {
  try {
    await pool.query('BEGIN');
    await pool.query('UPDATE events SET is_current = FALSE');
    const { rows } = await pool.query(
      `UPDATE events SET is_current = TRUE WHERE id = $1
       RETURNING id, name, date, is_current AS "isCurrent"`,
      [req.params.id],
    );
    await pool.query('COMMIT');
    if (!rows.length) { await pool.query('ROLLBACK'); return res.status(404).json({ error: 'Not found' }); }
    res.json(rows[0]);
  } catch (err) {
    await pool.query('ROLLBACK').catch(() => {});
    console.error('[PUT /api/events/:id/set-current]', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT /api/events/:id/lock — lock or unlock scoring
app.put('/api/events/:id/lock', writeLimiter, async (req, res) => {
  const { locked } = req.body;
  if (typeof locked !== 'boolean') return res.status(400).json({ error: 'locked (boolean) required' });
  try {
    const { rows } = await pool.query(
      `UPDATE events SET scoring_locked = $1 WHERE id = $2
       RETURNING id, name, date, is_current AS "isCurrent", scoring_locked AS "scoringLocked"`,
      [locked, req.params.id],
    );
    if (!rows.length) return res.status(404).json({ error: 'Not found' });
    res.json(rows[0]);
  } catch (err) {
    console.error('[PUT /api/events/:id/lock]', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.delete('/api/events/:id', writeLimiter, async (req, res) => {
  try {
    // CASCADE DELETE in schema handles cars/judges/scores automatically
    const { rowCount } = await pool.query('DELETE FROM events WHERE id = $1', [req.params.id]);
    if (!rowCount) return res.status(404).json({ error: 'Not found' });
    res.json({ success: true });
  } catch (err) {
    console.error('[DELETE /api/events/:id]', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── Cars ─────────────────────────────────────────────────────────────────────
app.get('/api/cars', readLimiter, async (req, res) => {
  try {
    const { eventId } = req.query;
    if (!eventId) return res.status(400).json({ error: 'eventId is required' });
    const { rows } = await pool.query(
      `SELECT id, event_id AS "eventId", registration_id AS "registrationId",
              owner_info AS "ownerInfo", make, model, year, color
       FROM cars WHERE event_id = $1 ORDER BY registration_id`,
      [eventId],
    );
    res.json(rows);
  } catch (err) {
    console.error('[GET /api/cars]', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/api/cars', writeLimiter, async (req, res) => {
  try {
    const { eventId, registrationId, ownerInfo, make, model, year, color } = req.body;
    if (!eventId || !registrationId || !make || !model) {
      return res.status(400).json({ error: 'Missing required fields' });
    }
    const { rows } = await pool.query(
      `INSERT INTO cars (event_id, registration_id, owner_info, make, model, year, color)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id, event_id AS "eventId", registration_id AS "registrationId",
                 owner_info AS "ownerInfo", make, model, year, color`,
      [eventId, registrationId, ownerInfo, make, model, year, color],
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Duplicate registration ID for this event' });
    console.error('[POST /api/cars]', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.put('/api/cars/:id', writeLimiter, async (req, res) => {
  try {
    const { registrationId, ownerInfo, make, model, year, color, eventId } = req.body;
    const { rows } = await pool.query(
      `UPDATE cars
       SET registration_id = $1, owner_info = $2, make = $3, model = $4,
           year = $5, color = $6, event_id = $7
       WHERE id = $8
       RETURNING id, event_id AS "eventId", registration_id AS "registrationId",
                 owner_info AS "ownerInfo", make, model, year, color`,
      [registrationId, ownerInfo, make, model, year, color, eventId, req.params.id],
    );
    if (!rows.length) return res.status(404).json({ error: 'Not found' });
    res.json(rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Duplicate registration ID for this event' });
    console.error('[PUT /api/cars/:id]', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.delete('/api/cars/:id', writeLimiter, async (req, res) => {
  try {
    const { rowCount } = await pool.query('DELETE FROM cars WHERE id = $1', [req.params.id]);
    if (!rowCount) return res.status(404).json({ error: 'Not found' });
    res.json({ success: true });
  } catch (err) {
    console.error('[DELETE /api/cars/:id]', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── Judges ───────────────────────────────────────────────────────────────────
app.get('/api/judges', readLimiter, async (req, res) => {
  try {
    const { eventId } = req.query;
    if (!eventId) return res.status(400).json({ error: 'eventId is required' });
    const { rows } = await pool.query(
      `SELECT id, event_id AS "eventId", name, email, password
       FROM judges WHERE event_id = $1 ORDER BY name`,
      [eventId],
    );
    res.json(rows);
  } catch (err) {
    console.error('[GET /api/judges]', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/api/judges', writeLimiter, async (req, res) => {
  try {
    const { eventId, name, email, password } = req.body;
    if (!eventId || !name || !email || !password) {
      return res.status(400).json({ error: 'Missing required fields' });
    }
    const { rows } = await pool.query(
      `INSERT INTO judges (event_id, name, email, password)
       VALUES ($1, $2, $3, $4)
       RETURNING id, event_id AS "eventId", name, email, password`,
      [eventId, name.trim(), email.trim(), password],
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error('[POST /api/judges]', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.put('/api/judges/:id', writeLimiter, async (req, res) => {
  try {
    const { name, email, password } = req.body;
    let query, params;
    if (password) {
      query = `UPDATE judges SET name = $1, email = $2, password = $3 WHERE id = $4
               RETURNING id, event_id AS "eventId", name, email, password`;
      params = [name, email, password, req.params.id];
    } else {
      query = `UPDATE judges SET name = $1, email = $2 WHERE id = $3
               RETURNING id, event_id AS "eventId", name, email, password`;
      params = [name, email, req.params.id];
    }
    const { rows } = await pool.query(query, params);
    if (!rows.length) return res.status(404).json({ error: 'Not found' });
    res.json(rows[0]);
  } catch (err) {
    console.error('[PUT /api/judges/:id]', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.delete('/api/judges/:id', writeLimiter, async (req, res) => {
  try {
    const { rowCount } = await pool.query('DELETE FROM judges WHERE id = $1', [req.params.id]);
    if (!rowCount) return res.status(404).json({ error: 'Not found' });
    res.json({ success: true });
  } catch (err) {
    console.error('[DELETE /api/judges/:id]', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── Scores ───────────────────────────────────────────────────────────────────
app.get('/api/scores', readLimiter, async (req, res) => {
  try {
    const { eventId, judgeId } = req.query;
    if (!eventId) return res.status(400).json({ error: 'eventId is required' });

    let query = `SELECT id, car_id AS "carId", judge_id AS "judgeId",
                        event_id AS "eventId", score::float AS score, notes
                 FROM scores WHERE event_id = $1`;
    const params = [eventId];

    if (judgeId) {
      query += ' AND judge_id = $2';
      params.push(judgeId);
    }

    const { rows } = await pool.query(query, params);
    res.json(rows);
  } catch (err) {
    console.error('[GET /api/scores]', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/api/scores', writeLimiter, async (req, res) => {
  try {
    const { carId, judgeId, eventId, score, notes } = req.body;
    if (!carId || !judgeId || !eventId || score === undefined) {
      return res.status(400).json({ error: 'Missing required fields' });
    }
    const lockCheck = await pool.query('SELECT scoring_locked FROM events WHERE id = $1', [eventId]);
    if (lockCheck.rows[0]?.scoring_locked) {
      return res.status(423).json({ error: 'Scoring is locked for this event' });
    }
    // Upsert — one score per judge per car
    const { rows } = await pool.query(
      `INSERT INTO scores (car_id, judge_id, event_id, score, notes)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (car_id, judge_id) DO UPDATE
         SET score = EXCLUDED.score, notes = EXCLUDED.notes, updated_at = NOW()
       RETURNING id, car_id AS "carId", judge_id AS "judgeId",
                 event_id AS "eventId", score::float AS score, notes`,
      [carId, judgeId, eventId, score, notes || ''],
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error('[POST /api/scores]', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.put('/api/scores/:id', writeLimiter, async (req, res) => {
  try {
    const { score, notes, carId, judgeId, eventId } = req.body;
    const lockCheck = await pool.query('SELECT scoring_locked FROM events WHERE id = $1', [eventId]);
    if (lockCheck.rows[0]?.scoring_locked) {
      return res.status(423).json({ error: 'Scoring is locked for this event' });
    }
    const { rows } = await pool.query(
      `UPDATE scores SET score = $1, notes = $2, car_id = $3, judge_id = $4,
              event_id = $5, updated_at = NOW()
       WHERE id = $6
       RETURNING id, car_id AS "carId", judge_id AS "judgeId",
                 event_id AS "eventId", score::float AS score, notes`,
      [score, notes || '', carId, judgeId, eventId, req.params.id],
    );
    if (!rows.length) return res.status(404).json({ error: 'Not found' });
    res.json(rows[0]);
  } catch (err) {
    console.error('[PUT /api/scores/:id]', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ── Admin auth ───────────────────────────────────────────────────────────────
// Tokens are stored in memory (Map) with a 24-hour TTL.
// They reset on server restart — acceptable for a show-day app.
const adminTokens = new Map(); // token -> expiresAt (ms)

// Timing-safe string compare — prevents timing attacks on credential checks
function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

app.post('/api/admin/login', authLimiter, (req, res) => {
  const { username, password } = req.body || {};
  if (
    process.env.ADMIN_USERNAME &&
    safeEqual(username, process.env.ADMIN_USERNAME) &&
    safeEqual(password, process.env.ADMIN_PASSWORD)
  ) {
    const token = crypto.randomBytes(32).toString('hex');
    adminTokens.set(token, Date.now() + 24 * 60 * 60 * 1000);
    return res.json({ token });
  }
  res.status(401).json({ error: 'Invalid credentials' });
});

app.get('/api/admin/verify', (req, res) => {
  const token = (req.headers.authorization || '').replace('Bearer ', '');
  const expiry = token && adminTokens.get(token);
  if (expiry && expiry > Date.now()) return res.json({ ok: true });
  if (token) adminTokens.delete(token);
  res.status(401).json({ ok: false });
});

// ── Basic health ping ────────────────────────────────────────────────────────
// GET /api/health — for uptime monitors (UptimeRobot etc.)
app.get('/api/health', (_req, res) => {
  res.json({ ok: true, timestamp: new Date().toISOString() });
});

// ── Backup health check ──────────────────────────────────────────────────────
// GET /api/health/backup?secret=<HEALTH_SECRET>
// Returns 200 { ok:true } if a backup exists in S3 within the last 25 hours.
// Clawdbot (or any monitoring tool) can hit this daily.
app.get('/api/health/backup', (req, res) => {
  const secret = process.env.HEALTH_SECRET;
  if (!secret || req.query.secret !== secret) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const bucket = process.env.S3_BUCKET_NAME;
  const prefix = process.env.S3_PREFIX || 'autoscore/backups';
  if (!bucket) return res.status(500).json({ ok: false, error: 'S3_BUCKET_NAME not configured' });

  const { exec } = require('child_process');
  // List objects, sort chronologically, take the most recent line
  exec(`aws s3 ls "s3://${bucket}/${prefix}/" | sort | tail -1`, (err, stdout) => {
    if (err) return res.status(500).json({ ok: false, error: err.message });

    const line = stdout.trim();
    if (!line) return res.status(500).json({ ok: false, error: 'No backups found in S3' });

    // aws s3 ls output: "2026-04-11 03:00:01      123456 autoscore_20260411_030001.sql.gz"
    const match = line.match(/^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})/);
    if (!match) return res.status(500).json({ ok: false, error: 'Cannot parse S3 listing', raw: line });

    const backupTime = new Date(match[1] + ' UTC');
    const ageHours   = (Date.now() - backupTime.getTime()) / 3_600_000;
    const ok         = ageHours < 25;

    res.status(ok ? 200 : 500).json({
      ok,
      lastBackup: backupTime.toISOString(),
      ageHours:   Math.round(ageHours * 10) / 10,
      message:    ok ? 'Backup is current' : `Last backup is ${Math.round(ageHours)}h old — expected < 25h`,
    });
  });
});

// ── SPA fallback — send index.html for all non-API routes ───────────────────
app.use((req, res) => {
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ error: 'Not found' });
  }
  res.sendFile(path.join(DIST_DIR, 'index.html'));
});

// ── Start ────────────────────────────────────────────────────────────────────
if (require.main === module) {
  const PORT = process.env.PORT || 3000;
  const server = app.listen(PORT, async () => {
    console.log(`http://localhost:${PORT}`);
    await startNotifyListener();
  });

  // Graceful shutdown — PM2 sends SIGTERM before killing the process.
  // Finish in-flight requests, close the DB pool, then exit cleanly.
  process.on('SIGTERM', () => {
    console.log('[shutdown] SIGTERM received — draining connections');
    server.close(() => {
      pool.end().then(() => {
        console.log('[shutdown] Clean exit');
        process.exit(0);
      });
    });
  });
}

module.exports = app;
