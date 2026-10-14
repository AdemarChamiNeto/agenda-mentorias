import { DateTime } from 'luxon';

/**
 * Regras da agenda, sem banco nem framework (testadas sozinhas em horarios.spec.ts).
 *
 * A agenda semanal é lida no fuso do mentor ("segunda das 9h às 12h" em São Paulo) e cada
 * horário vira um instante em UTC. Feriados, bloqueios, antecedência mínima e marcações já
 * existentes tiram horários da lista.
 */

export type Janela = { diaSemana: number; inicioMin: number; fimMin: number };
export type Intervalo = { inicio: Date; fim: Date };
export type Agenda = {
  fuso: string;
  duracaoMinutos: number;
  antecedenciaMinutos: number;
  janelas: Janela[];
};
/** data (YYYY-MM-DD, no fuso do mentor) → nome do feriado */
export type Feriados = ReadonlyMap<string, string>;

export const MAX_DIAS_CONSULTA = 31;

const sobrepoe = (a: Intervalo, b: Intervalo) =>
  a.inicio < b.fim && b.inicio < a.fim;

/** Todos os horários da agenda num dia local, antes de tirar o que está ocupado. */
function horariosDoDia(agenda: Agenda, dia: DateTime): Intervalo[] {
  const meiaNoite = dia.startOf('day');
  const lista: Intervalo[] = [];
  for (const j of agenda.janelas.filter((x) => x.diaSemana === dia.weekday)) {
    for (
      let t = j.inicioMin;
      t + agenda.duracaoMinutos <= j.fimMin;
      t += agenda.duracaoMinutos
    ) {
      const inicio = meiaNoite.plus({ minutes: t });
      lista.push({
        inicio: inicio.toJSDate(),
        fim: inicio.plus({ minutes: agenda.duracaoMinutos }).toJSDate(),
      });
    }
  }
  return lista.sort((a, b) => a.inicio.getTime() - b.inicio.getTime());
}

/** Dias (YYYY-MM-DD) entre `de` e `ate`, inclusive, no fuso do mentor. */
function dias(fuso: string, de: string, ate: string): DateTime[] {
  const inicio = DateTime.fromISO(de, { zone: fuso });
  const fim = DateTime.fromISO(ate, { zone: fuso });
  if (!inicio.isValid || !fim.isValid)
    throw new RangeError('data inválida (use AAAA-MM-DD)');
  if (fim < inicio) throw new RangeError('"ate" é antes de "de"');
  const n = Math.round(fim.diff(inicio, 'days').days) + 1;
  if (n > MAX_DIAS_CONSULTA)
    throw new RangeError(`no máximo ${MAX_DIAS_CONSULTA} dias por consulta`);
  return Array.from({ length: n }, (_, i) => inicio.plus({ days: i }));
}

/** Horários livres para o público ver: só os que ainda dá para marcar. */
export function horariosLivres(
  agenda: Agenda,
  de: string,
  ate: string,
  ocupados: Intervalo[],
  feriados: Feriados,
  agora: Date,
): Intervalo[] {
  const limite = agora.getTime() + agenda.antecedenciaMinutos * 60_000;
  return dias(agenda.fuso, de, ate)
    .filter((d) => !feriados.has(d.toISODate()!))
    .flatMap((d) => horariosDoDia(agenda, d))
    .filter(
      (h) =>
        h.inicio.getTime() >= limite && !ocupados.some((o) => sobrepoe(h, o)),
    );
}

/**
 * Por que não dá para marcar um horário (null = dá). As marcações de outras pessoas NÃO entram
 * aqui: quem garante "um horário, uma pessoa" é a exclusion constraint do banco, também quando
 * dois pedidos chegam ao mesmo tempo.
 */
export function motivoIndisponivel(
  agenda: Agenda,
  inicio: Date,
  bloqueios: Intervalo[],
  feriados: Feriados,
  agora: Date,
): string | null {
  const local = DateTime.fromJSDate(inicio, { zone: agenda.fuso });
  if (
    inicio.getTime() <
    agora.getTime() + agenda.antecedenciaMinutos * 60_000
  ) {
    return `marque com pelo menos ${agenda.antecedenciaMinutos} minutos de antecedência`;
  }
  const feriado = feriados.get(local.toISODate()!);
  if (feriado) return `${local.toFormat('dd/MM/yyyy')} é feriado (${feriado})`;
  const horario = horariosDoDia(agenda, local).find(
    (h) => h.inicio.getTime() === inicio.getTime(),
  );
  if (!horario) return 'esse horário não está na agenda do mentor';
  if (bloqueios.some((b) => sobrepoe(horario, b)))
    return 'o mentor bloqueou esse horário';
  return null;
}
