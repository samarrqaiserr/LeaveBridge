import { IsArray, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { BalancePayloadDto } from './balance-payload.dto';

export class BatchSyncDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => BalancePayloadDto)
  balances: BalancePayloadDto[];
}
