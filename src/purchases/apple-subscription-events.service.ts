import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  SignedDataVerifier,
  Environment,
  AppStoreServerAPIClient,
  JWSTransactionDecodedPayload,
  JWSRenewalInfoDecodedPayload,
} from '@apple/app-store-server-library';
import { readFileSync } from 'fs';
import { User } from '../users/entities/user.entity';
import { Subscription } from '../users/entities/subscription.entity';
import { AppleNotification } from './entities/apple-notification.entity';

interface AppleNotificationPayload {
  notificationType: string;
  subtype?: string;
  notificationUUID: string;
  data?: {
    signedTransactionInfo?: string;
    signedRenewalInfo?: string;
    environment?: string;
    bundleId?: string;
  };
}

@Injectable()
export class AppleSubscriptionEventsService implements OnModuleInit {
  private readonly logger = new Logger(AppleSubscriptionEventsService.name);
  private verifier: SignedDataVerifier | null = null;
  private apiClient: AppStoreServerAPIClient | null = null;
  private isEnabled = false;

  constructor(
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    @InjectRepository(Subscription)
    private readonly subscriptionRepository: Repository<Subscription>,
    @InjectRepository(AppleNotification)
    private readonly appleNotificationRepository: Repository<AppleNotification>,
    private readonly configService: ConfigService,
  ) {}

  onModuleInit() {
    this.initializeAppleClient();
  }

  private initializeAppleClient() {
    const bundleId = this.configService.get<string>('APPLE_BUNDLE_ID');
    const appleEnv = this.configService.get<string>('APPLE_ENV') || 'Sandbox';
    const issuerId = this.configService.get<string>('APPLE_ISSUER_ID');
    const keyId = this.configService.get<string>('APPLE_KEY_ID');
    const privateKeyPath = this.configService.get<string>(
      'APPLE_PRIVATE_KEY_PATH',
    );

    if (!bundleId || !issuerId || !keyId || !privateKeyPath) {
      this.logger.warn(
        'Apple App Store Server Notifications not configured. iOS webhook listener disabled.',
      );
      this.logger.warn(
        'Required: APPLE_BUNDLE_ID, APPLE_ISSUER_ID, APPLE_KEY_ID, APPLE_PRIVATE_KEY_PATH',
      );
      return;
    }

    try {
      // Load Apple Root CA certificate for signature verification
      const certPath = 'src/purchases/certs/AppleRootCA-G3.cer';
      let appleRootCA: Buffer;
      try {
        appleRootCA = readFileSync(certPath);
      } catch {
        this.logger.warn(
          `Apple Root CA certificate not found at ${certPath}. Signature verification will fail.`,
        );
        return;
      }

      const environment =
        appleEnv === 'Production'
          ? Environment.PRODUCTION
          : Environment.SANDBOX;

      const appAppleId = this.configService.get<string>('APPLE_APP_ID');

      // Initialize verifier for webhook signature validation
      this.verifier = new SignedDataVerifier(
        [appleRootCA],
        true, // Enable online checks
        environment,
        bundleId,
        appAppleId ? Number(appAppleId) : undefined,
      );

      // Initialize API client for re-verification (required for production resilience)
      let privateKey: string;
      try {
        privateKey = readFileSync(privateKeyPath, 'utf-8');
      } catch (error) {
        this.logger.error(
          `Apple private key not found at ${privateKeyPath}. Check APPLE_PRIVATE_KEY_PATH.`,
          error,
        );
        throw error;
      }

      this.apiClient = new AppStoreServerAPIClient(
        privateKey,
        keyId,
        issuerId,
        bundleId,
        environment,
      );
      this.logger.log('Apple App Store Server API client initialized');

      this.isEnabled = true;
      this.logger.log(
        `Apple App Store Server Notifications listener enabled (${appleEnv})`,
      );
    } catch (error) {
      this.logger.error(
        'Failed to initialize Apple subscription event handler:',
        error,
      );
    }
  }

