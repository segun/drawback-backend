import {
  IsEmail,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

export class RegisterDto {
  @IsEmail()
  @MaxLength(254)
  email!: string;

  @IsString()
  @MinLength(8)
  @MaxLength(72)
  password!: string;

  /**
   * Must start with @, followed by 3–29 alphanumeric/underscore characters.
   * Example: @alice_99
   */
  @IsString()
  @Matches(/^@[a-zA-Z0-9_]{3,29}$/, {
    message:
      'displayName must start with @ and contain 3–29 alphanumeric/underscore characters',
  })
  displayName!: string;
}
