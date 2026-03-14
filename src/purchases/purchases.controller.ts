import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { User } from '../users/entities/user.entity';
import { PurchasesService } from './purchases.service';
import { VerifyReceiptDto } from './dto/verify-receipt.dto';

@UseGuards(JwtAuthGuard)
@Controller('purchases')
export class PurchasesController {
  constructor(
    private readonly purchasesService: PurchasesService,
    private readonly configService: ConfigService,
  ) {}

  @Post('verify')
  async verifyReceipt(
    @CurrentUser() user: User,
    @Body() dto: VerifyReceiptDto,
  ) {
    return await this.purchasesService.verifyReceipt(
      user.id,
      dto.platform,
      dto.receipt,
      dto.productId,
    );
  }
}
