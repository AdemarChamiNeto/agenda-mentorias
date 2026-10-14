import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService, RELOGIO, type Relogio } from '../infra/infra.module';

export const DIAS_ATE_ANONIMIZAR = 30;

/**
 * LGPD e contas de demonstração: nome e e-mail do aluno viram "anonimizado" 30 dias depois do
 * horário (o mentor continua vendo o histórico de horários), e as contas de demonstração vencidas
 * somem com tudo o que tinham (cascade). Roda de hora em hora e também é chamada nos testes.
 */
@Injectable()
export class LimpezaService {
  private readonly log = new Logger(LimpezaService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(RELOGIO) private readonly agora: Relogio,
  ) {}

  @Cron(CronExpression.EVERY_HOUR)
  async executar() {
    const agora = this.agora();
    const limite = new Date(agora.getTime() - DIAS_ATE_ANONIMIZAR * 86_400_000);
    const anonimizadas = await this.prisma.marcacao.updateMany({
      where: { fim: { lt: limite }, anonimizadaEm: null },
      data: {
        alunoNome: 'anonimizado',
        alunoEmail: 'anonimizado',
        anonimizadaEm: agora,
      },
    });
    const demos = await this.prisma.mentor.deleteMany({
      where: { demoExpiraEm: { lte: agora } },
    });
    if (anonimizadas.count || demos.count)
      this.log.log(
        `anonimizadas: ${anonimizadas.count}; demonstrações apagadas: ${demos.count}`,
      );
    return { anonimizadas: anonimizadas.count, demosApagadas: demos.count };
  }
}
