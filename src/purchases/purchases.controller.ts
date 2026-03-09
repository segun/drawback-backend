import {
  Body,
  Controller,
  ForbiddenException,
  Post,
  UseGuards,
} from '@nestjs/common';
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

  @Post('mock-unlock')
  async mockUnlock(@CurrentUser() user: User) {
    const nodeEnv = this.configService.get<string>('NODE_ENV');
    if (nodeEnv === 'production') {
      throw new ForbiddenException('Mock unlock not available in production');
    }

    const updatedUser = await this.purchasesService.unlockDiscoveryAccess(
      user.id,
    );
    return { hasDiscoveryAccess: Boolean(updatedUser.hasDiscoveryAccess) };
  }

  @Post('verify')
  async verifyReceipt(
    @CurrentUser() user: User,
    @Body() dto: VerifyReceiptDto,
  ) {
    const result = await this.purchasesService.verifyReceipt(
      user.id,
      dto.platform,
      dto.receipt,
    );
    return result;
  }
}
