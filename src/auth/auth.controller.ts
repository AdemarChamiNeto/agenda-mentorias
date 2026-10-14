import { Body, Controller, HttpCode, Post, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { AuthService } from './auth.service';
import { CadastroDto, CodigoTotpDto, Login2faDto, LoginDto } from './dto';
import { MentorGuard, MentorId } from './mentor.guard';

const QUINZE_MIN = 15 * 60_000;

@ApiTags('Autenticação do mentor')
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('demo')
  @Throttle({ default: { limit: 5, ttl: 60 * 60_000 } })
  @ApiOperation({
    summary:
      'Cria uma conta de mentor de demonstração (24 h, já com agenda) e devolve o token',
  })
  demo() {
    return this.auth.demo();
  }

  @Post('cadastro')
  @Throttle({ default: { limit: 5, ttl: QUINZE_MIN } })
  @ApiOperation({ summary: 'Cadastra um mentor (senha com bcrypt custo 12)' })
  @ApiResponse({ status: 409, description: 'E-mail já cadastrado' })
  cadastrar(@Body() dto: CadastroDto) {
    return this.auth.cadastrar(dto.nome, dto.email, dto.senha);
  }

  @Post('login')
  @HttpCode(200)
  @Throttle({ default: { limit: 5, ttl: QUINZE_MIN } })
  @ApiOperation({
    summary:
      'Login. Com 2FA ativo, devolve um token temporário para o /auth/login/2fa',
  })
  @ApiResponse({
    status: 401,
    description: 'E-mail ou senha incorretos (a mesma resposta para os dois)',
  })
  login(@Body() dto: LoginDto) {
    return this.auth.login(dto.email, dto.senha);
  }

  @Post('login/2fa')
  @HttpCode(200)
  @Throttle({ default: { limit: 5, ttl: QUINZE_MIN } })
  @ApiOperation({
    summary:
      'Segundo passo do login: código do app autenticador ou código de recuperação',
  })
  login2fa(@Body() dto: Login2faDto) {
    return this.auth.login2fa(dto.tokenTemporario, dto.codigo);
  }

  @Post('2fa/configurar')
  @UseGuards(MentorGuard)
  @ApiBearerAuth()
  @Throttle({ default: { limit: 5, ttl: QUINZE_MIN } })
  @ApiOperation({
    summary:
      'Gera o segredo do 2FA e o QR code (o 2FA só liga depois do /2fa/ativar)',
  })
  configurar(@MentorId() mentorId: string) {
    return this.auth.configurar2fa(mentorId);
  }

  @Post('2fa/ativar')
  @UseGuards(MentorGuard)
  @ApiBearerAuth()
  @Throttle({ default: { limit: 5, ttl: QUINZE_MIN } })
  @ApiOperation({
    summary:
      'Confirma o 2FA com um código do app e devolve os 10 códigos de recuperação (só desta vez)',
  })
  ativar(@MentorId() mentorId: string, @Body() dto: CodigoTotpDto) {
    return this.auth.ativar2fa(mentorId, dto.codigo);
  }
}
