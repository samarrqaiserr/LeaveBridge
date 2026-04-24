import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { HcmController } from '../mock-hcm/src/hcm.controller';
import { HcmService } from '../mock-hcm/src/hcm.service';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['../mock-hcm/.env'],
    }),
  ],
  controllers: [HcmController],
  providers: [HcmService],
})
export class MockHcmModule {}
