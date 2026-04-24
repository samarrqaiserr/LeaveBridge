import { Injectable, NotFoundException, Inject, forwardRef } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Balance, LeaveType } from '../entities/balance.entity';
import { AuditService } from '../audit/audit.service';
import { AuditSource, AuditEventType } from '../entities/audit-log.entity';

@Injectable()
export class BalanceService {
  constructor(
    @InjectRepository(Balance)
    private readonly balanceRepository: Repository<Balance>,
    @Inject(forwardRef(() => AuditService))
    private readonly auditService: AuditService,
  ) {}

  async findByEmployeeLocation(
    employeeId: string,
    locationId: string,
  ): Promise<Balance[]> {
    return this.balanceRepository.find({
      where: { employeeId, locationId },
    });
  }

  async findByEmployeeLocationAndType(
    employeeId: string,
    locationId: string,
    leaveType: LeaveType,
  ): Promise<Balance | null> {
    return this.balanceRepository.findOne({
      where: { employeeId, locationId, leaveType },
    });
  }

  async createOrUpdate(
    employeeId: string,
    locationId: string,
    leaveType: LeaveType,
    balance: number,
    source: AuditSource,
    actor?: string,
  ): Promise<Balance> {
    const existing = await this.findByEmployeeLocationAndType(
      employeeId,
      locationId,
      leaveType,
    );

    if (existing) {
      const beforeValue = existing.availableBalance;
      existing.availableBalance = balance;
      
      const updated = await this.balanceRepository.save(existing);
      
      await this.auditService.logBalanceUpdate(
        employeeId,
        locationId,
        leaveType,
        beforeValue,
        balance,
        source,
        actor,
      );

      return updated;
    } else {
      const newBalance = this.balanceRepository.create({
        employeeId,
        locationId,
        leaveType,
        availableBalance: balance,
        reservedDays: 0,
      });

      const saved = await this.balanceRepository.save(newBalance);
      
      await this.auditService.logBalanceUpdate(
        employeeId,
        locationId,
        leaveType,
        0,
        balance,
        source,
        actor,
      );

      return saved;
    }
  }

  async reserveDays(
    employeeId: string,
    locationId: string,
    leaveType: LeaveType,
    days: number,
    requestId: string,
  ): Promise<Balance> {
    const balance = await this.findByEmployeeLocationAndType(
      employeeId,
      locationId,
      leaveType,
    );

    if (!balance) {
      throw new NotFoundException(
        `Balance not found for employee ${employeeId}, location ${locationId}, leave type ${leaveType}`,
      );
    }

    const availableForReservation = balance.availableBalance - balance.reservedDays;
    if (availableForReservation < days) {
      throw new Error(
        `Insufficient balance. Available: ${availableForReservation}, Requested: ${days}`,
      );
    }

    const beforeReserved = balance.reservedDays;
    balance.reservedDays += days;
    
    const updated = await this.balanceRepository.save(balance);
    
    await this.auditService.logReservationCreated(
      employeeId,
      locationId,
      leaveType,
      beforeReserved,
      balance.reservedDays,
      requestId,
    );

    return updated;
  }

  async releaseReservation(
    employeeId: string,
    locationId: string,
    leaveType: LeaveType,
    days: number,
    requestId: string,
  ): Promise<Balance> {
    const balance = await this.findByEmployeeLocationAndType(
      employeeId,
      locationId,
      leaveType,
    );

    if (!balance) {
      throw new NotFoundException(
        `Balance not found for employee ${employeeId}, location ${locationId}, leave type ${leaveType}`,
      );
    }

    const beforeReserved = balance.reservedDays;
    balance.reservedDays = Math.max(0, balance.reservedDays - days);
    
    const updated = await this.balanceRepository.save(balance);
    
    await this.auditService.logReservationReleased(
      employeeId,
      locationId,
      leaveType,
      beforeReserved,
      balance.reservedDays,
      requestId,
    );

    return updated;
  }

  async decrementBalance(
    employeeId: string,
    locationId: string,
    leaveType: LeaveType,
    days: number,
    requestId: string,
  ): Promise<Balance> {
    const balance = await this.findByEmployeeLocationAndType(
      employeeId,
      locationId,
      leaveType,
    );

    if (!balance) {
      throw new NotFoundException(
        `Balance not found for employee ${employeeId}, location ${locationId}, leave type ${leaveType}`,
      );
    }

    const beforeBalance = balance.availableBalance;
    const beforeReserved = balance.reservedDays;
    
    balance.availableBalance = Math.max(0, balance.availableBalance - days);
    balance.reservedDays = Math.max(0, balance.reservedDays - days);
    
    const updated = await this.balanceRepository.save(balance);
    
    await this.auditService.logBalanceUpdate(
      employeeId,
      locationId,
      leaveType,
      beforeBalance,
      balance.availableBalance,
      AuditSource.READYON_REQUEST,
      `request:${requestId}`,
    );

    return updated;
  }

  async applyWebhookDelta(
    employeeId: string,
    locationId: string,
    leaveType: LeaveType,
    delta: number,
    actor?: string,
  ): Promise<Balance> {
    const balance = await this.findByEmployeeLocationAndType(
      employeeId,
      locationId,
      leaveType,
    );

    if (!balance) {
      throw new NotFoundException(
        `Balance not found for employee ${employeeId}, location ${locationId}, leave type ${leaveType}`,
      );
    }

    const beforeBalance = balance.availableBalance;
    const newBalance = balance.availableBalance + delta;
    
    // Apply floor logic: availableBalance - reservedDays should never be negative
    const minBalance = balance.reservedDays;
    const finalBalance = Math.max(minBalance, newBalance);
    
    balance.availableBalance = finalBalance;
    
    const updated = await this.balanceRepository.save(balance);
    
    if (finalBalance !== newBalance) {
      // Floor was applied
      await this.auditService.logBalanceFloorApplied(
        employeeId,
        locationId,
        leaveType,
        beforeBalance,
        finalBalance,
        delta,
        minBalance,
        actor,
      );
    } else {
      await this.auditService.logBalanceUpdate(
        employeeId,
        locationId,
        leaveType,
        beforeBalance,
        finalBalance,
        AuditSource.HCM_WEBHOOK,
        actor,
      );
    }

    return updated;
  }

  getAvailableBalance(balance: Balance): number {
    return balance.availableBalance - balance.reservedDays;
  }
}
