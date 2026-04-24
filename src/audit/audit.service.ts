import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';
import { AuditLog, AuditSource, AuditEventType } from '../entities/audit-log.entity';

@Injectable()
export class AuditService {
  constructor(
    @InjectRepository(AuditLog)
    private readonly auditLogRepository: Repository<AuditLog>,
  ) {}

  async logBalanceUpdate(
    employeeId: string,
    locationId: string,
    leaveType: string,
    beforeValue: number,
    afterValue: number,
    source: AuditSource,
    actor?: string,
  ): Promise<AuditLog> {
    const auditLog = this.auditLogRepository.create({
      id: uuidv4(),
      employeeId,
      locationId,
      leaveType,
      eventType: AuditEventType.BALANCE_UPDATED,
      source,
      beforeValue,
      afterValue,
      actor,
      metadata: JSON.stringify({ type: 'balance_update' }),
    });

    return this.auditLogRepository.save(auditLog);
  }

  async logBalanceFloorApplied(
    employeeId: string,
    locationId: string,
    leaveType: string,
    beforeValue: number,
    afterValue: number,
    delta: number,
    floorValue: number,
    actor?: string,
  ): Promise<AuditLog> {
    const auditLog = this.auditLogRepository.create({
      id: uuidv4(),
      employeeId,
      locationId,
      leaveType,
      eventType: AuditEventType.BALANCE_FLOOR_APPLIED,
      source: AuditSource.HCM_WEBHOOK,
      beforeValue,
      afterValue,
      actor,
      metadata: JSON.stringify({ 
        type: 'balance_floor_applied',
        delta,
        floorValue,
        originalAfterValue: afterValue + delta,
      }),
    });

    return this.auditLogRepository.save(auditLog);
  }

  async logReservationCreated(
    employeeId: string,
    locationId: string,
    leaveType: string,
    beforeValue: number,
    afterValue: number,
    requestId: string,
  ): Promise<AuditLog> {
    const auditLog = this.auditLogRepository.create({
      id: uuidv4(),
      employeeId,
      locationId,
      leaveType,
      eventType: AuditEventType.RESERVATION_CREATED,
      source: AuditSource.READYON_REQUEST,
      beforeValue,
      afterValue,
      actor: `request:${requestId}`,
      requestId,
      metadata: JSON.stringify({ type: 'reservation_created' }),
    });

    return this.auditLogRepository.save(auditLog);
  }

  async logReservationReleased(
    employeeId: string,
    locationId: string,
    leaveType: string,
    beforeValue: number,
    afterValue: number,
    requestId: string,
  ): Promise<AuditLog> {
    const auditLog = this.auditLogRepository.create({
      id: uuidv4(),
      employeeId,
      locationId,
      leaveType,
      eventType: AuditEventType.RESERVATION_RELEASED,
      source: AuditSource.READYON_REQUEST,
      beforeValue,
      afterValue,
      actor: `request:${requestId}`,
      requestId,
      metadata: JSON.stringify({ type: 'reservation_released' }),
    });

    return this.auditLogRepository.save(auditLog);
  }

  async logRequestCreated(
    employeeId: string,
    locationId: string,
    leaveType: string,
    requestedDays: number,
    requestId: string,
    managerId?: string,
  ): Promise<AuditLog> {
    const auditLog = this.auditLogRepository.create({
      id: uuidv4(),
      employeeId,
      locationId,
      leaveType,
      eventType: AuditEventType.REQUEST_CREATED,
      source: AuditSource.READYON_REQUEST,
      beforeValue: null,
      afterValue: requestedDays,
      actor: managerId || 'system',
      requestId,
      metadata: JSON.stringify({ type: 'request_created', requestedDays }),
    });

    return this.auditLogRepository.save(auditLog);
  }

  async logRequestApproved(
    employeeId: string,
    locationId: string,
    leaveType: string,
    requestedDays: number,
    requestId: string,
    managerId: string,
  ): Promise<AuditLog> {
    const auditLog = this.auditLogRepository.create({
      id: uuidv4(),
      employeeId,
      locationId,
      leaveType,
      eventType: AuditEventType.REQUEST_APPROVED,
      source: AuditSource.READYON_REQUEST,
      beforeValue: null,
      afterValue: requestedDays,
      actor: managerId,
      requestId,
      metadata: JSON.stringify({ type: 'request_approved', requestedDays }),
    });

    return this.auditLogRepository.save(auditLog);
  }

  async logRequestRejected(
    employeeId: string,
    locationId: string,
    leaveType: string,
    requestedDays: number,
    requestId: string,
    managerId: string,
    rejectionReason: string,
  ): Promise<AuditLog> {
    const auditLog = this.auditLogRepository.create({
      id: uuidv4(),
      employeeId,
      locationId,
      leaveType,
      eventType: AuditEventType.REQUEST_REJECTED,
      source: AuditSource.READYON_REQUEST,
      beforeValue: null,
      afterValue: requestedDays,
      actor: managerId,
      requestId,
      metadata: JSON.stringify({ 
        type: 'request_rejected', 
        requestedDays,
        rejectionReason,
      }),
    });

    return this.auditLogRepository.save(auditLog);
  }

  async logRequestCancelled(
    employeeId: string,
    locationId: string,
    leaveType: string,
    requestedDays: number,
    requestId: string,
    actor: string,
  ): Promise<AuditLog> {
    const auditLog = this.auditLogRepository.create({
      id: uuidv4(),
      employeeId,
      locationId,
      leaveType,
      eventType: AuditEventType.REQUEST_CANCELLED,
      source: AuditSource.READYON_REQUEST,
      beforeValue: null,
      afterValue: requestedDays,
      actor,
      requestId,
      metadata: JSON.stringify({ type: 'request_cancelled', requestedDays }),
    });

    return this.auditLogRepository.save(auditLog);
  }

  async logBatchSyncWarning(
    employeeId: string,
    locationId: string,
    leaveType: string,
    incomingBalance: number,
    currentBalance: number,
    reservedDays: number,
  ): Promise<AuditLog> {
    const auditLog = this.auditLogRepository.create({
      id: uuidv4(),
      employeeId,
      locationId,
      leaveType,
      eventType: AuditEventType.BATCH_SYNC_WARNING,
      source: AuditSource.HCM_BATCH,
      beforeValue: currentBalance,
      afterValue: incomingBalance,
      actor: 'batch_sync',
      metadata: JSON.stringify({ 
        type: 'batch_sync_warning',
        incomingBalance,
        currentBalance,
        reservedDays,
        discrepancy: currentBalance - incomingBalance,
      }),
    });

    return this.auditLogRepository.save(auditLog);
  }

  async getAuditTrail(employeeId: string): Promise<AuditLog[]> {
    return this.auditLogRepository.find({
      where: { employeeId },
      order: { timestamp: 'DESC' },
    });
  }
}
