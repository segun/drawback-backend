import { IsEnum, IsOptional, IsString } from 'class-validator';
import { ReportStatus } from '../enums/report-status.enum';
import { ReportType } from '../enums/report-type.enum';

export class ReportFiltersDto {
  @IsEnum(ReportStatus)
  @IsOptional()
  status?: ReportStatus;

  @IsEnum(ReportType)
  @IsOptional()
  reportType?: ReportType;

  @IsString()
  @IsOptional()
  reportedUser?: string;

  @IsString()
  @IsOptional()
  reporter?: string;
}
