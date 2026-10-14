import { horariosLivres, motivoIndisponivel, type Agenda } from './horarios';

// segunda das 9h às 12h e quarta das 14h às 16h, em São Paulo (UTC-3, sem horário de verão)
const agenda: Agenda = {
  fuso: 'America/Sao_Paulo',
  duracaoMinutos: 60,
  antecedenciaMinutos: 120,
  janelas: [
    { diaSemana: 1, inicioMin: 9 * 60, fimMin: 12 * 60 },
    { diaSemana: 3, inicioMin: 14 * 60, fimMin: 16 * 60 },
  ],
};
const semFeriados = new Map<string, string>();
const domingo = new Date('2026-11-01T12:00:00Z'); // "agora" nos testes
const iso = (lista: { inicio: Date }[]) =>
  lista.map((h) => h.inicio.toISOString());

describe('horariosLivres', () => {
  it('lê a agenda no fuso do mentor e devolve os horários em UTC', () => {
    const livres = horariosLivres(
      agenda,
      '2026-11-02',
      '2026-11-04',
      [],
      semFeriados,
      domingo,
    );
    expect(iso(livres)).toEqual([
      '2026-11-02T12:00:00.000Z', // seg 09h em SP
      '2026-11-02T13:00:00.000Z',
      '2026-11-02T14:00:00.000Z',
      '2026-11-04T17:00:00.000Z', // qua 14h em SP
      '2026-11-04T18:00:00.000Z',
    ]);
  });

  it('tira feriado, horário ocupado e o que está dentro da antecedência mínima', () => {
    const feriados = new Map([['2026-11-04', 'Feriado de teste']]);
    const ocupados = [
      {
        inicio: new Date('2026-11-02T13:30:00Z'),
        fim: new Date('2026-11-02T14:00:00Z'),
      },
    ]; // pega metade das 10h
    const agora = new Date('2026-11-02T10:30:00Z'); // seg 07h30 em SP: 09h fica a 1h30 (< 2h de antecedência)
    const livres = horariosLivres(
      agenda,
      '2026-11-02',
      '2026-11-04',
      ocupados,
      feriados,
      agora,
    );
    // sobra só seg 11h: 09h pela antecedência, 10h por estar ocupada, quarta inteira pelo feriado
    expect(iso(livres)).toEqual(['2026-11-02T14:00:00.000Z']);
  });

  it('duração que não cabe inteira na janela não gera horário quebrado', () => {
    const livres = horariosLivres(
      { ...agenda, duracaoMinutos: 90 },
      '2026-11-02',
      '2026-11-02',
      [],
      semFeriados,
      domingo,
    );
    expect(iso(livres)).toEqual([
      '2026-11-02T12:00:00.000Z',
      '2026-11-02T13:30:00.000Z',
    ]); // 09h e 10h30; 12h passaria do fim
  });

  it('recusa período invertido ou longo demais', () => {
    expect(() =>
      horariosLivres(
        agenda,
        '2026-11-04',
        '2026-11-02',
        [],
        semFeriados,
        domingo,
      ),
    ).toThrow(/antes/);
    expect(() =>
      horariosLivres(
        agenda,
        '2026-11-01',
        '2026-12-15',
        [],
        semFeriados,
        domingo,
      ),
    ).toThrow(/31 dias/);
    expect(() =>
      horariosLivres(
        agenda,
        '2026-13-01',
        '2026-13-02',
        [],
        semFeriados,
        domingo,
      ),
    ).toThrow(/data inválida/);
  });
});

describe('motivoIndisponivel', () => {
  const seg9h = new Date('2026-11-02T12:00:00Z');

  it('horário da agenda, longe o bastante e sem bloqueio: pode marcar', () => {
    expect(
      motivoIndisponivel(agenda, seg9h, [], semFeriados, domingo),
    ).toBeNull();
  });

  it('explica cada motivo de recusa', () => {
    expect(
      motivoIndisponivel(
        agenda,
        new Date('2026-11-02T12:30:00Z'),
        [],
        semFeriados,
        domingo,
      ),
    ).toMatch(/não está na agenda/);
    expect(
      motivoIndisponivel(
        agenda,
        new Date('2026-11-03T12:00:00Z'),
        [],
        semFeriados,
        domingo,
      ),
    ).toMatch(/não está na agenda/); // terça
    expect(
      motivoIndisponivel(
        agenda,
        seg9h,
        [],
        new Map([['2026-11-02', 'Finados']]),
        domingo,
      ),
    ).toBe('02/11/2026 é feriado (Finados)');
    expect(
      motivoIndisponivel(
        agenda,
        seg9h,
        [
          {
            inicio: new Date('2026-11-02T00:00:00Z'),
            fim: new Date('2026-11-03T00:00:00Z'),
          },
        ],
        semFeriados,
        domingo,
      ),
    ).toBe('o mentor bloqueou esse horário');
    expect(
      motivoIndisponivel(
        agenda,
        seg9h,
        [],
        semFeriados,
        new Date('2026-11-02T11:00:00Z'),
      ),
    ).toMatch(/120 minutos de antecedência/);
  });
});
