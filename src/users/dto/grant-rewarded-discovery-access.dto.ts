import { IsIn, IsInt, Max, Min } from 'class-validator';

export class GrantRewardedDiscoveryAccessDto {
  @IsIn(['rewarded_ad'])
  grantType!: 'rewarded_ad';

  @IsInt()
  @Min(1)
  @Max(5)
  durationMinutes!: number;
}
