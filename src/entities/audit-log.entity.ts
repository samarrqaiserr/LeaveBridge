import { Entity, PrimaryColumn, Column, CreateDateColumn } from 'typeorm';

export enum AuditSource {
  HCM_REALTIME = 'HCM_REALTIME',
  HCM_BATCH = 'HCM_BATCH',
  HCM_WEBHOOK = 'HCM_WEBHOOK',
  READYON_REQUEST = 'READYON_REQUEST',
}

export enum AuditEventType {
  BALANCE_UPDATED = 'BALANCE_UPDATED',
  BALANCE_FLOOR_APPLIED = 'BALANCE_FLOOR_APPLIED',
  RESERVATION_CREATED = 'RESERVATION_CREATED',
  RESERVATION_RELEASED = 'RESERVATION_RELEASED',
  REQUEST_CREATED = 'REQUEST_CREATED',
  REQUEST_APPROVED = 'REQUEST_APPROVED',
  REQUEST_REJECTED = 'REQUEST_REJECTED',
  REQUEST_CANCELLED = 'REQUEST_CANCELLED',
  BATCH_SYNC_WARNING = 'BATCH_SYNC_WARNING',
}

@Entity('audit_logs')
export class AuditLog {
  @PrimaryColumn('uuid')
  id: string;

  @Column({ type: 'varchar' })
  employeeId: string;

  @Column({ type: 'varchar' })
  locationId: string;

  @Column({ type: 'varchar', enum: ['ANNUAL', 'SICK', 'UNPAID'] })
  leaveType: string;

  @Column({ type: 'varchar', enum: AuditEventType })
  eventType: AuditEventType;

  @Column({ type: 'varchar', enum: AuditSource })
  source: AuditSource;

  @Column({ type: 'int', nullable: true })
  beforeValue: number;

  @Column({ type: 'int', nullable: true })
  afterValue: number;

  @Column({ type: 'text', nullable: true })
  actor: string;

  @Column({ type: 'text', nullable: true })
  metadata: string;

  @Column({ type: 'varchar', nullable: true })
  requestId: string;

  @CreateDateColumn({ type: 'datetime' })
  timestamp: Date;

  constructor(partial?: Partial<AuditLog>) {
    Object.assign(this, partial);
  }
}
