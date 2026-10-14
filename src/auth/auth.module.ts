import { Global, Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AMBIENTE } from '../infra/infra.module';
import type { Ambiente } from '../config/ambiente';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { MentorGuard } from './mentor.guard';

@Global()
@Module({
  imports: [
    JwtModule.registerAsync({
      inject: [AMBIENTE],
      useFactory: (ambiente: Ambiente) => ({
        secret: ambiente.jwtSecret,
        signOptions: { algorithm: 'HS256' },
        verifyOptions: { algorithms: ['HS256'] },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, MentorGuard],
  exports: [JwtModule, MentorGuard],
})
export class AuthModule {}
