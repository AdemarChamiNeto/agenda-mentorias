import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { brasilApi, demo, limparBanco, relogio, subirApp } from './apoio';

let app: INestApplication;
const http = () => request(app.getHttpServer());

beforeAll(async () => {
  app = await subirApp();
});
beforeEach(() => limparBanco(app));
afterAll(() => app.close());

// terça, 03/11/2026, 09h em São Paulo = 12h UTC (segunda, 02/11, é Finados na BrasilAPI de mentira)
const TER_9H = '2026-11-03T09:00:00-03:00';
const marcar = (mentorId: string, corpo: object, chave?: string) => {
  const r = http().post(`/mentores/${mentorId}/marcacoes`);
  if (chave) r.set('Idempotency-Key', chave);
  return r.send({
    alunoNome: 'Bruno Lima',
    alunoEmail: 'bruno@exemplo.com',
    inicio: TER_9H,
    ...corpo,
  });
};

describe('horários livres', () => {
  it('lê a agenda no fuso do mentor, tira o feriado da BrasilAPI e devolve em UTC', async () => {
    const { mentorId } = await demo(app);
    const r = await http()
      .get(`/mentores/${mentorId}/horarios?de=2026-11-02&ate=2026-11-03`)
      .expect(200);
    expect(r.body.fuso).toBe('America/Sao_Paulo');
    expect(r.body.horarios.map((h: { inicio: string }) => h.inicio)).toEqual([
      // segunda 02/11 não aparece: Finados
      '2026-11-03T12:00:00.000Z',
      '2026-11-03T13:00:00.000Z',
      '2026-11-03T14:00:00.000Z',
      '2026-11-03T17:00:00.000Z',
      '2026-11-03T18:00:00.000Z',
      '2026-11-03T19:00:00.000Z',
    ]);
  });

  it('com a BrasilAPI fora do ar a agenda continua funcionando (só sem os feriados)', async () => {
    const { mentorId } = await demo(app);
    brasilApi.falhar = true;
    const r = await http()
      .get(`/mentores/${mentorId}/horarios?de=2026-11-02&ate=2026-11-02`)
      .expect(200);
    expect(r.body.horarios).toHaveLength(6);
  });

  it('o cache guarda os feriados: a BrasilAPI é chamada uma vez por ano', async () => {
    const { mentorId } = await demo(app);
    await http()
      .get(`/mentores/${mentorId}/horarios?de=2026-11-02&ate=2026-11-06`)
      .expect(200);
    await http()
      .get(`/mentores/${mentorId}/horarios?de=2026-11-09&ate=2026-11-13`)
      .expect(200);
    expect(brasilApi.chamadas).toBe(1);
  });

  it('período inválido é 400; mentor inexistente ou id malformado é 404', async () => {
    const { mentorId } = await demo(app);
    await http()
      .get(`/mentores/${mentorId}/horarios?de=2026-11-10&ate=2026-11-01`)
      .expect(400);
    await http()
      .get(`/mentores/${mentorId}/horarios?de=2026-11-01&ate=2026-12-31`)
      .expect(400);
    await http()
      .get(`/mentores/${mentorId}/horarios?de=ontem&ate=hoje`)
      .expect(400);
    await http()
      .get(
        '/mentores/00000000-0000-4000-8000-000000000000/horarios?de=2026-11-03&ate=2026-11-03',
      )
      .expect(404);
    await http()
      .get('/mentores/nao-e-uuid/horarios?de=2026-11-03&ate=2026-11-03')
      .expect(404);
  });
});

