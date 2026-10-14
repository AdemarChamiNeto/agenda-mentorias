import { Controller, Get, Module, Redirect } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ApiExcludeEndpoint, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AgendaService } from './agenda/agenda.service';
import {
  MentorController,
  PublicoController,
} from './agenda/agenda.controllers';
import { AuthModule } from './auth/auth.module';
import { ExemplosService } from './exemplos/exemplos.service';
import { FeriadosService } from './feriados/feriados.service';
import { InfraModule, PrismaService } from './infra/infra.module';
import { LimpezaService } from './limpeza/limpeza.service';

@ApiTags('Saúde')
@Controller()
class SaudeController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  @Redirect('/docs', 302)
  @ApiExcludeEndpoint()
  raiz() {}

  @Get('saude')
  @ApiOperation({ summary: 'API e banco respondendo' })
  async saude() {
    await this.prisma.$queryRaw`SELECT 1`;
    return { ok: true };
  }
}

@Module({
  imports: [
    InfraModule,
    AuthModule,
    ScheduleModule.forRoot(),
    // limite geral por IP; login, cadastro, 2FA e marcação têm limites menores no próprio endpoint
    ThrottlerModule.forRoot({
      throttlers: [{ name: 'default', ttl: 60_000, limit: 120 }],
      // os testes e2e fazem dezenas de logins do mesmo IP; o rate limit tem teste próprio, que liga de novo
      skipIf: () => process.env.RATE_LIMIT_DESLIGADO === '1',
    }),
  ],
  controllers: [SaudeController, PublicoController, MentorController],
  providers: [
    AgendaService,
    FeriadosService,
    LimpezaService,
    ExemplosService,
    { provide: APP_GUARD, useClass: ThrottlerGuard },
  ],
})
export class AppModule {}
