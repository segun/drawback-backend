import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Report } from './entities/report.entity';
import { CreateReportDto } from './dto/create-report.dto';
import { UpdateReportStatusDto } from './dto/update-report-status.dto';
import { ReportFiltersDto } from './dto/report-filters.dto';
import { ReportStatus } from './enums/report-status.enum';

@Injectable()
export class ReportsService {
  constructor(
    @InjectRepository(Report)
    private readonly reportRepository: Repository<Report>,
  ) {}

  async createReport(
    reporterId: string,
    dto: CreateReportDto,
  ): Promise<Report> {
    // Prevent users from reporting themselves
    if (reporterId === dto.reportedUserId) {
      throw new BadRequestException('You cannot report yourself');
    }

    const report = this.reportRepository.create({
      reporterId,
      ...dto,
    });

    return await this.reportRepository.save(report);
  }

  async findAllReports(filters?: ReportFiltersDto): Promise<Report[]> {
    const queryBuilder = this.reportRepository
      .createQueryBuilder('report')
      .leftJoinAndSelect('report.reporter', 'reporter')
      .leftJoinAndSelect('report.reportedUser', 'reportedUser')
      .leftJoinAndSelect('report.resolver', 'resolver')
      .orderBy('report.createdAt', 'DESC');

    if (filters?.status) {
      queryBuilder.andWhere('report.status = :status', {
        status: filters.status,
      });
    }

    if (filters?.reportType) {
      queryBuilder.andWhere('report.reportType = :reportType', {
        reportType: filters.reportType,
      });
    }

    if (filters?.reportedUserId) {
      queryBuilder.andWhere('report.reportedUserId = :reportedUserId', {
        reportedUserId: filters.reportedUserId,
      });
    }

    if (filters?.reporterId) {
      queryBuilder.andWhere('report.reporterId = :reporterId', {
        reporterId: filters.reporterId,
      });
    }

    return await queryBuilder.getMany();
  }

  async findReportById(reportId: string): Promise<Report> {
    const report = await this.reportRepository.findOne({
      where: { id: reportId },
      relations: ['reporter', 'reportedUser', 'resolver'],
    });

    if (!report) {
      throw new NotFoundException('Report not found');
    }

    return report;
  }

  async updateReportStatus(
    reportId: string,
    adminId: string,
    dto: UpdateReportStatusDto,
  ): Promise<Report> {
    const report = await this.findReportById(reportId);

    report.status = dto.status;
    if (dto.adminNotes !== undefined) {
      report.adminNotes = dto.adminNotes;
    }

    // Mark as resolved if status is RESOLVED or DISMISSED
    if (
      dto.status === ReportStatus.RESOLVED ||
      dto.status === ReportStatus.DISMISSED
    ) {
      report.resolvedBy = adminId;
      report.resolvedAt = new Date();
    } else {
      // Clear resolution data if moving back to pending/review
      report.resolvedBy = undefined;
      report.resolvedAt = undefined;
    }

    return await this.reportRepository.save(report);
  }

  async deleteReport(reportId: string): Promise<void> {
    const report = await this.findReportById(reportId);
    await this.reportRepository.remove(report);
  }

  // Helper method to get report counts by status (useful for admin dashboard)
  async getReportStats(): Promise<{
    total: number;
    pending: number;
    underReview: number;
    resolved: number;
    dismissed: number;
  }> {
    const [total, pending, underReview, resolved, dismissed] =
      await Promise.all([
        this.reportRepository.count(),
        this.reportRepository.count({
          where: { status: ReportStatus.PENDING },
        }),
        this.reportRepository.count({
          where: { status: ReportStatus.UNDER_REVIEW },
        }),
        this.reportRepository.count({
          where: { status: ReportStatus.RESOLVED },
        }),
        this.reportRepository.count({
          where: { status: ReportStatus.DISMISSED },
        }),
      ]);

    return { total, pending, underReview, resolved, dismissed };
  }
}
