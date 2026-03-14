import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { google } from 'googleapis';
import { User } from '../users/entities/user.entity';

export interface SubscriptionDetails {
  tier: string;
  startDate: string;
  endDate: string;
  autoRenew: boolean;
}

@Injectable()
export class PurchasesService {
  private readonly logger = new Logger(PurchasesService.name);

  constructor(
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    private readonly configService: ConfigService,
  ) {}

  async unlockDiscoveryAccess(userId: string): Promise<User> {
    await this.userRepository.update(userId, { hasDiscoveryAccess: true });

    const user = await this.userRepository.findOne({ where: { id: userId } });
    if (!user) {
      throw new Error('User not found');
    }
    return user;
  }

  async verifyReceipt(
    userId: string,
    platform: 'ios' | 'android',
    receipt: string,
    productId: string,
  ): Promise<{
    success: boolean;
    subscription?: SubscriptionDetails;
    error?: string;
    details?: string;
  }> {
    // Only Android supported for now
    if (platform !== 'android') {
      throw new BadRequestException('Only Android platform is supported');
    }

    try {
      // 1. Initialize Google Play API client
      const auth = new google.auth.GoogleAuth({
        keyFile: this.configService.get<string>(
          'GOOGLE_APPLICATION_CREDENTIALS',
        ),
        scopes: ['https://www.googleapis.com/auth/androidpublisher'],
      });

      const androidPublisher = google.androidpublisher({
        version: 'v3',
        auth,
      });

      // 2. IMPORTANT: For new subscription model, use the parent subscription ID
      // Flutter sends base plan ID (monthly, quarterly, yearly)
      // Google API needs parent subscription ID (discovery_access)
      const subscriptionId = this.configService.get<string>(
        'GOOGLE_SUBSCRIPTION_ID',
      ); // 'discovery_access'

      if (!subscriptionId) {
        throw new InternalServerErrorException(
          'GOOGLE_SUBSCRIPTION_ID not configured',
        );
      }

      // 3. Verify the purchase with Google
      const result = await androidPublisher.purchases.subscriptions.get({
        packageName: this.configService.get<string>('GOOGLE_PACKAGE_NAME')!,
        subscriptionId: subscriptionId, // Parent subscription ID, NOT base plan ID
        token: receipt, // The purchase token from the app
      });

      const subscription = result.data;

      // 4. Check if subscription is valid
      if (!subscription || subscription.paymentState !== 1) {
        throw new BadRequestException('Invalid or unpaid subscription');
      }

      // 5. Extract subscription details
      const startTime = new Date(parseInt(subscription.startTimeMillis!));
      const endTime = new Date(parseInt(subscription.expiryTimeMillis!));
      const isAutoRenewing = subscription.autoRenewing === true;

      // 6. Determine tier from base plan ID sent by Flutter
      // productId is the base plan ID: 'monthly', 'quarterly', or 'yearly'
      const tier = productId; // Use the base plan ID directly

      // 7. Update user in database
      await this.userRepository.update(userId, {
        subscriptionPlatform: 'android',
        subscriptionTier: tier,
        subscriptionStatus: 'active',
        subscriptionStartDate: startTime,
        subscriptionEndDate: endTime,
        subscriptionAutoRenew: isAutoRenewing,
        originalTransactionId: subscription.orderId || null,
        purchaseToken: receipt,
        hasDiscoveryAccess: true, // Grant discovery access
      });

      this.logger.log(
        `Successfully verified Android subscription for user ${userId}: ${tier}`,
      );

      // 8. Return success
      return {
        success: true,
        subscription: {
          tier,
          startDate: startTime.toISOString(),
          endDate: endTime.toISOString(),
          autoRenew: isAutoRenewing,
        },
      };
    } catch (error) {
      this.logger.error('Purchase verification failed:', error);

      if (
        error instanceof BadRequestException ||
        error instanceof InternalServerErrorException
      ) {
        throw error;
      }

      throw new InternalServerErrorException({
        success: false,
        error: 'Verification failed',
        details: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  // Apple verification can be added here later if needed
}
