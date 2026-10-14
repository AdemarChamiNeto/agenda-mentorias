import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { hash } from 'bcryptjs';
import * as crypto from 'node:crypto';
import { PrismaService } from '../infra/infra.module';
import { CUSTO_BCRYPT } from '../auth/auth.service';

const h = (hora: number) => hora * 60;
/** Mentores fictícios para a demo pública ter horários para marcar desde o primeiro acesso. */
const EXEMPLOS = [
  {
    nome: 'Ana Souza',
    email: 'ana.souza@exemplo.invalid',
    duracaoMinutos: 60,
    bio: 'Mentoria de front-end com React e TypeScript (dados fictícios).',
    janelas: [1, 3, 5].map((d) => ({
      diaSemana: d,
      inicioMin: h(9),
      fimMin: h(12),
    })),
  },
  {
    nome: 'Bruno Lima',
    email: 'bruno.lima@exemplo.invalid',
    duracaoMinutos: 45,
    bio: 'Back-end com Node.js, NestJS e PostgreSQL (dados fictícios).',
    janelas: [2, 4].flatMap((d) => [
      { diaSemana: d, inicioMin: h(14), fimMin: h(18) },
      { diaSemana: d, inicioMin: h(19), fimMin: h(21) },
    ]),
  },
  {
    nome: 'Carla Mendes',
    email: 'carla.mendes@exemplo.invalid',
    duracaoMinutos: 30,
    bio: 'Carreira, currículo e entrevistas para dev júnior (dados fictícios).',
    janelas: [1, 2, 3, 4, 5].map((d) => ({
      diaSemana: d,
      inicioMin: h(18),
      fimMin: h(20),
    })),
  },
];

/** Cria os exemplos uma vez (banco vazio). Ninguém entra nessas contas: a senha é aleatória e descartada. */
@Injectable()
export class ExemplosService implements OnApplicationBootstrap {
  private readonly log = new Logger(ExemplosService.name);
  constructor(private readonly prisma: PrismaService) {}

  async onApplicationBootstrap() {
    if (process.env.NODE_ENV === 'test') return;
    await this.criarSeVazio();
  }

  async criarSeVazio() {
    if (await this.prisma.mentor.count({ where: { demoExpiraEm: null } }))
      return;
    for (const e of EXEMPLOS) {
      await this.prisma.mentor.create({
        data: {
          nome: e.nome,
          email: e.email,
          bio: e.bio,
          duracaoMinutos: e.duracaoMinutos,
          credencial: {
            create: {
              senhaHash: await hash(
                crypto.randomBytes(24).toString('hex'),
                CUSTO_BCRYPT,
              ),
            },
          },
          disponibilidades: { create: e.janelas },
        },
      });
    }
    this.log.log(`${EXEMPLOS.length} mentores de exemplo criados`);
  }
}
