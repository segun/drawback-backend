import { IsOptional, IsUUID } from 'class-validator';

export class DrawClearDto {
  @IsOptional()
  @IsUUID()
  requestId?: string;

  @IsOptional()
  @IsUUID()
  groupId?: string;
}
