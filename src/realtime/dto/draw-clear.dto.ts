import { IsUUID } from 'class-validator';

export class DrawClearDto {
  @IsUUID()
  requestId!: string;
}
