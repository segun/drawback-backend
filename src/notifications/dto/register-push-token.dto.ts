import { IsEnum, IsNotEmpty, IsString } from 'class-validator';
import { PushPlatform } from '../enums/push-platform.enum';
import { PushProvider } from '../enums/push-provider.enum';

export class RegisterPushTokenDto {
  @IsEnum(PushProvider)
  provider!: PushProvider;

  @IsString()
  @IsNotEmpty()
  token!: string;

  @IsEnum(PushPlatform)
  platform!: PushPlatform;

  @IsString()
  @IsNotEmpty()
  deviceId!: string;
}
