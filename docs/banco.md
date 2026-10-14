# Banco de dados

Roteiro de `_padroes/prompt-banco-de-dados.md` preenchido para este projeto, com as decisões e o porquê.

## Contexto
- **O que é:** API de agendamento de mentorias. O mentor publica a agenda da semana; o aluno vê os horários livres e marca sem criar conta. Cancela com o código que recebe na marcação.
- **Multi-tenant:** cada mentor só vê e mexe no que é dele (agenda, bloqueios, marcações). Não há empresa nem workspace.
- **Banco:** PostgreSQL 16 com Prisma 7 (`@prisma/adapter-pg`). Produção: um projeto Neon só desta API.
- **Acesso:** só a API fala com o banco. Não existe front que conecte direto.
- **Volume esperado:** dezenas de mentores, centenas de marcações por mês. A consulta mais frequente é "horários livres de um mentor entre duas datas": as marcações e os bloqueios do mentor no período.

## Papéis
| Papel | Pode | Não pode |
|---|---|---|
| **Visitante / aluno** (sem conta) | listar mentores, ver horários livres, marcar, cancelar com o código | ver marcações de ninguém, nem as próprias (o código só cancela) |
| **Mentor** (e-mail, senha e 2FA) | editar perfil e agenda, bloquear períodos, ver e cancelar as próprias marcações | ver ou mexer em agenda, bloqueio ou marcação de outro mentor (→ 404) |
| **Demonstração** (24 h, sem dados) | o mesmo que o mentor | aparecer na lista pública; entrar com senha |

## Modelo
```
mentores 1──1 credenciais                (senha bcrypt, segredo TOTP cifrado)
mentores 1──N codigos_recuperacao        (SHA-256)
mentores 1──N disponibilidades           (janela semanal: dia, início e fim em minutos)
mentores 1──N bloqueios                  (folga, férias: intervalo em UTC)
mentores 1──N marcacoes                  (aluno, início/fim em UTC, status, hash do código)
feriados                                 (cache da BrasilAPI, sem relação)
```
- **Status da marcação:** `CONFIRMADA` → `CANCELADA` (pelo aluno ou pelo mentor). Não volta.
- **Apagar de verdade:** só a conta de demonstração vencida (com tudo dela, em cascata). Marcação não é apagada: é cancelada e, 30 dias depois do horário, anonimizada.

## Regras que o banco garante (e não só a aplicação)
| Regra | Como |
|---|---|
| **Dois alunos não marcam o mesmo horário**, nem com dez pedidos no mesmo milissegundo | `EXCLUDE USING gist (mentor_id WITH =, tstzrange(inicio, fim, '[)') WITH &&) WHERE (status = 'CONFIRMADA')`. Testado com 10 requisições simultâneas: 1 × 201 e 9 × 409 |
| Horário cancelado libera a vaga | o `WHERE` da mesma restrição só olha as confirmadas |
| Janelas do mesmo dia não se sobrepõem | `EXCLUDE (mentor_id =, dia_semana =, int4range(inicio_min, fim_min) &&)` |
| Clique duplo não marca duas vezes | `UNIQUE (mentor_id, chave_idempotencia)`: o segundo pedido devolve a mesma marcação |
| E-mail único sem diferenciar maiúsculas | `UNIQUE (email)` + `CHECK (email = lower(email))` |
| Cancelada ⇔ tem data de cancelamento | `CHECK ((status = 'CANCELADA') = (cancelada_em IS NOT NULL))` |
| Intervalos válidos, dia 1–7, duração 15–240 min, antecedência até 7 dias | `CHECK` em cada tabela |

O Prisma não sabe declarar `EXCLUDE` nem `CHECK`. Eles estão em SQL no fim da migração inicial (`prisma/migrations/…_inicial/migration.sql`), e a extensão `btree_gist` permite misturar `=` de UUID com `&&` de intervalo no mesmo índice.

## Índices
| Índice | Por quê |
|---|---|
| `marcacoes (mentor_id, inicio)` | horários livres e marcações do mentor num período |
| `marcacoes (aluno_email, inicio)` | o limite de 3 marcações futuras por e-mail com o mesmo mentor |
| `marcacoes_sem_sobreposicao` (gist) | a regra da vaga única; também serve à busca por sobreposição |
| `bloqueios (mentor_id, inicio)` | bloqueios do mentor no período |
| `disponibilidades (mentor_id)` | chave estrangeira; a agenda inteira do mentor é lida de uma vez |
| `feriados (ano)` | o cache é lido por ano |
| UNIQUEs (`email`, `codigo_cancelamento_hash`, `(mentor_id, chave_idempotencia)`, `(mentor_id, codigo_hash)`) | as regras de unicidade; o do código de cancelamento é a busca do cancelamento |

## Dados sensíveis
| Coluna | Tratamento |
|---|---|
| `credenciais.senha_hash` | bcrypt custo 12, em tabela separada do perfil (consultar o perfil nunca traz o hash) |
| `credenciais.totp_segredo` | AES-256-GCM com a `ENCRYPTION_KEY` (fora do banco) |
| `codigos_recuperacao.codigo_hash` e `marcacoes.codigo_cancelamento_hash` | SHA-256: são aleatórios e longos, então não precisam do custo do bcrypt |
| `marcacoes.aluno_nome` e `aluno_email` | viram `anonimizado` 30 dias depois do horário (tarefa de hora em hora) |

## Decisões (onde fugi do roteiro, de propósito)
- **Isolamento na camada de serviço, não em RLS.** O roteiro pede Row Level Security. Com o Prisma, a RLS exigiria um `SET LOCAL` com o id do mentor em cada transação, e a parte pública (horários, marcar, cancelar) precisaria de outra policy. Por isso, toda consulta da área do mentor filtra por `mentor_id` no serviço, e recurso de outro mentor responde **404**, não 403. Há teste e2e que tenta ler e cancelar o recurso de outro mentor.
- **`updated_at` pelo Prisma (`@updatedAt`), não por trigger.** Só a API escreve no banco, e o Prisma atualiza o campo em toda escrita. Tabelas que só recebem inserção (`bloqueios`, `codigos_recuperacao`, `feriados`) não têm `updated_at`.
- **Sem `deleted_at`.** Marcação tem status e anonimização; bloqueio e janela de agenda apagados não têm valor histórico; conta real não é apagada pela API.
- **O código de cancelamento não é guardado:** ele sai de um HMAC do id da marcação com a chave do servidor. Assim, o reenvio com a mesma `Idempotency-Key` devolve o mesmo código, e o banco só guarda o hash.
- **Horários em UTC, agenda no fuso do mentor.** A janela "seg 09:00–12:00" está em minutos no fuso do mentor (`America/Sao_Paulo` por padrão), e cada marcação vai para o banco em `timestamptz`. Testado com um mentor em `America/Manaus`.
- **Feriados em cache:** a BrasilAPI é chamada uma vez por ano. Se ela estiver fora, a agenda continua sem os feriados daquele ano e tenta de novo em 10 minutos.
- **CASCADE em todas as chaves estrangeiras.** Tudo pertence ao mentor, e só a demonstração vencida é apagada. Cada FK tem o motivo comentado no `schema.prisma`.

## Pontos de atenção
- **Rate limit em memória:** com uma instância só (plano grátis do Render) basta. Com duas ou mais, o contador vai para o Redis ou para o banco.
- **A tarefa de limpeza roda em cada instância.** Com mais de uma, as duas fazem o mesmo `UPDATE` (é idempotente, mas desperdiça); a saída seria um advisory lock.
- **Conexões:** 5 por instância (`max: 5` no pool), dentro do limite do Neon grátis.
