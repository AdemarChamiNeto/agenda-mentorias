import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsDateString,
  IsEmail,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

const HORA = /^([01]\d|2[0-3]):[0-5]\d$|^24:00$/;
const DATA = /^\d{4}-\d{2}-\d{2}$/;

export class AtualizarPerfilDto {
  @ApiPropertyOptional({ example: 'Ana Souza' })
  @IsOptional()
  @IsString()
  @Length(2, 80)
  nome?: string;

  @ApiPropertyOptional({ example: 'Mentora de React e TypeScript há 6 anos.' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  bio?: string;

  @ApiPropertyOptional({
    example: 'America/Sao_Paulo',
    description: 'fuso IANA em que a agenda semanal é lida',
  })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  fuso?: string;

  @ApiPropertyOptional({ example: 60, minimum: 15, maximum: 240 })
  @IsOptional()
  @IsInt()
  @Min(15)
  @Max(240)
  duracaoMinutos?: number;

  @ApiPropertyOptional({
    example: 120,
    description: 'antecedência mínima para marcar, em minutos (até 7 dias)',
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10080)
  antecedenciaMinutos?: number;
}

export class JanelaDto {
  @ApiProperty({ example: 1, description: '1 = segunda ... 7 = domingo' })
  @IsInt()
  @Min(1)
  @Max(7)
  diaSemana: number;

  @ApiProperty({ example: '09:00' })
  @Matches(HORA, { message: 'inicio no formato HH:MM' })
  inicio: string;

  @ApiProperty({ example: '12:00' })
  @Matches(HORA, { message: 'fim no formato HH:MM' })
  fim: string;
}

export class DisponibilidadesDto {
  @ApiProperty({ type: [JanelaDto] })
  @IsArray()
  @ArrayMaxSize(28)
  @ValidateNested({ each: true })
  @Type(() => JanelaDto)
  janelas: JanelaDto[];
}

export class BloqueioDto {
  @ApiProperty({ example: '2026-12-24T00:00:00-03:00' })
  @IsDateString({}, { message: 'inicio deve ser uma data e hora ISO 8601' })
  inicio: string;

  @ApiProperty({ example: '2026-12-26T00:00:00-03:00' })
  @IsDateString({}, { message: 'fim deve ser uma data e hora ISO 8601' })
  fim: string;

  @ApiPropertyOptional({ example: 'Natal' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  motivo?: string;
}

export class PeriodoDto {
  @ApiProperty({
    example: '2026-11-02',
    description: 'data inicial (no fuso do mentor)',
  })
  @Matches(DATA, { message: 'de no formato AAAA-MM-DD' })
  de: string;

  @ApiProperty({
    example: '2026-11-08',
    description: 'data final, inclusive (até 31 dias)',
  })
  @Matches(DATA, { message: 'ate no formato AAAA-MM-DD' })
  ate: string;
}

export class MarcacaoDto {
  @ApiProperty({ example: 'Bruno Lima' })
  @IsString()
  @Length(2, 80, { message: 'alunoNome deve ter de 2 a 80 caracteres' })
  alunoNome: string;

  @ApiProperty({ example: 'bruno@exemplo.com' })
  @IsEmail({}, { message: 'alunoEmail inválido' })
  @MaxLength(254)
  alunoEmail: string;

  @ApiProperty({
    example: '2026-11-02T09:00:00-03:00',
    description: 'início de um dos horários livres',
  })
  @IsDateString({}, { message: 'inicio deve ser uma data e hora ISO 8601' })
  inicio: string;
}

export class CancelarDto {
  @ApiProperty({ description: 'código de cancelamento recebido ao marcar' })
  @IsString()
  @Length(20, 100)
  codigo: string;
}
