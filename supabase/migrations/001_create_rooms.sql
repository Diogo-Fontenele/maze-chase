-- Run this in Supabase SQL Editor
-- Project: maze-chase

CREATE TABLE IF NOT EXISTS rooms (
  code TEXT PRIMARY KEY,
  state JSONB NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable Row Level Security
ALTER TABLE rooms ENABLE ROW LEVEL SECURITY;

-- Allow anyone to read and write (public game)
CREATE POLICY "Public read" ON rooms FOR SELECT USING (true);
CREATE POLICY "Public insert" ON rooms FOR INSERT WITH CHECK (true);
CREATE POLICY "Public update" ON rooms FOR UPDATE USING (true);

-- Enable Realtime
ALTER PUBLICATION supabase_realtime ADD TABLE rooms;
