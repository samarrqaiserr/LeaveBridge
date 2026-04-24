import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { HcmService, HcmTimeOffRequest, HcmResponse } from '../../src/time-off/hcm.service';
import { TimeOffRequest, TimeOffRequestStatus } from '../../src/entities/time-off-request.entity';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('HcmService', () => {
  let service: HcmService;
  let configService: jest.Mocked<ConfigService>;

  const mockTimeOffRequest: TimeOffRequest = {
    id: 'req1',
    employeeId: 'emp1',
    locationId: 'loc1',
    leaveType: 'ANNUAL',
    startDate: new Date('2024-01-01'),
    endDate: new Date('2024-01-05'),
    requestedDays: 5,
    status: TimeOffRequestStatus.PENDING,
    managerId: null,
    reason: 'Vacation',
    rejectionReason: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeEach(async () => {
    const mockConfigService = {
      get: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        HcmService,
        {
          provide: ConfigService,
          useValue: mockConfigService,
        },
      ],
    }).compile();

    service = module.get<HcmService>(HcmService);
    configService = module.get(ConfigService);

    configService.get.mockReturnValue('http://localhost:3001');
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('submitTimeOffToHCM', () => {
    it('should submit time off request successfully', async () => {
      const expectedRequest: HcmTimeOffRequest = {
        employeeId: 'emp1',
        locationId: 'loc1',
        leaveType: 'ANNUAL',
        startDate: '2024-01-01',
        endDate: '2024-01-05',
        requestedDays: 5,
      };

      const mockResponse: HcmResponse = { success: true };
      mockedAxios.post.mockResolvedValue({ data: mockResponse });

      await service.submitTimeOffToHCM(mockTimeOffRequest);

      expect(mockedAxios.post).toHaveBeenCalledWith(
        'http://localhost:3001/hcm/time-off',
        expectedRequest,
        {
          timeout: 10000,
          headers: {
            'Content-Type': 'application/json',
          },
        },
      );
    });

    it('should throw error when HCM rejects request', async () => {
      const mockResponse: HcmResponse = {
        success: false,
        message: 'Insufficient balance',
        code: 'INSUFFICIENT_BALANCE',
      };
      mockedAxios.post.mockResolvedValue({ data: mockResponse });

      await expect(service.submitTimeOffToHCM(mockTimeOffRequest)).rejects.toThrow(
        'HCM rejected the request: Insufficient balance (code: INSUFFICIENT_BALANCE)',
      );
    });

    it('should throw error when HCM service is unreachable', async () => {
      const error = new Error('ECONNREFUSED');
      (error as any).code = 'ECONNREFUSED';
      mockedAxios.post.mockRejectedValue(error);

      await expect(service.submitTimeOffToHCM(mockTimeOffRequest)).rejects.toThrow(
        'HCM service is unreachable',
      );
    });

    it('should throw error when HCM host not found', async () => {
      const error = new Error('ENOTFOUND');
      (error as any).code = 'ENOTFOUND';
      mockedAxios.post.mockRejectedValue(error);

      await expect(service.submitTimeOffToHCM(mockTimeOffRequest)).rejects.toThrow(
        'HCM service is unreachable',
      );
    });

    it('should throw error for HTTP 400 response', async () => {
      const error = new Error('Request failed');
      (error as any).response = {
        status: 400,
        data: {
          success: false,
          message: 'Invalid request',
          code: 'INVALID_REQUEST',
        },
      };
      mockedAxios.post.mockRejectedValue(error);

      await expect(service.submitTimeOffToHCM(mockTimeOffRequest)).rejects.toThrow(
        'HCM rejected the request: Invalid request (code: INVALID_REQUEST)',
      );
    });

    it('should throw error for other axios errors', async () => {
      const error = new Error('Network error');
      mockedAxios.post.mockRejectedValue(error);

      await expect(service.submitTimeOffToHCM(mockTimeOffRequest)).rejects.toThrow(
        'HCM service error: Network error',
      );
    });
  });

  describe('getBalanceFromHCM', () => {
    it('should get balance from HCM successfully', async () => {
      const mockResponse = { balance: 20 };
      mockedAxios.get.mockResolvedValue({ data: mockResponse });

      const result = await service.getBalanceFromHCM('emp1', 'loc1', 'ANNUAL');

      expect(result).toBe(20);
      expect(mockedAxios.get).toHaveBeenCalledWith(
        'http://localhost:3001/hcm/balance/emp1/loc1/ANNUAL',
        {
          timeout: 5000,
        },
      );
    });

    it('should throw error when HCM service is unreachable', async () => {
      const error = new Error('ECONNREFUSED');
      (error as any).code = 'ECONNREFUSED';
      mockedAxios.get.mockRejectedValue(error);

      await expect(service.getBalanceFromHCM('emp1', 'loc1', 'ANNUAL')).rejects.toThrow(
        'HCM service is unreachable',
      );
    });

    it('should throw error for other axios errors', async () => {
      const error = new Error('Network error');
      mockedAxios.get.mockRejectedValue(error);

      await expect(service.getBalanceFromHCM('emp1', 'loc1', 'ANNUAL')).rejects.toThrow(
        'HCM service error: Network error',
      );
    });
  });

  describe('submitBatchToHCM', () => {
    it('should submit batch to HCM successfully', async () => {
      const balances = [
        {
          employeeId: 'emp1',
          locationId: 'loc1',
          leaveType: 'ANNUAL',
          balance: 20,
        },
      ];

      mockedAxios.post.mockResolvedValue({});

      await service.submitBatchToHCM(balances);

      expect(mockedAxios.post).toHaveBeenCalledWith(
        'http://localhost:3001/hcm/batch',
        { balances },
        {
          timeout: 30000,
          headers: {
            'Content-Type': 'application/json',
          },
        },
      );
    });

    it('should throw error for batch submission failure', async () => {
      const balances = [];
      const error = new Error('Network error');
      mockedAxios.post.mockRejectedValue(error);

      await expect(service.submitBatchToHCM(balances)).rejects.toThrow(
        'HCM batch submission failed: Network error',
      );
    });
  });
});
