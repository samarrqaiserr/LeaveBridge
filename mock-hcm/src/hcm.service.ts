import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomInt } from 'crypto';

export interface HcmTimeOffRequest {
  employeeId: string;
  locationId: string;
  leaveType: string;
  startDate: string;
  endDate: string;
  requestedDays: number;
}

export interface HcmBalance {
  employeeId: string;
  locationId: string;
  leaveType: string;
  balance: number;
}

export interface HcmResponse {
  success: boolean;
  message?: string;
  code?: string;
}

@Injectable()
export class HcmService {
  private readonly rejectRatio: number;
  private isOffline = false;
  private forceNextReject = false;
  
  // In-memory storage for testing
  private balances = new Map<string, number>();
  private lastBatchPayload: any[] = [];

  constructor(private readonly configService: ConfigService) {
    this.rejectRatio = parseFloat(this.configService.get<string>('HCM_REJECT_RATIO') || '0.1');
  }

  async submitTimeOff(request: HcmTimeOffRequest): Promise<HcmResponse> {
    if (this.isOffline) {
      throw new Error('HCM service is offline');
    }

    if (this.forceNextReject) {
      this.forceNextReject = false;
      return {
        success: false,
        message: 'Insufficient balance in HCM system',
        code: 'INSUFFICIENT_BALANCE',
      };
    }

    // Random rejection based on ratio
    if (Math.random() < this.rejectRatio) {
      return {
        success: false,
        message: 'Random rejection for testing',
        code: 'INSUFFICIENT_BALANCE',
      };
    }

    return { success: true };
  }

  async getBalance(employeeId: string, locationId: string, leaveType: string): Promise<number> {
    if (this.isOffline) {
      throw new Error('HCM service is offline');
    }

    const key = `${employeeId}:${locationId}:${leaveType}`;
    const baseBalance = this.balances.get(key) || 20; // Default 20 days
    
    // Simulate HCM drift with ±1 day variation
    const drift = randomInt(-1, 2);
    return Math.max(0, baseBalance + drift);
  }

  async submitBatch(balances: HcmBalance[]): Promise<void> {
    if (this.isOffline) {
      throw new Error('HCM service is offline');
    }

    this.lastBatchPayload = balances;
    
    // Store the balances for testing
    balances.forEach(hcmBalance => {
      const key = `${hcmBalance.employeeId}:${hcmBalance.locationId}:${hcmBalance.leaveType}`;
      this.balances.set(key, hcmBalance.balance);
    });
  }

  // Control endpoints for testing
  setBalance(employeeId: string, locationId: string, leaveType: string, balance: number): void {
    const key = `${employeeId}:${locationId}:${leaveType}`;
    this.balances.set(key, balance);
  }

  forceNextRejection(): void {
    this.forceNextReject = true;
  }

  goOffline(): void {
    this.isOffline = true;
  }

  goOnline(): void {
    this.isOffline = false;
  }

  getLastBatchPayload(): any[] {
    return this.lastBatchPayload;
  }

  clearBalances(): void {
    this.balances.clear();
    this.lastBatchPayload = [];
  }
}
