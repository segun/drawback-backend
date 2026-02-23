import { IsObject, IsUUID } from 'class-validator';

export class DrawStrokeDto {
  @IsUUID()
  requestId!: string;

  @IsObject()
  stroke!: Record<string, unknown>;
}
