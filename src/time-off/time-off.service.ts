import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';
import { TimeOffRequest, TimeOffRequestStatus } from '../entities/time-off-request.entity';
import { OutboxEvent, OutboxStatus } from '../entities/outbox-event.entity';
import { Balance, LeaveType } from '../entities/balance.entity';
import { BalanceService } from '../balance/balance.service';
import { AuditService } from '../audit/audit.service';
import { AuditSource } from '../entities/audit-log.entity';
import { HcmService } from './hcm.service';

@Injectable()
export class TimeOffService {
  constructor(
    @InjectRepository(TimeOffRequest)
    private readonly timeOffRequestRepository: Repository<TimeOffRequest>,
    @InjectRepository(OutboxEvent)
    private readonly outboxEventRepository: Repository<OutboxEvent>,
    private readonly balanceService: BalanceService,
    private readonly auditService: AuditService,
    private readonly hcmService: HcmService,
    private readonly dataSource: DataSource,
  ) {}

  async createTimeOffRequest(
    employeeId: string,
    locationId: string,
    leaveType: LeaveType,
    startDate: Date,
    endDate: Date,
    reason?: string,
  ): Promise<TimeOffRequest> {
    const requestedDays = this.calculateRequestedDays(startDate, endDate);
    
    if (requestedDays <= 0) {
      throw new BadRequestException('Invalid date range: requested days must be positive');
    }

    return await this.dataSource.transaction(async (manager) => {
      // Check balance availability
      const balance = await manager.findOne(Balance, {
        where: { employeeId, locationId, leaveType },
      });

      if (!balance) {
        throw new NotFoundException(
          `Balance not found for employee ${employeeId}, location ${locationId}, leave type ${leaveType}`,
        );
      }

      const availableBalance = balance.availableBalance - balance.reservedDays;
      if (availableBalance < requestedDays) {
        throw new BadRequestException(
          `Insufficient balance. Available: ${availableBalance}, Requested: ${requestedDays}`,
        );
      }

      // Create the request
      const request = manager.create(TimeOffRequest, {
        id: uuidv4(),
        employeeId,
        locationId,
        leaveType,
        startDate,
        endDate,
        requestedDays,
        status: TimeOffRequestStatus.PENDING,
        reason,
      });

      const savedRequest = await manager.save(request);

      // Reserve the days
      balance.reservedDays += requestedDays;
      await manager.save(balance);

      // Log the reservation
      await this.auditService.logReservationCreated(
        employeeId,
        locationId,
        leaveType,
        balance.reservedDays - requestedDays,
        balance.reservedDays,
        savedRequest.id,
      );

      // Log the request creation
      await this.auditService.logRequestCreated(
        employeeId,
        locationId,
        leaveType,
        requestedDays,
        savedRequest.id,
      );

      return savedRequest;
    });
  }

  async getRequestById(id: string): Promise<TimeOffRequest> {
    const request = await this.timeOffRequestRepository.findOne({
      where: { id },
    });

    if (!request) {
      throw new NotFoundException(`Time off request with ID ${id} not found`);
    }

    return request;
  }

