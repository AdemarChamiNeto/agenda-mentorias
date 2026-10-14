import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { DateTime, IANAZone } from 'luxon';
import * as crypto from 'node:crypto';
import {
  AMBIENTE,
  PrismaService,
  RELOGIO,
  type Relogio,
} from '../infra/infra.module';
import type { Ambiente } from '../config/ambiente';
import { FeriadosService } from '../feriados/feriados.service';
import {
  horariosLivres,
  motivoIndisponivel,
  type Agenda,
} from '../dominio/horarios';
import { hashToken } from '../seguranca/segredos';
import type {
  AtualizarPerfilDto,
  BloqueioDto,
  JanelaDto,
  MarcacaoDto,
} from './dto';

/** Máximo de marcações futuras de um mesmo e-mail com o mesmo mentor (contra spam e "segurar a agenda"). */
export const MAX_MARCACOES_POR_EMAIL = 3;
const MAX_DIAS_A_FRENTE = 60;

const paraHora = (min: number) =>
  `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
const deHora = (h: string) => Number(h.slice(0, 2)) * 60 + Number(h.slice(3));

/** O Prisma 7 com adaptador repassa o erro do Postgres: procura o nome da restrição no erro. */
const violou = (err: unknown, restricao: string) =>
  JSON.stringify(err, Object.getOwnPropertyNames(err ?? {})).includes(
    restricao,
  );

@Injectable()
export class AgendaService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly feriados: FeriadosService,
    @Inject(AMBIENTE) private readonly ambiente: Ambiente,
    @Inject(RELOGIO) private readonly agora: Relogio,
  ) {}

  /**
   * Código de cancelamento = HMAC do id da marcação com a chave do servidor. Só quem marcou recebe;
   * o banco guarda só o SHA-256; e um reenvio com a mesma Idempotency-Key devolve o mesmo código
   * sem precisar guardá-lo.
   */
  private codigoCancelamento(marcacaoId: string) {
    return crypto
      .createHmac('sha256', this.ambiente.chaveCriptografia)
      .update(`cancelamento:${marcacaoId}`)
      .digest('base64url')
      .slice(0, 32);
  }

  /** Mentor que aceita marcação (existe e não é uma demonstração vencida); senão 404. */
  private async mentorAtivo(mentorId: string) {
    const m = await this.prisma.mentor.findUnique({
      where: { id: mentorId },
      include: { disponibilidades: true },
    });
    if (!m || (m.demoExpiraEm && m.demoExpiraEm <= this.agora()))
      throw new NotFoundException('mentor não encontrado');
    const agenda: Agenda = {
      fuso: m.fuso,
      duracaoMinutos: m.duracaoMinutos,
      antecedenciaMinutos: m.antecedenciaMinutos,
      janelas: m.disponibilidades.map((d) => ({
        diaSemana: d.diaSemana,
        inicioMin: d.inicioMin,
        fimMin: d.fimMin,
      })),
    };
    return { mentor: m, agenda };
  }

  private async feriadosEntre(fuso: string, inicio: DateTime, fim: DateTime) {
    return this.feriados.dosAnos([
      inicio.setZone(fuso).year,
      fim.setZone(fuso).year,
    ]);
  }

  // ---------------- público ----------------

  listarMentores() {
    return this.prisma.mentor.findMany({
      where: { demoExpiraEm: null },
      select: {
        id: true,
        nome: true,
        bio: true,
        duracaoMinutos: true,
        fuso: true,
      },
      orderBy: { nome: 'asc' },
    });
  }

  async horarios(mentorId: string, de: string, ate: string) {
    const { agenda } = await this.mentorAtivo(mentorId);
    const ini = DateTime.fromISO(de, { zone: agenda.fuso }).startOf('day');
    const fim = DateTime.fromISO(ate, { zone: agenda.fuso }).endOf('day');
    if (!ini.isValid || !fim.isValid)
      throw new BadRequestException('data inválida (use AAAA-MM-DD)');
    const periodo = {
      inicio: { lt: fim.toJSDate() },
      fim: { gt: ini.toJSDate() },
    };
    const [bloqueios, marcacoes, feriados] = await Promise.all([
      this.prisma.bloqueio.findMany({
        where: { mentorId, ...periodo },
        select: { inicio: true, fim: true },
      }),
      this.prisma.marcacao.findMany({
        where: { mentorId, status: 'CONFIRMADA', ...periodo },
        select: { inicio: true, fim: true },
      }),
      this.feriadosEntre(agenda.fuso, ini, fim),
    ]);
    try {
      const livres = horariosLivres(
        agenda,
        de,
        ate,
        [...bloqueios, ...marcacoes],
        feriados,
        this.agora(),
      );
      return {
        fuso: agenda.fuso,
        duracaoMinutos: agenda.duracaoMinutos,
        horarios: livres,
      };
    } catch (err) {
      if (err instanceof RangeError) throw new BadRequestException(err.message);
      throw err;
    }
  }

  async marcar(mentorId: string, dto: MarcacaoDto, chaveIdempotencia?: string) {
    const { agenda } = await this.mentorAtivo(mentorId);
    const email = dto.alunoEmail.trim().toLowerCase();
    const chave = chaveIdempotencia?.slice(0, 100) || null;

    // reenvio do mesmo pedido (clique duplo, rede que caiu): devolve a mesma marcação e o mesmo código
    if (chave) {
      const antes = await this.prisma.marcacao.findUnique({
        where: {
          mentorId_chaveIdempotencia: { mentorId, chaveIdempotencia: chave },
        },
      });
      if (antes) return this.respostaMarcacao(antes);
    }

    const inicio = new Date(dto.inicio);
    const agora = this.agora();
    if (inicio.getTime() > agora.getTime() + MAX_DIAS_A_FRENTE * 86_400_000) {
      throw new UnprocessableEntityException(
        `dá para marcar até ${MAX_DIAS_A_FRENTE} dias à frente`,
      );
    }
    const fim = new Date(inicio.getTime() + agenda.duracaoMinutos * 60_000);
    const [bloqueios, feriados, doMesmoEmail] = await Promise.all([
      this.prisma.bloqueio.findMany({
        where: { mentorId, inicio: { lt: fim }, fim: { gt: inicio } },
        select: { inicio: true, fim: true },
      }),
      this.feriadosEntre(
        agenda.fuso,
        DateTime.fromJSDate(inicio),
        DateTime.fromJSDate(inicio),
      ),
      this.prisma.marcacao.count({
        where: {
          mentorId,
          alunoEmail: email,
          status: 'CONFIRMADA',
          inicio: { gt: agora },
        },
      }),
    ]);
    const motivo = motivoIndisponivel(
      agenda,
      inicio,
      bloqueios,
      feriados,
      agora,
    );
    if (motivo) throw new UnprocessableEntityException(motivo);
    if (doMesmoEmail >= MAX_MARCACOES_POR_EMAIL) {
      throw new UnprocessableEntityException(
        `no máximo ${MAX_MARCACOES_POR_EMAIL} marcações futuras por e-mail com o mesmo mentor`,
      );
    }

    const id = crypto.randomUUID();
    try {
      const m = await this.prisma.marcacao.create({
        data: {
          id,
          mentorId,
          alunoNome: dto.alunoNome.trim(),
          alunoEmail: email,
          inicio,
          fim,
          chaveIdempotencia: chave,
          codigoCancelamentoHash: hashToken(this.codigoCancelamento(id)),
        },
      });
      return this.respostaMarcacao(m);
    } catch (err) {
      // a exclusion constraint do banco: outra pessoa ficou com o horário (inclusive ao mesmo tempo)
      if (violou(err, 'marcacoes_sem_sobreposicao'))
        throw new ConflictException(
          'esse horário acabou de ser marcado por outra pessoa',
        );
      // dois reenvios com a mesma Idempotency-Key chegando juntos: o segundo devolve o do primeiro
      if (chave && (err as { code?: string }).code === 'P2002') {
        const antes = await this.prisma.marcacao.findUniqueOrThrow({
          where: {
            mentorId_chaveIdempotencia: { mentorId, chaveIdempotencia: chave },
          },
        });
        return this.respostaMarcacao(antes);
      }
      throw err;
    }
  }

  private respostaMarcacao(m: {
    id: string;
    mentorId: string;
    inicio: Date;
    fim: Date;
    status: string;
  }) {
    return {
      id: m.id,
      mentorId: m.mentorId,
      inicio: m.inicio,
      fim: m.fim,
      status: m.status,
      codigoCancelamento: this.codigoCancelamento(m.id),
    };
  }

  /** O aluno cancela com o código. Código errado e marcação de outra pessoa dão a mesma resposta (404). */
  async cancelarPorCodigo(codigo: string) {
    const m = await this.prisma.marcacao.findUnique({
      where: { codigoCancelamentoHash: hashToken(codigo) },
    });
    if (!m) throw new NotFoundException('código de cancelamento inválido');
    return this.cancelar(m, 'aluno');
  }

  private async cancelar(
    m: { id: string; status: string; inicio: Date },
    por: 'aluno' | 'mentor',
  ) {
    if (m.status === 'CANCELADA')
      throw new ConflictException('essa marcação já foi cancelada');
    if (m.inicio <= this.agora())
      throw new UnprocessableEntityException(
        'o horário já começou: não dá mais para cancelar',
      );
    const atualizada = await this.prisma.marcacao.update({
      where: { id: m.id },
      data: {
        status: 'CANCELADA',
        canceladaEm: this.agora(),
        canceladaPor: por,
      },
      select: { id: true, inicio: true, fim: true, status: true },
    });
    return atualizada;
  }

  // ---------------- área do mentor (tudo filtrado pelo mentor logado) ----------------

  async perfil(mentorId: string) {
    return this.prisma.mentor.findUniqueOrThrow({
      where: { id: mentorId },
      select: {
        id: true,
        nome: true,
        email: true,
        bio: true,
        fuso: true,
        duracaoMinutos: true,
        antecedenciaMinutos: true,
        demoExpiraEm: true,
        credencial: { select: { totpAtivadoEm: true } },
      },
    });
  }

  async atualizarPerfil(mentorId: string, dto: AtualizarPerfilDto) {
    if (dto.fuso && !IANAZone.isValidZone(dto.fuso))
      throw new BadRequestException(
        'fuso desconhecido (use um nome IANA, como America/Sao_Paulo)',
      );
    await this.prisma.mentor.update({ where: { id: mentorId }, data: dto });
    return this.perfil(mentorId);
  }

  async disponibilidades(mentorId: string) {
    const lista = await this.prisma.disponibilidade.findMany({
      where: { mentorId },
      orderBy: [{ diaSemana: 'asc' }, { inicioMin: 'asc' }],
    });
    return lista.map((d) => ({
      diaSemana: d.diaSemana,
      inicio: paraHora(d.inicioMin),
      fim: paraHora(d.fimMin),
    }));
  }

  /** Troca a agenda semanal inteira de uma vez (numa transação: nunca fica pela metade). */
  async trocarDisponibilidades(mentorId: string, janelas: JanelaDto[]) {
    const dados = janelas.map((j) => ({
      mentorId,
      diaSemana: j.diaSemana,
      inicioMin: deHora(j.inicio),
      fimMin: deHora(j.fim),
    }));
    if (dados.some((d) => d.fimMin <= d.inicioMin))
      throw new UnprocessableEntityException(
        'em cada janela, o fim precisa ser depois do início',
      );
    try {
      await this.prisma.$transaction([
        this.prisma.disponibilidade.deleteMany({ where: { mentorId } }),
        this.prisma.disponibilidade.createMany({ data: dados }),
      ]);
    } catch (err) {
      if (violou(err, 'disponibilidades_sem_sobreposicao'))
        throw new UnprocessableEntityException(
          'há janelas que se sobrepõem no mesmo dia',
        );
      throw err;
    }
    return this.disponibilidades(mentorId);
  }

  bloqueios(mentorId: string) {
    return this.prisma.bloqueio.findMany({
      where: { mentorId, fim: { gt: this.agora() } },
      select: { id: true, inicio: true, fim: true, motivo: true },
      orderBy: { inicio: 'asc' },
    });
  }

  async criarBloqueio(mentorId: string, dto: BloqueioDto) {
    const inicio = new Date(dto.inicio);
    const fim = new Date(dto.fim);
    if (fim <= inicio)
      throw new UnprocessableEntityException(
        'o fim do bloqueio precisa ser depois do início',
      );
    if (fim.getTime() - inicio.getTime() > 366 * 86_400_000)
      throw new UnprocessableEntityException('bloqueio de no máximo 1 ano');
    return this.prisma.bloqueio.create({
      data: { mentorId, inicio, fim, motivo: dto.motivo?.trim() ?? '' },
      select: { id: true, inicio: true, fim: true, motivo: true },
    });
  }

  async removerBloqueio(mentorId: string, id: string) {
    const r = await this.prisma.bloqueio.deleteMany({
      where: { id, mentorId },
    });
    if (!r.count) throw new NotFoundException('bloqueio não encontrado');
  }

  async marcacoesDoMentor(mentorId: string, de: string, ate: string) {
    const fuso = (
      await this.prisma.mentor.findUniqueOrThrow({
        where: { id: mentorId },
        select: { fuso: true },
      })
    ).fuso;
    const ini = DateTime.fromISO(de, { zone: fuso }).startOf('day');
    const fim = DateTime.fromISO(ate, { zone: fuso }).endOf('day');
    if (!ini.isValid || !fim.isValid || fim < ini)
      throw new BadRequestException('período inválido');
    return this.prisma.marcacao.findMany({
      where: { mentorId, inicio: { gte: ini.toJSDate(), lte: fim.toJSDate() } },
      select: {
        id: true,
        alunoNome: true,
        alunoEmail: true,
        inicio: true,
        fim: true,
        status: true,
        canceladaPor: true,
      },
      orderBy: { inicio: 'asc' },
    });
  }

  async cancelarPeloMentor(mentorId: string, id: string) {
    // filtro pelo mentor: marcação de outro mentor é 404, igual a uma que não existe
    const m = await this.prisma.marcacao.findFirst({ where: { id, mentorId } });
    if (!m) throw new NotFoundException('marcação não encontrada');
    return this.cancelar(m, 'mentor');
  }
}
