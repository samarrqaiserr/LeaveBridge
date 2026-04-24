import { 
  Controller, 
  Get, 
  Post, 
  Param, 
  Body, 
  HttpCode, 
  HttpStatus,
  ValidationPipe,
  HttpException,
  ConflictException,
} from '@nestjs/common';
import { SyncService, BalancePayload, WebhookPayload } from './sync.service';
import { BatchSyncDto } from '../dto/batch-sync.dto';
import { WebhookDto } from '../dto/webhook.dto';
import { AuditService } from '../audit/audit.service';

@Controller('sync')
export class SyncController {
  constructor(
    private readonly syncService: SyncService,
    private readonly auditService: AuditService,
  ) {}

  @Post('batch')
  @HttpCode(HttpStatus.OK)
  async batchSync(@Body(ValidationPipe) batchDto: BatchSyncDto) {
    const idempotencyKey = this.syncService.generateIdempotencyKey(batchDto);
    
    // Check if this batch was already processed
    const alreadyProcessed = await this.syncService.isBatchProcessed(idempotencyKey);
    if (alreadyProcessed) {
      throw new ConflictException('This batch has already been processed');
    }

    // Process the batch
    await this.syncService.processBatchSync(batchDto.balances);
    
    // Mark as processed
    await this.syncService.markBatchProcessed(idempotencyKey, batchDto.balances);

    return {
      message: 'Batch sync completed successfully',
      processed: batchDto.balances.length,
      idempotencyKey,
    };
  }

  @Post('webhook')
  @HttpCode(HttpStatus.OK)
  async webhook(@Body(ValidationPipe) webhookDto: WebhookDto) {
    await this.syncService.processWebhook({
      employeeId: webhookDto.employeeId,
      locationId: webhookDto.locationId,
      leaveType: webhookDto.leaveType,
      delta: webhookDto.delta,
      reason: webhookDto.reason,
    });

    return {
      message: 'Webhook processed successfully',
      employeeId: webhookDto.employeeId,
      locationId: webhookDto.locationId,
      leaveType: webhookDto.leaveType,
      delta: webhookDto.delta,
    };
  }
}
