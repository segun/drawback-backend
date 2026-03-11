import {
  IsEnum,
  IsNotEmpty,
  IsString,
  IsUUID,
  IsOptional,
  MaxLength,
} from 'class-validator';
import { ReportType } from '../enums/report-type.enum';

export class CreateReportDto {
  @IsUUID()
  @IsNotEmpty()
  reportedUserId!: string;

  @IsEnum(ReportType)
  @IsNotEmpty()
  reportType!: ReportType;

  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  description!: string;

  @IsUUID()
  @IsOptional()
  chatRequestId?: string;

  @IsString()
  @IsOptional()
  @MaxLength(255)
  sessionContext?: string;
}
