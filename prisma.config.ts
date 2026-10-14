import { defineConfig, env } from 'prisma/config';

// O Prisma 7 não lê o .env sozinho. Local: lê o .env; no CI e no Render as variáveis já vêm do ambiente.
try {
  process.loadEnvFile();
} catch {
  /* sem .env: segue com o ambiente */
}

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations' },
  // o `prisma generate` (build do Docker) não precisa do banco; o `migrate` sem a variável para com erro
  ...(process.env.DATABASE_URL ? { datasource: { url: env('DATABASE_URL') } } : {}),
});
