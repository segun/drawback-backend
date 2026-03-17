import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  Logger,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { google } from 'googleapis';
import {
  SignedDataVerifier,
  Environment,
  JWSTransactionDecodedPayload,
} from '@apple/app-store-server-library';
import { readFileSync } from 'fs';
import { User } from '../users/entities/user.entity';
import { Subscription } from '../users/entities/subscription.entity';

export interface SubscriptionDetails {
  tier: string;
  platform: 'ios' | 'android';
  startDate: string;
  endDate: string;
  autoRenew: boolean;
}

@Injectable()
export class PurchasesService implements OnModuleInit {
  private readonly logger = new Logger(PurchasesService.name);
  private appleVerifier: SignedDataVerifier | null = null;

  constructor(
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    @InjectRepository(Subscription)
    private readonly subscriptionRepository: Repository<Subscription>,
    private readonly configService: ConfigService,
  ) {}

  onModuleInit() {
    this.initializeAppleVerifier();
  }

  private initializeAppleVerifier() {
    const bundleId = this.configService.get<string>('APPLE_BUNDLE_ID');
    const appleEnv = this.configService.get<string>('APPLE_ENV') || 'Sandbox';

    if (!bundleId) {
      this.logger.warn(
        'APPLE_BUNDLE_ID not configured. StoreKit 2 JWS verification will be disabled.',
      );
      return;
    }

    try {
      const certPath = 'src/purchases/certs/AppleRootCA-G3.cer';
      let appleRootCA: Buffer;
      try {
        appleRootCA = readFileSync(certPath);
      } catch {
        this.logger.warn(
          `Apple Root CA certificate not found at ${certPath}. StoreKit 2 JWS verification will be disabled.`,
        );
        return;
      }

      const environment =
        appleEnv === 'Production'
          ? Environment.PRODUCTION
          : Environment.SANDBOX;

      const appAppleId = this.configService.get<string>('APPLE_APP_ID');

      this.appleVerifier = new SignedDataVerifier(
        [appleRootCA],
        true,
        environment,
        bundleId,
        appAppleId ? Number(appAppleId) : undefined,
      );

      this.logger.log(
        `Apple JWS verifier initialized for StoreKit 2 (${appleEnv})`,
      );
    } catch (error) {
      this.logger.error('Failed to initialize Apple JWS verifier:', error);
    }
  }

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
    try {
      let startTime: Date;
      let endTime: Date;
      let isAutoRenewing = false;
      let originalTransactionId: string | null = null;

      if (platform === 'android') {
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
        startTime = new Date(parseInt(subscription.startTimeMillis!));
        endTime = new Date(parseInt(subscription.expiryTimeMillis!));
        isAutoRenewing = subscription.autoRenewing === true;
        originalTransactionId = subscription.orderId || null;
      } else if (platform === 'ios') {
        const sharedSecret = this.configService.get<string>(
          'APPLE_SHARED_SECRET',
        );

        if (!sharedSecret) {
          throw new InternalServerErrorException(
            'APPLE_SHARED_SECRET not configured',
          );
        }

        // Validate receipt data before sending to Apple
        if (!receipt || receipt.trim().length === 0) {
          throw new BadRequestException('Receipt data is empty or missing');
        }

        const trimmedReceipt = receipt.trim();

        // Check if this is a JWS transaction signature (StoreKit 2)
        if (trimmedReceipt.startsWith('eyJ') && trimmedReceipt.includes('.')) {
          this.logger.log(
            'Detected StoreKit 2 JWS transaction signature, using modern verification flow',
          );
          return await this.verifyJWSTransaction(
            userId,
            trimmedReceipt,
            productId,
          );
        }

        const verifyPayload = {
          'receipt-data': trimmedReceipt,
          password: sharedSecret,
          'exclude-old-transactions': true,
        };

        const verifyWithApple = async (url: string) => {
          const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(verifyPayload),
          });

          return (await response.json()) as {
            status: number;
            latest_receipt_info?: Array<{
              product_id?: string;
              purchase_date_ms?: string;
              expires_date_ms?: string;
              original_transaction_id?: string;
            }>;
            pending_renewal_info?: Array<{
              product_id?: string;
              auto_renew_product_id?: string;
              auto_renew_status?: string;
              original_transaction_id?: string;
            }>;
          };
        };

        let appleResponse = await verifyWithApple(
          'https://buy.itunes.apple.com/verifyReceipt',
        );

        // Sandbox receipts sent to production return 21007
        if (appleResponse.status === 21007) {
          appleResponse = await verifyWithApple(
            'https://sandbox.itunes.apple.com/verifyReceipt',
          );
        }

        if (appleResponse.status !== 0) {
          const errorMessages: Record<number, string> = {
            21000: 'The App Store could not read the JSON object you provided.',
            21002: 'The receipt-data property was malformed or missing.',
            21003: 'The receipt could not be authenticated.',
            21004:
              'The shared secret you provided does not match the shared secret on file.',
            21005: 'The receipt server is not currently available.',
            21006: 'This receipt is valid but the subscription has expired.',
            21007: 'This receipt is from the test environment.',
            21008: 'This receipt is from the production environment.',
            21010: 'This receipt could not be authorized.',
          };

          const errorMsg =
            errorMessages[appleResponse.status] || 'Unknown error';
          this.logger.error(
            `Apple verification failed with status ${appleResponse.status}: ${errorMsg}`,
          );

          throw new BadRequestException(
            `Receipt verification failed: ${errorMsg}`,
          );
        }

