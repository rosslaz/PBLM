-- ─────────────────────────────────────────────────────────────────────────────
-- Pickleball League Manager — Supabase Schema
-- Run this entire script in: Supabase Dashboard → SQL Editor → Run
-- Safe to re-run (uses IF NOT EXISTS / ON CONFLICT DO NOTHING)
-- ─────────────────────────────────────────────────────────────────────────────

-- ── Leagues ───────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS pb_leagues (
  id         TEXT PRIMARY KEY,          -- e.g. "league_1"
  data       JSONB NOT NULL DEFAULT '{}',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── Players ───────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS pb_players (
  id         TEXT PRIMARY KEY,          -- e.g. "player_1"
  data       JSONB NOT NULL DEFAULT '{}',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── Registrations (player ↔ league membership + paid status) ─────────────────
CREATE TABLE IF NOT EXISTS pb_registrations (
  key        TEXT PRIMARY KEY,          -- e.g. "league_1_player_1"
  data       JSONB NOT NULL DEFAULT '{}',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── Schedules (one row per league, stores the full weekly court schedule) ─────
CREATE TABLE IF NOT EXISTS pb_schedules (
  league_id  TEXT PRIMARY KEY,
  data       JSONB NOT NULL DEFAULT '{}',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── Scores (one row per match result) ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS pb_scores (
  key        TEXT PRIMARY KEY,          -- e.g. "league_1_1_w1_c0_m0"
  data       JSONB NOT NULL DEFAULT '{}',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── Locked weeks ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS pb_locked_weeks (
  key        TEXT PRIMARY KEY,          -- e.g. "league_1_w3"
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── Check-ins (player availability per league per week) ───────────────────────
CREATE TABLE IF NOT EXISTS pb_checkins (
  key        TEXT PRIMARY KEY,          -- e.g. "league_1_w3_player_5"
  data       JSONB NOT NULL DEFAULT '{}',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── Config (admin emails, auto-increment counters) ────────────────────────────
CREATE TABLE IF NOT EXISTS pb_config (
  id           INTEGER PRIMARY KEY DEFAULT 1,
  admin_emails TEXT[]   NOT NULL DEFAULT ARRAY['ross.lazar@gmail.com'],
  next_id      JSONB    NOT NULL DEFAULT '{"league":1,"player":1}',
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Seed the single config row (safe to run again — does nothing if row exists)
INSERT INTO pb_config (id, admin_emails, next_id)
VALUES (1, ARRAY['ross.lazar@gmail.com'], '{"league":1,"player":1}')
ON CONFLICT (id) DO NOTHING;

-- ── Auto-update timestamps on every write ────────────────────────────────────
CREATE OR REPLACE FUNCTION pb_touch_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

DO $$ DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['pb_leagues','pb_players','pb_registrations',
                            'pb_schedules','pb_scores','pb_checkins','pb_config'] LOOP
    EXECUTE format(
      'DROP TRIGGER IF EXISTS trg_updated_at ON %I;
       CREATE TRIGGER trg_updated_at BEFORE UPDATE ON %I
       FOR EACH ROW EXECUTE PROCEDURE pb_touch_updated_at();', t, t);
  END LOOP;
END $$;

-- ── Row Level Security — allow the anon key full access ───────────────────────
-- (The app enforces its own admin/player auth logic in the frontend)
DO $$ DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['pb_leagues','pb_players','pb_registrations',
                            'pb_schedules','pb_scores','pb_locked_weeks','pb_checkins','pb_config'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY;', t);
    EXECUTE format(
      'DROP POLICY IF EXISTS "anon_all" ON %I;
       CREATE POLICY "anon_all" ON %I FOR ALL TO anon USING (true) WITH CHECK (true);', t, t);
  END LOOP;
END $$;
