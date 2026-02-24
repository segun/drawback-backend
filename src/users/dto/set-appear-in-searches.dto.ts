import { IsBoolean } from 'class-validator';

export class SetAppearInSearchesDto {
  @IsBoolean()
  appearInSearches!: boolean;
}
