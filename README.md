# Agenda de Mentorias

API de agendamento de mentorias: o mentor publica a agenda da semana, o aluno vê os horários livres (sem feriados e bloqueios) e marca sem criar conta. Para cancelar, usa o código que recebeu na marcação.

**Demo (Swagger):** [agenda-mentorias.onrender.com/docs](https://agenda-mentorias.onrender.com/docs). Para testar a área do mentor sem cadastro, `POST /auth/demo` cria uma conta de 24 h já com agenda; cole o token em **Authorize**. O plano grátis do Render dorme sem visitas, e a primeira leva uns 30 s para acordar.

<p>
  <img src="docs/rotas.png" width="49%" alt="Swagger com as 20 rotas: saúde, público (mentores, horários, marcar, cancelar), área do mentor e autenticação com 2FA">
  <img src="docs/horarios.png" width="49%" alt="GET /mentores/{id}/horarios de 16 a 20/11/2026: horários na segunda 16 e na quarta 18, em UTC; a sexta 20 (Consciência Negra) não aparece">
</p>

À direita, a agenda de seg/qua/sex das 9h às 12h (em UTC: 12:00Z–15:00Z) de 16 a 20/11/2026: a sexta, 20, é feriado (Consciência Negra), e a BrasilAPI a tirou da lista.

**Stack:** Node 22 · **NestJS 11** · TypeScript · **Prisma 7** · PostgreSQL 16 · class-validator · Swagger (OpenAPI) · **Jest** + Supertest · Docker · GitHub Actions · Render + Neon

## Funcionalidades

- **Público (sem conta):**
  - lista de mentores e **horários livres** num período de até 31 dias;
  - **marcar** com nome e e-mail: a resposta traz o **código de cancelamento**, que só aparece nessa hora;
  - **cancelar** com o código, até o horário começar.
- **Área do mentor** (token Bearer):
  - perfil com **fuso**, duração dos horários (15–240 min) e antecedência mínima;
  - **agenda semanal** em janelas (ex.: seg 09:00–12:00 e 14:00–17:00);
  - **bloqueios** de folga e férias;
  - marcações do período e cancelamento pelo mentor.
- **Regras da marcação:**
  - **um horário, uma pessoa**, garantido pelo banco mesmo com pedidos simultâneos;
  - **feriados nacionais** fora da agenda (BrasilAPI, com cache);
  - antecedência mínima, até 60 dias à frente e no máximo 3 marcações futuras por e-mail com o mesmo mentor;
  - **`Idempotency-Key`**: o clique duplo devolve a mesma marcação e o mesmo código.
- **Conta:** cadastro e login com **bcrypt (custo 12)** e **2FA por TOTP** (QR code e 10 códigos de recuperação).
- **LGPD:** 30 dias depois do horário, nome e e-mail do aluno viram `anonimizado`.
- **Demonstração:** `POST /auth/demo` cria um mentor de 24 h, com agenda, que depois some com tudo o que tiver. Três mentores de exemplo (fictícios) são criados no primeiro start.
- **Rate limit** em todas as rotas, com `429` e `Retry-After`:

  | Rotas | Limite por IP |
  |---|---|
  | cadastro, login, 2FA | 5 / 15 min |
  | conta de demonstração | 5 / hora |
  | marcar e cancelar (público) | 10 / min |
  | escrita na área do mentor | 30 / min |
  | o resto (leitura) | 120 / min |

## Arquitetura

```
prisma/
  schema.prisma          modelo (mentores, credenciais, agenda, bloqueios, marcações, feriados)
  migrations/            SQL gerado + exclusion constraints e CHECKs que o Prisma não declara
src/
  dominio/horarios.ts    regra pura: horários livres e por que um horário não pode ser marcado
  agenda/                rotas públicas e da área do mentor, DTOs e o serviço
  auth/                  cadastro, login, 2FA, guarda do token e conta de demonstração
  seguranca/             TOTP (RFC 6238), AES-256-GCM, hashes e códigos aleatórios
  feriados/              BrasilAPI com cache no banco e timeout
  limpeza/               tarefa de hora em hora: anonimização e demonstrações vencidas
  infra/                 Prisma, relógio e fetch injetáveis (os testes trocam os dois)
  config/ambiente.ts     o app não sobe se faltar variável ou se a chave estiver errada
test/                    e2e contra PostgreSQL real
docs/banco.md            roteiro do banco preenchido: regras, índices, decisões
```

### Decisões

- **A vaga única é garantida pelo banco, não por um `SELECT` antes do `INSERT`.** Entre a consulta e a inserção, outra requisição pode marcar o mesmo horário. Uma **exclusion constraint** do PostgreSQL (`tstzrange(inicio, fim) &&` por mentor, só nas confirmadas) recusa a segunda marcação, e a API responde **409**. O teste dispara **10 marcações ao mesmo tempo** no mesmo horário: 1 × 201 e 9 × 409.
- **Código de cancelamento em vez de conta para o aluno.** Marcar uma mentoria não deveria exigir cadastro. O código tem 32 caracteres aleatórios, e o banco guarda só o SHA-256. Ele vem de um HMAC do id da marcação com a chave do servidor, então o reenvio com a mesma `Idempotency-Key` devolve o mesmo código sem que ele fique guardado.
- **Regra de horário isolada e relógio injetável.** `dominio/horarios.ts` não conhece Nest nem Prisma: recebe agenda, ocupados, feriados e "agora", e devolve os horários. Os testes e2e fixam o relógio em 01/11/2026 e trocam a BrasilAPI por uma resposta roteirizada (Finados em 02/11).
- **Fuso:** a agenda semanal é lida no fuso do mentor (Luxon), e tudo vai para o banco em UTC. A API devolve UTC (`...Z`) e aceita qualquer offset (`2026-11-03T09:00:00-03:00`).
- **BrasilAPI fora do ar não derruba a agenda.** Timeout de 5 s; se falhar, a agenda segue sem os feriados daquele ano e tenta de novo em 10 minutos. Com resposta, o ano fica em cache no banco e a API externa não é chamada de novo.
- **Erros pela pergunta "de quem é a falha?":**
  - **do aluno:** dado inválido → **400**, horário fora da agenda, feriado ou sem antecedência → **422** com o motivo, vaga tomada → **409**;
  - **de permissão:** recurso de outro mentor → **404**, igual a não existir (não revela que existe);
  - **de terceiro:** BrasilAPI → segue sem o dado e registra no log;
  - **login errado:** a mesma mensagem com e sem conta, e o bcrypt roda nos dois casos (o tempo não revela se o e-mail existe).
- **2FA:** o segredo TOTP fica cifrado (AES-256-GCM). O banco guarda o último passo usado, e o mesmo código não entra duas vezes. Depois da senha, o login devolve um **token temporário de 5 min** que só serve para `/auth/login/2fa`.
- **Isolamento na camada de serviço, não em RLS:** com o Prisma, toda consulta da área do mentor filtra por `mentor_id`. O motivo está em [docs/banco.md](docs/banco.md).
- **NestJS 11 e não 12:** o 12 só sai em ESM e o CLI dele já cria o projeto com Vitest. O 11 roda com Jest em CommonJS sem adaptação.

## Rodando

Precisa de Node 22 e Docker.

```bash
docker compose up -d db     # Postgres 16 na porta 5435, dono sem superusuário (igual ao Neon)
cp .env.example .env
npm install
npx prisma generate
npx prisma migrate deploy
npm run start:dev           # http://localhost:3004/docs
```

Ou a imagem de produção:

```bash
docker build -t agenda-mentorias .
docker run -p 3004:3004 -e DATABASE_URL=postgresql://agenda:agenda-dev@host.docker.internal:5435/agenda \
  -e JWT_SECRET=um-segredo-local-com-mais-de-32-caracteres -e ENCRYPTION_KEY=$(openssl rand -hex 32) agenda-mentorias
```

## Testes

```bash
npm test             # 18 testes de unidade (regra de horários, TOTP com os vetores da RFC 6238, cifra, ambiente)
npm run test:e2e     # 28 testes da API inteira contra PostgreSQL real (docker compose up -d db)
```

- **Horários:** fuso do mentor, feriado da BrasilAPI, BrasilAPI fora do ar, cache (uma chamada por ano), período inválido.
- **Marcar:** 10 pedidos simultâneos → exatamente 1 marca; `Idempotency-Key` com os dois pedidos chegando juntos; antecedência, bloqueio, limite por e-mail, campo a mais → 400.
- **Cancelar:** pelo código (e o código não serve de novo), depois do início não pode, pelo mentor.
- **Isolamento:** um mentor tenta ler, cancelar e apagar o que é de outro → 404.
- **Conta:** e-mail único sem diferenciar maiúsculas, bcrypt custo 12, a mesma mensagem com e sem conta.
- **2FA:** QR code, ativação, token temporário recusado na área do mentor, código reusado → 401, código de recuperação uma vez só.
- **Limpeza:** anonimização depois de 30 dias e demonstração vencida apagada com tudo.
- **Rate limit:** a 6ª tentativa de login em 15 min → 429 com `Retry-After`.
- **Documentação:** toda rota está no OpenAPI.

O CI roda lint, typecheck, testes de unidade, e2e contra um PostgreSQL no próprio Actions e o build, além do build da imagem Docker e do gitleaks em todo o histórico.

## Deploy (Render + Neon)

1. No Neon, crie um **projeto só para esta API** e copie a connection string **direta** (sem `-pooler`), com `?sslmode=require`.
2. No Render: **New + → Blueprint** → este repositório (`render.yaml`). Cole a `DATABASE_URL`; o `JWT_SECRET` e a `ENCRYPTION_KEY` são gerados pelo Render.
3. Cada subida roda `prisma migrate deploy` antes de ligar a API. A primeira cria a extensão `btree_gist`, as tabelas e os três mentores de exemplo.

## Autor

Ademar C. Neto · [portfólio](https://ademarchamineto.github.io) · [GitHub](https://github.com/AdemarChamiNeto)
