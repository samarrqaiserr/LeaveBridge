import { IsString, IsInt, IsEnum, IsOptional } from 'class-validator';
import { LeaveType } from '../entities/balance.entity';

export class WebhookDto {
  @IsString()
  employeeId: string;

  @IsString()
  locationId: string;

  @IsEnum(LeaveType)
  leaveType: LeaveType;

  @IsInt()
  delta: number;

  @IsString()
  @IsOptional()
  reason?: string;
}
