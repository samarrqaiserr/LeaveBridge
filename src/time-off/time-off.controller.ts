import { 
  Controller, 
  Post, 
  Get, 
  Patch, 
  Param, 
  Body, 
  HttpCode, 
  HttpStatus,
  ValidationPipe,
  Headers,
} from '@nestjs/common';
import { TimeOffService } from './time-off.service';
import { CreateTimeOffRequestDto } from '../dto/create-time-off-request.dto';
import { ApproveRequestDto } from '../dto/approve-request.dto';
import { CancelRequestDto } from '../dto/cancel-request.dto';

@Controller('time-off')
export class TimeOffController {
  constructor(private readonly timeOffService: TimeOffService) {}

  @Post('requests')
  async createRequest(@Body(ValidationPipe) createRequestDto: CreateTimeOffRequestDto) {
    const request = await this.timeOffService.createTimeOffRequest(
      createRequestDto.employeeId,
      createRequestDto.locationId,
      createRequestDto.leaveType,
      createRequestDto.startDate,
      createRequestDto.endDate,
      createRequestDto.reason,
    );

    return {
      id: request.id,
      status: request.status,
      employeeId: request.employeeId,
      locationId: request.locationId,
      leaveType: request.leaveType,
      startDate: request.startDate,
      endDate: request.endDate,
      requestedDays: request.requestedDays,
      createdAt: request.createdAt,
    };
  }

  @Get('requests/:id')
  async getRequest(@Param('id') id: string) {
    const request = await this.timeOffService.getRequestById(id);
    
    return {
      id: request.id,
      status: request.status,
      employeeId: request.employeeId,
      locationId: request.locationId,
      leaveType: request.leaveType,
      startDate: request.startDate,
      endDate: request.endDate,
      requestedDays: request.requestedDays,
      managerId: request.managerId,
      reason: request.reason,
      rejectionReason: request.rejectionReason,
      createdAt: request.createdAt,
      updatedAt: request.updatedAt,
    };
  }

  @Patch('requests/:id/approve')
  @HttpCode(HttpStatus.OK)
  async approveRequest(
    @Param('id') id: string,
    @Body(ValidationPipe) approveDto: ApproveRequestDto,
    @Headers() headers: any,
  ) {
    try {
      const request = await this.timeOffService.approveRequest(id, approveDto.managerId);
      
      return {
        id: request.id,
        status: request.status,
        managerId: request.managerId,
        updatedAt: request.updatedAt,
      };
    } catch (error) {
      if (error.message?.includes('HCM service is unreachable')) {
        // Return 202 with retry-after header for HCM unavailability
        return {
          message: 'Request approved locally, pending HCM synchronization',
          retryAfter: 300, // 5 minutes
        };
      }
      throw error;
    }
  }

  @Patch('requests/:id/cancel')
  @HttpCode(HttpStatus.OK)
  async cancelRequest(
    @Param('id') id: string,
    @Body(ValidationPipe) cancelDto: CancelRequestDto,
  ) {
    const request = await this.timeOffService.cancelRequest(id, cancelDto.actorId);
    
    return {
      id: request.id,
      status: request.status,
      updatedAt: request.updatedAt,
    };
  }
}
