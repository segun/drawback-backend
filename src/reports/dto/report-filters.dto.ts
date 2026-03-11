import { IsEnum, IsOptional, IsUUID } from 'class-validator';
import { ReportStatus } from '../enums/report-status.enum';
import { ReportType } from '../enums/report-type.enum';

export class ReportFiltersDto {
  @IsEnum(ReportStatus)
  @IsOptional()
  status?: ReportStatus;

  @IsEnum(ReportType)
  @IsOptional()
  reportType?: ReportType;

  @IsUUID()
  @IsOptional()
  reportedUserId?: string;

  @IsUUID()
  @IsOptional()
  reporterId?: string;
}
