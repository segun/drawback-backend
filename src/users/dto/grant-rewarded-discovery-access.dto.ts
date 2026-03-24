import { IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';

export class GrantRewardedDiscoveryAccessDto {
  @IsIn(['rewarded_ad'])
  grantType!: 'rewarded_ad';

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(60)
  durationMinutes?: number;
}
