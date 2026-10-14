import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsString, Length, Matches, MaxLength } from 'class-validator';

export class CadastroDto {
  @ApiProperty({ example: 'Ana Souza' })
  @IsString()
  @Length(2, 80, { message: 'nome deve ter de 2 a 80 caracteres' })
  nome: string;

  @ApiProperty({ example: 'ana@exemplo.com' })
  @IsEmail({}, { message: 'e-mail inválido' })
  @MaxLength(254)
  email: string;

  /** bcrypt usa só os primeiros 72 bytes: senha maior seria aceita e cortada sem aviso */
  @ApiProperty({
    example: 'uma senha longa e só sua',
    minLength: 10,
    maxLength: 72,
  })
  @IsString()
  @Length(10, 72, { message: 'a senha deve ter de 10 a 72 caracteres' })
  senha: string;
}

export class LoginDto {
  @ApiProperty({ example: 'ana@exemplo.com' })
  @IsEmail({}, { message: 'e-mail inválido' })
  @MaxLength(254)
  email: string;

  @ApiProperty()
  @IsString()
  @MaxLength(72)
  senha: string;
}

export class Login2faDto {
  @ApiProperty({
    description: 'token temporário devolvido pelo login (vale 5 minutos)',
  })
  @IsString()
  @MaxLength(2000)
  tokenTemporario: string;

  @ApiProperty({
    example: '123456',
    description:
      'código de 6 dígitos do app autenticador ou um código de recuperação',
  })
  @IsString()
  @Length(6, 20)
  codigo: string;
}

export class CodigoTotpDto {
  @ApiProperty({ example: '123456' })
  @Matches(/^\d{6}$/, { message: 'o código tem 6 dígitos' })
  codigo: string;
}
