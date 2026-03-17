import { IsIn, IsString, IsNotEmpty } from 'class-validator';

export class VerifyReceiptDto {
  @IsIn(['ios', 'android'])
  platform!: 'ios' | 'android';

  @IsString()
  @IsNotEmpty()
  receipt!: string; // Purchase token for Android, receipt data for iOS

  @IsString()
  @IsNotEmpty()
  productId!: string; // Android: discovery_unlock_forever, iOS: monthly|quarterly|yearly
}