describe('marcar', () => {
  it('marca, devolve o código de cancelamento e tira o horário da lista', async () => {
    const { mentorId } = await demo(app);
    const r = await marcar(mentorId, {}).expect(201);
    expect(r.body).toMatchObject({
      mentorId,
      inicio: '2026-11-03T12:00:00.000Z',
      fim: '2026-11-03T13:00:00.000Z',
      status: 'CONFIRMADA',
    });
    expect(r.body.codigoCancelamento).toMatch(/^[A-Za-z0-9_-]{32}$/);
    const livres = await http().get(
      `/mentores/${mentorId}/horarios?de=2026-11-03&ate=2026-11-03`,
    );
    expect(
      livres.body.horarios.map((h: { inicio: string }) => h.inicio),
    ).not.toContain('2026-11-03T12:00:00.000Z');
  });

  it('10 pessoas no mesmo horário ao mesmo tempo: exatamente 1 consegue (exclusion constraint do banco)', async () => {
    const { mentorId } = await demo(app);
    const respostas = await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        marcar(mentorId, { alunoEmail: `aluno${i}@exemplo.com` }),
      ),
    );
    const status = respostas.map((r) => r.status).sort();
    expect(status).toEqual([201, ...Array(9).fill(409)]);
    expect(respostas.find((r) => r.status === 409)!.body.message).toBe(
      'esse horário acabou de ser marcado por outra pessoa',
    );
  });

  it('Idempotency-Key: o reenvio devolve a mesma marcação e o mesmo código, inclusive chegando junto', async () => {
    const { mentorId } = await demo(app);
    const [a, b] = await Promise.all([
      marcar(mentorId, {}, 'pedido-1'),
      marcar(mentorId, {}, 'pedido-1'),
    ]);
    expect([a.status, b.status].sort()).toEqual([201, 201]);
    expect(a.body.id).toBe(b.body.id);
    expect(a.body.codigoCancelamento).toBe(b.body.codigoCancelamento);
    const c = await marcar(mentorId, {}, 'pedido-1').expect(201);
    expect(c.body.id).toBe(a.body.id);
  });

  it.each([
    [
      'fora da agenda (09h30)',
      { inicio: '2026-11-03T09:30:00-03:00' },
      /não está na agenda/,
    ],
    [
      'feriado',
      { inicio: '2026-11-02T09:00:00-03:00' },
      /02\/11\/2026 é feriado \(Finados\)/,
    ],
    [
      'mais de 60 dias à frente',
      { inicio: '2027-02-02T09:00:00-03:00' },
      /60 dias/,
    ],
  ])('422 quando é %s', async (_nome, corpo, msg) => {
    const { mentorId } = await demo(app);
    const r = await marcar(mentorId, corpo).expect(422);
    expect(r.body.message).toMatch(msg);
  });

  it('respeita a antecedência mínima e os bloqueios do mentor', async () => {
    relogio.agora = new Date('2026-11-03T11:30:00Z'); // terça 08h30: a de 09h está a 30 min (< 1 h)
    const { mentorId, token } = await demo(app); // criada agora (a demonstração vence em 24 h)
    expect((await marcar(mentorId, {}).expect(422)).body.message).toMatch(
      /60 minutos de antecedência/,
    );

    relogio.agora = new Date('2026-11-02T12:00:00Z');
    await http()
      .post('/eu/bloqueios')
      .auth(token, { type: 'bearer' })
      .send({
        inicio: '2026-11-03T00:00:00-03:00',
        fim: '2026-11-04T00:00:00-03:00',
        motivo: 'Consulta médica',
      })
      .expect(201);
    expect((await marcar(mentorId, {}).expect(422)).body.message).toBe(
      'o mentor bloqueou esse horário',
    );
  });

  it('no máximo 3 marcações futuras por e-mail com o mesmo mentor', async () => {
    const { mentorId } = await demo(app);
    for (const h of ['09', '10', '11'])
      await marcar(mentorId, { inicio: `2026-11-03T${h}:00:00-03:00` }).expect(
        201,
      );
    const r = await marcar(mentorId, {
      inicio: '2026-11-03T14:00:00-03:00',
      alunoEmail: 'BRUNO@exemplo.com',
    }).expect(422);
    expect(r.body.message).toMatch(/no máximo 3/);
  });

  it('corpo inválido é 400, inclusive campo a mais (forbidNonWhitelisted)', async () => {
    const { mentorId } = await demo(app);
    await marcar(mentorId, { alunoEmail: 'nao-e-email' }).expect(400);
    await marcar(mentorId, { inicio: 'amanhã' }).expect(400);
    const extra = await marcar(mentorId, { status: 'CANCELADA' }).expect(400);
    expect(JSON.stringify(extra.body.message)).toContain('status');
  });
});

describe('cancelar', () => {
  it('o aluno cancela com o código, o horário volta a ficar livre e o código não serve de novo', async () => {
    const { mentorId } = await demo(app);
    const { codigoCancelamento } = (await marcar(mentorId, {}).expect(201))
      .body;
    await http()
      .post('/marcacoes/cancelar')
      .send({ codigo: codigoCancelamento })
      .expect(200);
    await http()
      .post('/marcacoes/cancelar')
      .send({ codigo: codigoCancelamento })
      .expect(409);
    await marcar(mentorId, { alunoEmail: 'outra@exemplo.com' }).expect(201); // o horário voltou
    await http()
      .post('/marcacoes/cancelar')
      .send({ codigo: 'x'.repeat(32) })
      .expect(404);
  });

  it('depois que o horário começou não dá mais para cancelar', async () => {
    const { mentorId } = await demo(app);
    const { codigoCancelamento } = (await marcar(mentorId, {}).expect(201))
      .body;
    relogio.agora = new Date('2026-11-03T12:10:00Z');
    await http()
      .post('/marcacoes/cancelar')
      .send({ codigo: codigoCancelamento })
      .expect(422);
  });
});

