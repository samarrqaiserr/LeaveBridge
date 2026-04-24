import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { Balance, LeaveType } from '../../src/entities/balance.entity';
import { BalanceService } from '../../src/balance/balance.service';
import { AuditService } from '../../src/audit/audit.service';
import { SyncService, BalancePayload, WebhookPayload } from '../../src/sync/sync.service';
import { HcmService } from '../../src/time-off/hcm.service';
import { AuditEventType, AuditSource } from '../../src/entities/audit-log.entity';

describe('SyncService', () => {
  let service: SyncService;
  let balanceRepository: jest.Mocked<Repository<Balance>>;
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

  beforeEach(async () => {
    const mockBalanceRepository = {
      findOne: jest.fn(),
      save: jest.fn(),
      create: jest.fn(),
    };

    const mockBalanceService = {
      applyWebhookDelta: jest.fn(),
    };

    const mockAuditService = {
      logBalanceUpdate: jest.fn(),
      logBatchSyncWarning: jest.fn(),
      getAuditTrail: jest.fn(),
    };

    const mockHcmService = {
      getBalanceFromHCM: jest.fn(),
    };

    const mockDataSource = {
      transaction: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SyncService,
        {
          provide: getRepositoryToken(Balance),
          useValue: mockBalanceRepository,
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

    service = module.get<SyncService>(SyncService);
    balanceRepository = module.get(getRepositoryToken(Balance));
    balanceService = module.get(BalanceService);
    auditService = module.get(AuditService);
    hcmService = module.get(HcmService);
    dataSource = module.get(DataSource);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('generateIdempotencyKey', () => {
    it('should generate consistent hash for same payload', () => {
      const payload = {
        employeeId: 'emp1',
        locationId: 'loc1',
        leaveType: LeaveType.ANNUAL,
        balance: 20,
      };

      const key1 = service.generateIdempotencyKey(payload);
      const key2 = service.generateIdempotencyKey(payload);

      expect(key1).toBe(key2);
      expect(key1).toMatch(/^[a-f0-9]{64}$/); // SHA256 hash
    });

    it('should generate different hash for different payloads', () => {
      const payload1 = { employeeId: 'emp1', balance: 20 };
      const payload2 = { employeeId: 'emp2', balance: 20 };

      const key1 = service.generateIdempotencyKey(payload1);
      const key2 = service.generateIdempotencyKey(payload2);

      expect(key1).not.toBe(key2);
    });

    it('should generate same hash regardless of key order', () => {
      const payload1 = { balance: 20, employeeId: 'emp1' };
      const payload2 = { employeeId: 'emp1', balance: 20 };

      const key1 = service.generateIdempotencyKey(payload1);
      const key2 = service.generateIdempotencyKey(payload2);

      expect(key1).toBe(key2);
    });
  });

  describe('processBatchSync', () => {
    it('should process batch sync successfully', async () => {
      const payloads: BalancePayload[] = [
        {
          employeeId: 'emp1',
          locationId: 'loc1',
          leaveType: LeaveType.ANNUAL,
          balance: 25,
        },
      ];

      const mockTransaction = jest.fn((callback) => {
        return callback({
          findOne: jest.fn().mockResolvedValue(mockBalance),
          save: jest.fn().mockResolvedValue({ ...mockBalance, availableBalance: 25 }),
        });
      });
      dataSource.transaction.mockImplementation(mockTransaction);

      await service.processBatchSync(payloads);

      expect(dataSource.transaction).toHaveBeenCalled();
      expect(auditService.logBalanceUpdate).toHaveBeenCalledWith(
        'emp1',
        'loc1',
        LeaveType.ANNUAL,
        20,
        25,
        'HCM_BATCH',
        'batch_sync',
      );
    });

    it('should create new balance when not found', async () => {
      const payloads: BalancePayload[] = [
        {
          employeeId: 'emp2',
          locationId: 'loc1',
          leaveType: LeaveType.SICK,
          balance: 15,
        },
      ];

      const mockTransaction = jest.fn((callback) => {
        return callback({
          findOne: jest.fn().mockResolvedValue(null),
          create: jest.fn().mockReturnValue({
            employeeId: 'emp2',
            locationId: 'loc1',
            leaveType: LeaveType.SICK,
            availableBalance: 15,
            reservedDays: 0,
          }),
          save: jest.fn().mockResolvedValue({
            employeeId: 'emp2',
            locationId: 'loc1',
            leaveType: LeaveType.SICK,
            availableBalance: 15,
            reservedDays: 0,
          }),
        });
      });
      dataSource.transaction.mockImplementation(mockTransaction);

      await service.processBatchSync(payloads);

      expect(auditService.logBalanceUpdate).toHaveBeenCalledWith(
        'emp2',
        'loc1',
        LeaveType.SICK,
        0,
        15,
        'HCM_BATCH',
        'batch_sync',
      );
    });

    it('should log warning when incoming balance is lower than current minus reserved', async () => {
      const lowBalance = { ...mockBalance, availableBalance: 10, reservedDays: 8 };
      const payloads: BalancePayload[] = [
        {
          employeeId: 'emp1',
          locationId: 'loc1',
          leaveType: LeaveType.ANNUAL,
          balance: 5, // Lower than current (10) - reserved (8) = 2
        },
      ];

      const mockTransaction = jest.fn((callback) => {
        return callback({
          findOne: jest.fn().mockResolvedValue(lowBalance),
          save: jest.fn().mockResolvedValue({ ...lowBalance, availableBalance: 5 }),
        });
      });
      dataSource.transaction.mockImplementation(mockTransaction);

      await service.processBatchSync(payloads);

      expect(auditService.logBatchSyncWarning).toHaveBeenCalledWith(
        'emp1',
        'loc1',
        LeaveType.ANNUAL,
        5,
        10,
        8,
      );
    });
  });

  describe('processWebhook', () => {
    it('should process webhook delta successfully', async () => {
      const webhook: WebhookPayload = {
        employeeId: 'emp1',
        locationId: 'loc1',
        leaveType: LeaveType.ANNUAL,
        delta: 5,
        reason: 'anniversary bonus',
      };

      balanceService.applyWebhookDelta.mockResolvedValue(mockBalance);

      await service.processWebhook(webhook);

      expect(balanceService.applyWebhookDelta).toHaveBeenCalledWith(
        'emp1',
        'loc1',
        LeaveType.ANNUAL,
        5,
        'anniversary bonus',
      );
    });

    it('should process webhook delta with negative delta', async () => {
      const webhook: WebhookPayload = {
        employeeId: 'emp1',
        locationId: 'loc1',
        leaveType: LeaveType.ANNUAL,
        delta: -3,
      };

      balanceService.applyWebhookDelta.mockResolvedValue(mockBalance);

      await service.processWebhook(webhook);

      expect(balanceService.applyWebhookDelta).toHaveBeenCalledWith(
        'emp1',
        'loc1',
        LeaveType.ANNUAL,
        -3,
        'webhook',
      );
    });
  });

  describe('isBatchProcessed', () => {
    it('should return false when no matching audit log found', async () => {
      const idempotencyKey = 'test-key';
      auditService.getAuditTrail.mockResolvedValue([]);

      const result = await service.isBatchProcessed(idempotencyKey);

      expect(result).toBe(false);
      expect(auditService.getAuditTrail).toHaveBeenCalledWith('batch_sync');
    });

    it('should return true when matching audit log found', async () => {
      const idempotencyKey = 'test-key';
      const mockAuditLog = {
        id: 'audit-id',
        employeeId: 'batch_sync',
        locationId: 'system',
        leaveType: 'SYSTEM',
        eventType: AuditEventType.BALANCE_UPDATED,
        source: AuditSource.HCM_BATCH,
        beforeValue: 0,
        afterValue: 0,
        actor: 'idempotency_marker',
        metadata: JSON.stringify({ idempotencyKey: 'test-key' }),
        requestId: 'batch_sync',
        timestamp: new Date(),
      };
      auditService.getAuditTrail.mockResolvedValue([mockAuditLog]);

      const result = await service.isBatchProcessed(idempotencyKey);

      expect(result).toBe(true);
    });
  });

  describe('markBatchProcessed', () => {
    it('should mark batch as processed', async () => {
      const idempotencyKey = 'test-key';
      const payloads: BalancePayload[] = [
        {
          employeeId: 'emp1',
          locationId: 'loc1',
          leaveType: LeaveType.ANNUAL,
          balance: 20,
        },
      ];

      auditService.logBalanceUpdate.mockResolvedValue({} as any);

      await service.markBatchProcessed(idempotencyKey, payloads);

      expect(auditService.logBalanceUpdate).toHaveBeenCalledWith(
        'emp1',
        'loc1',
        LeaveType.ANNUAL,
        0,
        0,
        'HCM_BATCH',
        'idempotency_marker',
      );
    });

    it('should not log when payloads array is empty', async () => {
      const idempotencyKey = 'test-key';
      const payloads: BalancePayload[] = [];

      auditService.logBalanceUpdate.mockResolvedValue({} as any);

      await service.markBatchProcessed(idempotencyKey, payloads);

      expect(auditService.logBalanceUpdate).not.toHaveBeenCalled();
    });
  });

  describe('syncWithHCM', () => {
    it('should sync all leave types with HCM', async () => {
      const employeeId = 'emp1';
      const locationId = 'loc1';

      hcmService.getBalanceFromHCM
        .mockResolvedValueOnce(25)
        .mockResolvedValueOnce(15)
        .mockResolvedValueOnce(10);

      balanceService.createOrUpdate
        .mockResolvedValueOnce(mockBalance)
        .mockResolvedValueOnce(mockBalance)
        .mockResolvedValueOnce(mockBalance);

      await service.syncWithHCM(employeeId, locationId);

      expect(hcmService.getBalanceFromHCM).toHaveBeenCalledTimes(3);
      expect(hcmService.getBalanceFromHCM).toHaveBeenCalledWith(employeeId, locationId, 'ANNUAL');
      expect(hcmService.getBalanceFromHCM).toHaveBeenCalledWith(employeeId, locationId, 'SICK');
      expect(hcmService.getBalanceFromHCM).toHaveBeenCalledWith(employeeId, locationId, 'UNPAID');

      expect(balanceService.createOrUpdate).toHaveBeenCalledTimes(3);
      expect(balanceService.createOrUpdate).toHaveBeenCalledWith(
        employeeId,
        locationId,
        LeaveType.ANNUAL,
        25,
        'HCM_REALTIME',
        'hcm_sync',
      );
    });

    it('should handle HCM service errors gracefully', async () => {
      const employeeId = 'emp1';
      const locationId = 'loc1';

      hcmService.getBalanceFromHCM
        .mockResolvedValueOnce(25)
        .mockRejectedValueOnce(new Error('HCM service unavailable'))
        .mockResolvedValueOnce(10);

      balanceService.createOrUpdate
        .mockResolvedValueOnce(mockBalance)
        .mockResolvedValueOnce(mockBalance);

      const consoleSpy = jest.spyOn(console, 'error').mockImplementation();

      await service.syncWithHCM(employeeId, locationId);

      expect(consoleSpy).toHaveBeenCalledWith(
        'Failed to sync balance for emp1/loc1/SICK:',
        'HCM service unavailable',
      );

      consoleSpy.mockRestore();
    });
  });
});
