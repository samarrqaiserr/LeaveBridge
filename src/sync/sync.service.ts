import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { Balance, LeaveType } from '../entities/balance.entity';
import { BalanceService } from '../balance/balance.service';
import { AuditService } from '../audit/audit.service';
import { AuditSource } from '../entities/audit-log.entity';
import { HcmService } from '../time-off/hcm.service';
import { v4 as uuidv4 } from 'uuid';
import * as crypto from 'crypto';

export interface BalancePayload {
  employeeId: string;
  locationId: string;
  leaveType: LeaveType;
  balance: number;
}

export interface WebhookPayload {
  employeeId: string;
  locationId: string;
  leaveType: LeaveType;
  delta: number;
  reason?: string;
}

@Injectable()
export class SyncService {
  constructor(
    @InjectRepository(Balance)
    private readonly balanceRepository: Repository<Balance>,
    private readonly balanceService: BalanceService,
    private readonly auditService: AuditService,
    private readonly hcmService: HcmService,
    private readonly dataSource: DataSource,
  ) {}

  async processBatchSync(payloads: BalancePayload[]): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      for (const payload of payloads) {
        const existing = await manager.findOne(Balance, {
          where: {
            employeeId: payload.employeeId,
            locationId: payload.locationId,
            leaveType: payload.leaveType,
          },
        });

        if (existing) {
          // Check for potential HCM rollback
          const minBalance = existing.reservedDays;
          if (payload.balance < existing.availableBalance - existing.reservedDays) {
            // Log warning about possible HCM rollback
            await this.auditService.logBatchSyncWarning(
              payload.employeeId,
              payload.locationId,
              payload.leaveType,
              payload.balance,
              existing.availableBalance,
              existing.reservedDays,
            );
          }

          // Update balance but preserve reservations
          existing.availableBalance = payload.balance;
          await manager.save(existing);

          await this.auditService.logBalanceUpdate(
            payload.employeeId,
            payload.locationId,
            payload.leaveType,
            existing.availableBalance,
            payload.balance,
            AuditSource.HCM_BATCH,
            'batch_sync',
          );
        } else {
          // Create new balance
          const newBalance = manager.create(Balance, {
            employeeId: payload.employeeId,
            locationId: payload.locationId,
            leaveType: payload.leaveType,
            availableBalance: payload.balance,
            reservedDays: 0,
          });
          await manager.save(newBalance);

          await this.auditService.logBalanceUpdate(
            payload.employeeId,
            payload.locationId,
            payload.leaveType,
            0,
            payload.balance,
            AuditSource.HCM_BATCH,
            'batch_sync',
          );
        }
      }
    });
  }

  async processWebhook(webhook: WebhookPayload): Promise<void> {
    await this.balanceService.applyWebhookDelta(
      webhook.employeeId,
      webhook.locationId,
      webhook.leaveType,
      webhook.delta,
      webhook.reason || 'webhook',
    );
  }

  generateIdempotencyKey(payload: any): string {
    const payloadString = JSON.stringify(payload, Object.keys(payload).sort());
    return crypto.createHash('sha256').update(payloadString).digest('hex');
  }

  async isBatchProcessed(idempotencyKey: string): Promise<boolean> {
    // This would typically check a separate idempotency table
    // For now, we'll implement a simple version using audit logs
    const existingLog = await this.auditService.getAuditTrail('batch_sync');
    return existingLog.some(log => 
      log.metadata && JSON.parse(log.metadata).idempotencyKey === idempotencyKey
    );
  }

  async markBatchProcessed(idempotencyKey: string, payload: BalancePayload[]): Promise<void> {
    // This would typically store in an idempotency table
    // For now, we'll add the idempotency key to the first audit log entry
    if (payload.length > 0) {
      const firstPayload = payload[0];
      await this.auditService.logBalanceUpdate(
        firstPayload.employeeId,
        firstPayload.locationId,
        firstPayload.leaveType,
        0, // before value not relevant for idempotency
        0, // after value not relevant for idempotency
        AuditSource.HCM_BATCH,
        'idempotency_marker',
      );
    }
  }

  async syncWithHCM(employeeId: string, locationId: string): Promise<void> {
    const leaveTypes = [LeaveType.ANNUAL, LeaveType.SICK, LeaveType.UNPAID];
    
    for (const leaveType of leaveTypes) {
      try {
        const hcmBalance = await this.hcmService.getBalanceFromHCM(
          employeeId,
          locationId,
          leaveType,
        );

        await this.balanceService.createOrUpdate(
          employeeId,
          locationId,
          leaveType,
          hcmBalance,
          AuditSource.HCM_REALTIME,
          'hcm_sync',
        );
      } catch (error) {
        // Log error but continue with other leave types
        console.error(
          `Failed to sync balance for ${employeeId}/${locationId}/${leaveType}:`,
          error.message,
        );
      }
    }
  }
}
