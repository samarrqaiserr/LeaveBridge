import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Balance } from '../entities/balance.entity';
import { AuditLog } from '../entities/audit-log.entity';
import { SyncService } from './sync.service';
import { SyncController } from './sync.controller';
import { BalanceModule } from '../balance/balance.module';
import { AuditModule } from '../audit/audit.module';
import { TimeOffModule } from '../time-off/time-off.module';
import { HcmService } from '../time-off/hcm.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([Balance, AuditLog]),
    BalanceModule,
    AuditModule,
    TimeOffModule,
  ],
  controllers: [SyncController],
  providers: [SyncService, HcmService],
  exports: [SyncService],
})
export class SyncModule {}