  async handleWebhook(signedPayload: string): Promise<void> {
    if (!this.isEnabled || !this.verifier) {
      throw new Error('Apple webhook handler not initialized');
    }

    try {
      // 1. Verify and decode the signed payload
      const notification =
        await this.verifier.verifyAndDecodeNotification(signedPayload);

      const { notificationUUID, notificationType, subtype, data } =
        notification;

      this.logger.log('Received Apple notification:', {
        notificationType,
        subtype,
        uuid: notificationUUID,
      });

      // 2. Check for duplicate (idempotency)
      const existing = await this.appleNotificationRepository.findOne({
        where: { notificationUUID },
      });

      if (existing) {
        this.logger.log(
          `Duplicate notification ${notificationUUID}, skipping processing`,
        );
        return;
      }

      // 3. Decode nested signed data if present
      let transactionInfo: JWSTransactionDecodedPayload | null = null;
      let renewalInfo: JWSRenewalInfoDecodedPayload | null = null;

      if (data?.signedTransactionInfo) {
        try {
          transactionInfo = await this.verifier.verifyAndDecodeTransaction(
            data.signedTransactionInfo,
          );
        } catch (error) {
          this.logger.error('Failed to verify transaction info:', error);
        }
      }

      if (data?.signedRenewalInfo) {
        try {
          renewalInfo = await this.verifier.verifyAndDecodeRenewalInfo(
            data.signedRenewalInfo,
          );
        } catch (error) {
          this.logger.error('Failed to verify renewal info:', error);
        }
      }

      // 4. Record notification as processed (idempotency)
      await this.appleNotificationRepository.save({
        notificationUUID,
        notificationType,
        originalTransactionId: transactionInfo?.originalTransactionId || null,
        rawPayload: JSON.stringify(notification),
      });

      // 5. Handle the notification
      await this.processNotification(
        notification as AppleNotificationPayload,
        transactionInfo,
        renewalInfo,
      );
    } catch (error) {
      this.logger.error('Failed to process Apple webhook:', error);
      throw error; // Re-throw so controller returns 400/500
    }
  }

  private async processNotification(
    notification: AppleNotificationPayload,
    transactionInfo: JWSTransactionDecodedPayload | null,
    renewalInfo: JWSRenewalInfoDecodedPayload | null,
  ) {
    const { notificationType, subtype } = notification;
    const originalTransactionId = transactionInfo?.originalTransactionId;

    if (!originalTransactionId) {
      this.logger.warn(
        `No originalTransactionId in notification ${notification.notificationUUID}`,
      );
      return;
    }

    // Find subscription by originalTransactionId
    const subscription = await this.subscriptionRepository.findOne({
      where: {
        platform: 'ios',
        originalTransactionId,
      },
      relations: ['user'],
    });

    // Handle case where notification arrives before /verify-receipt
    if (!subscription) {
      if (
        notificationType === 'SUBSCRIBED' ||
        notificationType === 'INITIAL_BUY'
      ) {
        this.logger.log(
          `Received ${notificationType} notification for transaction ${originalTransactionId.substring(0, 10)}... - will be handled by /verify-receipt endpoint`,
        );
        return;
      }

      this.logger.error(
        `Subscription not found for originalTransactionId: ${originalTransactionId.substring(0, 10)}...`,
      );
      return;
    }

    const user = subscription.user;
    this.logger.log(
      `Processing ${notificationType}${subtype ? `:${subtype}` : ''} for user ${user.id}`,
    );

    // Map notification types to actions
    switch (notificationType) {
      case 'DID_RENEW':
        await this.handleRenewed(subscription, transactionInfo, renewalInfo);
        break;

      case 'DID_CHANGE_RENEWAL_STATUS':
        await this.handleRenewalStatusChange(subscription, renewalInfo);
        break;

      case 'EXPIRED':
        await this.handleExpired(subscription, subtype);
        break;

      case 'DID_FAIL_TO_RENEW':
        await this.handleFailedRenewal(subscription, subtype);
        break;

      case 'GRACE_PERIOD_EXPIRED':
        await this.handleGracePeriodExpired(subscription);
        break;

      case 'SUBSCRIBED':
        // New subscriptions handled by /verify-receipt
        this.logger.log(`New subscription for user ${user.id}`);
        break;

      case 'REFUND':
      case 'REVOKE':
        await this.handleRevoked(subscription);
        break;

      case 'REFUND_REVERSED':
        await this.handleRefundReversed(subscription, transactionInfo);
        break;

      default:
        this.logger.warn(
          `Unhandled notification type: ${notificationType}${subtype ? `:${subtype}` : ''}`,
        );
    }
  }

