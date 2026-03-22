import { Type } from 'class-transformer';
import { IsOptional, IsString, ValidateNested } from 'class-validator';

class AdsOverrideDto {
  @IsString()
  provider!: string;
}

export class SetUserConfigOverridesDto {
  @IsOptional()
  @ValidateNested()
  @Type(() => AdsOverrideDto)
  ads?: AdsOverrideDto;
}