describe('área do mentor e isolamento', () => {
  it('sem token, token inválido ou o token temporário do 2FA: 401', async () => {
    await http().get('/eu').expect(401);
    await http().get('/eu').auth('nao-e-token', { type: 'bearer' }).expect(401);
  });

  it('um mentor não vê nem mexe no que é de outro (sempre 404, igual a não existir)', async () => {
    const ana = await demo(app);
    const beto = await demo(app);
    const daAna = (await marcar(ana.mentorId, {}).expect(201)).body;
    const bloqueioDaAna = (
      await http()
        .post('/eu/bloqueios')
        .auth(ana.token, { type: 'bearer' })
        .send({ inicio: '2026-11-10T00:00:00Z', fim: '2026-11-11T00:00:00Z' })
        .expect(201)
    ).body;

    await http()
      .post(`/eu/marcacoes/${daAna.id}/cancelar`)
      .auth(beto.token, { type: 'bearer' })
      .expect(404);
    await http()
      .delete(`/eu/bloqueios/${bloqueioDaAna.id}`)
      .auth(beto.token, { type: 'bearer' })
      .expect(404);
    const doBeto = await http()
      .get('/eu/marcacoes?de=2026-11-01&ate=2026-11-30')
      .auth(beto.token, { type: 'bearer' })
      .expect(200);
    expect(doBeto.body).toEqual([]);
    const daAnaLista = await http()
      .get('/eu/marcacoes?de=2026-11-01&ate=2026-11-30')
      .auth(ana.token, { type: 'bearer' })
      .expect(200);
    expect(daAnaLista.body.map((m: { id: string }) => m.id)).toEqual([
      daAna.id,
    ]);
    await http()
      .post(`/eu/marcacoes/${daAna.id}/cancelar`)
      .auth(ana.token, { type: 'bearer' })
      .expect(200);
  });

  it('troca a agenda semanal (janelas sobrepostas no mesmo dia: 422) e muda duração e fuso', async () => {
    const { token, mentorId } = await demo(app);
    await http()
      .put('/eu/disponibilidades')
      .auth(token, { type: 'bearer' })
      .send({
        janelas: [
          { diaSemana: 2, inicio: '09:00', fim: '12:00' },
          { diaSemana: 2, inicio: '11:00', fim: '13:00' },
        ],
      })
      .expect(422);
    const ok = await http()
      .put('/eu/disponibilidades')
      .auth(token, { type: 'bearer' })
      .send({ janelas: [{ diaSemana: 2, inicio: '18:00', fim: '20:00' }] })
      .expect(200);
    expect(ok.body).toEqual([{ diaSemana: 2, inicio: '18:00', fim: '20:00' }]);
    await http()
      .patch('/eu')
      .auth(token, { type: 'bearer' })
      .send({ duracaoMinutos: 30, fuso: 'America/Manaus' })
      .expect(200);
    await http()
      .patch('/eu')
      .auth(token, { type: 'bearer' })
      .send({ fuso: 'Lua/Base' })
      .expect(400);
    const r = await http()
      .get(`/mentores/${mentorId}/horarios?de=2026-11-03&ate=2026-11-03`)
      .expect(200);
    // terça 18h–20h em Manaus (UTC-4), de 30 em 30 min
    expect(r.body.horarios.map((h: { inicio: string }) => h.inicio)).toEqual([
      '2026-11-03T22:00:00.000Z',
      '2026-11-03T22:30:00.000Z',
      '2026-11-03T23:00:00.000Z',
      '2026-11-03T23:30:00.000Z',
    ]);
  });

  it('as contas de demonstração não aparecem na lista pública de mentores', async () => {
    await demo(app);
    expect((await http().get('/mentores').expect(200)).body).toEqual([]);
  });
});

describe('saúde e documentação', () => {
  it('/saude responde, / leva ao Swagger e toda rota está documentada', async () => {
    await http().get('/saude').expect(200, { ok: true });
    await http().get('/').expect(302).expect('location', '/docs');
    const doc = (await http().get('/docs-json').expect(200)).body;
    expect(Object.keys(doc.paths).sort()).toEqual([
      '/auth/2fa/ativar',
      '/auth/2fa/configurar',
      '/auth/cadastro',
      '/auth/demo',
      '/auth/login',
      '/auth/login/2fa',
      '/eu',
      '/eu/bloqueios',
      '/eu/bloqueios/{id}',
      '/eu/disponibilidades',
      '/eu/marcacoes',
      '/eu/marcacoes/{id}/cancelar',
      '/marcacoes/cancelar',
      '/mentores',
      '/mentores/{id}/horarios',
      '/mentores/{id}/marcacoes',
      '/saude',
    ]);
  });
});
