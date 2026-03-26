import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as admin from 'firebase-admin';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { CacheService } from '../cache/cache.service';
import { PushToken } from './entities/push-token.entity';
import { PushProvider } from './enums/push-provider.enum';
import { RegisterPushTokenDto } from './dto/register-push-token.dto';
import { DeactivatePushTokenDto } from './dto/deactivate-push-token.dto';

@Injectable()
export class NotificationsService implements OnModuleInit {
  private readonly logger = new Logger(NotificationsService.name);
  private firebaseApp: admin.app.App | null = null;
  private missingFirebaseConfigWarned = false;

  constructor(
    @InjectRepository(PushToken)
    private readonly pushTokenRepository: Repository<PushToken>,
    private readonly configService: ConfigService,
    private readonly cacheService: CacheService,
  ) {}

  onModuleInit(): void {
    const pushEnabled = this.isPushEnabled();
    if (!pushEnabled) {
      return;
    }

    const serviceAccountPath = this.configService.get<string>(
      'FIREBASE_SERVICE_ACCOUNT_JSON',
    );

    this.logger.debug(
      `Initializing Firebase Admin SDK for push notifications (enabled=${pushEnabled}, serviceAccountPath=${serviceAccountPath ? '[provided]' : '[not provided]'})`,
    );

    if (admin.apps.length > 0) {
      this.firebaseApp = admin.apps[0]!;
      return;
    }

    try {
      if (serviceAccountPath) {
        const serviceAccount =
          this.loadServiceAccountFromPath(serviceAccountPath);
        this.firebaseApp = admin.initializeApp({
          credential: admin.credential.cert(serviceAccount),
        });
      } else {
        // Fallback to ADC (e.g. GOOGLE_APPLICATION_CREDENTIALS) when explicit JSON is not provided.
        this.firebaseApp = admin.initializeApp({
          credential: admin.credential.applicationDefault(),
        });
      }
      this.logger.log('Firebase Admin SDK initialised');
    } catch (err) {
      this.logger.error(
        'Failed to initialise Firebase Admin SDK. Set FIREBASE_SERVICE_ACCOUNT_JSON to a valid JSON file path or configure GOOGLE_APPLICATION_CREDENTIALS.',
        err,
      );
    }
  }

  async registerToken(
    userId: string,
    dto: RegisterPushTokenDto,
  ): Promise<void> {
    const existingByToken = await this.pushTokenRepository.findOne({
      where: { provider: dto.provider, token: dto.token },
    });
    const existingForUserProvider = await this.pushTokenRepository.findOne({
      where: { userId, provider: dto.provider },
    });

    const now = new Date();

    // Reuse a token row if it already exists globally (provider+token is unique).
    if (existingByToken) {
      if (
        existingForUserProvider &&
        existingForUserProvider.id !== existingByToken.id
      ) {
        await this.pushTokenRepository.delete({
          id: existingForUserProvider.id,
        });
      }

      existingByToken.userId = userId;
      existingByToken.platform = dto.platform;
      existingByToken.deviceId = dto.deviceId;
      existingByToken.active = true;
      existingByToken.deactivationReason = null;
      existingByToken.lastSeenAt = now;
      await this.pushTokenRepository.save(existingByToken);
      return;
    }

    if (existingForUserProvider) {
      existingForUserProvider.token = dto.token;
      existingForUserProvider.platform = dto.platform;
      existingForUserProvider.deviceId = dto.deviceId;
      existingForUserProvider.active = true;
      existingForUserProvider.deactivationReason = null;
      existingForUserProvider.lastSeenAt = now;
      await this.pushTokenRepository.save(existingForUserProvider);
      return;
    }

    const pushToken = this.pushTokenRepository.create({
      userId,
      provider: dto.provider,
      token: dto.token,
      platform: dto.platform,
      deviceId: dto.deviceId,
      active: true,
      lastSeenAt: now,
    });
    await this.pushTokenRepository.save(pushToken);
    this.logger.log(
      `push.token.created: userId=${userId} provider=${dto.provider} platform=${dto.platform} token=${dto.token.slice(0, 8)}...`,
    );
  }

  async deactivateToken(
    userId: string,
    dto: DeactivatePushTokenDto,
  ): Promise<void> {
    const existing = await this.pushTokenRepository.findOne({
      where: { provider: dto.provider, token: dto.token, userId },
    });

    if (!existing) {
      return; // idempotent
    }

    await this.pushTokenRepository.delete({ id: existing.id });
  }

  async sendChatRequestPush(
    recipientUserId: string,
    payload: {
      requestId: string;
      senderUserId: string;
      senderName: string;
      messageId: string;
    },
  ): Promise<void> {
    if (!this.canSendPush()) {
      return;
    }

    const cooldownKey = `push:chat-request:${payload.senderUserId}:${recipientUserId}`;
    const cooldownToken = await this.cacheService.acquireLock(cooldownKey, 60);
    if (!cooldownToken) {
      this.logger.warn(
        `push.chat-request.rate-limited: from=${payload.senderUserId} to=${recipientUserId} requestId=${payload.requestId}`,
      );
      return;
    }

    const tokens = await this.pushTokenRepository.find({
      where: {
        userId: recipientUserId,
        active: true,
        provider: PushProvider.FCM,
      },
      order: { updatedAt: 'DESC' },
      take: 1,
    });

    if (tokens.length === 0) {
      return;
    }

    for (const pushToken of tokens) {
      const sent = await this.sendFcmMessage(pushToken, {
        notification: {
          title: 'DrawBack Request',
          body: `${payload.senderName} sent you a draw request`,
        },
        data: {
          schemaVersion: '1',
          type: 'request_received',
          requestId: payload.requestId,
          senderName: payload.senderName,
          route: 'pending_request',
          messageId: payload.messageId,
        },
        requestId: payload.requestId,
        messageId: payload.messageId,
      });

      if (sent) {
        this.logger.log(
          `push.sent: type=request_received from=${payload.senderUserId} to=${recipientUserId} requestId=${payload.requestId} messageId=${payload.messageId}`,
        );
      }
    }
  }

