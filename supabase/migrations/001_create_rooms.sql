-- =============================================
-- MAZE CHASE — Execute no SQL Editor do Supabase
-- Dashboard → SQL Editor → New query → Cole tudo → Run
-- =============================================

-- 1. Cria a tabela
CREATE TABLE IF NOT EXISTS rooms (
  code        TEXT PRIMARY KEY,
  state       JSONB NOT NULL DEFAULT '{}',
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Habilita RLS
ALTER TABLE rooms ENABLE ROW LEVEL SECURITY;

-- 3. Remove políticas antigas se existirem
DROP POLICY IF EXISTS "Public read"   ON rooms;
DROP POLICY IF EXISTS "Public insert" ON rooms;
DROP POLICY IF EXISTS "Public update" ON rooms;
DROP POLICY IF EXISTS "Public upsert" ON rooms;

-- 4. Cria políticas permissivas (jogo público)
CREATE POLICY "Public read"   ON rooms FOR SELECT USING (true);
CREATE POLICY "Public insert" ON rooms FOR INSERT WITH CHECK (true);
CREATE POLICY "Public update" ON rooms FOR UPDATE USING (true);

-- 5. Habilita Realtime
ALTER PUBLICATION supabase_realtime ADD TABLE rooms;

-- 6. Confirma
SELECT 'Tabela rooms criada com sucesso!' AS status;
