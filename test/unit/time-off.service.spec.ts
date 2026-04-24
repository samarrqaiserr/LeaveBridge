import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';
import { TimeOffService } from '../../src/time-off/time-off.service';
import { TimeOffRequest, TimeOffRequestStatus } from '../../src/entities/time-off-request.entity';
import { OutboxEvent, OutboxStatus } from '../../src/entities/outbox-event.entity';
import { Balance, LeaveType } from '../../src/entities/balance.entity';
import { BalanceService } from '../../src/balance/balance.service';
import { AuditService } from '../../src/audit/audit.service';
import { HcmService } from '../../src/time-off/hcm.service';

describe('TimeOffService', () => {
  let service: TimeOffService;
  let timeOffRequestRepository: jest.Mocked<Repository<TimeOffRequest>>;
  let outboxEventRepository: jest.Mocked<Repository<OutboxEvent>>;
  let balanceService: jest.Mocked<BalanceService>;
  let auditService: jest.Mocked<AuditService>;
  let hcmService: jest.Mocked<HcmService>;
  let dataSource: jest.Mocked<DataSource>;

  const mockBalance: Balance = {
    employeeId: 'emp1',
    locationId: 'loc1',
    leaveType: LeaveType.ANNUAL,
    availableBalance: 20,
    reservedDays: 5,
    version: 1,
  };

  const mockTimeOffRequest: TimeOffRequest = {
    id: uuidv4(),
    employeeId: 'emp1',
    locationId: 'loc1',
    leaveType: LeaveType.ANNUAL,
    startDate: new Date('2024-01-01'),
    endDate: new Date('2024-01-05'),
    requestedDays: 5,
    status: TimeOffRequestStatus.PENDING,
    managerId: null,
    reason: 'Vacation',
    rejectionReason: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeEach(async () => {
    const mockTimeOffRequestRepository = {
      findOne: jest.fn(),
      create: jest.fn(),
      save: jest.fn(),
    };

    const mockOutboxEventRepository = {
      create: jest.fn(),
      save: jest.fn(),
    };

    const mockBalanceService = {
      findByEmployeeLocationAndType: jest.fn(),
      reserveDays: jest.fn(),
      releaseReservation: jest.fn(),
      decrementBalance: jest.fn(),
      getAvailableBalance: jest.fn(),
    };

    const mockAuditService = {
      logReservationCreated: jest.fn(),
      logRequestCreated: jest.fn(),
      logRequestApproved: jest.fn(),
      logRequestRejected: jest.fn(),
      logRequestCancelled: jest.fn(),
    };

    const mockHcmService = {
      submitTimeOffToHCM: jest.fn(),
    };

    const mockDataSource = {
      transaction: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TimeOffService,
        {
          provide: getRepositoryToken(TimeOffRequest),
          useValue: mockTimeOffRequestRepository,
        },
        {
          provide: getRepositoryToken(OutboxEvent),
          useValue: mockOutboxEventRepository,
        },
        {
          provide: BalanceService,
          useValue: mockBalanceService,
        },
        {
          provide: AuditService,
          useValue: mockAuditService,
        },
        {
          provide: HcmService,
          useValue: mockHcmService,
        },
        {
          provide: DataSource,
          useValue: mockDataSource,
        },
      ],
    }).compile();

    service = module.get<TimeOffService>(TimeOffService);
    timeOffRequestRepository = module.get(getRepositoryToken(TimeOffRequest));
    outboxEventRepository = module.get(getRepositoryToken(OutboxEvent));
    balanceService = module.get(BalanceService);
    auditService = module.get(AuditService);
    hcmService = module.get(HcmService);
    dataSource = module.get(DataSource);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('createTimeOffRequest', () => {
    it('should create time off request successfully', async () => {
      const startDate = new Date('2024-01-01');
      const endDate = new Date('2024-01-05');

      const mockTransaction = jest.fn((callback) => {
        return callback({
          findOne: jest.fn().mockResolvedValue(mockBalance),
          create: jest.fn().mockReturnValue(mockTimeOffRequest),
          save: jest.fn().mockResolvedValue(mockTimeOffRequest),
        });
      });
      dataSource.transaction.mockImplementation(mockTransaction);

      const result = await service.createTimeOffRequest(
        'emp1',
        'loc1',
        LeaveType.ANNUAL,
        startDate,
        endDate,
        'Vacation',
      );

      expect(dataSource.transaction).toHaveBeenCalled();
      expect(result).toEqual(mockTimeOffRequest);
      expect(auditService.logReservationCreated).toHaveBeenCalled();
      expect(auditService.logRequestCreated).toHaveBeenCalled();
    });

    it('should throw error when insufficient balance', async () => {
      const startDate = new Date('2024-01-01');
      const endDate = new Date('2024-01-10'); // 10 days
      const lowBalance = { ...mockBalance, availableBalance: 5, reservedDays: 0 };

      const mockTransaction = jest.fn((callback) => {
        return callback({
          findOne: jest.fn().mockResolvedValue(lowBalance),
        });
      });
      dataSource.transaction.mockImplementation(mockTransaction);

      await expect(
        service.createTimeOffRequest('emp1', 'loc1', LeaveType.ANNUAL, startDate, endDate),
      ).rejects.toThrow('Insufficient balance. Available: 5, Requested: 10');
    });

    it('should throw error when balance not found', async () => {
      const startDate = new Date('2024-01-01');
      const endDate = new Date('2024-01-05');

      const mockTransaction = jest.fn((callback) => {
        return callback({
          findOne: jest.fn().mockResolvedValue(null),
        });
      });
      dataSource.transaction.mockImplementation(mockTransaction);

      await expect(
        service.createTimeOffRequest('emp1', 'loc1', LeaveType.ANNUAL, startDate, endDate),
      ).rejects.toThrow(
        'Balance not found for employee emp1, location loc1, leave type ANNUAL',
      );
    });

    it('should throw error for invalid date range', async () => {
      const startDate = new Date('2024-01-10');
      const endDate = new Date('2024-01-05'); // End before start

      await expect(
        service.createTimeOffRequest('emp1', 'loc1', LeaveType.ANNUAL, startDate, endDate),
      ).rejects.toThrow('Invalid date range: requested days must be positive');
    });
  });

  describe('getRequestById', () => {
    it('should return request when found', async () => {
      timeOffRequestRepository.findOne.mockResolvedValue(mockTimeOffRequest);

      const result = await service.getRequestById('req1');

      expect(timeOffRequestRepository.findOne).toHaveBeenCalledWith({ where: { id: 'req1' } });
      expect(result).toEqual(mockTimeOffRequest);
    });

    it('should throw error when request not found', async () => {
      timeOffRequestRepository.findOne.mockResolvedValue(null);

      await expect(service.getRequestById('req1')).rejects.toThrow(
        'Time off request with ID req1 not found',
      );
    });
  });

  describe('approveRequest', () => {
    it('should approve request successfully when HCM accepts', async () => {
      const approvedRequest = {
        ...mockTimeOffRequest,
        status: TimeOffRequestStatus.APPROVED,
        managerId: 'manager1',
      };

      timeOffRequestRepository.findOne.mockResolvedValue(mockTimeOffRequest);
      hcmService.submitTimeOffToHCM.mockResolvedValue();

      const mockTransaction = jest.fn((callback) => {
        return callback({
          findOne: jest.fn().mockResolvedValue(mockBalance),
          save: jest.fn()
            .mockResolvedValueOnce(approvedRequest)
            .mockResolvedValueOnce({ ...mockBalance, availableBalance: 17, reservedDays: 2 })
            .mockResolvedValueOnce({} as OutboxEvent),
        });
      });
      dataSource.transaction.mockImplementation(mockTransaction);

      const result = await service.approveRequest('req1', 'manager1');

      expect(hcmService.submitTimeOffToHCM).toHaveBeenCalledWith(mockTimeOffRequest);
      expect(result.status).toBe(TimeOffRequestStatus.APPROVED);
      expect(result.managerId).toBe('manager1');
    });

    it('should reject request when HCM rejects', async () => {
      const rejectedRequest = {
        ...mockTimeOffRequest,
        status: TimeOffRequestStatus.REJECTED,
        managerId: 'manager1',
        rejectionReason: 'HCM rejected the request: INSUFFICIENT_BALANCE',
      };

      timeOffRequestRepository.findOne.mockResolvedValue(mockTimeOffRequest);
      hcmService.submitTimeOffToHCM.mockRejectedValue(
        new Error('HCM rejected the request: INSUFFICIENT_BALANCE'),
      );

      const mockTransaction = jest.fn((callback) => {
        return callback({
          findOne: jest.fn().mockResolvedValue(mockBalance),
          save: jest.fn()
            .mockResolvedValueOnce(rejectedRequest)
            .mockResolvedValueOnce({ ...mockBalance, reservedDays: 0 }),
        });
      });
      dataSource.transaction.mockImplementation(mockTransaction);

      await expect(service.approveRequest('req1', 'manager1')).rejects.toThrow(
        'HCM rejected the request: INSUFFICIENT_BALANCE',
      );
    });

    it('should return PENDING status when HCM is unreachable', async () => {
      timeOffRequestRepository.findOne.mockResolvedValue(mockTimeOffRequest);
      hcmService.submitTimeOffToHCM.mockRejectedValue(new Error('HCM service is unreachable'));

      const mockTransaction = jest.fn((callback) => {
        return callback({
          save: jest.fn().mockResolvedValue({} as OutboxEvent),
        });
      });
      dataSource.transaction.mockImplementation(mockTransaction);

      const result = await service.approveRequest('req1', 'manager1');

      expect(result.status).toBe(TimeOffRequestStatus.PENDING);
    });

    it('should throw error when request not in PENDING status', async () => {
      const approvedRequest = {
        ...mockTimeOffRequest,
        status: TimeOffRequestStatus.APPROVED,
      };

      timeOffRequestRepository.findOne.mockResolvedValue(approvedRequest);

      await expect(service.approveRequest('req1', 'manager1')).rejects.toThrow(
        'Cannot approve request in status: APPROVED',
      );
    });
  });

  describe('cancelRequest', () => {
    it('should cancel request successfully', async () => {
      const cancelledRequest = {
        ...mockTimeOffRequest,
        status: TimeOffRequestStatus.CANCELLED,
      };

      timeOffRequestRepository.findOne.mockResolvedValue(mockTimeOffRequest);

      const mockTransaction = jest.fn((callback) => {
        return callback({
          findOne: jest.fn().mockResolvedValue(mockBalance),
          save: jest.fn()
            .mockResolvedValueOnce(cancelledRequest)
            .mockResolvedValueOnce({ ...mockBalance, reservedDays: 0 }),
        });
      });
      dataSource.transaction.mockImplementation(mockTransaction);

      const result = await service.cancelRequest('req1', 'emp1');

      expect(result.status).toBe(TimeOffRequestStatus.CANCELLED);
      expect(auditService.logReservationReleased).toHaveBeenCalled();
      expect(auditService.logRequestCancelled).toHaveBeenCalled();
    });

    it('should throw error when request not in PENDING status', async () => {
      const approvedRequest = {
        ...mockTimeOffRequest,
        status: TimeOffRequestStatus.APPROVED,
      };

      timeOffRequestRepository.findOne.mockResolvedValue(approvedRequest);

      await expect(service.cancelRequest('req1', 'emp1')).rejects.toThrow(
        'Cannot cancel request in status: APPROVED',
      );
    });
  });

  describe('calculateRequestedDays', () => {
    it('should calculate days correctly for same day', () => {
      const startDate = new Date('2024-01-01');
      const endDate = new Date('2024-01-01');

      // Access private method through prototype for testing
      const result = (service as any).calculateRequestedDays(startDate, endDate);

      expect(result).toBe(1);
    });

    it('should calculate days correctly for multi-day range', () => {
      const startDate = new Date('2024-01-01');
      const endDate = new Date('2024-01-05');

      const result = (service as any).calculateRequestedDays(startDate, endDate);

      expect(result).toBe(5);
    });

    it('should return 0 for invalid date range', () => {
      const startDate = new Date('2024-01-10');
      const endDate = new Date('2024-01-05');

      const result = (service as any).calculateRequestedDays(startDate, endDate);

      expect(result).toBe(0);
    });
  });
});
