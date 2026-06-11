# 🏛️ Maze Chase — Polícia vs Ladrão

Jogo multiplayer online de labirinto. Até 10 jogadores, 4 ladrões vs policiais.

---

## 🚀 Deploy (passo a passo)

### 1. Supabase — criar tabela

1. Acesse [supabase.com](https://supabase.com) → seu projeto
2. Clique em **SQL Editor** no menu lateral
3. Cole e execute o seguinte SQL:

```sql
CREATE TABLE IF NOT EXISTS rooms (
  code TEXT PRIMARY KEY,
  state JSONB NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE rooms ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public read"   ON rooms FOR SELECT USING (true);
CREATE POLICY "Public insert" ON rooms FOR INSERT WITH CHECK (true);
CREATE POLICY "Public update" ON rooms FOR UPDATE USING (true);

ALTER PUBLICATION supabase_realtime ADD TABLE rooms;
```

4. Clique em **Run**

---

### 2. GitHub — subir o código

1. Acesse [github.com](https://github.com) → clique em **New repository**
2. Nome: `maze-chase` → clique **Create repository**
3. Na página do repositório, clique em **uploading an existing file**
4. Arraste todos os arquivos desta pasta para o GitHub
5. Clique **Commit changes**

---

### 3. Vercel — fazer o deploy

1. Acesse [vercel.com](https://vercel.com) → **Add New Project**
2. Conecte sua conta do GitHub
3. Selecione o repositório `maze-chase`
4. Clique **Deploy**
5. Aguarde 1-2 minutos

Pronto! O Vercel vai gerar uma URL como `maze-chase.vercel.app` — compartilhe com qualquer pessoa!

---

## 🎮 Como jogar

1. Abra a URL do jogo
2. Clique **CRIAR NOVA SALA** — aparece um código de 4 letras
3. Mande o código para seu filho pelo WhatsApp
4. Ele abre a mesma URL, digita o código e entra
5. Escolham os papéis (👮 Policial / 🦹 Ladrão)
6. Clique **▶ INICIAR PARTIDA**

**Objetivo:**
- 🦹 Ladrões: coletam todas as 💎 joias antes de serem presos
- 👮 Policiais: prendem todos os ladrões chegando perto deles

**Controles:** WASD ou Setas do teclado, ou botões na tela
