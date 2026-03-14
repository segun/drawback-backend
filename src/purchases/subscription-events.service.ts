import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PubSub, Message } from '@google-cloud/pubsub';
import { google } from 'googleapis';
import { User } from '../users/entities/user.entity';

export enum SubscriptionNotificationType {
  SUBSCRIPTION_RECOVERED = 1,
  SUBSCRIPTION_RENEWED = 2,
  SUBSCRIPTION_CANCELED = 3,
  SUBSCRIPTION_PURCHASED = 4,
  SUBSCRIPTION_ON_HOLD = 5,
  SUBSCRIPTION_IN_GRACE_PERIOD = 6,
  SUBSCRIPTION_RESTARTED = 7,
  SUBSCRIPTION_PRICE_CHANGE_CONFIRMED = 10,
  SUBSCRIPTION_REVOKED = 12,
  SUBSCRIPTION_EXPIRED = 13,
}

interface SubscriptionNotificationData {
  version: string;
  packageName: string;
  eventTimeMillis: string;
  subscriptionNotification?: {
    version: string;
    notificationType: number;
    purchaseToken: string;
    subscriptionId: string;
  };
}

@Injectable()
export class SubscriptionEventsService implements OnModuleInit {
  private readonly logger = new Logger(SubscriptionEventsService.name);
  private pubsubClient: PubSub | null = null;
  private isEnabled = false;

  constructor(
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    private readonly configService: ConfigService,
  ) {}

