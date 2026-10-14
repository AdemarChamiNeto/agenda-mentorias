import {
  ConflictException,
  Inject,
  Injectable,
  UnauthorizedException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { compare, hash, hashSync } from 'bcryptjs';
import * as crypto from 'node:crypto';
import * as QRCode from 'qrcode';
import {
  AMBIENTE,
  PrismaService,
  RELOGIO,
  type Relogio,
} from '../infra/infra.module';
import type { Ambiente } from '../config/ambiente';
import {
  cifrar,
  decifrar,
  hashCodigoRecuperacao,
  novosCodigosRecuperacao,
} from '../seguranca/segredos';
import { generateSecret, otpauthUrl, verifyCode } from '../seguranca/totp';
import type { TokenPayload } from './mentor.guard';

export const CUSTO_BCRYPT = 12;
/** hash de uma senha qualquer: login com e-mail que não existe gasta o mesmo tempo (não revela quem tem conta) */
const HASH_FALSO = hashSync('senha-que-ninguem-usa', CUSTO_BCRYPT);

/** Agenda inicial da conta de demonstração: seg a sex, 9h–12h e 14h–17h. */
const AGENDA_DEMO = [1, 2, 3, 4, 5].flatMap((dia) => [
  { diaSemana: dia, inicioMin: 9 * 60, fimMin: 12 * 60 },
  { diaSemana: dia, inicioMin: 14 * 60, fimMin: 17 * 60 },
]);

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    @Inject(AMBIENTE) private readonly ambiente: Ambiente,
    @Inject(RELOGIO) private readonly agora: Relogio,
  ) {}

  private sessao(mentorId: string) {
    return this.jwt.signAsync(
      { sub: mentorId, tipo: 'sessao' } satisfies TokenPayload,
      { expiresIn: '8h' },
    );
  }

  async cadastrar(nome: string, email: string, senha: string) {
    const emailNormalizado = email.trim().toLowerCase();
    const senhaHash = await hash(senha, CUSTO_BCRYPT);
    try {
      const m = await this.prisma.mentor.create({
        data: {
          nome: nome.trim(),
          email: emailNormalizado,
          credencial: { create: { senhaHash } },
        },
        select: { id: true },
      });
      return { token: await this.sessao(m.id) };
    } catch (err) {
      if ((err as { code?: string }).code === 'P2002')
        throw new ConflictException('já existe uma conta com esse e-mail');
      throw err;
    }
  }

  /** Senha certa: sem 2FA, já entra; com 2FA, devolve um token temporário de 5 minutos para o segundo passo. */
  async login(email: string, senha: string) {
    const m = await this.prisma.mentor.findUnique({
      where: { email: email.trim().toLowerCase() },
      select: {
        id: true,
        demoExpiraEm: true,
        credencial: { select: { senhaHash: true, totpAtivadoEm: true } },
      },
    });
    const ok = await compare(senha, m?.credencial?.senhaHash ?? HASH_FALSO);
    if (!m || !ok || m.demoExpiraEm)
      throw new UnauthorizedException('e-mail ou senha incorretos');
    if (m.credencial?.totpAtivadoEm) {
      const tokenTemporario = await this.jwt.signAsync(
        { sub: m.id, tipo: '2fa' } satisfies TokenPayload,
        { expiresIn: '5m' },
      );
      return { precisa2fa: true, tokenTemporario };
    }
    return { precisa2fa: false, token: await this.sessao(m.id) };
  }

  /** Segundo passo: código do app (não pode ser reusado) ou um código de recuperação (uso único). */
  async login2fa(tokenTemporario: string, codigo: string) {
    let payload: TokenPayload;
    try {
      payload = await this.jwt.verifyAsync<TokenPayload>(tokenTemporario);
    } catch {
      throw new UnauthorizedException(
        'o login expirou: entre com a senha de novo',
      );
    }
    if (payload.tipo !== '2fa')
      throw new UnauthorizedException('token inválido');
    const mentorId = payload.sub;
    const c = await this.prisma.credencial.findUnique({ where: { mentorId } });
    if (!c?.totpSegredo || !c.totpAtivadoEm)
      throw new UnauthorizedException('2FA não está ativo nesta conta');

    const passo = verifyCode(
      decifrar(c.totpSegredo, this.ambiente.chaveCriptografia),
      codigo,
      this.agora(),
      c.totpUltimoPasso,
    );
    if (passo !== null) {
      // condição no UPDATE: dois logins ao mesmo tempo com o mesmo código, só um passa
      const r = await this.prisma.credencial.updateMany({
        where: {
          mentorId,
          OR: [{ totpUltimoPasso: null }, { totpUltimoPasso: { lt: passo } }],
        },
        data: { totpUltimoPasso: passo },
      });
      if (r.count === 1) return { token: await this.sessao(mentorId) };
    } else {
      const usado = await this.prisma.codigoRecuperacao.updateMany({
        where: {
          mentorId,
          codigoHash: hashCodigoRecuperacao(codigo),
          usadoEm: null,
        },
        data: { usadoEm: this.agora() },
      });
      if (usado.count === 1) {
        const restantes = await this.prisma.codigoRecuperacao.count({
          where: { mentorId, usadoEm: null },
        });
        return {
          token: await this.sessao(mentorId),
          codigosRecuperacaoRestantes: restantes,
        };
      }
    }
    throw new UnauthorizedException('código inválido ou já usado');
  }

  /** Passo 1 do 2FA: gera o segredo (ainda inativo) e o QR code para o app autenticador. */
  async configurar2fa(mentorId: string) {
    const m = await this.prisma.mentor.findUniqueOrThrow({
      where: { id: mentorId },
      select: { email: true, credencial: true },
    });
    if (m.credencial?.totpAtivadoEm)
      throw new ConflictException('o 2FA já está ativo');
    const segredo = generateSecret();
    await this.prisma.credencial.update({
      where: { mentorId },
      data: {
        totpSegredo: cifrar(segredo, this.ambiente.chaveCriptografia),
        totpUltimoPasso: null,
      },
    });
    const url = otpauthUrl(segredo, m.email);
    return { otpauthUrl: url, segredo, qrCode: await QRCode.toDataURL(url) };
  }

  /** Passo 2: o código do app confirma que a leitura deu certo; só então o 2FA liga e os códigos de recuperação aparecem (uma vez). */
  async ativar2fa(mentorId: string, codigo: string) {
    const c = await this.prisma.credencial.findUniqueOrThrow({
      where: { mentorId },
    });
    if (c.totpAtivadoEm) throw new ConflictException('o 2FA já está ativo');
    if (!c.totpSegredo)
      throw new UnprocessableEntityException(
        'chame /auth/2fa/configurar antes',
      );
    const passo = verifyCode(
      decifrar(c.totpSegredo, this.ambiente.chaveCriptografia),
      codigo,
      this.agora(),
    );
    if (passo === null)
      throw new UnprocessableEntityException(
        'código incorreto: confira o horário do celular e tente o código atual',
      );
    const codigos = novosCodigosRecuperacao();
    await this.prisma.$transaction([
      this.prisma.credencial.update({
        where: { mentorId },
        data: { totpAtivadoEm: this.agora(), totpUltimoPasso: passo },
      }),
      this.prisma.codigoRecuperacao.deleteMany({ where: { mentorId } }),
      this.prisma.codigoRecuperacao.createMany({
        data: codigos.map((c) => ({
          mentorId,
          codigoHash: hashCodigoRecuperacao(c),
        })),
      }),
    ]);
    return { codigosRecuperacao: codigos };
  }

  /** Conta de 24 h, sem pedir dado nenhum, já com agenda: para testar a API pelo Swagger. */
  async demo() {
    const id = crypto.randomUUID();
    const m = await this.prisma.mentor.create({
      data: {
        nome: 'Mentor de demonstração',
        email: `demo-${id}@exemplo.invalid`,
        bio: 'Conta temporária: some em 24 horas, com tudo o que for criado nela.',
        antecedenciaMinutos: 60,
        demoExpiraEm: new Date(this.agora().getTime() + 24 * 3600_000),
        credencial: {
          create: {
            senhaHash: await hash(
              crypto.randomBytes(24).toString('hex'),
              CUSTO_BCRYPT,
            ),
          },
        }, // ninguém entra com senha
        disponibilidades: { create: AGENDA_DEMO },
      },
      select: { id: true, demoExpiraEm: true },
    });
    return {
      token: await this.sessao(m.id),
      mentorId: m.id,
      expiraEm: m.demoExpiraEm,
    };
  }
}
