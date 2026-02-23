import { IsString, Matches, MaxLength } from 'class-validator';

export class UpdateProfileDto {
  @IsString()
  @Matches(/^@[a-zA-Z0-9_]{3,29}$/, {
    message:
      'displayName must start with @ and contain 3–29 alphanumeric/underscore characters',
  })
  @MaxLength(30)
  displayName!: string;
}