  onModuleInit() {
    void this.initializePubSub();
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  private async initializePubSub() {
    const projectId = this.configService.get<string>('GOOGLE_CLOUD_PROJECT_ID');
    const subscriptionName = this.configService.get<string>(
      'GOOGLE_PUBSUB_SUBSCRIPTION',
    );
    const credentialsPath = this.configService.get<string>(
      'GOOGLE_APPLICATION_CREDENTIALS',
    );

    // Only initialize if all required config is present
    if (!projectId || !subscriptionName || !credentialsPath) {
      this.logger.warn(
        'Google Cloud Pub/Sub not configured. Subscription event listener disabled.',
      );
      this.logger.warn(
        'Required: GOOGLE_CLOUD_PROJECT_ID, GOOGLE_PUBSUB_SUBSCRIPTION, GOOGLE_APPLICATION_CREDENTIALS',
      );
      return;
    }

    try {
      this.pubsubClient = new PubSub({
        projectId,
        keyFilename: credentialsPath,
      });

      this.isEnabled = true;
      this.startListener();
    } catch (error) {
      this.logger.error('Failed to initialize Pub/Sub client:', error);
    }
  }

  private startListener() {
    if (!this.pubsubClient || !this.isEnabled) {
      return;
    }

    const subscriptionName = this.configService.get<string>(
      'GOOGLE_PUBSUB_SUBSCRIPTION',
    )!;

    try {
      const subscription = this.pubsubClient.subscription(subscriptionName);

      subscription.on('message', (message: Message) => {
        void this.handleMessage(message);
      });

      subscription.on('error', (error) => {
        this.logger.error('Pub/Sub subscription error:', error);
      });

      this.logger.log(
        `Listening for subscription notifications on: ${subscriptionName}`,
      );
    } catch (error) {
      this.logger.error('Failed to start Pub/Sub listener:', error);
      this.isEnabled = false;
    }
  }

  private async handleMessage(message: Message) {
    try {
      const data = JSON.parse(
        message.data.toString(),
      ) as SubscriptionNotificationData;

      this.logger.log('Received subscription notification:', {
        packageName: data.packageName,
        notificationType:
          data.subscriptionNotification?.notificationType || 'unknown',
      });

      if (data.subscriptionNotification) {
        await this.handleSubscriptionNotification(
          data.subscriptionNotification,
        );
      }

      // Acknowledge the message
      message.ack();
    } catch (error) {
      this.logger.error('Error processing subscription notification:', error);
      // Negative acknowledge - message will be redelivered
      message.nack();
    }
  }

  private async handleSubscriptionNotification(notification: {
    notificationType: number;
    purchaseToken: string;
    subscriptionId: string;
  }) {
    const { notificationType, purchaseToken, subscriptionId } = notification;

    // Find user with this purchase token
    const user = await this.userRepository.findOne({
      where: { purchaseToken },
    });

    if (!user) {
      this.logger.error(
        `User not found for purchase token: ${purchaseToken.substring(0, 10)}...`,
      );
      return;
    }

    this.logger.log(
      `Processing notification type ${notificationType} for user ${user.id}`,
    );

    switch (notificationType) {
      case SubscriptionNotificationType.SUBSCRIPTION_RENEWED as number:
        await this.handleRenewed(user, subscriptionId, purchaseToken);
        break;

      case SubscriptionNotificationType.SUBSCRIPTION_CANCELED as number:
        await this.handleCanceled(user);
        break;

      case SubscriptionNotificationType.SUBSCRIPTION_EXPIRED as number:
        await this.handleExpired(user);
        break;

      case SubscriptionNotificationType.SUBSCRIPTION_IN_GRACE_PERIOD as number:
        await this.handleGracePeriod(user);
        break;

      case SubscriptionNotificationType.SUBSCRIPTION_ON_HOLD as number:
        await this.handleOnHold(user);
        break;

      case SubscriptionNotificationType.SUBSCRIPTION_RECOVERED as number:
        await this.handleRecovered(user, subscriptionId, purchaseToken);
        break;

      case SubscriptionNotificationType.SUBSCRIPTION_RESTARTED as number:
        await this.handleRestarted(user, subscriptionId, purchaseToken);
        break;

      case SubscriptionNotificationType.SUBSCRIPTION_REVOKED as number:
        await this.handleRevoked(user);
        break;

      case SubscriptionNotificationType.SUBSCRIPTION_PURCHASED as number:
        // New purchases are handled by the verify endpoint
        this.logger.log(`New subscription purchase for user ${user.id}`);
        break;

      default:
        this.logger.warn(`Unhandled notification type: ${notificationType}`);
    }
  }

  private async handleRenewed(
    user: User,
    subscriptionId: string,
    purchaseToken: string,
  ) {
    try {
      // Fetch updated subscription details from Google
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

      const result = await androidPublisher.purchases.subscriptions.get({
        packageName: this.configService.get<string>('GOOGLE_PACKAGE_NAME')!,
        subscriptionId,
        token: purchaseToken,
      });

      const subscription = result.data;
      const newEndTime = new Date(parseInt(subscription.expiryTimeMillis!));
      const isAutoRenewing = subscription.autoRenewing === true;

      await this.userRepository.update(user.id, {
        subscriptionEndDate: newEndTime,
        subscriptionStatus: 'active',
        subscriptionAutoRenew: isAutoRenewing,
      });

      this.logger.log(
        `Subscription renewed for user ${user.id} until ${newEndTime.toISOString()}`,
      );
    } catch (error) {
      this.logger.error(
        `Failed to update renewed subscription for user ${user.id}:`,
        error,
      );
    }
  }

  private async handleCanceled(user: User) {
    await this.userRepository.update(user.id, {
      subscriptionStatus: 'cancelled',
      subscriptionAutoRenew: false,
    });

    // TypeORM returns Date | null for datetime columns
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const endDate = user.subscriptionEndDate as Date | null;
    const expiryDate =
      endDate && endDate instanceof Date ? endDate.toISOString() : 'unknown';
    this.logger.log(
      `Subscription cancelled for user ${user.id}. Will expire at: ${expiryDate}`,
    );
  }

  private async handleExpired(user: User) {
    await this.userRepository.update(user.id, {
      subscriptionStatus: 'expired',
      hasDiscoveryAccess: false,
    });

    this.logger.log(`Subscription expired for user ${user.id}`);
  }

  private async handleGracePeriod(user: User) {
    await this.userRepository.update(user.id, {
      subscriptionStatus: 'grace_period',
    });

    this.logger.log(
      `Subscription in grace period for user ${user.id}. Access maintained.`,
    );
  }

  private async handleOnHold(user: User) {
    await this.userRepository.update(user.id, {
      subscriptionStatus: 'on_hold',
    });

    this.logger.log(
      `Subscription on hold for user ${user.id}. Access maintained temporarily.`,
    );
  }

  private async handleRecovered(
    user: User,
    subscriptionId: string,
    purchaseToken: string,
  ) {
    // Same as renewed - fetch latest details
    await this.handleRenewed(user, subscriptionId, purchaseToken);
    this.logger.log(`Subscription recovered for user ${user.id}`);
  }

  private async handleRestarted(
    user: User,
    subscriptionId: string,
    purchaseToken: string,
  ) {
    // Same as renewed - fetch latest details
    await this.handleRenewed(user, subscriptionId, purchaseToken);
    this.logger.log(`Subscription restarted for user ${user.id}`);
  }

  private async handleRevoked(user: User) {
    await this.userRepository.update(user.id, {
      subscriptionStatus: 'revoked',
      subscriptionAutoRenew: false,
      hasDiscoveryAccess: false,
    });

    this.logger.log(
      `Subscription revoked for user ${user.id}. Access removed.`,
    );
  }
}