        const receiptInfos = appleResponse.latest_receipt_info ?? [];
        const matchingProductReceipts = receiptInfos
          .filter((entry) => entry.product_id === productId)
          .filter((entry) => {
            const expiry = Number(entry.expires_date_ms);
            return Number.isFinite(expiry) && expiry > 0;
          })
          .sort(
            (a, b) =>
              Number(b.expires_date_ms ?? '0') -
              Number(a.expires_date_ms ?? '0'),
          );

        const latestReceipt = matchingProductReceipts[0];
        if (!latestReceipt) {
          throw new BadRequestException(
            'Receipt does not contain a valid subscription for this product',
          );
        }

        endTime = new Date(Number(latestReceipt.expires_date_ms));
        startTime = latestReceipt.purchase_date_ms
          ? new Date(Number(latestReceipt.purchase_date_ms))
          : new Date();
        originalTransactionId = latestReceipt.original_transaction_id ?? null;

        const pendingRenewals = appleResponse.pending_renewal_info ?? [];
        const matchingRenewal = pendingRenewals.find(
          (entry) =>
            entry.product_id === productId ||
            entry.auto_renew_product_id === productId ||
            (entry.original_transaction_id &&
              entry.original_transaction_id === originalTransactionId),
        );
        isAutoRenewing = matchingRenewal?.auto_renew_status === '1';

        if (endTime <= new Date()) {
          throw new BadRequestException('Invalid or expired receipt');
        }
      } else {
        throw new BadRequestException('Unsupported platform');
      }

      // 6. Determine tier from product ID sent by Flutter
      const tier = productId;

      // 7. Upsert subscription record (update if exists, create if not)
      const existingSubscription = await this.subscriptionRepository.findOne({
        where: { user: { id: userId } },
      });

      if (existingSubscription) {
        // Update existing subscription
        await this.subscriptionRepository.update(existingSubscription.id, {
          platform,
          tier,
          status: 'active',
          startDate: startTime,
          endDate: endTime,
          autoRenew: isAutoRenewing,
          originalTransactionId,
          purchaseToken: receipt,
        });
      } else {
        // Create new subscription
        await this.subscriptionRepository.save({
          userId,
          platform,
          tier,
          status: 'active',
          startDate: startTime,
          endDate: endTime,
          autoRenew: isAutoRenewing,
          originalTransactionId,
          purchaseToken: receipt,
        });
      }

      await this.userRepository.update(userId, { hasDiscoveryAccess: true });

      this.logger.log(
        `Successfully verified ${platform} subscription for user ${userId}: ${tier}`,
      );

      // 8. Return success
      return {
        success: true,
        subscription: {
          tier,
          platform,
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

  /**
   * Verify a StoreKit 2 JWS transaction signature
   * This is the modern alternative to the legacy verifyReceipt endpoint
   */
  private async verifyJWSTransaction(
    userId: string,
    jwsTransaction: string,
    productId: string,
  ): Promise<{
    success: boolean;
    subscription?: SubscriptionDetails;
    error?: string;
    details?: string;
  }> {
    if (!this.appleVerifier) {
      throw new InternalServerErrorException(
        'Apple JWS verifier not initialized. Check APPLE_BUNDLE_ID and Apple Root CA certificate.',
      );
    }

    try {
      // Verify and decode the JWS transaction signature
      const transaction: JWSTransactionDecodedPayload =
        await this.appleVerifier.verifyAndDecodeTransaction(jwsTransaction);

      // Validate product ID matches
      if (transaction.productId !== productId) {
        throw new BadRequestException(
          `Product ID mismatch: expected ${productId}, got ${transaction.productId}`,
        );
      }

      // Extract subscription details
      const expiresDate = transaction.expiresDate
        ? new Date(transaction.expiresDate)
        : null;
      const purchaseDate = transaction.purchaseDate
        ? new Date(transaction.purchaseDate)
        : new Date();
      const originalTransactionId = transaction.originalTransactionId;

      if (!expiresDate) {
        throw new BadRequestException(
          'Transaction does not contain an expiry date',
        );
      }

      if (expiresDate <= new Date()) {
        throw new BadRequestException('Transaction has expired');
      }

      // For auto-renew status, we'd need the renewal info JWS token
      // Since we only have the transaction, assume true for active subscriptions
      const isAutoRenewing = true;

      const tier = productId;

      // Upsert subscription record
      const existingSubscription = await this.subscriptionRepository.findOne({
        where: { user: { id: userId } },
      });

      if (existingSubscription) {
        await this.subscriptionRepository.update(existingSubscription.id, {
          platform: 'ios',
          tier,
          status: 'active',
          startDate: purchaseDate,
          endDate: expiresDate,
          autoRenew: isAutoRenewing,
          originalTransactionId,
          purchaseToken: jwsTransaction.substring(0, 255), // Store truncated for reference
        });
      } else {
        await this.subscriptionRepository.save({
          userId,
          platform: 'ios',
          tier,
          status: 'active',
          startDate: purchaseDate,
          endDate: expiresDate,
          autoRenew: isAutoRenewing,
          originalTransactionId,
          purchaseToken: jwsTransaction.substring(0, 255),
        });
      }

      await this.userRepository.update(userId, { hasDiscoveryAccess: true });

      this.logger.log(
        `Successfully verified StoreKit 2 subscription for user ${userId}: ${tier} (expires: ${expiresDate.toISOString()})`,
      );

      return {
        success: true,
        subscription: {
          tier,
          platform: 'ios',
          startDate: purchaseDate.toISOString(),
          endDate: expiresDate.toISOString(),
          autoRenew: isAutoRenewing,
        },
      };
    } catch (error) {
      this.logger.error('JWS transaction verification failed:', error);

      if (
        error instanceof BadRequestException ||
        error instanceof InternalServerErrorException
      ) {
        throw error;
      }

      throw new InternalServerErrorException({
        success: false,
        error: 'JWS verification failed',
        details: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }
}
