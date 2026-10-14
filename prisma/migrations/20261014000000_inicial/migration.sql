-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "StatusMarcacao" AS ENUM ('CONFIRMADA', 'CANCELADA');

-- CreateTable
CREATE TABLE "mentores" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "nome" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "bio" TEXT NOT NULL DEFAULT '',
    "fuso" TEXT NOT NULL DEFAULT 'America/Sao_Paulo',
    "duracao_minutos" INTEGER NOT NULL DEFAULT 60,
    "antecedencia_minutos" INTEGER NOT NULL DEFAULT 120,
    "demo_expira_em" TIMESTAMPTZ(6),
    "criado_em" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizado_em" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "mentores_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "credenciais" (
    "mentor_id" UUID NOT NULL,
    "senha_hash" TEXT NOT NULL,
    "totp_segredo" TEXT,
    "totp_ativado_em" TIMESTAMPTZ(6),
    "totp_ultimo_passo" INTEGER,
    "atualizado_em" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "credenciais_pkey" PRIMARY KEY ("mentor_id")
);

-- CreateTable
CREATE TABLE "codigos_recuperacao" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "mentor_id" UUID NOT NULL,
    "codigo_hash" TEXT NOT NULL,
    "usado_em" TIMESTAMPTZ(6),

    CONSTRAINT "codigos_recuperacao_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "disponibilidades" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "mentor_id" UUID NOT NULL,
    "dia_semana" INTEGER NOT NULL,
    "inicio_min" INTEGER NOT NULL,
    "fim_min" INTEGER NOT NULL,

    CONSTRAINT "disponibilidades_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bloqueios" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "mentor_id" UUID NOT NULL,
    "inicio" TIMESTAMPTZ(6) NOT NULL,
    "fim" TIMESTAMPTZ(6) NOT NULL,
    "motivo" TEXT NOT NULL DEFAULT '',
    "criado_em" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bloqueios_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "marcacoes" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "mentor_id" UUID NOT NULL,
    "aluno_nome" TEXT NOT NULL,
    "aluno_email" TEXT NOT NULL,
    "inicio" TIMESTAMPTZ(6) NOT NULL,
    "fim" TIMESTAMPTZ(6) NOT NULL,
    "status" "StatusMarcacao" NOT NULL DEFAULT 'CONFIRMADA',
    "codigo_cancelamento_hash" TEXT NOT NULL,
    "chave_idempotencia" TEXT,
    "cancelada_em" TIMESTAMPTZ(6),
    "cancelada_por" TEXT,
    "anonimizada_em" TIMESTAMPTZ(6),
    "criado_em" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "marcacoes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "feriados" (
    "data" DATE NOT NULL,
    "ano" INTEGER NOT NULL,
    "nome" TEXT NOT NULL,

    CONSTRAINT "feriados_pkey" PRIMARY KEY ("data")
);

-- CreateIndex
CREATE UNIQUE INDEX "mentores_email_key" ON "mentores"("email");

-- CreateIndex
CREATE UNIQUE INDEX "codigos_recuperacao_mentor_id_codigo_hash_key" ON "codigos_recuperacao"("mentor_id", "codigo_hash");

-- CreateIndex
CREATE INDEX "disponibilidades_mentor_id_idx" ON "disponibilidades"("mentor_id");

-- CreateIndex
CREATE INDEX "bloqueios_mentor_id_inicio_idx" ON "bloqueios"("mentor_id", "inicio");

-- CreateIndex
CREATE UNIQUE INDEX "marcacoes_codigo_cancelamento_hash_key" ON "marcacoes"("codigo_cancelamento_hash");

-- CreateIndex
CREATE INDEX "marcacoes_mentor_id_inicio_idx" ON "marcacoes"("mentor_id", "inicio");

-- CreateIndex
CREATE INDEX "marcacoes_aluno_email_inicio_idx" ON "marcacoes"("aluno_email", "inicio");

