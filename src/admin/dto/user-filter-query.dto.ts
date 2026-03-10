import { Type } from 'class-transformer';
import { IsBoolean, IsEnum, IsOptional } from 'class-validator';
import { UserMode } from '../../users/enums/user-mode.enum';
import { PaginationQueryDto } from './pagination-query.dto';

export class UserFilterQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsEnum(UserMode)
  mode?: UserMode;

  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  appearInSearches?: boolean;

  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  appearInDiscoveryGame?: boolean;

  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  isBlocked?: boolean;

  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  isActivated?: boolean;
}
