import {
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { ReportStatus } from '../enums/report-status.enum';

export class UpdateReportStatusDto {
  @IsEnum(ReportStatus)
  @IsNotEmpty()
  status!: ReportStatus;

  @IsString()
  @IsOptional()
  @MaxLength(2000)
  adminNotes?: string;
}
