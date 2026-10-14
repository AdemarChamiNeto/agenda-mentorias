import { Inject, Injectable, Logger } from '@nestjs/common';
import { FETCH, PrismaService } from '../infra/infra.module';

const BRASIL_API = 'https://brasilapi.com.br/api/feriados/v1';
const ESPERA_APOS_FALHA_MS = 10 * 60_000;

/**
 * Feriados nacionais da BrasilAPI (mesma lógica do Controle de Ponto), com cache no banco: a API
 * de fora é chamada uma vez por ano. Se ela cair, a agenda continua funcionando, só sem os
 * feriados daquele ano, e tenta de novo em 10 minutos.
 */
@Injectable()
export class FeriadosService {
  private readonly log = new Logger(FeriadosService.name);
  /** ano → quando a última consulta falhou (não martela uma API fora do ar) */
  private readonly falhas = new Map<number, number>();

  constructor(
    private readonly prisma: PrismaService,
    @Inject(FETCH) private readonly buscar: typeof fetch,
  ) {}

  /** Esquece as falhas lembradas (os testes simulam a API fora do ar e depois de volta). */
  esquecerFalhas() {
    this.falhas.clear();
  }

  /** data (YYYY-MM-DD) → nome, para os anos pedidos. */
  async dosAnos(anos: number[]): Promise<Map<string, string>> {
    const mapa = new Map<string, string>();
    for (const ano of [...new Set(anos)]) {
      for (const [d, n] of await this.doAno(ano)) mapa.set(d, n);
    }
    return mapa;
  }

  private async doAno(ano: number): Promise<Map<string, string>> {
    const salvos = await this.prisma.feriado.findMany({ where: { ano } });
    if (salvos.length)
      return new Map(
        salvos.map((f) => [f.data.toISOString().slice(0, 10), f.nome]),
      );

    const falhou = this.falhas.get(ano);
    if (falhou && Date.now() - falhou < ESPERA_APOS_FALHA_MS) return new Map();
    let lista: { date: string; name: string }[];
    try {
      lista = await this.consultar(ano);
      this.falhas.delete(ano);
    } catch (err) {
      this.falhas.set(ano, Date.now());
      this.log.warn(
        `BrasilAPI indisponível para ${ano}: ${(err as Error).message}. Seguindo sem feriados.`,
      );
      return new Map();
    }
    await this.prisma.feriado.createMany({
      data: lista.map((f) => ({
        data: new Date(`${f.date}T00:00:00Z`),
        ano,
        nome: f.name,
      })),
      skipDuplicates: true,
    });
    return new Map(lista.map((f) => [f.date, f.name]));
  }

  private async consultar(ano: number) {
    const res = await this.buscar(`${BRASIL_API}/${ano}`, {
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) throw new Error(`BrasilAPI respondeu ${res.status}`);
    const corpo = (await res.json()) as unknown;
    if (!Array.isArray(corpo))
      throw new Error('resposta inesperada da BrasilAPI');
    return (corpo as { date?: unknown; name?: unknown }[]).filter(
      (f): f is { date: string; name: string } =>
        typeof f?.date === 'string' &&
        /^\d{4}-\d{2}-\d{2}$/.test(f.date) &&
        typeof f?.name === 'string',
    );
  }
}
