/**
 * Variáveis de ambiente obrigatórias: o servidor nem sobe se faltar alguma (main.ts chama
 * `carregarAmbiente()` antes de tudo), e a mensagem diz o que fazer.
 */
export type Ambiente = {
  databaseUrl: string;
  jwtSecret: string;
  chaveCriptografia: Buffer;
  porta: number;
  urlPublica: string;
};

/** 32 bytes em hex (openssl rand -hex 32) ou base64 (o generateValue do Render). */
export function decodificarChave(s: string): Buffer | null {
  if (/^[0-9a-fA-F]{64}$/.test(s)) return Buffer.from(s, 'hex');
  if (!/^[A-Za-z0-9+/_-]{43}=?$/.test(s)) return null;
  const b = Buffer.from(s, 'base64');
  return b.length === 32 ? b : null;
}

export function carregarAmbiente(
  env: NodeJS.ProcessEnv = process.env,
): Ambiente {
  const erros: string[] = [];
  const exigir = (nome: string) => {
    const v = env[nome];
    if (!v) erros.push(`defina ${nome} (veja o .env.example)`);
    return v ?? '';
  };
  const databaseUrl = exigir('DATABASE_URL');
  const jwtSecret = exigir('JWT_SECRET');
  if (jwtSecret && jwtSecret.length < 32)
    erros.push(
      'JWT_SECRET curto: use 32 caracteres ou mais (openssl rand -hex 32)',
    );
  const chaveTexto = exigir('ENCRYPTION_KEY');
  const chave = chaveTexto ? decodificarChave(chaveTexto) : null;
  if (chaveTexto && !chave)
    erros.push(
      'ENCRYPTION_KEY deve ter 32 bytes: 64 caracteres hex (openssl rand -hex 32) ou base64',
    );
  if (erros.length)
    throw new Error(`Configuração inválida:\n- ${erros.join('\n- ')}`);

  const porta = Number(env.PORT ?? 3004);
  return {
    databaseUrl,
    jwtSecret,
    chaveCriptografia: chave!,
    porta,
    // no Render o endereço público vem sozinho
    urlPublica: (
      env.PUBLIC_URL ??
      env.RENDER_EXTERNAL_URL ??
      `http://localhost:${porta}`
    ).replace(/\/$/, ''),
  };
}