  async approveRequest(
    requestId: string,
    managerId: string,
  ): Promise<TimeOffRequest> {
    const request = await this.getRequestById(requestId);

    if (request.status !== TimeOffRequestStatus.PENDING) {
      throw new BadRequestException(
        `Cannot approve request in status: ${request.status}`,
      );
    }

    try {
      // Call HCM real-time API
      await this.hcmService.submitTimeOffToHCM(request);

      // If HCM accepts, proceed with approval
      return await this.dataSource.transaction(async (manager) => {
        // Update request status
        request.status = TimeOffRequestStatus.APPROVED;
        request.managerId = managerId;
        const updatedRequest = await manager.save(request);

        // Decrement balance and release reservation
        const balance = await manager.findOne(Balance, {
          where: {
            employeeId: request.employeeId,
            locationId: request.locationId,
            leaveType: request.leaveType as LeaveType,
          },
        });

        if (!balance) {
          throw new NotFoundException(
            `Balance not found for employee ${request.employeeId}, location ${request.locationId}, leave type ${request.leaveType}`,
          );
        }

        // Defensive validation
        const availableAfterApproval = balance.availableBalance - balance.reservedDays - request.requestedDays;
        if (availableAfterApproval < 0) {
          throw new BadRequestException(
            `Balance validation failed. Available: ${balance.availableBalance - balance.reservedDays}, Requested: ${request.requestedDays}`,
          );
        }

        // Update balance
        balance.availableBalance = Math.max(0, balance.availableBalance - request.requestedDays);
        balance.reservedDays = Math.max(0, balance.reservedDays - request.requestedDays);
        await manager.save(balance);

        // Create outbox event
        const outboxEvent = manager.create(OutboxEvent, {
          id: uuidv4(),
          eventType: 'TIME_OFF_APPROVED',
          payload: JSON.stringify({
            requestId: request.id,
            employeeId: request.employeeId,
            locationId: request.locationId,
            leaveType: request.leaveType,
            requestedDays: request.requestedDays,
            startDate: request.startDate,
            endDate: request.endDate,
          }),
          status: OutboxStatus.COMPLETED,
          requestId: request.id,
        });
        await manager.save(outboxEvent);

        // Log the approval
        await this.auditService.logRequestApproved(
          request.employeeId,
          request.locationId,
          request.leaveType,
          request.requestedDays,
          request.id,
          managerId,
        );

        return updatedRequest;
      });
    } catch (error) {
      // If HCM rejects, mark request as rejected and release reservation
      if (error.message?.includes('HCM rejected') || error.message?.includes('INSUFFICIENT_BALANCE')) {
        await this.dataSource.transaction(async (manager) => {
          request.status = TimeOffRequestStatus.REJECTED;
          request.rejectionReason = error.message;
          request.managerId = managerId;
          await manager.save(request);

          // Release reservation
          const balance = await manager.findOne(Balance, {
            where: {
              employeeId: request.employeeId,
              locationId: request.locationId,
              leaveType: request.leaveType as LeaveType,
            },
          });

          if (balance) {
            balance.reservedDays = Math.max(0, balance.reservedDays - request.requestedDays);
            await manager.save(balance);
          }

          // Log the rejection
          await this.auditService.logRequestRejected(
            request.employeeId,
            request.locationId,
            request.leaveType,
            request.requestedDays,
            request.id,
            managerId,
            error.message,
          );
        });

        throw new BadRequestException(`HCM rejected the request: ${error.message}`);
      } else if (error.message?.includes('unreachable') || error.code === 'ECONNREFUSED') {
        // HCM is unreachable
        await this.dataSource.transaction(async (manager) => {
          // Create outbox event for retry
          const outboxEvent = manager.create(OutboxEvent, {
            id: uuidv4(),
            eventType: 'TIME_OFF_APPROVED',
            payload: JSON.stringify({
              requestId: request.id,
              employeeId: request.employeeId,
              locationId: request.locationId,
              leaveType: request.leaveType,
              requestedDays: request.requestedDays,
              startDate: request.startDate,
              endDate: request.endDate,
              managerId,
            }),
            status: OutboxStatus.PENDING_RETRY,
            requestId: request.id,
            retryCount: 0,
            nextRetryAt: new Date(Date.now() + 5 * 60 * 1000), // 5 minutes from now
          });
          await manager.save(outboxEvent);
        });

        // Return request in PENDING status
        return request;
      } else {
        throw error;
      }
    }
  }

  async cancelRequest(requestId: string, actorId: string): Promise<TimeOffRequest> {
    const request = await this.getRequestById(requestId);

    if (request.status !== TimeOffRequestStatus.PENDING) {
      throw new BadRequestException(
        `Cannot cancel request in status: ${request.status}`,
      );
    }

    return await this.dataSource.transaction(async (manager) => {
      // Update request status
      request.status = TimeOffRequestStatus.CANCELLED;
      const updatedRequest = await manager.save(request);

      // Release reservation
      const balance = await manager.findOne(Balance, {
        where: {
          employeeId: request.employeeId,
          locationId: request.locationId,
          leaveType: request.leaveType as LeaveType,
        },
      });

      if (balance) {
        const beforeReserved = balance.reservedDays;
        balance.reservedDays = Math.max(0, balance.reservedDays - request.requestedDays);
        await manager.save(balance);

        // Log the reservation release
        await this.auditService.logReservationReleased(
          request.employeeId,
          request.locationId,
          request.leaveType,
          beforeReserved,
          balance.reservedDays,
          request.id,
        );
      }

      // Log the cancellation
      await this.auditService.logRequestCancelled(
        request.employeeId,
        request.locationId,
        request.leaveType,
        request.requestedDays,
        request.id,
        actorId,
      );

      return updatedRequest;
    });
  }

  private calculateRequestedDays(startDate: Date, endDate: Date): number {
    const start = new Date(startDate);
    const end = new Date(endDate);
    
    if (start > end) {
      return 0;
    }

    const diffTime = Math.abs(end.getTime() - start.getTime());
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1;
    
    return diffDays;
  }
}
