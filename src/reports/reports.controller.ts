import {
  Controller,
  Post,
  Get,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ReportsService } from './reports.service';
import { CreateReportDto } from './dto/create-report.dto';
import { UpdateReportStatusDto } from './dto/update-report-status.dto';
import { ReportFiltersDto } from './dto/report-filters.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AdminGuard } from '../auth/admin.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { User } from '../users/entities/user.entity';

@Controller('reports')
@UseGuards(JwtAuthGuard)
export class ReportsController {
  constructor(private readonly reportsService: ReportsService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async createReport(
    @CurrentUser() user: User,
    @Body() createReportDto: CreateReportDto,
  ) {
    return await this.reportsService.createReport(user.id, createReportDto);
  }

  @Get('admin')
  @UseGuards(AdminGuard)
  async getAllReports(@Query() filters: ReportFiltersDto) {
    return await this.reportsService.findAllReports(filters);
  }

  @Get('admin/stats')
  @UseGuards(AdminGuard)
  async getReportStats() {
    return await this.reportsService.getReportStats();
  }

  @Get('admin/:id')
  @UseGuards(AdminGuard)
  async getReportById(@Param('id') reportId: string) {
    return await this.reportsService.findReportById(reportId);
  }

  @Patch('admin/:id')
  @UseGuards(AdminGuard)
  async updateReportStatus(
    @CurrentUser() admin: User,
    @Param('id') reportId: string,
    @Body() updateDto: UpdateReportStatusDto,
  ) {
    return await this.reportsService.updateReportStatus(
      reportId,
      admin.id,
      updateDto,
    );
  }

  @Delete('admin/:id')
  @UseGuards(AdminGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteReport(@Param('id') reportId: string) {
    await this.reportsService.deleteReport(reportId);
  }
}
