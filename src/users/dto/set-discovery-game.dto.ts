import { IsBoolean, IsOptional, IsString } from 'class-validator';

export class SetDiscoveryGameDto {
  @IsBoolean()
  appearInDiscoveryGame!: boolean;

  @IsOptional()
  @IsString()
  base64Image?: string;
}
