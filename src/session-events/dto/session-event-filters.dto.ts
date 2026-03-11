import { IsEnum, IsOptional, IsUUID, IsDateString } from 'class-validator';
import { SessionEventType } from '../enums/session-event-type.enum';

export class SessionEventFiltersDto {
  @IsUUID()
  @IsOptional()
  userId?: string;

  @IsEnum(SessionEventType)
  @IsOptional()
  eventType?: SessionEventType;

  @IsDateString()
  @IsOptional()
  startDate?: string;

  @IsDateString()
  @IsOptional()
  endDate?: string;
}
