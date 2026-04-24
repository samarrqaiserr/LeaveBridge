import * as request from 'supertest';
import { getApp, getHcmApp } from '../setup.e2e';

describe('Time Off E2E Tests', () => {
  let app: any;
  let hcmApp: any;

  beforeAll(async () => {
    app = getApp();
    hcmApp = getHcmApp();
  });

  beforeEach(async () => {
    // Reset mock HCM state
    await request(hcmApp.getHttpServer())
      .post('/hcm/__control/clear')
      .expect(200);

    // Set initial balance for testing
    await request(hcmApp.getHttpServer())
      .post('/hcm/__control/set-balance')
      .send({
        employeeId: 'emp1',
        locationId: 'loc1',
        leaveType: 'ANNUAL',
        balance: 20,
      })
      .expect(200);
  });

  describe('Happy path: employee requests leave, manager approves, HCM accepts', () => {
    it('should complete full lifecycle successfully', async () => {
      // Step 1: Create time off request
      const createResponse = await request(app.getHttpServer())
        .post('/time-off/requests')
        .send({
          employeeId: 'emp1',
          locationId: 'loc1',
          leaveType: 'ANNUAL',
          startDate: '2024-01-01',
          endDate: '2024-01-05',
          reason: 'Vacation',
        })
        .expect(201);

      expect(createResponse.body.status).toBe('PENDING');
      expect(createResponse.body.requestedDays).toBe(5);

      const requestId = createResponse.body.id;

      // Step 2: Verify balance reservation
      const balanceResponse = await request(app.getHttpServer())
        .get('/balances/emp1/loc1')
        .expect(200);

      const annualBalance = balanceResponse.body.balances.find(
        (b: any) => b.leaveType === 'ANNUAL',
      );
      expect(annualBalance.reservedDays).toBe(5);
      expect(annualBalance.netAvailable).toBe(15); // 20 - 5

      // Step 3: Approve request
      const approveResponse = await request(app.getHttpServer())
        .patch(`/time-off/requests/${requestId}/approve`)
        .send({
          managerId: 'manager1',
        })
        .expect(200);

      expect(approveResponse.body.status).toBe('APPROVED');
      expect(approveResponse.body.managerId).toBe('manager1');

      // Step 4: Verify final balance
      const finalBalanceResponse = await request(app.getHttpServer())
        .get('/balances/emp1/loc1')
        .expect(200);

      const finalAnnualBalance = finalBalanceResponse.body.balances.find(
        (b: any) => b.leaveType === 'ANNUAL',
      );
      expect(finalAnnualBalance.availableBalance).toBe(15); // 20 - 5
      expect(finalAnnualBalance.reservedDays).toBe(0);
      expect(finalAnnualBalance.netAvailable).toBe(15);

      // Step 5: Verify audit trail
      const auditResponse = await request(app.getHttpServer())
        .get('/audit/emp1')
        .expect(200);

      const auditLogs = auditResponse.body.auditLogs;
      expect(auditLogs.length).toBeGreaterThan(0);
      
      const requestCreatedLog = auditLogs.find((log: any) => 
        log.eventType === 'REQUEST_CREATED'
      );
      const requestApprovedLog = auditLogs.find((log: any) => 
        log.eventType === 'REQUEST_APPROVED'
      );
      
      expect(requestCreatedLog).toBeDefined();
      expect(requestApprovedLog).toBeDefined();
    });
  });

  describe('HCM rejection: force-reject next call', () => {
    it('should handle HCM rejection gracefully', async () => {
      // Step 1: Create time off request
      const createResponse = await request(app.getHttpServer())
        .post('/time-off/requests')
        .send({
          employeeId: 'emp1',
          locationId: 'loc1',
          leaveType: 'ANNUAL',
          startDate: '2024-01-01',
          endDate: '2024-01-05',
          reason: 'Vacation',
        })
        .expect(201);

      const requestId = createResponse.body.id;

      // Step 2: Force HCM to reject next request
      await request(hcmApp.getHttpServer())
        .post('/hcm/__control/force-next-reject')
        .expect(200);

      // Step 3: Attempt approval - should be rejected by HCM
      const approveResponse = await request(app.getHttpServer())
        .patch(`/time-off/requests/${requestId}/approve`)
        .send({
          managerId: 'manager1',
        })
        .expect(400);

      expect(approveResponse.body.message).toContain('HCM rejected the request');

      // Step 4: Verify request status is REJECTED
      const requestResponse = await request(app.getHttpServer())
        .get(`/time-off/requests/${requestId}`)
        .expect(200);

      expect(requestResponse.body.status).toBe('REJECTED');
      expect(requestResponse.body.rejectionReason).toContain('HCM rejected the request');

      // Step 5: Verify balance was restored (reservation released)
      const balanceResponse = await request(app.getHttpServer())
        .get('/balances/emp1/loc1')
        .expect(200);

      const annualBalance = balanceResponse.body.balances.find(
        (b: any) => b.leaveType === 'ANNUAL',
      );
      expect(annualBalance.availableBalance).toBe(20); // Unchanged
      expect(annualBalance.reservedDays).toBe(0); // Released

      // Step 6: Verify rejection in audit trail
      const auditResponse = await request(app.getHttpServer())
        .get('/audit/emp1')
        .expect(200);

      const auditLogs = auditResponse.body.auditLogs;
      const requestRejectedLog = auditLogs.find((log: any) => 
        log.eventType === 'REQUEST_REJECTED'
      );
      expect(requestRejectedLog).toBeDefined();
    });
  });

  describe('HCM offline: go-offline scenario', () => {
    it('should handle HCM unavailability with retry mechanism', async () => {
      // Step 1: Create time off request
      const createResponse = await request(app.getHttpServer())
        .post('/time-off/requests')
        .send({
          employeeId: 'emp1',
          locationId: 'loc1',
          leaveType: 'ANNUAL',
          startDate: '2024-01-01',
          endDate: '2024-01-05',
          reason: 'Vacation',
        })
        .expect(201);

      const requestId = createResponse.body.id;

      // Step 2: Take HCM offline
      await request(hcmApp.getHttpServer())
        .post('/hcm/__control/go-offline')
        .expect(200);

      // Step 3: Attempt approval - should return 202 with retry info
      const approveResponse = await request(app.getHttpServer())
        .patch(`/time-off/requests/${requestId}/approve`)
        .send({
          managerId: 'manager1',
        })
        .expect(202);

      expect(approveResponse.body.message).toContain('pending HCM synchronization');
      expect(approveResponse.body.retryAfter).toBe(300);

      // Step 4: Verify request remains in PENDING status
      const requestResponse = await request(app.getHttpServer())
        .get(`/time-off/requests/${requestId}`)
        .expect(200);

      expect(requestResponse.body.status).toBe('PENDING');

      // Step 5: Bring HCM back online
      await request(hcmApp.getHttpServer())
        .post('/hcm/__control/go-online')
        .expect(200);

      // Step 6: Retry approval - should succeed now
      const retryApproveResponse = await request(app.getHttpServer())
        .patch(`/time-off/requests/${requestId}/approve`)
        .send({
          managerId: 'manager1',
        })
        .expect(200);

      expect(retryApproveResponse.body.status).toBe('APPROVED');
    });
  });

  describe('Webhook anniversary bonus', () => {
    it('should process webhook delta and update balance', async () => {
      // Step 1: Send webhook with +5 days
      const webhookResponse = await request(app.getHttpServer())
        .post('/sync/webhook')
        .send({
          employeeId: 'emp1',
          locationId: 'loc1',
          leaveType: 'ANNUAL',
          delta: 5,
          reason: 'anniversary bonus',
        })
        .expect(200);

      expect(webhookResponse.body.delta).toBe(5);

      // Step 2: Verify balance was updated
      const balanceResponse = await request(app.getHttpServer())
        .get('/balances/emp1/loc1')
        .expect(200);

      const annualBalance = balanceResponse.body.balances.find(
        (b: any) => b.leaveType === 'ANNUAL',
      );
      expect(annualBalance.availableBalance).toBe(25); // 20 + 5

      // Step 3: Verify audit log entry
      const auditResponse = await request(app.getHttpServer())
        .get('/audit/emp1')
        .expect(200);

      const auditLogs = auditResponse.body.auditLogs;
      const balanceUpdateLog = auditLogs.find((log: any) => 
        log.eventType === 'BALANCE_UPDATED' && 
        log.source === 'HCM_WEBHOOK' &&
        log.actor === 'anniversary bonus'
      );
      expect(balanceUpdateLog).toBeDefined();
      expect(balanceUpdateLog.beforeValue).toBe(20);
      expect(balanceUpdateLog.afterValue).toBe(25);
    });
  });

  describe('Batch import idempotency', () => {
    it('should handle duplicate batch imports gracefully', async () => {
      const batchPayload = {
        balances: [
          {
            employeeId: 'emp1',
            locationId: 'loc1',
            leaveType: 'ANNUAL',
            balance: 30,
          },
          {
            employeeId: 'emp1',
            locationId: 'loc1',
            leaveType: 'SICK',
            balance: 15,
          },
        ],
      };

      // Step 1: Send first batch
      const firstResponse = await request(app.getHttpServer())
        .post('/sync/batch')
        .send(batchPayload)
        .expect(200);

      expect(firstResponse.body.processed).toBe(2);
      expect(firstResponse.body.idempotencyKey).toBeDefined();

      // Step 2: Send identical batch again
      const secondResponse = await request(app.getHttpServer())
        .post('/sync/batch')
        .send(batchPayload)
        .expect(409); // Conflict

      expect(secondResponse.body.message).toContain('already been processed');

      // Step 3: Verify no duplicate audit entries were created
      const auditResponse = await request(app.getHttpServer())
        .get('/audit/emp1')
        .expect(200);

      const auditLogs = auditResponse.body.auditLogs;
      const batchUpdates = auditLogs.filter((log: any) => 
        log.source === 'HCM_BATCH'
      );
      
      // Should only have logs from first batch, not duplicates
      const idempotencyMarkers = batchUpdates.filter((log: any) => 
        log.actor === 'idempotency_marker'
      );
      expect(idempotencyMarkers.length).toBe(1); // Only one marker
    });
  });

  describe('Concurrent approval race', () => {
    it('should handle concurrent approval attempts correctly', async () => {
      // Step 1: Create two requests that together exceed balance
      const request1Response = await request(app.getHttpServer())
        .post('/time-off/requests')
        .send({
          employeeId: 'emp1',
          locationId: 'loc1',
          leaveType: 'ANNUAL',
          startDate: '2024-01-01',
          endDate: '2024-01-10', // 10 days
          reason: 'Vacation 1',
        })
        .expect(201);

      const request2Response = await request(app.getHttpServer())
        .post('/time-off/requests')
        .send({
          employeeId: 'emp1',
          locationId: 'loc1',
          leaveType: 'ANNUAL',
          startDate: '2024-02-01',
          endDate: '2024-02-08', // 8 days
          reason: 'Vacation 2',
        })
        .expect(201);

      const req1Id = request1Response.body.id;
      const req2Id = request2Response.body.id;

      // Step 2: Attempt to approve both simultaneously
      const approve1Promise = request(app.getHttpServer())
        .patch(`/time-off/requests/${req1Id}/approve`)
        .send({ managerId: 'manager1' });

      const approve2Promise = request(app.getHttpServer())
        .patch(`/time-off/requests/${req2Id}/approve`)
        .send({ managerId: 'manager2' });

      const [result1, result2] = await Promise.allSettled([
        approve1Promise,
        approve2Promise,
      ]);

      // Step 3: Verify exactly one succeeded and one failed
      const successCount = [
        result1.status === 'fulfilled' && result1.value.status === 200,
        result2.status === 'fulfilled' && result2.value.status === 200,
      ].filter(Boolean).length;

      const failureCount = [
        result1.status === 'rejected',
        result2.status === 'rejected',
      ].filter(Boolean).length;

      expect(successCount).toBe(1);
      expect(failureCount).toBe(1);

      // Step 4: Verify final balance state
      const balanceResponse = await request(app.getHttpServer())
        .get('/balances/emp1/loc1')
        .expect(200);

      const annualBalance = balanceResponse.body.balances.find(
        (b: any) => b.leaveType === 'ANNUAL',
      );
      
      // Should have exactly one request deducted
      expect(annualBalance.availableBalance).toBeLessThan(20);
      expect(annualBalance.reservedDays).toBe(0);

      // Step 5: Verify request statuses
      const req1Status = await request(app.getHttpServer())
        .get(`/time-off/requests/${req1Id}`)
        .expect(200);

      const req2Status = await request(app.getHttpServer())
        .get(`/time-off/requests/${req2Id}`)
        .expect(200);

      const statuses = [req1Status.body.status, req2Status.body.status];
      expect(statuses).toContain('APPROVED');
      expect(statuses).toContain('REJECTED');
    });
  });
});
