import { IsNotEmpty, IsString, IsUUID } from 'class-validator';

export class DrawEmoteDto {
  @IsUUID()
  requestId!: string;

  @IsString()
  @IsNotEmpty()
  emoji!: string;
}
