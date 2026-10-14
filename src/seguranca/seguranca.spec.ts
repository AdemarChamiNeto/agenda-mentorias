import { carregarAmbiente, decodificarChave } from '../config/ambiente';
import {
  cifrar,
  decifrar,
  hashCodigoRecuperacao,
  novoCodigoCancelamento,
  novosCodigosRecuperacao,
} from './segredos';
import {
  base32Decode,
  base32Encode,
  codeForStep,
  generateSecret,
  otpauthUrl,
  stepAt,
  verifyCode,
} from './totp';

// segredo dos vetores de teste da RFC 6238 (SHA-1): "12345678901234567890" em ASCII
const RFC = base32Encode(Buffer.from('12345678901234567890'));
const CHAVE = Buffer.alloc(32, 7);

describe('TOTP (reaproveitado do Controle de Ponto)', () => {
  it.each([
    [59, '94287082'],
    [1111111109, '07081804'],
    [1111111111, '14050471'],
    [1234567890, '89005924'],
    [2000000000, '69279037'],
  ])('vetor oficial da RFC 6238 em %i s', (segundos, esperado) => {
    expect(codeForStep(RFC, stepAt(new Date(segundos * 1000)), 8)).toBe(
      esperado,
    );
  });

  it('base32 vai e volta e recusa caractere inválido', () => {
    const s = generateSecret();
    expect(s).toMatch(/^[A-Z2-7]{32}$/);
    expect(base32Encode(base32Decode(s))).toBe(s);
    expect(() => base32Decode('abc1')).toThrow();
  });

  it('aceita 1 passo de diferença no relógio, recusa mais e não aceita código reusado', () => {
    const agora = new Date('2026-10-14T12:00:00Z');
    const passo = stepAt(agora);
    expect(verifyCode(RFC, codeForStep(RFC, passo - 1), agora)).toBe(passo - 1);
    expect(verifyCode(RFC, codeForStep(RFC, passo + 1), agora)).toBe(passo + 1);
    expect(verifyCode(RFC, codeForStep(RFC, passo - 2), agora)).toBeNull();
    expect(verifyCode(RFC, codeForStep(RFC, passo), agora, passo)).toBeNull(); // já usado
    expect(verifyCode(RFC, '12345', agora)).toBeNull();
  });

  it('URL do QR code com o nome do app', () => {
    const url = new URL(otpauthUrl('JBSWY3DPEHPK3PXP', 'ana@exemplo.com'));
    expect(url.protocol).toBe('otpauth:');
    expect(decodeURIComponent(url.pathname)).toBe(
      '/Agenda de Mentorias:ana@exemplo.com',
    );
  });
});

describe('segredos', () => {
  it('cifra com IV novo a cada vez e recusa valor adulterado', () => {
    const a = cifrar('JBSWY3DPEHPK3PXP', CHAVE);
    expect(a).not.toBe(cifrar('JBSWY3DPEHPK3PXP', CHAVE));
    expect(a).not.toContain('JBSWY3DPEHPK3PXP');
    expect(decifrar(a, CHAVE)).toBe('JBSWY3DPEHPK3PXP');
    const [v, iv, tag, dados] = a.split(':');
    expect(() =>
      decifrar(
        [v, iv, tag, (dados[0] === 'A' ? 'B' : 'A') + dados.slice(1)].join(':'),
        CHAVE,
      ),
    ).toThrow();
    expect(() => decifrar(a, Buffer.alloc(32, 8))).toThrow(); // chave errada
  });

  it('códigos: recuperação com 10 únicos e hash tolerante ao formato; cancelamento longo e único', () => {
    const cods = novosCodigosRecuperacao();
    expect(new Set(cods).size).toBe(10);
    for (const c of cods) expect(c).toMatch(/^[a-z2-9]{5}-[a-z2-9]{5}$/);
    expect(hashCodigoRecuperacao(cods[0])).toBe(
      hashCodigoRecuperacao(cods[0].toUpperCase().replace('-', ' ')),
    );
    expect(novoCodigoCancelamento()).toMatch(/^[A-Za-z0-9_-]{32}$/);
  });
});

describe('ambiente', () => {
  const ok = {
    DATABASE_URL: 'postgresql://x',
    JWT_SECRET: 'x'.repeat(32),
    ENCRYPTION_KEY: '0'.repeat(64),
  };

  it('chave em hex ou base64 de 32 bytes; o resto é recusado', () => {
    expect(decodificarChave('0'.repeat(64))?.length).toBe(32);
    expect(
      decodificarChave(Buffer.alloc(32, 7).toString('base64'))?.length,
    ).toBe(32);
    expect(decodificarChave('curta')).toBeNull();
  });

  it('não sobe sem as variáveis e diz o que fazer; no Render usa o endereço público dele', () => {
    expect(() => carregarAmbiente({})).toThrow(
      /defina DATABASE_URL[\s\S]*defina JWT_SECRET[\s\S]*defina ENCRYPTION_KEY/,
    );
    expect(() => carregarAmbiente({ ...ok, JWT_SECRET: 'curto' })).toThrow(
      /JWT_SECRET curto/,
    );
    expect(
      carregarAmbiente({
        ...ok,
        RENDER_EXTERNAL_URL: 'https://agenda.onrender.com/',
      }).urlPublica,
    ).toBe('https://agenda.onrender.com');
  });
});