  private async handleRenewed(
    subscription: Subscription,
    transactionInfo: JWSTransactionDecodedPayload | null,
    renewalInfo: JWSRenewalInfoDecodedPayload | null,
  ) {
    try {
      // Re-verify with Apple API for fresh data (like Android re-fetches from Google)
      let freshExpiresDate: Date | null = null;
      let freshAutoRenew = false;

      if (this.apiClient && transactionInfo?.originalTransactionId) {
        try {
          const statuses = await this.apiClient.getAllSubscriptionStatuses(
            transactionInfo.originalTransactionId,
          );

          // Get latest transaction from the response
          const lastTransaction =
            statuses.data?.[0]?.lastTransactions?.[0]?.signedTransactionInfo;

          if (lastTransaction && this.verifier) {
            const freshTransaction =
              await this.verifier.verifyAndDecodeTransaction(lastTransaction);
            freshExpiresDate = freshTransaction.expiresDate
              ? new Date(freshTransaction.expiresDate)
              : null;
          }

          const renewalStatus =
            statuses.data?.[0]?.lastTransactions?.[0]?.signedRenewalInfo;
          if (renewalStatus && this.verifier) {
            const freshRenewal =
              await this.verifier.verifyAndDecodeRenewalInfo(renewalStatus);
            freshAutoRenew = freshRenewal.autoRenewStatus === 1;
          }

          this.logger.log(
            `Re-verified subscription from Apple API for user ${subscription.userId}`,
          );
        } catch (apiError) {
          this.logger.warn(
            `Failed to re-verify with Apple API, falling back to webhook data:`,
            apiError,
          );
        }
      }

      // Use fresh data if available, otherwise fall back to webhook data
      const expiresDate =
        freshExpiresDate ||
        (transactionInfo?.expiresDate
          ? new Date(transactionInfo.expiresDate)
          : null);
      const autoRenewStatus = this.apiClient
        ? freshAutoRenew
        : renewalInfo?.autoRenewStatus === 1;

      if (!expiresDate) {
        this.logger.error('No expiry date in renewed transaction info');
        return;
      }

      await this.subscriptionRepository.update(subscription.id, {
        endDate: expiresDate,
        status: 'active',
        autoRenew: autoRenewStatus,
      });

      await this.userRepository.update(subscription.userId, {
        hasDiscoveryAccess: true,
      });

      this.logger.log(
        `Subscription renewed for user ${subscription.userId} until ${expiresDate.toISOString()}`,
      );
    } catch (error) {
      this.logger.error(
        `Failed to update renewed subscription for user ${subscription.userId}:`,
        error,
      );
    }
  }

  private async handleRenewalStatusChange(
    subscription: Subscription,
    renewalInfo: JWSRenewalInfoDecodedPayload | null,
  ) {
    const autoRenewEnabled = renewalInfo?.autoRenewStatus === 1;

    await this.subscriptionRepository.update(subscription.id, {
      autoRenew: autoRenewEnabled,
      status: autoRenewEnabled ? subscription.status : 'cancelled',
    });

    this.logger.log(
      `Auto-renew ${autoRenewEnabled ? 'enabled' : 'disabled'} for user ${subscription.userId}`,
    );
  }

  private async handleExpired(subscription: Subscription, subtype?: string) {
    // Different expiry reasons
    const status =
      subtype === 'VOLUNTARY' || subtype === 'BILLING_RETRY'
        ? 'expired'
        : 'expired';

    await this.subscriptionRepository.update(subscription.id, {
      status,
    });

    await this.userRepository.update(subscription.userId, {
      hasDiscoveryAccess: false,
    });

    this.logger.log(
      `Subscription expired for user ${subscription.userId} (${subtype || 'no subtype'})`,
    );
  }

  private async handleFailedRenewal(
    subscription: Subscription,
    subtype?: string,
  ) {
    if (subtype === 'GRACE_PERIOD') {
      await this.subscriptionRepository.update(subscription.id, {
        status: 'grace_period',
      });
      this.logger.log(
        `Subscription in grace period for user ${subscription.userId}. Access maintained.`,
      );
    } else {
      await this.subscriptionRepository.update(subscription.id, {
        status: 'billing_retry',
      });
      this.logger.log(
        `Subscription renewal failed for user ${subscription.userId}. In billing retry.`,
      );
    }
  }

  private async handleGracePeriodExpired(subscription: Subscription) {
    await this.subscriptionRepository.update(subscription.id, {
      status: 'expired',
    });

    await this.userRepository.update(subscription.userId, {
      hasDiscoveryAccess: false,
    });

    this.logger.log(
      `Grace period expired for user ${subscription.userId}. Access removed.`,
    );
  }

  private async handleRevoked(subscription: Subscription) {
    await this.subscriptionRepository.update(subscription.id, {
      status: 'revoked',
      autoRenew: false,
    });

    await this.userRepository.update(subscription.userId, {
      hasDiscoveryAccess: false,
    });

    this.logger.log(
      `Subscription revoked for user ${subscription.userId}. Access removed.`,
    );
  }

  private async handleRefundReversed(
    subscription: Subscription,
    transactionInfo: JWSTransactionDecodedPayload | null,
  ) {
    // Refund was reversed, restore subscription
    const expiresDate = transactionInfo?.expiresDate
      ? new Date(transactionInfo.expiresDate)
      : null;

    if (expiresDate && expiresDate > new Date()) {
      await this.subscriptionRepository.update(subscription.id, {
        status: 'active',
        endDate: expiresDate,
      });

      await this.userRepository.update(subscription.userId, {
        hasDiscoveryAccess: true,
      });

      this.logger.log(
        `Refund reversed, subscription restored for user ${subscription.userId}`,
      );
    }
  }
}
