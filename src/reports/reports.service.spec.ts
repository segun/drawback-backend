import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ReportsService } from './reports.service';
import { Report } from './entities/report.entity';
import { User } from '../users/entities/user.entity';
import { ReportType } from './enums/report-type.enum';
import { ReportStatus } from './enums/report-status.enum';

const makeReport = (overrides: Partial<Report> = {}): Report =>
  ({
    id: 'report-1',
    reporterId: 'user-1',
    reportedUserId: 'user-2',
    reportType: ReportType.HARASSMENT,
    description: 'This user is harassing me',
    status: ReportStatus.PENDING,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  }) as Report;

const repoMock = () => ({
  findOne: jest.fn(),
  find: jest.fn(),
  create: jest.fn(),
  save: jest.fn(),
  remove: jest.fn(),
  count: jest.fn(),
  createQueryBuilder: jest.fn(),
});

describe('ReportsService', () => {
  let service: ReportsService;
  let reportRepo: ReturnType<typeof repoMock>;
  let userRepo: ReturnType<typeof repoMock>;

  beforeEach(async () => {
    reportRepo = repoMock();
    userRepo = repoMock();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ReportsService,
        { provide: getRepositoryToken(Report), useValue: reportRepo },
        { provide: getRepositoryToken(User), useValue: userRepo },
      ],
    }).compile();

    service = module.get(ReportsService);
    reportRepo = module.get(getRepositoryToken(Report));
    userRepo = module.get(getRepositoryToken(User));
  });

  afterEach(() => jest.clearAllMocks());

  // ── createReport ────────────────────────────────────────────────────

  describe('createReport', () => {
    it('should create a report successfully', async () => {
      const dto = {
        reportedUserId: 'user-2',
        reportType: ReportType.HARASSMENT,
        description: 'This user is harassing me',
      };

      const mockReport = makeReport();
      reportRepo.create.mockReturnValue(mockReport);
      reportRepo.save.mockResolvedValue(mockReport);

      const result = await service.createReport('user-1', dto);

      expect(reportRepo.create).toHaveBeenCalledWith({
        reporterId: 'user-1',
        ...dto,
      });
      expect(reportRepo.save).toHaveBeenCalledWith(mockReport);
      expect(result).toEqual(mockReport);
    });

    it('should throw BadRequestException if user reports themselves', async () => {
      const dto = {
        reportedUserId: 'user-1',
        reportType: ReportType.SPAM,
        description: 'Spam content',
      };

      await expect(service.createReport('user-1', dto)).rejects.toThrow(
        BadRequestException,
      );
      await expect(service.createReport('user-1', dto)).rejects.toThrow(
        'You cannot report yourself',
      );

      expect(reportRepo.create).not.toHaveBeenCalled();
    });
  });

  // ── findAllReports ──────────────────────────────────────────────────

  describe('findAllReports', () => {
    it('should return all reports with filters', async () => {
      const mockReports = [makeReport(), makeReport({ id: 'report-2' })];

      const mockQueryBuilder = {
        leftJoinAndSelect: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue(mockReports),
      };

      reportRepo.createQueryBuilder.mockReturnValue(mockQueryBuilder);

      const filters = { status: ReportStatus.PENDING };
      const result = await service.findAllReports(filters);

      expect(mockQueryBuilder.andWhere).toHaveBeenCalledWith(
        'report.status = :status',
        { status: ReportStatus.PENDING },
      );
      expect(result).toEqual(mockReports);
    });

    it('should return all reports without filters', async () => {
      const mockReports = [makeReport()];

      const mockQueryBuilder = {
        leftJoinAndSelect: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue(mockReports),
      };

      reportRepo.createQueryBuilder.mockReturnValue(mockQueryBuilder);

      const result = await service.findAllReports();

      expect(mockQueryBuilder.andWhere).not.toHaveBeenCalled();
      expect(result).toEqual(mockReports);
    });
  });

  // ── findReportById ──────────────────────────────────────────────────

  describe('findReportById', () => {
    it('should return a report by id', async () => {
      const mockReport = makeReport();
      reportRepo.findOne.mockResolvedValue(mockReport);

      const result = await service.findReportById('report-1');

      expect(reportRepo.findOne).toHaveBeenCalledWith({
        where: { id: 'report-1' },
        relations: ['reporter', 'reportedUser', 'resolver'],
      });
      expect(result).toEqual(mockReport);
    });

    it('should return null if report not found', async () => {
      reportRepo.findOne.mockResolvedValue(null);

      await expect(service.findReportById('nonexistent')).resolves.toBeNull();
    });
  });

  // ── updateReportStatus ──────────────────────────────────────────────

  describe('updateReportStatus', () => {
    it('should update report status and set resolver info', async () => {
      const mockReport = makeReport();
      reportRepo.findOne.mockResolvedValue(mockReport);

      const updatedReport = {
        ...mockReport,
        status: ReportStatus.RESOLVED,
        resolvedBy: 'admin-1',
        resolvedAt: new Date(),
      };
      reportRepo.save.mockResolvedValue(updatedReport);

      const dto = {
        status: ReportStatus.RESOLVED,
        adminNotes: 'User has been banned',
      };

      const result = await service.updateReportStatus(
        'report-1',
        'admin-1',
        dto,
      );

      expect(result.status).toBe(ReportStatus.RESOLVED);
      expect(result.resolvedBy).toBe('admin-1');
      expect(result.resolvedAt).toBeDefined();
    });

    it('should clear resolver info when moving back to pending', async () => {
      const mockReport = makeReport({
        status: ReportStatus.RESOLVED,
        resolvedBy: 'admin-1',
        resolvedAt: new Date(),
      });
      reportRepo.findOne.mockResolvedValue(mockReport);
      reportRepo.save.mockResolvedValue({
        ...mockReport,
        status: ReportStatus.PENDING,
        resolvedBy: undefined,
        resolvedAt: undefined,
      });

      const dto = { status: ReportStatus.PENDING };

      const result = await service.updateReportStatus(
        'report-1',
        'admin-1',
        dto,
      );

      expect(result.status).toBe(ReportStatus.PENDING);
      expect(result.resolvedBy).toBeUndefined();
      expect(result.resolvedAt).toBeUndefined();
    });
  });

  // ── deleteReport ────────────────────────────────────────────────────

  describe('deleteReport', () => {
    it('should delete a report', async () => {
      const mockReport = makeReport();
      reportRepo.findOne.mockResolvedValue(mockReport);
      reportRepo.remove.mockResolvedValue(mockReport);

      await service.deleteReport('report-1');

      expect(reportRepo.remove).toHaveBeenCalledWith(mockReport);
    });

    it('should throw NotFoundException if report does not exist', async () => {
      reportRepo.findOne.mockResolvedValue(null);

      await expect(service.deleteReport('nonexistent')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  // ── getReportStats ──────────────────────────────────────────────────

  describe('getReportStats', () => {
    it('should return report statistics', async () => {
      reportRepo.count
        .mockResolvedValueOnce(100) // total
        .mockResolvedValueOnce(25) // pending
        .mockResolvedValueOnce(15) // underReview
        .mockResolvedValueOnce(50) // resolved
        .mockResolvedValueOnce(10); // dismissed

      const result = await service.getReportStats();

      expect(result).toEqual({
        total: 100,
        pending: 25,
        underReview: 15,
        resolved: 50,
        dismissed: 10,
      });
      expect(reportRepo.count).toHaveBeenCalledTimes(5);
    });
  });
});
