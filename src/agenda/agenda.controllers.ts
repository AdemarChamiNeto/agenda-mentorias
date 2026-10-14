import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiHeader,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { MentorGuard, MentorId } from '../auth/mentor.guard';
import { AgendaService } from './agenda.service';
import {
  AtualizarPerfilDto,
  BloqueioDto,
  CancelarDto,
  DisponibilidadesDto,
  MarcacaoDto,
  PeriodoDto,
} from './dto';

/** id que não é UUID vira 404, igual a um que não existe (não ensina o formato a quem está tentando adivinhar) */
const uuid = (o = 'não encontrado') =>
  new ParseUUIDPipe({ exceptionFactory: () => new NotFoundException(o) });

@ApiTags('Público: horários e marcações')
@Controller()
export class PublicoController {
  constructor(private readonly agenda: AgendaService) {}

  @Get('mentores')
  @ApiOperation({
    summary: 'Mentores (as contas de demonstração não aparecem aqui)',
  })
  mentores() {
    return this.agenda.listarMentores();
  }

  @Get('mentores/:id/horarios')
  @ApiOperation({
    summary:
      'Horários livres de um mentor no período (sem feriados, bloqueios e horários já marcados)',
  })
  horarios(
    @Param('id', uuid('mentor não encontrado')) id: string,
    @Query() q: PeriodoDto,
  ) {
    return this.agenda.horarios(id, q.de, q.ate);
  }

  @Post('mentores/:id/marcacoes')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({
    summary:
      'Marca um horário. Devolve o código de cancelamento (só nesta resposta)',
  })
  @ApiHeader({
    name: 'Idempotency-Key',
    required: false,
    description: 'reenviar com a mesma chave devolve a mesma marcação',
  })
  @ApiResponse({
    status: 409,
    description: 'O horário acabou de ser marcado por outra pessoa',
  })
  @ApiResponse({
    status: 422,
    description:
      'Fora da agenda, feriado, bloqueado, sem antecedência ou limite por e-mail',
  })
  marcar(
    @Param('id', uuid('mentor não encontrado')) id: string,
    @Body() dto: MarcacaoDto,
    @Headers('idempotency-key') chave?: string,
  ) {
    return this.agenda.marcar(id, dto, chave);
  }

  @Post('marcacoes/cancelar')
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({ summary: 'O aluno cancela com o código recebido ao marcar' })
  cancelar(@Body() dto: CancelarDto) {
    return this.agenda.cancelarPorCodigo(dto.codigo);
  }
}

/** Escrita na área do mentor: 30 por minuto (a leitura fica no limite geral de 120). */
const ESCRITA = { default: { limit: 30, ttl: 60_000 } };

@ApiTags('Área do mentor')
@ApiBearerAuth()
@UseGuards(MentorGuard)
@Controller('eu')
export class MentorController {
  constructor(private readonly agenda: AgendaService) {}

  @Get()
  @ApiOperation({ summary: 'Perfil do mentor logado' })
  perfil(@MentorId() mentorId: string) {
    return this.agenda.perfil(mentorId);
  }

  @Patch()
  @Throttle(ESCRITA)
  @ApiOperation({
    summary:
      'Atualiza nome, bio, fuso, duração dos horários e antecedência mínima',
  })
  atualizar(@MentorId() mentorId: string, @Body() dto: AtualizarPerfilDto) {
    return this.agenda.atualizarPerfil(mentorId, dto);
  }

  @Get('disponibilidades')
  @ApiOperation({ summary: 'Agenda semanal' })
  disponibilidades(@MentorId() mentorId: string) {
    return this.agenda.disponibilidades(mentorId);
  }

  @Put('disponibilidades')
  @Throttle(ESCRITA)
  @ApiOperation({
    summary:
      'Troca a agenda semanal inteira (janelas do mesmo dia não podem se sobrepor)',
  })
  trocar(@MentorId() mentorId: string, @Body() dto: DisponibilidadesDto) {
    return this.agenda.trocarDisponibilidades(mentorId, dto.janelas);
  }

  @Get('bloqueios')
  @ApiOperation({ summary: 'Bloqueios que ainda não terminaram' })
  bloqueios(@MentorId() mentorId: string) {
    return this.agenda.bloqueios(mentorId);
  }

  @Post('bloqueios')
  @Throttle(ESCRITA)
  @ApiOperation({ summary: 'Bloqueia um período (folga, férias, compromisso)' })
  criarBloqueio(@MentorId() mentorId: string, @Body() dto: BloqueioDto) {
    return this.agenda.criarBloqueio(mentorId, dto);
  }

  @Delete('bloqueios/:id')
  @Throttle(ESCRITA)
  @HttpCode(204)
  @ApiOperation({ summary: 'Remove um bloqueio' })
  removerBloqueio(
    @MentorId() mentorId: string,
    @Param('id', uuid('bloqueio não encontrado')) id: string,
  ) {
    return this.agenda.removerBloqueio(mentorId, id);
  }

  @Get('marcacoes')
  @ApiOperation({ summary: 'Marcações do mentor no período' })
  marcacoes(@MentorId() mentorId: string, @Query() q: PeriodoDto) {
    return this.agenda.marcacoesDoMentor(mentorId, q.de, q.ate);
  }

  @Post('marcacoes/:id/cancelar')
  @Throttle(ESCRITA)
  @HttpCode(200)
  @ApiOperation({ summary: 'O mentor cancela uma marcação dele' })
  cancelar(
    @MentorId() mentorId: string,
    @Param('id', uuid('marcação não encontrada')) id: string,
  ) {
    return this.agenda.cancelarPeloMentor(mentorId, id);
  }
}
