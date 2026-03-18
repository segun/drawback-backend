import { IsEmail, IsOptional, IsString, MaxLength } from 'class-validator';

export class LoginDto {
  @IsEmail()
  @MaxLength(254)
  email!: string;

  @IsString()
  @MaxLength(72)
  password!: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  deviceId?: string;
}
