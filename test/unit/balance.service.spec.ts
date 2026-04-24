import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Balance, LeaveType } from '../../src/entities/balance.entity';
import { BalanceService } from '../../src/balance/balance.service';
import { AuditService } from '../../src/audit/audit.service';
import { AuditSource } from '../../src/entities/audit-log.entity';

describe('BalanceService', () => {
  let service: BalanceService;
  let balanceRepository: jest.Mocked<Repository<Balance>>;
  let auditService: jest.Mocked<AuditService>;

  const mockBalance: Balance = {
    employeeId: 'emp1',
    locationId: 'loc1',
    leaveType: LeaveType.ANNUAL,
    availableBalance: 20,
    reservedDays: 5,
    version: 1,
  };

  beforeEach(async () => {
    const mockBalanceRepository = {
      findOne: jest.fn(),
      find: jest.fn(),
      create: jest.fn(),
      save: jest.fn(),
    };

    const mockAuditService = {
      logBalanceUpdate: jest.fn(),
      logReservationCreated: jest.fn(),
      logReservationReleased: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BalanceService,
        {
          provide: getRepositoryToken(Balance),
          useValue: mockBalanceRepository,
        },
        {
          provide: AuditService,
          useValue: mockAuditService,
        },
      ],
    }).compile();

    service = module.get<BalanceService>(BalanceService);
    balanceRepository = module.get(getRepositoryToken(Balance));
    auditService = module.get(AuditService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('findByEmployeeLocation', () => {
    it('should return balances for employee and location', async () => {
      const expectedBalances = [mockBalance];
      balanceRepository.find.mockResolvedValue(expectedBalances);

      const result = await service.findByEmployeeLocation('emp1', 'loc1');

      expect(balanceRepository.find).toHaveBeenCalledWith({
        where: { employeeId: 'emp1', locationId: 'loc1' },
      });
      expect(result).toEqual(expectedBalances);
    });
  });

  describe('findByEmployeeLocationAndType', () => {
    it('should return balance for specific employee, location, and leave type', async () => {
      balanceRepository.findOne.mockResolvedValue(mockBalance);

      const result = await service.findByEmployeeLocationAndType(
        'emp1',
        'loc1',
        LeaveType.ANNUAL,
      );

      expect(balanceRepository.findOne).toHaveBeenCalledWith({
        where: { employeeId: 'emp1', locationId: 'loc1', leaveType: LeaveType.ANNUAL },
      });
      expect(result).toEqual(mockBalance);
    });

    it('should return null when balance not found', async () => {
      balanceRepository.findOne.mockResolvedValue(null);

      const result = await service.findByEmployeeLocationAndType(
        'emp1',
        'loc1',
        LeaveType.ANNUAL,
      );

      expect(result).toBeNull();
    });
  });

  describe('createOrUpdate', () => {
    it('should update existing balance', async () => {
      const updatedBalance = { ...mockBalance, availableBalance: 25 };
      balanceRepository.findOne.mockResolvedValue(mockBalance);
      balanceRepository.save.mockResolvedValue(updatedBalance);

      const result = await service.createOrUpdate(
        'emp1',
        'loc1',
        LeaveType.ANNUAL,
        25,
        AuditSource.HCM_BATCH,
        'batch_sync',
      );

      expect(balanceRepository.findOne).toHaveBeenCalledWith({
        where: { employeeId: 'emp1', locationId: 'loc1', leaveType: LeaveType.ANNUAL },
      });
      expect(balanceRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({ availableBalance: 25 }),
      );
      expect(auditService.logBalanceUpdate).toHaveBeenCalledWith(
        'emp1',
        'loc1',
        LeaveType.ANNUAL,
        20,
        25,
        AuditSource.HCM_BATCH,
        'batch_sync',
      );
      expect(result).toEqual(updatedBalance);
    });

    it('should create new balance when not found', async () => {
      const newBalance = { ...mockBalance, availableBalance: 15 };
      balanceRepository.findOne.mockResolvedValue(null);
      balanceRepository.create.mockReturnValue(newBalance);
      balanceRepository.save.mockResolvedValue(newBalance);

      const result = await service.createOrUpdate(
        'emp2',
        'loc1',
        LeaveType.SICK,
        15,
        AuditSource.HCM_WEBHOOK,
        'webhook',
      );

      expect(balanceRepository.create).toHaveBeenCalledWith({
        employeeId: 'emp2',
        locationId: 'loc1',
        leaveType: LeaveType.SICK,
        availableBalance: 15,
        reservedDays: 0,
      });
      expect(balanceRepository.save).toHaveBeenCalledWith(newBalance);
      expect(auditService.logBalanceUpdate).toHaveBeenCalledWith(
        'emp2',
        'loc1',
        LeaveType.SICK,
        0,
        15,
        AuditSource.HCM_WEBHOOK,
        'webhook',
      );
      expect(result).toEqual(newBalance);
    });
  });

  describe('reserveDays', () => {
    it('should reserve days successfully', async () => {
      const updatedBalance = { ...mockBalance, reservedDays: 8 };
      balanceRepository.findOne.mockResolvedValue(mockBalance);
      balanceRepository.save.mockResolvedValue(updatedBalance);

      const result = await service.reserveDays(
        'emp1',
        'loc1',
        LeaveType.ANNUAL,
        3,
        'req1',
      );

      expect(balanceRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({ reservedDays: 8 }),
      );
      expect(auditService.logReservationCreated).toHaveBeenCalledWith(
        'emp1',
        'loc1',
        LeaveType.ANNUAL,
        5,
        8,
        'req1',
      );
      expect(result).toEqual(updatedBalance);
    });

    it('should throw error when insufficient balance', async () => {
      const lowBalance = { ...mockBalance, availableBalance: 10, reservedDays: 8 };
      balanceRepository.findOne.mockResolvedValue(lowBalance);

      await expect(
        service.reserveDays('emp1', 'loc1', LeaveType.ANNUAL, 5, 'req1'),
      ).rejects.toThrow('Insufficient balance. Available: 2, Requested: 5');
    });

    it('should throw error when balance not found', async () => {
      balanceRepository.findOne.mockResolvedValue(null);

      await expect(
        service.reserveDays('emp1', 'loc1', LeaveType.ANNUAL, 3, 'req1'),
      ).rejects.toThrow(
        'Balance not found for employee emp1, location loc1, leave type ANNUAL',
      );
    });
  });

  describe('releaseReservation', () => {
    it('should release reservation successfully', async () => {
      const updatedBalance = { ...mockBalance, reservedDays: 2 };
      balanceRepository.findOne.mockResolvedValue(mockBalance);
      balanceRepository.save.mockResolvedValue(updatedBalance);

      const result = await service.releaseReservation(
        'emp1',
        'loc1',
        LeaveType.ANNUAL,
        3,
        'req1',
      );

      expect(balanceRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({ reservedDays: 2 }),
      );
      expect(auditService.logReservationReleased).toHaveBeenCalledWith(
        'emp1',
        'loc1',
        LeaveType.ANNUAL,
        5,
        2,
        'req1',
      );
      expect(result).toEqual(updatedBalance);
    });

    it('should not go below zero when releasing more than reserved', async () => {
      const updatedBalance = { ...mockBalance, reservedDays: 0 };
      balanceRepository.findOne.mockResolvedValue(mockBalance);
      balanceRepository.save.mockResolvedValue(updatedBalance);

      const result = await service.releaseReservation(
        'emp1',
        'loc1',
        LeaveType.ANNUAL,
        10,
        'req1',
      );

      expect(result.reservedDays).toBe(0);
    });
  });

  describe('decrementBalance', () => {
    it('should decrement balance and release reservation', async () => {
      const updatedBalance = {
        ...mockBalance,
        availableBalance: 17,
        reservedDays: 2,
      };
      balanceRepository.findOne.mockResolvedValue(mockBalance);
      balanceRepository.save.mockResolvedValue(updatedBalance);

      const result = await service.decrementBalance(
        'emp1',
        'loc1',
        LeaveType.ANNUAL,
        3,
        'req1',
      );

      expect(balanceRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({
          availableBalance: 17,
          reservedDays: 2,
        }),
      );
      expect(auditService.logBalanceUpdate).toHaveBeenCalledWith(
        'emp1',
        'loc1',
        LeaveType.ANNUAL,
        20,
        17,
        AuditSource.READYON_REQUEST,
        'request:req1',
      );
      expect(result).toEqual(updatedBalance);
    });
  });

  describe('applyWebhookDelta', () => {
    it('should apply positive delta successfully', async () => {
      const updatedBalance = { ...mockBalance, availableBalance: 25 };
      balanceRepository.findOne.mockResolvedValue(mockBalance);
      balanceRepository.save.mockResolvedValue(updatedBalance);

      const result = await service.applyWebhookDelta(
        'emp1',
        'loc1',
        LeaveType.ANNUAL,
        5,
        'webhook',
      );

      expect(balanceRepository.save).toHaveBeenCalledWith(
        expect.objectContaining({ availableBalance: 25 }),
      );
      expect(auditService.logBalanceUpdate).toHaveBeenCalledWith(
        'emp1',
        'loc1',
        LeaveType.ANNUAL,
        20,
        25,
        AuditSource.HCM_WEBHOOK,
        'webhook',
      );
      expect(result).toEqual(updatedBalance);
    });

    it('should apply floor logic when delta would make balance negative', async () => {
      const updatedBalance = { ...mockBalance, availableBalance: 5 }; // Floored to reservedDays
      balanceRepository.findOne.mockResolvedValue(mockBalance);
      balanceRepository.save.mockResolvedValue(updatedBalance);

      const result = await service.applyWebhookDelta(
        'emp1',
        'loc1',
        LeaveType.ANNUAL,
        -20, // Would make balance negative
        'webhook',
      );

      expect(result.availableBalance).toBe(5); // Floored to reservedDays
      expect(auditService.logBalanceFloorApplied).toHaveBeenCalledWith(
        'emp1',
        'loc1',
        LeaveType.ANNUAL,
        20,
        5,
        -20,
        5,
        'webhook',
      );
    });
  });

  describe('getAvailableBalance', () => {
    it('should calculate available balance correctly', () => {
      const balance = {
        availableBalance: 20,
        reservedDays: 5,
      } as Balance;

      const result = service.getAvailableBalance(balance);

      expect(result).toBe(15);
    });

    it('should return zero when available balance equals reserved days', () => {
      const balance = {
        availableBalance: 10,
        reservedDays: 10,
      } as Balance;

      const result = service.getAvailableBalance(balance);

      expect(result).toBe(0);
    });
  });
});
