import {
  Global,
  Inject,
  Injectable,
  Module,
  OnModuleDestroy,
} from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client';
import { carregarAmbiente, type Ambiente } from '../config/ambiente';

/** Token de injeção da configuração já validada. */
export const AMBIENTE = Symbol('AMBIENTE');
/** `fetch` injetável: os testes trocam a internet por respostas roteirizadas. */
export const FETCH = Symbol('FETCH');
/** Relógio injetável: as regras de antecedência e a limpeza dependem de "agora". */
export const RELOGIO = Symbol('RELOGIO');
export type Relogio = () => Date;

/** Prisma 7 com o adaptador do node-postgres. Poucas conexões: o plano grátis do Neon tem limite. */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleDestroy {
  constructor(@Inject(AMBIENTE) ambiente: Ambiente) {
    super({
      adapter: new PrismaPg({ connectionString: ambiente.databaseUrl, max: 5 }),
    });
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}

@Global()
@Module({
  providers: [
    { provide: AMBIENTE, useFactory: () => carregarAmbiente() },
    {
      provide: FETCH,
      useValue: (...args: Parameters<typeof fetch>) => fetch(...args),
    },
    { provide: RELOGIO, useValue: () => new Date() },
    PrismaService,
  ],
  exports: [AMBIENTE, FETCH, RELOGIO, PrismaService],
})
export class InfraModule {}
