import { IsEnum, IsNotEmpty, IsString } from 'class-validator';
import { PushProvider } from '../enums/push-provider.enum';

export class DeactivatePushTokenDto {
  @IsEnum(PushProvider)
  provider!: PushProvider;

  @IsString()
  @IsNotEmpty()
  token!: string;
}
