import { Controller, Get, Param } from '@nestjs/common';
import { BalanceService } from './balance.service';
import { AuditService } from '../audit/audit.service';

@Controller('balances')
export class BalanceController {
  constructor(
    private readonly balanceService: BalanceService,
    private readonly auditService: AuditService,
  ) {}

  @Get(':employeeId/:locationId')
  async getBalances(
    @Param('employeeId') employeeId: string,
    @Param('locationId') locationId: string,
  ) {
    const balances = await this.balanceService.findByEmployeeLocation(
      employeeId,
      locationId,
    );

    return {
      employeeId,
      locationId,
      balances: balances.map(balance => ({
        leaveType: balance.leaveType,
        availableBalance: balance.availableBalance,
        reservedDays: balance.reservedDays,
        netAvailable: this.balanceService.getAvailableBalance(balance),
      })),
    };
  }
}
