-- Run this in Supabase → SQL Editor to add the new pb_checkins table.
-- Safe to run multiple times.

CREATE TABLE IF NOT EXISTS pb_checkins (
  key        TEXT PRIMARY KEY,
  data       JSONB NOT NULL DEFAULT '{}',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Re-create the updated-at trigger
DROP TRIGGER IF EXISTS trg_updated_at ON pb_checkins;
CREATE TRIGGER trg_updated_at
  BEFORE UPDATE ON pb_checkins
  FOR EACH ROW EXECUTE PROCEDURE pb_touch_updated_at();

-- Enable Row Level Security with anon access
ALTER TABLE pb_checkins ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "anon_all" ON pb_checkins;
CREATE POLICY "anon_all" ON pb_checkins
  FOR ALL TO anon USING (true) WITH CHECK (true);
