import { Type } from 'class-transformer';
import { IsString, ValidateNested } from 'class-validator';

class AdsConfigDto {
  @IsString()
  provider!: string;
}

export class SetAppConfigDto {
  @ValidateNested()
  @Type(() => AdsConfigDto)
  ads!: AdsConfigDto;
}
