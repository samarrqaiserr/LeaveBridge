import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { HcmController } from './hcm.controller';
import { HcmService } from './hcm.service';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env'],
      load: [() => ({
        PORT: 3001,
        HCM_REJECT_RATIO: 0.1,
        NODE_ENV: 'development'
      })],
    }),
  ],
  controllers: [HcmController],
  providers: [HcmService],
})
export class AppModule {}
