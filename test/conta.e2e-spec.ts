import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { LimpezaService } from '../src/limpeza/limpeza.service';
import { PrismaService } from '../src/infra/infra.module';
import { codeForStep, stepAt } from '../src/seguranca/totp';
import { demo, limparBanco, relogio, subirApp } from './apoio';

let app: INestApplication;
const http = () => request(app.getHttpServer());

beforeAll(async () => {
  app = await subirApp();
});
beforeEach(() => limparBanco(app));
afterAll(() => app.close());

const cadastrar = (email = 'ana@exemplo.com') =>
  http()
    .post('/auth/cadastro')
    .send({ nome: 'Ana Souza', email, senha: 'uma senha longa e só minha' });
const codigoAgora = (segredo: string) =>
  codeForStep(segredo, stepAt(relogio.agora));

describe('cadastro e login', () => {
  it('cadastra (e-mail sem diferenciar maiúsculas), entra e não revela se o e-mail existe', async () => {
    await cadastrar('Ana@Exemplo.com').expect(201);
    await cadastrar('ana@exemplo.com').expect(409);
    const ok = await http()
      .post('/auth/login')
      .send({ email: 'ANA@exemplo.com', senha: 'uma senha longa e só minha' })
      .expect(200);
    expect(ok.body.precisa2fa).toBe(false);
    await http().get('/eu').auth(ok.body.token, { type: 'bearer' }).expect(200);

    const senhaErrada = await http()
      .post('/auth/login')
      .send({ email: 'ana@exemplo.com', senha: 'errada' })
      .expect(401);
    const semConta = await http()
      .post('/auth/login')
      .send({ email: 'ninguem@exemplo.com', senha: 'errada' })
      .expect(401);
    expect(senhaErrada.body.message).toBe(semConta.body.message);
  });

  it('senha curta, longa demais (bcrypt corta em 72) ou e-mail inválido: 400', async () => {
    await http()
      .post('/auth/cadastro')
      .send({ nome: 'Ana', email: 'ana@exemplo.com', senha: 'curta' })
      .expect(400);
    await http()
      .post('/auth/cadastro')
      .send({ nome: 'Ana', email: 'ana@exemplo.com', senha: 'x'.repeat(73) })
      .expect(400);
    await http()
      .post('/auth/cadastro')
      .send({ nome: 'Ana', email: 'nao-e-email', senha: 'uma senha longa' })
      .expect(400);
  });

  it('a senha fica com bcrypt custo 12, separada do perfil', async () => {
    await cadastrar().expect(201);
    const c = await app.get(PrismaService).credencial.findFirstOrThrow();
    expect(c.senhaHash).toMatch(/^\$2[aby]\$12\$/);
    const perfil = await app.get(PrismaService).mentor.findFirstOrThrow();
    expect(JSON.stringify(perfil)).not.toContain('$2');
  });
});

describe('2FA', () => {
  it('configura com QR code, ativa, exige o código no login e não aceita o mesmo código duas vezes', async () => {
    const { token } = (await cadastrar().expect(201)).body;
    const cfg = (
      await http()
        .post('/auth/2fa/configurar')
        .auth(token, { type: 'bearer' })
        .expect(201)
    ).body;
    expect(cfg.qrCode).toMatch(/^data:image\/png;base64,/);
    expect(cfg.otpauthUrl).toContain('Agenda%20de%20Mentorias');
    await http()
      .post('/auth/2fa/ativar')
      .auth(token, { type: 'bearer' })
      .send({ codigo: '000000' })
      .expect(422);
    const { codigosRecuperacao } = (
      await http()
        .post('/auth/2fa/ativar')
        .auth(token, { type: 'bearer' })
        .send({ codigo: codigoAgora(cfg.segredo) })
        .expect(201)
    ).body;
    expect(codigosRecuperacao).toHaveLength(10);

    // segredo guardado cifrado, nunca em texto
    const c = await app.get(PrismaService).credencial.findFirstOrThrow();
    expect(c.totpSegredo).toMatch(/^v1:/);
    expect(c.totpSegredo).not.toContain(cfg.segredo);

    const login = (
      await http()
        .post('/auth/login')
        .send({ email: 'ana@exemplo.com', senha: 'uma senha longa e só minha' })
        .expect(200)
    ).body;
    expect(login.precisa2fa).toBe(true);
    expect(login.token).toBeUndefined();
    // o token temporário não abre a área do mentor
    await http()
      .get('/eu')
      .auth(login.tokenTemporario, { type: 'bearer' })
      .expect(401);

    relogio.agora = new Date(relogio.agora.getTime() + 30_000); // próximo passo de 30 s
    const codigo = codigoAgora(cfg.segredo);
    const final = await http()
      .post('/auth/login/2fa')
      .send({ tokenTemporario: login.tokenTemporario, codigo })
      .expect(200);
    await http()
      .get('/eu')
      .auth(final.body.token, { type: 'bearer' })
      .expect(200);
    await http()
      .post('/auth/login/2fa')
      .send({ tokenTemporario: login.tokenTemporario, codigo })
      .expect(401); // reuso
  });

  it('código de recuperação entra uma vez só e diz quantos sobraram', async () => {
    const { token } = (await cadastrar().expect(201)).body;
    const { segredo } = (
      await http()
        .post('/auth/2fa/configurar')
        .auth(token, { type: 'bearer' })
        .expect(201)
    ).body;
    const { codigosRecuperacao } = (
      await http()
        .post('/auth/2fa/ativar')
        .auth(token, { type: 'bearer' })
        .send({ codigo: codigoAgora(segredo) })
    ).body;
    const login = (
      await http()
        .post('/auth/login')
        .send({ email: 'ana@exemplo.com', senha: 'uma senha longa e só minha' })
    ).body;
    const comRecuperacao = await http()
      .post('/auth/login/2fa')
      .send({
        tokenTemporario: login.tokenTemporario,
        codigo: codigosRecuperacao[0].toUpperCase(),
      })
      .expect(200);
    expect(comRecuperacao.body.codigosRecuperacaoRestantes).toBe(9);
    await http()
      .post('/auth/login/2fa')
      .send({
        tokenTemporario: login.tokenTemporario,
        codigo: codigosRecuperacao[0],
      })
      .expect(401);
  });
});

