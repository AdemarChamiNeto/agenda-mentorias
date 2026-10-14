import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { execSync } from 'node:child_process';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { FETCH, PrismaService, RELOGIO } from '../src/infra/infra.module';
import { configurarApp } from '../src/main';
import { FeriadosService } from '../src/feriados/feriados.service';

/**
 * Sobe o app inteiro (o mesmo AppModule e o mesmo configurarApp do servidor) contra o Postgres de
 * teste (nenhum módulo lê o ambiente ao ser importado: só quando o Nest monta o app), com duas trocas: a BrasilAPI vira uma resposta roteirizada e o relógio é controlado.
 */
export const DATABASE_URL_TESTE =
  process.env.DATABASE_URL_TESTE ??
  'postgresql://agenda:agenda-dev@localhost:5435/agenda_test';

process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = DATABASE_URL_TESTE;
process.env.JWT_SECRET ??= 'segredo-dos-testes-com-mais-de-32-caracteres';
process.env.ENCRYPTION_KEY ??= '1'.repeat(64);
process.env.RATE_LIMIT_DESLIGADO = '1';

let migrado = false;
export function migrar() {
  if (migrado) return;
  execSync('npx prisma migrate deploy', {
    env: { ...process.env, DATABASE_URL: DATABASE_URL_TESTE },
    stdio: 'pipe',
  });
  migrado = true;
}

/** Relógio dos testes: domingo, 01/11/2026, 09h em São Paulo. */
export const relogio = { agora: new Date('2026-11-01T12:00:00Z') };

/** BrasilAPI de mentira: Finados (02/11) em 2026; `falhar` simula a API fora do ar. */
export const brasilApi = { falhar: false, chamadas: 0 };
const fetchFalso = (url: string) => {
  brasilApi.chamadas++;
  if (brasilApi.falhar) return Promise.reject(new TypeError('fetch failed'));
  const ano = Number(url.split('/').pop());
  const lista =
    ano === 2026
      ? [{ date: '2026-11-02', name: 'Finados', type: 'national' }]
      : [];
  return Promise.resolve(
    new Response(JSON.stringify(lista), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }),
  );
};

export async function subirApp(): Promise<INestApplication> {
  migrar();
  const mod = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(FETCH)
    .useValue(fetchFalso)
    .overrideProvider(RELOGIO)
    .useValue(() => relogio.agora)
    .compile();
  const app = configurarApp(mod.createNestApplication());
  await app.init();
  app.getHttpServer().setMaxListeners(30); // os testes de concorrência abrem várias requisições ao mesmo tempo
  return app;
}

/** Banco limpo entre os testes (a ordem respeita as chaves estrangeiras). */
export async function limparBanco(app: INestApplication) {
  await app
    .get(PrismaService)
    .$executeRawUnsafe(
      'TRUNCATE marcacoes, bloqueios, disponibilidades, codigos_recuperacao, credenciais, mentores, feriados',
    );
  relogio.agora = new Date('2026-11-01T12:00:00Z');
  brasilApi.falhar = false;
  brasilApi.chamadas = 0;
  app.get(FeriadosService).esquecerFalhas();
}

/** Cria uma conta de demonstração (24 h, agenda seg–sex 9h–12h e 14h–17h, antecedência de 1 h). */
export async function demo(app: INestApplication) {
  const r = await request(app.getHttpServer()).post('/auth/demo').expect(201);
  return { token: r.body.token as string, mentorId: r.body.mentorId as string };
}
