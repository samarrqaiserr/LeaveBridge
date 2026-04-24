import { Entity, PrimaryColumn, Column, CreateDateColumn } from 'typeorm';

export enum OutboxStatus {
  PENDING = 'PENDING',
  PENDING_RETRY = 'PENDING_RETRY',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED',
}

@Entity('outbox_events')
export class OutboxEvent {
  @PrimaryColumn('uuid')
  id: string;

  @Column({ type: 'varchar' })
  eventType: string;

  @Column({ type: 'text' })
  payload: string;

  @Column({ 
    type: 'varchar', 
    enum: OutboxStatus, 
    default: OutboxStatus.PENDING 
  })
  status: OutboxStatus;

  @Column({ type: 'int', default: 0 })
  retryCount: number;

  @Column({ type: 'datetime', nullable: true })
  nextRetryAt: Date;

  @Column({ type: 'varchar', nullable: true })
  requestId: string;

  @Column({ type: 'text', nullable: true })
  errorMessage: string;

  @CreateDateColumn({ type: 'datetime' })
  createdAt: Date;

  constructor(partial?: Partial<OutboxEvent>) {
    Object.assign(this, partial);
  }
}
