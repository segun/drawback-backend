import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { User } from '../users/entities/user.entity';
import { PurchasesService } from './purchases.service';
import { AppleSubscriptionEventsService } from './apple-subscription-events.service';
import { VerifyReceiptDto } from './dto/verify-receipt.dto';

@Controller('purchases')
export class PurchasesController {
  private readonly logger = new Logger(PurchasesController.name);

  constructor(
    private readonly purchasesService: PurchasesService,
    private readonly appleSubscriptionEventsService: AppleSubscriptionEventsService,
    private readonly configService: ConfigService,
  ) {}

  @Post('verify')
  @UseGuards(JwtAuthGuard)
  async verifyReceipt(
    @CurrentUser() user: User,
    @Body() dto: VerifyReceiptDto,
  ) {
    this.logger.log(
      `Verifying ${dto.platform} receipt for user ${user.id}, productId: ${dto.productId}, receipt length: ${dto.receipt?.length || 0}`,
    );
    
    return await this.purchasesService.verifyReceipt(
      user.id,
      dto.platform,
      dto.receipt,
      dto.productId,
    );
  }

  @Post('webhooks/apple')
  @HttpCode(HttpStatus.OK)
  async handleAppleWebhook(@Body() body: { signedPayload: string }) {
    if (!body.signedPayload) {
      return { error: 'Missing signedPayload' };
    }

    try {
      await this.appleSubscriptionEventsService.handleWebhook(
        body.signedPayload,
      );
      return { ok: true };
    } catch (error) {
      return {
        error: 'Invalid signed payload',
        details: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }
}
