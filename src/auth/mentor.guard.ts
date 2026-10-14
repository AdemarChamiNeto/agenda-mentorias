import {
  CanActivate,
  createParamDecorator,
  ExecutionContext,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { Request } from 'express';
import { PrismaService, RELOGIO, type Relogio } from '../infra/infra.module';

export type TokenPayload = { sub: string; tipo: 'sessao' | '2fa' };

/**
 * Rotas do mentor: exige "Authorization: Bearer <token de sessão>". O token temporário do 2FA
 * não serve aqui (tipo diferente), e conta de demonstração vencida perde o acesso na hora.
 */
@Injectable()
export class MentorGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
    @Inject(RELOGIO) private readonly agora: Relogio,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx
      .switchToHttp()
      .getRequest<Request & { mentorId?: string }>();
    const [tipo, token] = (req.headers.authorization ?? '').split(' ');
    if (tipo !== 'Bearer' || !token)
      throw new UnauthorizedException(
        'faça login e envie o token: Authorization: Bearer <token>',
      );
    let payload: TokenPayload;
    try {
      payload = await this.jwt.verifyAsync<TokenPayload>(token);
    } catch {
      throw new UnauthorizedException(
        'token inválido ou vencido: faça login de novo',
      );
    }
    if (payload.tipo !== 'sessao')
      throw new UnauthorizedException(
        'token inválido: termine o login com o código do 2FA',
      );
    const mentor = await this.prisma.mentor.findUnique({
      where: { id: payload.sub },
      select: { demoExpiraEm: true },
    });
    if (
      !mentor ||
      (mentor.demoExpiraEm && mentor.demoExpiraEm <= this.agora())
    ) {
      throw new UnauthorizedException(
        'conta não existe mais (a de demonstração dura 24 horas)',
      );
    }
    req.mentorId = payload.sub;
    return true;
  }
}

/** Id do mentor logado (preenchido pelo MentorGuard). */
export const MentorId = createParamDecorator(
  (_: unknown, ctx: ExecutionContext) =>
    ctx.switchToHttp().getRequest<{ mentorId: string }>().mentorId,
);
