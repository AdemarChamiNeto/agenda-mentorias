import * as crypto from 'node:crypto';

/**
 * Segredo do 2FA cifrado com AES-256-GCM (cifra + autenticação: se alguém mexer no valor salvo,
 * a decifragem falha). Formato salvo: "v1:<iv>:<tag>:<cifra>" em base64url. Mesmo formato do
 * Controle de Ponto.
 */
export function cifrar(texto: string, chave: Buffer): string {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', chave, iv);
  const dados = Buffer.concat([c.update(texto, 'utf8'), c.final()]);
  return [
    'v1',
    ...[iv, c.getAuthTag(), dados].map((b) => b.toString('base64url')),
  ].join(':');
}

export function decifrar(salvo: string, chave: Buffer): string {
  const [v, iv, tag, dados] = salvo.split(':');
  if (v !== 'v1' || !iv || !tag || !dados)
    throw new Error('segredo em formato desconhecido');
  const d = crypto.createDecipheriv(
    'aes-256-gcm',
    chave,
    Buffer.from(iv, 'base64url'),
  );
  d.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([
    d.update(Buffer.from(dados, 'base64url')),
    d.final(),
  ]).toString('utf8');
}

/**
 * Tokens aleatórios e longos (código de cancelamento, código de recuperação) são guardados com
 * SHA-256: o bcrypt existe para senhas escolhidas por pessoas; aqui não há o que adivinhar, e a
 * busca pelo hash fica direta (índice único).
 */
export const hashToken = (token: string) =>
  crypto.createHash('sha256').update(token).digest('hex');

/** Código de cancelamento: 24 bytes aleatórios (192 bits), seguro para ir numa URL. */
export const novoCodigoCancelamento = () =>
  crypto.randomBytes(24).toString('base64url');

const ALFABETO_RECUPERACAO = 'abcdefghjkmnpqrstuvwxyz23456789'; // sem 0/o, 1/l/i

/** 10 códigos de recuperação de 10 caracteres (≈ 50 bits cada), uso único. */
export function novosCodigosRecuperacao(n = 10): string[] {
  return Array.from({ length: n }, () => {
    const c = Array.from(
      { length: 10 },
      () => ALFABETO_RECUPERACAO[crypto.randomInt(ALFABETO_RECUPERACAO.length)],
    );
    return `${c.slice(0, 5).join('')}-${c.slice(5).join('')}`;
  });
}

/** O hash ignora maiúsculas, espaços e o hífen: "ABCDE FGHJK" vale o mesmo que "abcde-fghjk". */
export const hashCodigoRecuperacao = (codigo: string) =>
  hashToken(codigo.toLowerCase().replace(/[^a-z0-9]/g, ''));
