import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosError } from 'axios';
import { TimeOffRequest } from '../entities/time-off-request.entity';

export interface HcmTimeOffRequest {
  employeeId: string;
  locationId: string;
  leaveType: string;
  startDate: string;
  endDate: string;
  requestedDays: number;
}

export interface HcmResponse {
  success: boolean;
  message?: string;
  code?: string;
}

@Injectable()
export class HcmService {
  private readonly hcmBaseUrl: string;

  constructor(private readonly configService: ConfigService) {
    this.hcmBaseUrl = this.configService.get<string>('HCM_BASE_URL') || 'http://localhost:3001';
  }

  async submitTimeOffToHCM(request: TimeOffRequest): Promise<void> {
    const hcmRequest: HcmTimeOffRequest = {
      employeeId: request.employeeId,
      locationId: request.locationId,
      leaveType: request.leaveType,
      startDate: new Date(request.startDate).toISOString().split('T')[0],
      endDate: new Date(request.endDate).toISOString().split('T')[0],
      requestedDays: request.requestedDays,
    };

    try {
      const response = await axios.post<HcmResponse>(
        `${this.hcmBaseUrl}/hcm/time-off`,
        hcmRequest,
        {
          timeout: 10000, // 10 second timeout
          headers: {
            'Content-Type': 'application/json',
          },
        },
      );

      if (!response.data.success) {
        throw new Error(
          `HCM rejected the request: ${response.data.message} (code: ${response.data.code})`,
        );
      }
    } catch (error) {
      if (axios.isAxiosError(error)) {
        const axiosError = error as AxiosError;
        
        if (axiosError.code === 'ECONNREFUSED' || axiosError.code === 'ENOTFOUND') {
          throw new Error('HCM service is unreachable');
        }

        if (axiosError.response?.status === 400) {
          const hcmResponse = axiosError.response.data as HcmResponse;
          throw new Error(
            `HCM rejected the request: ${hcmResponse.message} (code: ${hcmResponse.code})`,
          );
        }

        throw new Error(`HCM service error: ${axiosError.message}`);
      }

      throw error;
    }
  }

  async getBalanceFromHCM(
    employeeId: string,
    locationId: string,
    leaveType: string,
  ): Promise<number> {
    try {
      const response = await axios.get<{ balance: number }>(
        `${this.hcmBaseUrl}/hcm/balance/${employeeId}/${locationId}/${leaveType}`,
        {
          timeout: 5000,
        },
      );

      return response.data.balance;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        if (error.code === 'ECONNREFUSED' || error.code === 'ENOTFOUND') {
          throw new Error('HCM service is unreachable');
        }
        throw new Error(`HCM service error: ${error.message}`);
      }
      throw error;
    }
  }

  async submitBatchToHCM(balances: any[]): Promise<void> {
    try {
      await axios.post(
        `${this.hcmBaseUrl}/hcm/batch`,
        { balances },
        {
          timeout: 30000, // 30 second timeout for batch
          headers: {
            'Content-Type': 'application/json',
          },
        },
      );
    } catch (error) {
      if (axios.isAxiosError(error)) {
        throw new Error(`HCM batch submission failed: ${error.message}`);
      }
      throw error;
    }
  }
}
