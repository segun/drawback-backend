import { Type } from 'class-transformer';
import { IsInt, IsString, Min, ValidateNested } from 'class-validator';

class AdsConfigDto {
  @IsString()
  provider!: string;
}

export class SetAppConfigDto {
  @ValidateNested()
  @Type(() => AdsConfigDto)
  ads!: AdsConfigDto;

  @IsInt()
  @Min(1)
  temporaryDiscoveryAccessDurationMinutes!: number;
}