  async sendPeerWaitingPush(
    recipientUserId: string,
    payload: {
      requestId: string;
      roomId: string;
      waitingUserId: string;
      waitingUserName?: string;
    },
  ): Promise<void> {
    if (!this.canSendPush()) {
      return;
    }

    const tokens = await this.pushTokenRepository.find({
      where: {
        userId: recipientUserId,
        active: true,
        provider: PushProvider.FCM,
      },
      order: { updatedAt: 'DESC' },
      take: 1,
    });

    if (tokens.length === 0) {
      return;
    }

    const waitingName = payload.waitingUserName || 'Your peer';
    const messageId = `wait-${payload.requestId}-${payload.waitingUserId}`;

    for (const pushToken of tokens) {
      const sent = await this.sendFcmMessage(pushToken, {
        notification: {
          title: 'DrawBack Request',
          body: `${waitingName} is waiting in the chat room`,
        },
        data: {
          schemaVersion: '1',
          type: 'peer_waiting',
          requestId: payload.requestId,
          roomId: payload.roomId,
          waitingUserId: payload.waitingUserId,
          route: 'chat_room',
          messageId,
        },
        requestId: payload.requestId,
        messageId,
      });

      if (sent) {
        this.logger.log(
          `push.sent: type=peer_waiting from=${payload.waitingUserId} to=${recipientUserId} requestId=${payload.requestId} messageId=${messageId}`,
        );
      }
    }
  }

  private async sendFcmMessage(
    pushToken: PushToken,
    payload: {
      requestId: string;
      messageId: string;
      notification: { title: string; body: string };
      data: Record<string, string>;
    },
  ): Promise<boolean> {
    const redactedToken = `${pushToken.token.slice(0, 8)}...`;

    const message: admin.messaging.Message = {
      token: pushToken.token,
      notification: payload.notification,
      data: payload.data,
      android: {
        priority: 'high',
      },
      apns: {
        headers: {
          'apns-priority': '10',
        },
        payload: {
          aps: {
            sound: 'default',
            contentAvailable: true,
          },
        },
      },
    };

    const attemptSend = async (): Promise<string> => {
      return this.firebaseApp!.messaging().send(message);
    };

    const isInvalidTokenError = (err: unknown): boolean => {
      const code = (err as { code?: string }).code ?? '';
      return (
        code === 'messaging/invalid-registration-token' ||
        code === 'messaging/registration-token-not-registered'
      );
    };

    const isRetryableMessagingError = (err: unknown): boolean => {
      const code = (err as { code?: string }).code ?? '';
      return (
        code === 'messaging/internal-error' ||
        code === 'messaging/server-unavailable' ||
        code === 'messaging/unknown-error'
      );
    };

    try {
      await attemptSend();
      return true;
    } catch (err) {
      if (isInvalidTokenError(err)) {
        this.logger.warn(
          `push.token.invalidated: token=${redactedToken} requestId=${payload.requestId}`,
        );
        await this.pushTokenRepository.delete({ id: pushToken.id });
        return false;
      }

      if (!isRetryableMessagingError(err)) {
        this.logger.error(
          `push.send.failure (non-retryable): token=${redactedToken} requestId=${payload.requestId}`,
          err,
        );
        return false;
      }

      // Transient error — one retry after 1 s
      this.logger.warn(
        `push.send.failure (transient, retrying): token=${redactedToken} requestId=${payload.requestId}`,
        err,
      );
      await new Promise((resolve) => setTimeout(resolve, 1000));
      try {
        await attemptSend();
        return true;
      } catch (retryErr) {
        this.logger.error(
          `push.send.failure (final): token=${redactedToken} requestId=${payload.requestId}`,
          retryErr,
        );
        return false;
      }
    }
  }

  private isPushEnabled(): boolean {
    return (
      this.configService.get<string>('PUSH_NOTIFICATIONS_ENABLED') === 'true'
    );
  }

  private canSendPush(): boolean {
    if (!this.isPushEnabled()) {
      return false;
    }

    if (!this.firebaseApp) {
      if (!this.missingFirebaseConfigWarned) {
        this.logger.warn(
          'Push notifications enabled but Firebase is not initialised. Configure FIREBASE_SERVICE_ACCOUNT_JSON or GOOGLE_APPLICATION_CREDENTIALS.',
        );
        this.missingFirebaseConfigWarned = true;
      }
      return false;
    }

    return true;
  }

  private loadServiceAccountFromPath(inputPath: string): admin.ServiceAccount {
    const trimmedPath = inputPath.trim();
    const resolvedPath = path.isAbsolute(trimmedPath)
      ? trimmedPath
      : path.resolve(process.cwd(), trimmedPath);
    const fileContent = fs.readFileSync(resolvedPath, 'utf8');
    return JSON.parse(fileContent) as admin.ServiceAccount;
  }
}
