import { IsEnum, IsString } from 'class-validator';

export class VerifyReceiptDto {
  @IsEnum(['ios', 'android'])
  platform!: 'ios' | 'android';

  @IsString()
  receipt!: string;
}
