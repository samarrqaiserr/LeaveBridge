import { 
  Controller, 
  Get, 
  Post, 
  Param, 
  Body, 
  HttpCode, 
  HttpStatus,
  ValidationPipe,
  HttpException,
} from '@nestjs/common';
import { HcmService, HcmTimeOffRequest, HcmBalance, HcmResponse } from './hcm.service';

@Controller('hcm')
export class HcmController {
  constructor(private readonly hcmService: HcmService) {}

  @Get('balance/:employeeId/:locationId/:leaveType')
  async getBalance(
    @Param('employeeId') employeeId: string,
    @Param('locationId') locationId: string,
    @Param('leaveType') leaveType: string,
  ) {
    try {
      const balance = await this.hcmService.getBalance(employeeId, locationId, leaveType);
      return { balance };
    } catch (error) {
      throw new HttpException(error.message, HttpStatus.SERVICE_UNAVAILABLE);
    }
  }

  @Post('time-off')
  @HttpCode(HttpStatus.OK)
  async submitTimeOff(@Body(ValidationPipe) request: HcmTimeOffRequest): Promise<HcmResponse> {
    try {
      return await this.hcmService.submitTimeOff(request);
    } catch (error) {
      throw new HttpException(error.message, HttpStatus.SERVICE_UNAVAILABLE);
    }
  }

  @Post('batch')
  @HttpCode(HttpStatus.OK)
  async submitBatch(@Body(ValidationPipe) payload: { balances: HcmBalance[] }) {
    try {
      await this.hcmService.submitBatch(payload.balances);
      return { message: 'Batch processed successfully', count: payload.balances.length };
    } catch (error) {
      throw new HttpException(error.message, HttpStatus.SERVICE_UNAVAILABLE);
    }
  }

  // Control endpoints for testing
  @Post('__control/set-balance')
  @HttpCode(HttpStatus.OK)
  async setBalance(@Body() payload: {
    employeeId: string;
    locationId: string;
    leaveType: string;
    balance: number;
  }) {
    this.hcmService.setBalance(
      payload.employeeId,
      payload.locationId,
      payload.leaveType,
      payload.balance,
    );
    return { message: 'Balance set successfully' };
  }

  @Post('__control/force-next-reject')
  @HttpCode(HttpStatus.OK)
  async forceNextReject() {
    this.hcmService.forceNextRejection();
    return { message: 'Next request will be rejected' };
  }

  @Post('__control/go-offline')
  @HttpCode(HttpStatus.OK)
  async goOffline() {
    this.hcmService.goOffline();
    return { message: 'HCM service is now offline' };
  }

  @Post('__control/go-online')
  @HttpCode(HttpStatus.OK)
  async goOnline() {
    this.hcmService.goOnline();
    return { message: 'HCM service is now online' };
  }

  @Get('__control/last-batch')
  async getLastBatch() {
    return { payload: this.hcmService.getLastBatchPayload() };
  }

  @Post('__control/clear')
  @HttpCode(HttpStatus.OK)
  async clear() {
    this.hcmService.clearBalances();
    return { message: 'HCM service cleared' };
  }
}
