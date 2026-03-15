import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PubSub, Message } from '@google-cloud/pubsub';
import { google } from 'googleapis';
import { User } from '../users/entities/user.entity';
import { Subscription } from '../users/entities/subscription.entity';

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
    @InjectRepository(Subscription)
    private readonly subscriptionRepository: Repository<Subscription>,
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

    // Find subscription with this purchase token
    const subscription = await this.subscriptionRepository.findOne({
      where: { purchaseToken },
      relations: ['user'],
    });

    if (!subscription) {
      this.logger.error(
        `Subscription not found for purchase token: ${purchaseToken.substring(0, 10)}...`,
      );
      return;
    }

    const user = subscription.user;
    this.logger.log(
      `Processing notification type ${notificationType} for user ${user.id}`,
    );

    switch (notificationType) {
      case SubscriptionNotificationType.SUBSCRIPTION_RENEWED as number:
        await this.handleRenewed(subscription, subscriptionId, purchaseToken);
        break;

      case SubscriptionNotificationType.SUBSCRIPTION_CANCELED as number:
        await this.handleCanceled(subscription);
        break;

      case SubscriptionNotificationType.SUBSCRIPTION_EXPIRED as number:
        await this.handleExpired(subscription);
        break;

      case SubscriptionNotificationType.SUBSCRIPTION_IN_GRACE_PERIOD as number:
        await this.handleGracePeriod(subscription);
        break;

      case SubscriptionNotificationType.SUBSCRIPTION_ON_HOLD as number:
        await this.handleOnHold(subscription);
        break;

      case SubscriptionNotificationType.SUBSCRIPTION_RECOVERED as number:
        await this.handleRecovered(subscription, subscriptionId, purchaseToken);
        break;

      case SubscriptionNotificationType.SUBSCRIPTION_RESTARTED as number:
        await this.handleRestarted(subscription, subscriptionId, purchaseToken);
        break;

      case SubscriptionNotificationType.SUBSCRIPTION_REVOKED as number:
        await this.handleRevoked(subscription);
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
    subscription: Subscription,
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

      const googleSub = result.data;
      const newEndTime = new Date(parseInt(googleSub.expiryTimeMillis!));
      const isAutoRenewing = googleSub.autoRenewing === true;

      await this.subscriptionRepository.update(subscription.id, {
        endDate: newEndTime,
        status: 'active',
        autoRenew: isAutoRenewing,
      });

      this.logger.log(
        `Subscription renewed for user ${subscription.userId} until ${newEndTime.toISOString()}`,
      );
    } catch (error) {
      this.logger.error(
        `Failed to update renewed subscription for user ${subscription.userId}:`,
        error,
      );
    }
  }

  private async handleCanceled(subscription: Subscription) {
    await this.subscriptionRepository.update(subscription.id, {
      status: 'cancelled',
      autoRenew: false,
    });

    const expiryDate = subscription.endDate
      ? subscription.endDate.toISOString()
      : 'unknown';
    this.logger.log(
      `Subscription cancelled for user ${subscription.userId}. Will expire at: ${expiryDate}`,
    );
  }

  private async handleExpired(subscription: Subscription) {
    await this.subscriptionRepository.update(subscription.id, {
      status: 'expired',
    });

    await this.userRepository.update(subscription.userId, {
      hasDiscoveryAccess: false,
    });

    this.logger.log(`Subscription expired for user ${subscription.userId}`);
  }

  private async handleGracePeriod(subscription: Subscription) {
    await this.subscriptionRepository.update(subscription.id, {
      status: 'grace_period',
    });

    this.logger.log(
      `Subscription in grace period for user ${subscription.userId}. Access maintained.`,
    );
  }

  private async handleOnHold(subscription: Subscription) {
    await this.subscriptionRepository.update(subscription.id, {
      status: 'on_hold',
    });

    this.logger.log(
      `Subscription on hold for user ${subscription.userId}. Access maintained temporarily.`,
    );
  }

  private async handleRecovered(
    subscription: Subscription,
    subscriptionId: string,
    purchaseToken: string,
  ) {
    // Same as renewed - fetch latest details
    await this.handleRenewed(subscription, subscriptionId, purchaseToken);
    this.logger.log(`Subscription recovered for user ${subscription.userId}`);
  }

  private async handleRestarted(
    subscription: Subscription,
    subscriptionId: string,
    purchaseToken: string,
  ) {
    // Same as renewed - fetch latest details
    await this.handleRenewed(subscription, subscriptionId, purchaseToken);
    this.logger.log(`Subscription restarted for user ${subscription.userId}`);
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
}
