import { Entity, PrimaryColumn, Column, CreateDateColumn, UpdateDateColumn } from 'typeorm';

export enum TimeOffRequestStatus {
  PENDING = 'PENDING',
  APPROVED = 'APPROVED',
  CANCELLED = 'CANCELLED',
  REJECTED = 'REJECTED',
}

@Entity('time_off_requests')
export class TimeOffRequest {
  @PrimaryColumn('uuid')
  id: string;

  @Column({ type: 'varchar' })
  employeeId: string;

  @Column({ type: 'varchar' })
  locationId: string;

  @Column({ type: 'varchar', enum: ['ANNUAL', 'SICK', 'UNPAID'] })
  leaveType: string;

  @Column({ type: 'date' })
  startDate: Date;

  @Column({ type: 'date' })
  endDate: Date;

  @Column({ type: 'int' })
  requestedDays: number;

  @Column({ 
    type: 'varchar', 
    enum: TimeOffRequestStatus, 
    default: TimeOffRequestStatus.PENDING 
  })
  status: TimeOffRequestStatus;

  @Column({ type: 'varchar', nullable: true })
  managerId: string;

  @Column({ type: 'text', nullable: true })
  reason: string;

  @Column({ type: 'text', nullable: true })
  rejectionReason: string;

  @CreateDateColumn({ type: 'datetime' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'datetime' })
  updatedAt: Date;

  constructor(partial?: Partial<TimeOffRequest>) {
    Object.assign(this, partial);
  }
}
