import { Controller, Get, Param } from '@nestjs/common';
import { AuditService } from './audit.service';

@Controller('audit')
export class AuditController {
  constructor(private readonly auditService: AuditService) {}

  @Get(':employeeId')
  async getAuditTrail(@Param('employeeId') employeeId: string) {
    const auditLogs = await this.auditService.getAuditTrail(employeeId);

    return {
      employeeId,
      auditLogs: auditLogs.map(log => ({
        id: log.id,
        locationId: log.locationId,
        leaveType: log.leaveType,
        eventType: log.eventType,
        source: log.source,
        beforeValue: log.beforeValue,
        afterValue: log.afterValue,
        actor: log.actor,
        metadata: log.metadata ? JSON.parse(log.metadata) : null,
        requestId: log.requestId,
        timestamp: log.timestamp,
      })),
    };
  }
}
