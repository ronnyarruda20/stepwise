-- Stepwise — modelo inicial (08/10/2026).
-- conta = quem faz login (e-mail do Google). perfil = quem estuda: uma conta pode ter vários perfis
-- (a Maria e o Ronny no mesmo iPhone), e cada perfil tem o seu nível, as suas provas e os seus erros.

CREATE TABLE conta (
  id           INTEGER PRIMARY KEY,
  email        TEXT NOT NULL UNIQUE,
  nome         TEXT,
  criado_em    TEXT NOT NULL,
  sessao_desde TEXT              -- "Sair" revoga todo cookie assinado antes disto (como no Bola Alta)
);

CREATE TABLE perfil (
  id         INTEGER PRIMARY KEY,
  conta_id   INTEGER NOT NULL REFERENCES conta(id),
  nome       TEXT NOT NULL,
  nivel      TEXT,               -- CEFR: pre-A1 · A1 · A2 · B1 · B2 · C1 · C2; NULL = ainda não fez a prova
  nivel_em   TEXT,
  criado_em  TEXT NOT NULL
);
CREATE INDEX perfil_conta ON perfil(conta_id);

-- Uma prova de nivelamento ou uma conversa.
CREATE TABLE sessao (
  id          TEXT PRIMARY KEY,  -- uuid
  perfil_id   INTEGER NOT NULL REFERENCES perfil(id),
  tipo        TEXT NOT NULL CHECK (tipo IN ('prova', 'conversa')),
  tema        TEXT,              -- conversa: dia-a-dia · viagem · trabalho · livre
  estado      TEXT NOT NULL,     -- JSON: a escada da prova, ou o nível usado na conversa
  status      TEXT NOT NULL CHECK (status IN ('aberta', 'avaliando', 'fechada', 'falhou')),
  resultado   TEXT,              -- JSON: nota final (prova) ou relatório (conversa)
  iniciado_em TEXT NOT NULL,
  fechado_em  TEXT
);
CREATE INDEX sessao_perfil ON sessao(perfil_id, iniciado_em);

-- Cada fala, da IA ou do aluno. As medidas de fluência saem da transcrição (tempo de cada palavra).
CREATE TABLE turno (
  id            INTEGER PRIMARY KEY,
  sessao_id     TEXT NOT NULL REFERENCES sessao(id),
  ordem         INTEGER NOT NULL,
  papel         TEXT NOT NULL CHECK (papel IN ('ia', 'aluno')),
  texto         TEXT NOT NULL,
  tarefa_id     TEXT,            -- prova: qual tarefa do banco esta fala responde
  nivel_tarefa  TEXT,
  duracao_s     REAL,
  palavras      INTEGER,
  ppm           REAL,            -- palavras por minuto
  pausas_longas INTEGER,
  veredito      TEXT,            -- JSON: o que o juiz disse desta resposta
  criado_em     TEXT NOT NULL
);
-- ÚNICO: dois envios do mesmo turno (toque duplo, rede que repete) não gravam duas falas — o 2º recebe 409.
CREATE UNIQUE INDEX turno_sessao ON turno(sessao_id, ordem);

-- Erros que o professor apontou na conversa: alimentam a próxima sessão ("memória dos erros").
CREATE TABLE erro (
  id          INTEGER PRIMARY KEY,
  perfil_id   INTEGER NOT NULL REFERENCES perfil(id),
  sessao_id   TEXT NOT NULL REFERENCES sessao(id),
  errado      TEXT NOT NULL,
  certo       TEXT NOT NULL,
  explicacao  TEXT,
  categoria   TEXT,
  criado_em   TEXT NOT NULL
);
CREATE INDEX erro_perfil ON erro(perfil_id, criado_em);

-- Toda mudança de nível fica registrada, com a origem.
CREATE TABLE nivel_historico (
  id         INTEGER PRIMARY KEY,
  perfil_id  INTEGER NOT NULL REFERENCES perfil(id),
  nivel      TEXT NOT NULL,
  origem     TEXT NOT NULL CHECK (origem IN ('prova', 'manual')),
  sessao_id  TEXT,
  criado_em  TEXT NOT NULL
);
