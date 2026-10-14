import { INestApplication, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { carregarAmbiente } from './config/ambiente';

/** Tudo o que vale para o servidor e para os testes e2e (que sobem o mesmo app em memória). */
export function configurarApp(app: INestApplication) {
  (app as NestExpressApplication).set('trust proxy', 1); // atrás do proxy do Render: o IP real vem do X-Forwarded-For
  app.use(
    helmet({
      // o Swagger UI usa estilos inline e imagens em data:
      contentSecurityPolicy: {
        directives: {
          'style-src': ["'self'", "'unsafe-inline'"],
          'img-src': ["'self'", 'data:'],
        },
      },
    }),
  );
  // whitelist + forbidNonWhitelisted: campo que não está no DTO é erro (não passa nem é ignorado em silêncio)
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  const doc = new DocumentBuilder()
    .setTitle('Agenda de Mentorias')
    .setDescription(
      'Mentores publicam a agenda semanal e alunos marcam horários sem criar conta. ' +
        'Para testar a área do mentor: POST /auth/demo e use o token em "Authorize".',
    )
    .setVersion('1.0')
    .addBearerAuth()
    .build();
  SwaggerModule.setup(
    'docs',
    app,
    () => SwaggerModule.createDocument(app, doc),
    {
      jsonDocumentUrl: 'docs-json',
      customSiteTitle: 'Agenda de Mentorias — API',
    },
  );
  app.enableShutdownHooks();
  return app;
}

async function bootstrap() {
  try {
    process.loadEnvFile(); // local: lê o .env; no Render as variáveis já vêm do ambiente
  } catch {
    /* sem .env */
  }
  const ambiente = carregarAmbiente(); // falha aqui, com mensagem clara, se faltar variável
  const app = configurarApp(await NestFactory.create(AppModule));
  await app.listen(ambiente.porta);
  console.log(
    `Agenda de Mentorias em ${ambiente.urlPublica} (documentação em /docs)`,
  );
}

if (require.main === module) void bootstrap();
