import { IsEnum, IsString } from 'class-validator';

export class VerifyReceiptDto {
  @IsEnum(['ios', 'android'])
  platform!: 'ios' | 'android';

  @IsString()
  receipt!: string; // Purchase token for Android, receipt data for iOS

  @IsString()
  productId!: string; // Base plan ID (monthly, quarterly, yearly)
}
