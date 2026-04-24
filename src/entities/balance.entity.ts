import { Entity, PrimaryColumn, Column, VersionColumn } from 'typeorm';

export enum LeaveType {
  ANNUAL = 'ANNUAL',
  SICK = 'SICK',
  UNPAID = 'UNPAID',
}

@Entity('balances')
export class Balance {
  @PrimaryColumn({ type: 'varchar' })
  employeeId: string;

  @PrimaryColumn({ type: 'varchar' })
  locationId: string;

  @PrimaryColumn({ type: 'varchar', enum: LeaveType })
  leaveType: LeaveType;

  @Column({ type: 'int', default: 0 })
  availableBalance: number;

  @Column({ type: 'int', default: 0 })
  reservedDays: number;

  @VersionColumn()
  version: number;

  constructor(partial?: Partial<Balance>) {
    Object.assign(this, partial);
  }
}
