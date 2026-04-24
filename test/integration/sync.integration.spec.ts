import { Test, TestingModule } from '@nestjs/testing';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { Balance, LeaveType } from '../../src/entities/balance.entity';
import { AuditLog } from '../../src/entities/audit-log.entity';
import { BalanceService } from '../../src/balance/balance.service';
import { SyncService } from '../../src/sync/sync.service';
import { AuditService } from '../../src/audit/audit.service';
import { ConfigService } from '@nestjs/config';

describe('Sync Integration Tests', () => {
  let module: TestingModule;
  let dataSource: DataSource;
  let balanceService: BalanceService;
  let syncService: SyncService;
  let auditService: AuditService;

  beforeAll(async () => {
    module = await Test.createTestingModule({
      imports: [
        TypeOrmModule.forRoot({
          type: 'sqlite',
          database: ':memory:',
          entities: [Balance, AuditLog],
          synchronize: true,
          logging: false,
        }),
        TypeOrmModule.forFeature([Balance, AuditLog]),
      ],
      providers: [BalanceService, SyncService, AuditService],
    })
      .overrideProvider(ConfigService)
      .useValue({
        get: jest.fn((key: string) => {
          const config = {
            HCM_BASE_URL: 'http://localhost:3001',
            HCM_REJECT_RATIO: '0.1',
          };
          return config[key];
        }),
      })
      .compile();

    dataSource = module.get<DataSource>(DataSource);
    balanceService = module.get<BalanceService>(BalanceService);
    syncService = module.get<SyncService>(SyncService);
    auditService = module.get<AuditService>(AuditService);
  });

  afterAll(async () => {
    await dataSource.destroy();
    await module.close();
  });

  beforeEach(async () => {
    // Clean up database before each test
    await dataSource.query('DELETE FROM audit_logs');
    await dataSource.query('DELETE FROM balances');
  });

  describe('Batch sync operations', () => {
    it('should create new balances in batch', async () => {
      const batchPayloads = [
        {
          employeeId: 'emp1',
          locationId: 'loc1',
          leaveType: LeaveType.ANNUAL,
          balance: 20,
        },
        {
          employeeId: 'emp1',
          locationId: 'loc1',
          leaveType: LeaveType.SICK,
          balance: 10,
        },
        {
          employeeId: 'emp2',
          locationId: 'loc1',
          leaveType: LeaveType.ANNUAL,
          balance: 15,
        },
      ];

      await syncService.processBatchSync(batchPayloads);

      // Verify all balances were created
      const emp1Annual = await balanceService.findByEmployeeLocationAndType(
        'emp1',
        'loc1',
        LeaveType.ANNUAL,
      );
      const emp1Sick = await balanceService.findByEmployeeLocationAndType(
        'emp1',
        'loc1',
        LeaveType.SICK,
      );
      const emp2Annual = await balanceService.findByEmployeeLocationAndType(
        'emp2',
        'loc1',
        LeaveType.ANNUAL,
      );

      expect(emp1Annual.availableBalance).toBe(20);
      expect(emp1Sick.availableBalance).toBe(10);
      expect(emp2Annual.availableBalance).toBe(15);

      // Verify audit logs
      const emp1AuditLogs = await auditService.getAuditTrail('emp1');
      expect(emp1AuditLogs.length).toBe(2); // ANNUAL and SICK

      const emp2AuditLogs = await auditService.getAuditTrail('emp2');
      expect(emp2AuditLogs.length).toBe(1); // ANNUAL
    });

    it('should update existing balances in batch', async () => {
      // Create initial balances
      await balanceService.createOrUpdate(
        'emp1',
        'loc1',
        LeaveType.ANNUAL,
        20,
        'HCM_BATCH' as any,
        'initial',
      );
      await balanceService.createOrUpdate(
        'emp1',
        'loc1',
        LeaveType.SICK,
        10,
        'HCM_BATCH' as any,
        'initial',
      );

      const batchPayloads = [
        {
          employeeId: 'emp1',
          locationId: 'loc1',
          leaveType: LeaveType.ANNUAL,
          balance: 25, // Increased
        },
        {
          employeeId: 'emp1',
          locationId: 'loc1',
          leaveType: LeaveType.SICK,
          balance: 8, // Decreased
        },
      ];

      await syncService.processBatchSync(batchPayloads);

      // Verify balances were updated
      const annual = await balanceService.findByEmployeeLocationAndType(
        'emp1',
        'loc1',
        LeaveType.ANNUAL,
      );
      const sick = await balanceService.findByEmployeeLocationAndType(
        'emp1',
        'loc1',
        LeaveType.SICK,
      );

      expect(annual.availableBalance).toBe(25);
      expect(sick.availableBalance).toBe(8);

      // Verify audit logs
      const auditLogs = await auditService.getAuditTrail('emp1');
      const balanceUpdates = auditLogs.filter(log => 
        log.eventType === 'BALANCE_UPDATED'
      );
      expect(balanceUpdates.length).toBe(2); // Both should have update logs
    });
  });

  describe('Webhook operations', () => {
    it('should apply positive webhook delta', async () => {
      // Create initial balance
      await balanceService.createOrUpdate(
        'emp1',
        'loc1',
        LeaveType.ANNUAL,
        20,
        'HCM_BATCH' as any,
        'initial',
      );

      await syncService.processWebhook({
        employeeId: 'emp1',
        locationId: 'loc1',
        leaveType: LeaveType.ANNUAL,
        delta: 5,
        reason: 'anniversary bonus',
      });

      // Verify balance was updated
      const balance = await balanceService.findByEmployeeLocationAndType(
        'emp1',
        'loc1',
        LeaveType.ANNUAL,
      );
      expect(balance.availableBalance).toBe(25);

      // Verify audit log
      const auditLogs = await auditService.getAuditTrail('emp1');
      const updateLog = auditLogs.find(log => 
        log.eventType === 'BALANCE_UPDATED' && log.source === 'HCM_WEBHOOK'
      );
      expect(updateLog).toBeDefined();
      expect(updateLog.beforeValue).toBe(20);
      expect(updateLog.afterValue).toBe(25);
    });

    it('should apply negative webhook delta', async () => {
      // Create initial balance
      await balanceService.createOrUpdate(
        'emp1',
        'loc1',
        LeaveType.ANNUAL,
        20,
        'HCM_BATCH' as any,
        'initial',
      );

      await syncService.processWebhook({
        employeeId: 'emp1',
        locationId: 'loc1',
        leaveType: LeaveType.ANNUAL,
        delta: -3,
        reason: 'correction',
      });

      // Verify balance was updated
      const balance = await balanceService.findByEmployeeLocationAndType(
        'emp1',
        'loc1',
        LeaveType.ANNUAL,
      );
      expect(balance.availableBalance).toBe(17);

      // Verify audit log
      const auditLogs = await auditService.getAuditTrail('emp1');
      const updateLog = auditLogs.find(log => 
        log.eventType === 'BALANCE_UPDATED' && log.source === 'HCM_WEBHOOK'
      );
      expect(updateLog).toBeDefined();
      expect(updateLog.beforeValue).toBe(20);
      expect(updateLog.afterValue).toBe(17);
    });

    it('should apply floor when delta would make balance negative', async () => {
      // Create initial balance with reservation
      await balanceService.createOrUpdate(
        'emp1',
        'loc1',
        LeaveType.ANNUAL,
        10,
        'HCM_BATCH' as any,
        'initial',
      );
      await balanceService.reserveDays('emp1', 'loc1', LeaveType.ANNUAL, 7, 'req1');

      await syncService.processWebhook({
        employeeId: 'emp1',
        locationId: 'loc1',
        leaveType: LeaveType.ANNUAL,
        delta: -15, // Would make balance -5
        reason: 'major correction',
      });

      // Verify balance was floored
      const balance = await balanceService.findByEmployeeLocationAndType(
        'emp1',
        'loc1',
        LeaveType.ANNUAL,
      );
      expect(balance.availableBalance).toBe(7); // Floored to reservedDays

      // Verify floor audit log
      const auditLogs = await auditService.getAuditTrail('emp1');
      const floorLog = auditLogs.find(log => 
        log.eventType === 'BALANCE_FLOOR_APPLIED'
      );
      expect(floorLog).toBeDefined();
      expect(floorLog.source).toBe('HCM_WEBHOOK');
      expect(floorLog.beforeValue).toBe(10);
      expect(floorLog.afterValue).toBe(7);
    });
  });

  describe('Idempotency', () => {
    it('should generate consistent idempotency keys', async () => {
      const payload = {
        employeeId: 'emp1',
        locationId: 'loc1',
        leaveType: LeaveType.ANNUAL,
        balance: 20,
      };

      const key1 = syncService.generateIdempotencyKey(payload);
      const key2 = syncService.generateIdempotencyKey(payload);

      expect(key1).toBe(key2);
      expect(key1).toMatch(/^[a-f0-9]{64}$/); // SHA256 hash
    });

    it('should generate different keys for different payloads', async () => {
      const payload1 = { employeeId: 'emp1', balance: 20 };
      const payload2 = { employeeId: 'emp2', balance: 20 };

      const key1 = syncService.generateIdempotencyKey(payload1);
      const key2 = syncService.generateIdempotencyKey(payload2);

      expect(key1).not.toBe(key2);
    });
  });

  describe('Complex scenarios', () => {
    it('should handle multiple leave types for same employee', async () => {
      // Create initial balances
      await balanceService.createOrUpdate(
        'emp1',
        'loc1',
        LeaveType.ANNUAL,
        20,
        'HCM_BATCH' as any,
        'initial',
      );
      await balanceService.createOrUpdate(
        'emp1',
        'loc1',
        LeaveType.SICK,
        10,
        'HCM_BATCH' as any,
        'initial',
      );

      // Apply webhook deltas to different leave types
      await syncService.processWebhook({
        employeeId: 'emp1',
        locationId: 'loc1',
        leaveType: LeaveType.ANNUAL,
        delta: 5,
        reason: 'bonus',
      });

      await syncService.processWebhook({
        employeeId: 'emp1',
        locationId: 'loc1',
        leaveType: LeaveType.SICK,
        delta: -2,
        reason: 'correction',
      });

      // Verify both balances were updated correctly
      const annual = await balanceService.findByEmployeeLocationAndType(
        'emp1',
        'loc1',
        LeaveType.ANNUAL,
      );
      const sick = await balanceService.findByEmployeeLocationAndType(
        'emp1',
        'loc1',
        LeaveType.SICK,
      );

      expect(annual.availableBalance).toBe(25);
      expect(sick.availableBalance).toBe(8);

      // Verify audit logs for both operations
      const auditLogs = await auditService.getAuditTrail('emp1');
      const webhookLogs = auditLogs.filter(log => log.source === 'HCM_WEBHOOK');
      expect(webhookLogs.length).toBe(2);
    });

    it('should handle batch sync with mixed create and update operations', async () => {
      // Create some initial balances
      await balanceService.createOrUpdate(
        'emp1',
        'loc1',
        LeaveType.ANNUAL,
        15,
        'HCM_BATCH' as any,
        'initial',
      );

      const batchPayloads = [
        // Update existing
        {
          employeeId: 'emp1',
          locationId: 'loc1',
          leaveType: LeaveType.ANNUAL,
          balance: 25,
        },
        // Create new
        {
          employeeId: 'emp1',
          locationId: 'loc1',
          leaveType: LeaveType.SICK,
          balance: 10,
        },
        // Create new for different employee
        {
          employeeId: 'emp2',
          locationId: 'loc1',
          leaveType: LeaveType.ANNUAL,
          balance: 20,
        },
      ];

      await syncService.processBatchSync(batchPayloads);

      // Verify all operations completed
      const emp1Annual = await balanceService.findByEmployeeLocationAndType(
        'emp1',
        'loc1',
        LeaveType.ANNUAL,
      );
      const emp1Sick = await balanceService.findByEmployeeLocationAndType(
        'emp1',
        'loc1',
        LeaveType.SICK,
      );
      const emp2Annual = await balanceService.findByEmployeeLocationAndType(
        'emp2',
        'loc1',
        LeaveType.ANNUAL,
      );

      expect(emp1Annual.availableBalance).toBe(25); // Updated
      expect(emp1Sick.availableBalance).toBe(10); // Created
      expect(emp2Annual.availableBalance).toBe(20); // Created

      // Verify audit logs
      const emp1AuditLogs = await auditService.getAuditTrail('emp1');
      const emp2AuditLogs = await auditService.getAuditTrail('emp2');

      expect(emp1AuditLogs.length).toBeGreaterThan(0);
      expect(emp2AuditLogs.length).toBe(1);
    });
  });
});
