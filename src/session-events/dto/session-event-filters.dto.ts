import { IsEnum, IsOptional, IsString, IsDateString } from 'class-validator';
import { SessionEventType } from '../enums/session-event-type.enum';

export class SessionEventFiltersDto {
  @IsString()
  @IsOptional()
  user?: string;

  @IsEnum(SessionEventType)
  @IsOptional()
  eventType?: SessionEventType;

  @IsString()
  @IsOptional()
  socketId?: string;

  @IsString()
  @IsOptional()
  roomId?: string;

  @IsString()
  @IsOptional()
  requestId?: string;

  @IsDateString()
  @IsOptional()
  startDate?: string;

  @IsDateString()
  @IsOptional()
  endDate?: string;
}
