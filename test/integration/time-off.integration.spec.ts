import { Test, TestingModule } from '@nestjs/testing';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { Balance, LeaveType } from '../../src/entities/balance.entity';
import { TimeOffRequest, TimeOffRequestStatus } from '../../src/entities/time-off-request.entity';
import { AuditLog } from '../../src/entities/audit-log.entity';
import { OutboxEvent, OutboxStatus } from '../../src/entities/outbox-event.entity';
import { BalanceService } from '../../src/balance/balance.service';
import { TimeOffService } from '../../src/time-off/time-off.service';
import { AuditService } from '../../src/audit/audit.service';
import { SyncService } from '../../src/sync/sync.service';
import { HcmService } from '../../src/time-off/hcm.service';
import { ConfigService } from '@nestjs/config';

describe('TimeOff Integration Tests', () => {
  let module: TestingModule;
  let dataSource: DataSource;
  let balanceService: BalanceService;
  let timeOffService: TimeOffService;
  let auditService: AuditService;
  let syncService: SyncService;
  let hcmService: HcmService;

  beforeAll(async () => {
    module = await Test.createTestingModule({
      imports: [
        TypeOrmModule.forRoot({
          type: 'sqlite',
          database: ':memory:',
          entities: [Balance, TimeOffRequest, AuditLog, OutboxEvent],
          synchronize: true,
          logging: false,
        }),
        TypeOrmModule.forFeature([Balance, TimeOffRequest, AuditLog, OutboxEvent]),
      ],
      providers: [BalanceService, TimeOffService, AuditService, SyncService, HcmService],
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
    timeOffService = module.get<TimeOffService>(TimeOffService);
    auditService = module.get<AuditService>(AuditService);
    syncService = module.get<SyncService>(SyncService);
    hcmService = module.get<HcmService>(HcmService);
  });

  afterAll(async () => {
    await dataSource.destroy();
    await module.close();
  });

  beforeEach(async () => {
    // Clean up database before each test
    await dataSource.query('DELETE FROM outbox_events');
    await dataSource.query('DELETE FROM audit_logs');
    await dataSource.query('DELETE FROM time_off_requests');
    await dataSource.query('DELETE FROM balances');
  });

  describe('Full request lifecycle', () => {
    it('should create, approve, and verify balance decremented', async () => {
      // Setup initial balance
      const initialBalance = await balanceService.createOrUpdate(
        'emp1',
        'loc1',
        LeaveType.ANNUAL,
        20,
        'HCM_BATCH' as any,
        'test',
      );

      // Create time off request
      const startDate = new Date('2024-01-01');
      const endDate = new Date('2024-01-05');
      const request = await timeOffService.createTimeOffRequest(
        'emp1',
        'loc1',
        LeaveType.ANNUAL,
        startDate,
        endDate,
        'Vacation',
      );

      expect(request.status).toBe(TimeOffRequestStatus.PENDING);
      expect(request.requestedDays).toBe(5);

      // Verify reservation was created
      const balanceAfterRequest = await balanceService.findByEmployeeLocationAndType(
        'emp1',
        'loc1',
        LeaveType.ANNUAL,
      );
      expect(balanceAfterRequest.reservedDays).toBe(5);

      // Mock HCM service to accept
      jest.spyOn(hcmService, 'submitTimeOffToHCM').mockResolvedValue();

      // Approve request
      const approvedRequest = await timeOffService.approveRequest(request.id, 'manager1');

      expect(approvedRequest.status).toBe(TimeOffRequestStatus.APPROVED);
      expect(approvedRequest.managerId).toBe('manager1');

      // Verify balance was decremented and reservation released
      const finalBalance = await balanceService.findByEmployeeLocationAndType(
        'emp1',
        'loc1',
        LeaveType.ANNUAL,
      );
      expect(finalBalance.availableBalance).toBe(15); // 20 - 5
      expect(finalBalance.reservedDays).toBe(0);

      // Verify audit logs
      const auditLogs = await auditService.getAuditTrail('emp1');
      expect(auditLogs.length).toBeGreaterThan(0);
      
      // Verify outbox event
      const outboxEvents = await dataSource.getRepository(OutboxEvent).find({
        where: { requestId: request.id },
      });
      expect(outboxEvents.length).toBe(1);
      expect(outboxEvents[0].status).toBe(OutboxStatus.COMPLETED);
    });
  });

  describe('Concurrent requests', () => {
    it('should only approve one request when both exceed balance', async () => {
      // Setup initial balance
      await balanceService.createOrUpdate(
        'emp1',
        'loc1',
        LeaveType.ANNUAL,
        10,
        'HCM_BATCH' as any,
        'test',
      );

      // Mock HCM service to accept
      jest.spyOn(hcmService, 'submitTimeOffToHCM').mockResolvedValue();

      const startDate = new Date('2024-01-01');
      const endDate = new Date('2024-01-08'); // 8 days each

      // Create two requests simultaneously
      const request1Promise = timeOffService.createTimeOffRequest(
        'emp1',
        'loc1',
        LeaveType.ANNUAL,
        startDate,
        endDate,
        'Vacation 1',
      );

      const request2Promise = timeOffService.createTimeOffRequest(
        'emp1',
        'loc1',
        LeaveType.ANNUAL,
        startDate,
        endDate,
        'Vacation 2',
      );

      const [request1, request2] = await Promise.all([request1Promise, request2Promise]);

      // Both should be created with reservations
      expect(request1.status).toBe(TimeOffRequestStatus.PENDING);
      expect(request2.status).toBe(TimeOffRequestStatus.PENDING);

      // Try to approve both simultaneously
      const approve1Promise = timeOffService.approveRequest(request1.id, 'manager1');
      const approve2Promise = timeOffService.approveRequest(request2.id, 'manager2');

      const [result1, result2] = await Promise.allSettled([approve1Promise, approve2Promise]);

      // One should succeed, one should fail
      const successCount = [
        result1.status === 'fulfilled',
        result2.status === 'fulfilled',
      ].filter(Boolean).length;

      expect(successCount).toBe(1);

      // Verify final balance
      const finalBalance = await balanceService.findByEmployeeLocationAndType(
        'emp1',
        'loc1',
        LeaveType.ANNUAL,
      );
      expect(finalBalance.availableBalance).toBe(2); // 10 - 8
      expect(finalBalance.reservedDays).toBe(0);
    });
  });

  describe('Batch sync followed by request', () => {
    it('should use post-batch balance for new requests', async () => {
      // Initial balance
      await balanceService.createOrUpdate(
        'emp1',
        'loc1',
        LeaveType.ANNUAL,
        15,
        'HCM_BATCH' as any,
        'test',
      );

      // Process batch sync with new balance
      const batchPayloads = [
        {
          employeeId: 'emp1',
          locationId: 'loc1',
          leaveType: LeaveType.ANNUAL,
          balance: 25, // Increased from 15
        },
      ];

      await syncService.processBatchSync(batchPayloads);

      // Verify new balance
      const balanceAfterBatch = await balanceService.findByEmployeeLocationAndType(
        'emp1',
        'loc1',
        LeaveType.ANNUAL,
      );
      expect(balanceAfterBatch.availableBalance).toBe(25);

      // Create request using new balance
      const startDate = new Date('2024-01-01');
      const endDate = new Date('2024-01-05');
      const request = await timeOffService.createTimeOffRequest(
        'emp1',
        'loc1',
        LeaveType.ANNUAL,
        startDate,
        endDate,
        'Vacation',
      );

      expect(request.status).toBe(TimeOffRequestStatus.PENDING);

      // Verify reservation was created from new balance
      const balanceAfterRequest = await balanceService.findByEmployeeLocationAndType(
        'emp1',
        'loc1',
        LeaveType.ANNUAL,
      );
      expect(balanceAfterRequest.reservedDays).toBe(5);
    });
  });

  describe('Webhook delta causing floor', () => {
    it('should apply floor when webhook delta makes balance negative', async () => {
      // Setup balance with reservation
      await balanceService.createOrUpdate(
        'emp1',
        'loc1',
        LeaveType.ANNUAL,
        10,
        'HCM_BATCH' as any,
        'test',
      );

      // Create reservation
      await balanceService.reserveDays('emp1', 'loc1', LeaveType.ANNUAL, 8, 'req1');

      // Apply negative delta that would make balance negative
      await syncService.processWebhook({
        employeeId: 'emp1',
        locationId: 'loc1',
        leaveType: LeaveType.ANNUAL,
        delta: -15, // Would make balance -5
        reason: 'correction',
      });

      // Verify balance was floored
      const finalBalance = await balanceService.findByEmployeeLocationAndType(
        'emp1',
        'loc1',
        LeaveType.ANNUAL,
      );
      expect(finalBalance.availableBalance).toBe(8); // Floored to reservedDays

      // Verify BALANCE_FLOOR_APPLIED audit log
      const auditLogs = await auditService.getAuditTrail('emp1');
      const floorLog = auditLogs.find(log => 
        log.eventType === 'BALANCE_FLOOR_APPLIED'
      );
      expect(floorLog).toBeDefined();
      expect(floorLog.source).toBe('HCM_WEBHOOK');
    });
  });

  describe('Cancel before approval', () => {
    it('should release reservation and restore balance', async () => {
      // Setup initial balance
      await balanceService.createOrUpdate(
        'emp1',
        'loc1',
        LeaveType.ANNUAL,
        20,
        'HCM_BATCH' as any,
        'test',
      );

      // Create request
      const startDate = new Date('2024-01-01');
      const endDate = new Date('2024-01-05');
      const request = await timeOffService.createTimeOffRequest(
        'emp1',
        'loc1',
        LeaveType.ANNUAL,
        startDate,
        endDate,
        'Vacation',
      );

      // Verify reservation
      const balanceAfterRequest = await balanceService.findByEmployeeLocationAndType(
        'emp1',
        'loc1',
        LeaveType.ANNUAL,
      );
      expect(balanceAfterRequest.reservedDays).toBe(5);

      // Cancel request
      const cancelledRequest = await timeOffService.cancelRequest(request.id, 'emp1');

      expect(cancelledRequest.status).toBe(TimeOffRequestStatus.CANCELLED);

      // Verify reservation was released
      const finalBalance = await balanceService.findByEmployeeLocationAndType(
        'emp1',
        'loc1',
        LeaveType.ANNUAL,
      );
      expect(finalBalance.availableBalance).toBe(20); // Unchanged
      expect(finalBalance.reservedDays).toBe(0); // Released

      // Verify audit logs
      const auditLogs = await auditService.getAuditTrail('emp1');
      const reservationReleasedLog = auditLogs.find(log => 
        log.eventType === 'RESERVATION_RELEASED'
      );
      const requestCancelledLog = auditLogs.find(log => 
        log.eventType === 'REQUEST_CANCELLED'
      );
      expect(reservationReleasedLog).toBeDefined();
      expect(requestCancelledLog).toBeDefined();
    });
  });

  describe('Batch sync with active reservation', () => {
    it('should preserve reservations and warn about rollback', async () => {
      // Setup initial balance
      await balanceService.createOrUpdate(
        'emp1',
        'loc1',
        LeaveType.ANNUAL,
        20,
        'HCM_BATCH' as any,
        'test',
      );

      // Create active reservation
      await balanceService.reserveDays('emp1', 'loc1', LeaveType.ANNUAL, 5, 'req1');

      // Process batch sync with lower balance (potential rollback)
      const batchPayloads = [
        {
          employeeId: 'emp1',
          locationId: 'loc1',
          leaveType: LeaveType.ANNUAL,
          balance: 12, // Lower than current (20) - reserved (5) = 15
        },
      ];

      await syncService.processBatchSync(batchPayloads);

      // Verify balance was updated but reservation preserved
      const finalBalance = await balanceService.findByEmployeeLocationAndType(
        'emp1',
        'loc1',
        LeaveType.ANNUAL,
      );
      expect(finalBalance.availableBalance).toBe(12); // Updated from batch
      expect(finalBalance.reservedDays).toBe(5); // Preserved

      // Verify warning was logged
      const auditLogs = await auditService.getAuditTrail('emp1');
      const warningLog = auditLogs.find(log => 
        log.eventType === 'BATCH_SYNC_WARNING'
      );
      expect(warningLog).toBeDefined();
      expect(warningLog.source).toBe('HCM_BATCH');
    });
  });
});