describe('limpeza (LGPD e demonstrações)', () => {
  it('30 dias depois do horário, nome e e-mail do aluno viram "anonimizado"; demonstração vencida some com tudo', async () => {
    const { mentorId } = await demo(app);
    await http()
      .post(`/mentores/${mentorId}/marcacoes`)
      .send({
        alunoNome: 'Bruno Lima',
        alunoEmail: 'bruno@exemplo.com',
        inicio: '2026-11-03T09:00:00-03:00',
      })
      .expect(201);
    const prisma = app.get(PrismaService);
    const limpeza = app.get(LimpezaService);

    relogio.agora = new Date('2026-11-01T13:00:00Z'); // uma hora depois: nada a fazer
    expect(await limpeza.executar()).toEqual({
      anonimizadas: 0,
      demosApagadas: 0,
    });

    // a demo venceu (24 h); o histórico da marcação ainda guardaria o aluno se o mentor fosse real
    relogio.agora = new Date('2026-12-05T00:00:00Z');
    const r = await limpeza.executar();
    expect(r).toEqual({ anonimizadas: 1, demosApagadas: 1 });
    expect(await prisma.marcacao.count()).toBe(0); // foi junto com a demo (cascade)
  });

  it('mentor real: a marcação fica, só sem o dado pessoal', async () => {
    const { token } = (await cadastrar().expect(201)).body;
    const eu = (await http().get('/eu').auth(token, { type: 'bearer' })).body;
    await http()
      .put('/eu/disponibilidades')
      .auth(token, { type: 'bearer' })
      .send({ janelas: [{ diaSemana: 2, inicio: '09:00', fim: '10:00' }] })
      .expect(200);
    await http()
      .post(`/mentores/${eu.id}/marcacoes`)
      .send({
        alunoNome: 'Bruno Lima',
        alunoEmail: 'bruno@exemplo.com',
        inicio: '2026-11-03T09:00:00-03:00',
      })
      .expect(201);
    relogio.agora = new Date('2026-12-05T00:00:00Z');
    await app.get(LimpezaService).executar();
    const m = await app.get(PrismaService).marcacao.findFirstOrThrow();
    expect(m).toMatchObject({
      alunoNome: 'anonimizado',
      alunoEmail: 'anonimizado',
      status: 'CONFIRMADA',
    });
    expect(m.anonimizadaEm).not.toBeNull();
  });
});

describe('rate limit', () => {
  it('passou do limite do login: 429 com Retry-After', async () => {
    process.env.RATE_LIMIT_DESLIGADO = '0';
    try {
      const tentativas = [];
      for (let i = 0; i < 6; i++)
        tentativas.push(
          await http()
            .post('/auth/login')
            .send({ email: 'x@exemplo.com', senha: 'errada' }),
        );
      expect(tentativas.slice(0, 5).map((r) => r.status)).toEqual([
        401, 401, 401, 401, 401,
      ]);
      expect(tentativas[5].status).toBe(429);
      expect(Number(tentativas[5].headers['retry-after'])).toBeGreaterThan(0);
    } finally {
      process.env.RATE_LIMIT_DESLIGADO = '1';
    }
  });
});
