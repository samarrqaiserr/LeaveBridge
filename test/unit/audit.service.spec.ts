import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AuditService } from '../../src/audit/audit.service';
import { AuditLog, AuditSource, AuditEventType } from '../../src/entities/audit-log.entity';

describe('AuditService', () => {
  let service: AuditService;
  let auditLogRepository: jest.Mocked<Repository<AuditLog>>;

  const mockAuditLog: AuditLog = {
    id: 'audit-id',
    employeeId: 'emp1',
    locationId: 'loc1',
    leaveType: 'ANNUAL',
    eventType: AuditEventType.BALANCE_UPDATED,
    source: AuditSource.HCM_BATCH,
    beforeValue: 20,
    afterValue: 25,
    actor: 'batch_sync',
    metadata: '{"type": "balance_update"}',
    requestId: 'req1',
    timestamp: new Date(),
  };

  beforeEach(async () => {
    const mockAuditLogRepository = {
      create: jest.fn(),
      save: jest.fn(),
      find: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuditService,
        {
          provide: getRepositoryToken(AuditLog),
          useValue: mockAuditLogRepository,
        },
      ],
    }).compile();

    service = module.get<AuditService>(AuditService);
    auditLogRepository = module.get(getRepositoryToken(AuditLog));
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('logBalanceUpdate', () => {
    it('should create and save balance update audit log', async () => {
      auditLogRepository.create.mockReturnValue(mockAuditLog);
      auditLogRepository.save.mockResolvedValue(mockAuditLog);

      const result = await service.logBalanceUpdate(
        'emp1',
        'loc1',
        'ANNUAL',
        20,
        25,
        AuditSource.HCM_BATCH,
        'batch_sync',
      );

      expect(auditLogRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          employeeId: 'emp1',
          locationId: 'loc1',
          leaveType: 'ANNUAL',
          eventType: AuditEventType.BALANCE_UPDATED,
          source: AuditSource.HCM_BATCH,
          beforeValue: 20,
          afterValue: 25,
          actor: 'batch_sync',
          metadata: JSON.stringify({ type: 'balance_update' }),
        }),
      );
      expect(auditLogRepository.save).toHaveBeenCalledWith(mockAuditLog);
      expect(result).toEqual(mockAuditLog);
    });
  });

  describe('logBalanceFloorApplied', () => {
    it('should create and save balance floor applied audit log', async () => {
      const floorAuditLog = {
        ...mockAuditLog,
        eventType: AuditEventType.BALANCE_FLOOR_APPLIED,
        metadata: JSON.stringify({
          type: 'balance_floor_applied',
          delta: -20,
          floorValue: 5,
          originalAfterValue: 0,
        }),
      };
      auditLogRepository.create.mockReturnValue(floorAuditLog);
      auditLogRepository.save.mockResolvedValue(floorAuditLog);

      const result = await service.logBalanceFloorApplied(
        'emp1',
        'loc1',
        'ANNUAL',
        20,
        5,
        -20,
        5,
        'webhook',
      );

      expect(auditLogRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          employeeId: 'emp1',
          locationId: 'loc1',
          leaveType: 'ANNUAL',
          eventType: AuditEventType.BALANCE_FLOOR_APPLIED,
          source: AuditSource.HCM_WEBHOOK,
          beforeValue: 20,
          afterValue: 5,
          actor: 'webhook',
          metadata: JSON.stringify({
            type: 'balance_floor_applied',
            delta: -20,
            floorValue: 5,
            originalAfterValue: 0,
          }),
        }),
      );
      expect(auditLogRepository.save).toHaveBeenCalledWith(floorAuditLog);
      expect(result).toEqual(floorAuditLog);
    });
  });

  describe('logReservationCreated', () => {
    it('should create and save reservation created audit log', async () => {
      const reservationAuditLog = {
        ...mockAuditLog,
        eventType: AuditEventType.RESERVATION_CREATED,
        actor: 'request:req1',
        requestId: 'req1',
        metadata: JSON.stringify({ type: 'reservation_created' }),
      };
      auditLogRepository.create.mockReturnValue(reservationAuditLog);
      auditLogRepository.save.mockResolvedValue(reservationAuditLog);

      const result = await service.logReservationCreated(
        'emp1',
        'loc1',
        'ANNUAL',
        5,
        8,
        'req1',
      );

      expect(auditLogRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          employeeId: 'emp1',
          locationId: 'loc1',
          leaveType: 'ANNUAL',
          eventType: AuditEventType.RESERVATION_CREATED,
          source: AuditSource.READYON_REQUEST,
          beforeValue: 5,
          afterValue: 8,
          actor: 'request:req1',
          requestId: 'req1',
          metadata: JSON.stringify({ type: 'reservation_created' }),
        }),
      );
      expect(auditLogRepository.save).toHaveBeenCalledWith(reservationAuditLog);
      expect(result).toEqual(reservationAuditLog);
    });
  });

  describe('logReservationReleased', () => {
    it('should create and save reservation released audit log', async () => {
      const reservationAuditLog = {
        ...mockAuditLog,
        eventType: AuditEventType.RESERVATION_RELEASED,
        actor: 'request:req1',
        requestId: 'req1',
        metadata: JSON.stringify({ type: 'reservation_released' }),
      };
      auditLogRepository.create.mockReturnValue(reservationAuditLog);
      auditLogRepository.save.mockResolvedValue(reservationAuditLog);

      const result = await service.logReservationReleased(
        'emp1',
        'loc1',
        'ANNUAL',
        8,
        5,
        'req1',
      );

      expect(auditLogRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          employeeId: 'emp1',
          locationId: 'loc1',
          leaveType: 'ANNUAL',
          eventType: AuditEventType.RESERVATION_RELEASED,
          source: AuditSource.READYON_REQUEST,
          beforeValue: 8,
          afterValue: 5,
          actor: 'request:req1',
          requestId: 'req1',
          metadata: JSON.stringify({ type: 'reservation_released' }),
        }),
      );
      expect(auditLogRepository.save).toHaveBeenCalledWith(reservationAuditLog);
      expect(result).toEqual(reservationAuditLog);
    });
  });

  describe('logRequestCreated', () => {
    it('should create and save request created audit log', async () => {
      const requestAuditLog = {
        ...mockAuditLog,
        eventType: AuditEventType.REQUEST_CREATED,
        beforeValue: null,
        afterValue: 5,
        actor: 'manager1',
        requestId: 'req1',
        metadata: JSON.stringify({ type: 'request_created', requestedDays: 5 }),
      };
      auditLogRepository.create.mockReturnValue(requestAuditLog);
      auditLogRepository.save.mockResolvedValue(requestAuditLog);

      const result = await service.logRequestCreated(
        'emp1',
        'loc1',
        'ANNUAL',
        5,
        'req1',
        'manager1',
      );

      expect(auditLogRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          employeeId: 'emp1',
          locationId: 'loc1',
          leaveType: 'ANNUAL',
          eventType: AuditEventType.REQUEST_CREATED,
          source: AuditSource.READYON_REQUEST,
          beforeValue: null,
          afterValue: 5,
          actor: 'manager1',
          requestId: 'req1',
          metadata: JSON.stringify({ type: 'request_created', requestedDays: 5 }),
        }),
      );
      expect(auditLogRepository.save).toHaveBeenCalledWith(requestAuditLog);
      expect(result).toEqual(requestAuditLog);
    });

    it('should use system as actor when manager not provided', async () => {
      const requestAuditLog = {
        ...mockAuditLog,
        eventType: AuditEventType.REQUEST_CREATED,
        actor: 'system',
      };
      auditLogRepository.create.mockReturnValue(requestAuditLog);
      auditLogRepository.save.mockResolvedValue(requestAuditLog);

      await service.logRequestCreated('emp1', 'loc1', 'ANNUAL', 5, 'req1');

      expect(auditLogRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          actor: 'system',
        }),
      );
    });
  });

  describe('logRequestApproved', () => {
    it('should create and save request approved audit log', async () => {
      const requestAuditLog = {
        ...mockAuditLog,
        eventType: AuditEventType.REQUEST_APPROVED,
        beforeValue: null,
        afterValue: 5,
        actor: 'manager1',
        requestId: 'req1',
        metadata: JSON.stringify({ type: 'request_approved', requestedDays: 5 }),
      };
      auditLogRepository.create.mockReturnValue(requestAuditLog);
      auditLogRepository.save.mockResolvedValue(requestAuditLog);

      const result = await service.logRequestApproved(
        'emp1',
        'loc1',
        'ANNUAL',
        5,
        'req1',
        'manager1',
      );

      expect(auditLogRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          employeeId: 'emp1',
          locationId: 'loc1',
          leaveType: 'ANNUAL',
          eventType: AuditEventType.REQUEST_APPROVED,
          source: AuditSource.READYON_REQUEST,
          beforeValue: null,
          afterValue: 5,
          actor: 'manager1',
          requestId: 'req1',
          metadata: JSON.stringify({ type: 'request_approved', requestedDays: 5 }),
        }),
      );
      expect(auditLogRepository.save).toHaveBeenCalledWith(requestAuditLog);
      expect(result).toEqual(requestAuditLog);
    });
  });

  describe('logRequestRejected', () => {
    it('should create and save request rejected audit log', async () => {
      const requestAuditLog = {
        ...mockAuditLog,
        eventType: AuditEventType.REQUEST_REJECTED,
        beforeValue: null,
        afterValue: 5,
        actor: 'manager1',
        requestId: 'req1',
        metadata: JSON.stringify({
          type: 'request_rejected',
          requestedDays: 5,
          rejectionReason: 'Insufficient balance',
        }),
      };
      auditLogRepository.create.mockReturnValue(requestAuditLog);
      auditLogRepository.save.mockResolvedValue(requestAuditLog);

      const result = await service.logRequestRejected(
        'emp1',
        'loc1',
        'ANNUAL',
        5,
        'req1',
        'manager1',
        'Insufficient balance',
      );

      expect(auditLogRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          employeeId: 'emp1',
          locationId: 'loc1',
          leaveType: 'ANNUAL',
          eventType: AuditEventType.REQUEST_REJECTED,
          source: AuditSource.READYON_REQUEST,
          beforeValue: null,
          afterValue: 5,
          actor: 'manager1',
          requestId: 'req1',
          metadata: JSON.stringify({
            type: 'request_rejected',
            requestedDays: 5,
            rejectionReason: 'Insufficient balance',
          }),
        }),
      );
      expect(auditLogRepository.save).toHaveBeenCalledWith(requestAuditLog);
      expect(result).toEqual(requestAuditLog);
    });
  });

  describe('logRequestCancelled', () => {
    it('should create and save request cancelled audit log', async () => {
      const requestAuditLog = {
        ...mockAuditLog,
        eventType: AuditEventType.REQUEST_CANCELLED,
        beforeValue: null,
        afterValue: 5,
        actor: 'employee1',
        requestId: 'req1',
        metadata: JSON.stringify({ type: 'request_cancelled', requestedDays: 5 }),
      };
      auditLogRepository.create.mockReturnValue(requestAuditLog);
      auditLogRepository.save.mockResolvedValue(requestAuditLog);

      const result = await service.logRequestCancelled(
        'emp1',
        'loc1',
        'ANNUAL',
        5,
        'req1',
        'employee1',
      );

      expect(auditLogRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          employeeId: 'emp1',
          locationId: 'loc1',
          leaveType: 'ANNUAL',
          eventType: AuditEventType.REQUEST_CANCELLED,
          source: AuditSource.READYON_REQUEST,
          beforeValue: null,
          afterValue: 5,
          actor: 'employee1',
          requestId: 'req1',
          metadata: JSON.stringify({ type: 'request_cancelled', requestedDays: 5 }),
        }),
      );
      expect(auditLogRepository.save).toHaveBeenCalledWith(requestAuditLog);
      expect(result).toEqual(requestAuditLog);
    });
  });

  describe('logBatchSyncWarning', () => {
    it('should create and save batch sync warning audit log', async () => {
      const warningAuditLog = {
        ...mockAuditLog,
        eventType: AuditEventType.BATCH_SYNC_WARNING,
        source: AuditSource.HCM_BATCH,
        actor: 'batch_sync',
        metadata: JSON.stringify({
          type: 'batch_sync_warning',
          incomingBalance: 15,
          currentBalance: 20,
          reservedDays: 5,
          discrepancy: 5,
        }),
      };
      auditLogRepository.create.mockReturnValue(warningAuditLog);
      auditLogRepository.save.mockResolvedValue(warningAuditLog);

      const result = await service.logBatchSyncWarning(
        'emp1',
        'loc1',
        'ANNUAL',
        15,
        20,
        5,
      );

      expect(auditLogRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          employeeId: 'emp1',
          locationId: 'loc1',
          leaveType: 'ANNUAL',
          eventType: AuditEventType.BATCH_SYNC_WARNING,
          source: AuditSource.HCM_BATCH,
          beforeValue: 20,
          afterValue: 15,
          actor: 'batch_sync',
          metadata: JSON.stringify({
            type: 'batch_sync_warning',
            incomingBalance: 15,
            currentBalance: 20,
            reservedDays: 5,
            discrepancy: 5,
          }),
        }),
      );
      expect(auditLogRepository.save).toHaveBeenCalledWith(warningAuditLog);
      expect(result).toEqual(warningAuditLog);
    });
  });

  describe('getAuditTrail', () => {
    it('should return audit logs for employee ordered by timestamp', async () => {
      const auditLogs = [mockAuditLog];
      auditLogRepository.find.mockResolvedValue(auditLogs);

      const result = await service.getAuditTrail('emp1');

      expect(auditLogRepository.find).toHaveBeenCalledWith({
        where: { employeeId: 'emp1' },
        order: { timestamp: 'DESC' },
      });
      expect(result).toEqual(auditLogs);
    });
  });
});
