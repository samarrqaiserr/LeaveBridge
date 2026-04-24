import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TimeOffRequest } from '../entities/time-off-request.entity';
import { OutboxEvent } from '../entities/outbox-event.entity';
import { Balance } from '../entities/balance.entity';
import { TimeOffService } from './time-off.service';
import { TimeOffController } from './time-off.controller';
import { HcmService } from './hcm.service';
import { BalanceModule } from '../balance/balance.module';
import { AuditModule } from '../audit/audit.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([TimeOffRequest, OutboxEvent, Balance]),
    forwardRef(() => BalanceModule),
    forwardRef(() => AuditModule),
  ],
  controllers: [TimeOffController],
  providers: [TimeOffService, HcmService],
  exports: [TimeOffService],
})
export class TimeOffModule {}
