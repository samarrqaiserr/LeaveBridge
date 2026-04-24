import { IsString, IsInt, IsEnum } from 'class-validator';
import { LeaveType } from '../entities/balance.entity';

export class BalancePayloadDto {
  @IsString()
  employeeId: string;

  @IsString()
  locationId: string;

  @IsEnum(LeaveType)
  leaveType: LeaveType;

  @IsInt()
  balance: number;
}