-- CreateIndex
CREATE UNIQUE INDEX "marcacoes_mentor_id_chave_idempotencia_key" ON "marcacoes"("mentor_id", "chave_idempotencia");

-- CreateIndex
CREATE INDEX "feriados_ano_idx" ON "feriados"("ano");

-- AddForeignKey
ALTER TABLE "credenciais" ADD CONSTRAINT "credenciais_mentor_id_fkey" FOREIGN KEY ("mentor_id") REFERENCES "mentores"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "codigos_recuperacao" ADD CONSTRAINT "codigos_recuperacao_mentor_id_fkey" FOREIGN KEY ("mentor_id") REFERENCES "mentores"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "disponibilidades" ADD CONSTRAINT "disponibilidades_mentor_id_fkey" FOREIGN KEY ("mentor_id") REFERENCES "mentores"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bloqueios" ADD CONSTRAINT "bloqueios_mentor_id_fkey" FOREIGN KEY ("mentor_id") REFERENCES "mentores"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "marcacoes" ADD CONSTRAINT "marcacoes_mentor_id_fkey" FOREIGN KEY ("mentor_id") REFERENCES "mentores"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- ---------------------------------------------------------------------------
-- O que o Prisma não sabe declarar: exclusion constraints e CHECKs.
-- ---------------------------------------------------------------------------

-- btree_gist é "trusted": o dono do banco cria (no Neon e no Docker local, sem superusuário)
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- A regra principal: duas marcações confirmadas do mesmo mentor nunca se sobrepõem.
-- Fica no banco, e não só no código, porque dois pedidos que chegam juntos passam juntos por
-- qualquer "SELECT ... já existe?" da aplicação; aqui o segundo recebe erro 23P01.
ALTER TABLE "marcacoes" ADD CONSTRAINT "marcacoes_sem_sobreposicao"
  EXCLUDE USING gist ("mentor_id" WITH =, tstzrange("inicio", "fim", '[)') WITH &&)
  WHERE ("status" = 'CONFIRMADA');
ALTER TABLE "marcacoes" ADD CONSTRAINT "marcacoes_intervalo" CHECK ("fim" > "inicio");
ALTER TABLE "marcacoes" ADD CONSTRAINT "marcacoes_cancelamento" CHECK (("status" = 'CANCELADA') = ("cancelada_em" IS NOT NULL));
ALTER TABLE "marcacoes" ADD CONSTRAINT "marcacoes_cancelada_por" CHECK ("cancelada_por" IS NULL OR "cancelada_por" IN ('aluno', 'mentor'));

-- janelas da agenda semanal: dia ISO, dentro do dia e sem sobreposição no mesmo dia
ALTER TABLE "disponibilidades" ADD CONSTRAINT "disponibilidades_dia" CHECK ("dia_semana" BETWEEN 1 AND 7);
ALTER TABLE "disponibilidades" ADD CONSTRAINT "disponibilidades_horario" CHECK ("inicio_min" >= 0 AND "fim_min" <= 1440 AND "fim_min" > "inicio_min");
ALTER TABLE "disponibilidades" ADD CONSTRAINT "disponibilidades_sem_sobreposicao"
  EXCLUDE USING gist ("mentor_id" WITH =, "dia_semana" WITH =, int4range("inicio_min", "fim_min") WITH &&);

ALTER TABLE "bloqueios" ADD CONSTRAINT "bloqueios_intervalo" CHECK ("fim" > "inicio");
ALTER TABLE "mentores" ADD CONSTRAINT "mentores_duracao" CHECK ("duracao_minutos" BETWEEN 15 AND 240);
ALTER TABLE "mentores" ADD CONSTRAINT "mentores_antecedencia" CHECK ("antecedencia_minutos" BETWEEN 0 AND 10080);
ALTER TABLE "mentores" ADD CONSTRAINT "mentores_email_minusculo" CHECK ("email" = lower("email"));
