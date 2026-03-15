import {
  ConflictException,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
  forwardRef,
  Inject,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} from '@simplewebauthn/server';
import { isoBase64URL } from '@simplewebauthn/server/helpers';
import type {
  VerifiedRegistrationResponse,
  VerifiedAuthenticationResponse,
} from '@simplewebauthn/server';
import * as bcrypt from 'bcrypt';
import { randomUUID } from 'crypto';
import { Repository } from 'typeorm';
import { CacheService } from '../cache/cache.service';
import { MailService } from '../mail/mail.service';
import { User } from '../users/entities/user.entity';
import { UserMode } from '../users/enums/user-mode.enum';
import { UsersService } from '../users/users.service';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { LoginDto } from './dto/login.dto';
import {
  FinishPasskeyRegistrationDto,
  FinishPasskeyLoginDto,
  StartPasskeyLoginDto,
} from './dto/passkey.dto';
import { RegisterDto } from './dto/register.dto';
import { ResendConfirmationDto } from './dto/resend-confirmation.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { Credential } from './entities/credential.entity';
import { JwtPayload } from './interfaces/jwt-payload.interface';

@Injectable()
export class AuthService {
  /** How long (hours) an activation token remains valid. */
  static readonly ACTIVATION_TOKEN_TTL_HOURS = 24;

  /** Challenge TTL in seconds (5 minutes) */
  private static readonly CHALLENGE_TTL_SECONDS = 300;

  private readonly logger = new Logger(AuthService.name);

  constructor(
    @InjectRepository(User)
    private readonly usersRepository: Repository<User>,
    @InjectRepository(Credential)
    private readonly credentialsRepository: Repository<Credential>,
    private readonly jwtService: JwtService,
    private readonly cacheService: CacheService,
    private readonly mailService: MailService,
    private readonly configService: ConfigService,
    @Inject(forwardRef(() => UsersService))
    private readonly usersService: UsersService,
  ) {}

  async register(dto: RegisterDto): Promise<{ message: string }> {
    const emailTaken = await this.usersRepository.findOne({
      where: { email: dto.email.toLowerCase() },
    });
    if (emailTaken) {
      throw new ConflictException('Email is already in use');
    }

    const nameTaken = await this.usersRepository.findOne({
      where: { displayName: dto.displayName.toLowerCase() },
    });
    if (nameTaken) {
      throw new ConflictException('Display name is already taken');
    }

    const passwordHash = await bcrypt.hash(dto.password, 12);
    const activationToken = randomUUID();
    const activationTokenExpiry = new Date(
      Date.now() + AuthService.ACTIVATION_TOKEN_TTL_HOURS * 60 * 60 * 1000,
    );

    const user = this.usersRepository.create({
      email: dto.email.toLowerCase(),
      passwordHash,
      displayName: dto.displayName.toLowerCase(),
      isActivated: false,
      activationToken,
      activationTokenExpiry,
      mode: UserMode.PRIVATE,
    });

    await this.usersRepository.save(user);
    await this.mailService.sendActivationEmail(
      user.email,
      activationToken,
      user.displayName,
    );

    return {
      message:
        'Registration successful. Please check your email to activate your account.',
    };
  }

  async confirmEmail(token: string): Promise<{
    success: boolean;
    email: string | null;
    tempToken?: string;
    reason?: string;
  }> {
    const user = await this.usersRepository.findOne({
      where: { activationToken: token },
    });

    if (!user) {
      return {
        success: false,
        email: null,
        reason: 'Invalid or expired activation token',
      };
    }

    if (user.isActivated) {
      return {
        success: false,
        email: user.email,
        reason: 'Account is already activated',
      };
    }

    if (user.activationTokenExpiry && user.activationTokenExpiry < new Date()) {
      return {
        success: false,
        email: user.email,
        reason: 'Activation token has expired',
      };
    }

    user.isActivated = true;
    user.activationToken = null;
    user.activationTokenExpiry = null;
    await this.usersRepository.save(user);

    // Generate a temp token for optional passkey setup (24 hour expiry)
    const payload: JwtPayload = {
      sub: user.id,
      email: user.email,
      displayName: user.displayName,
      role: user.role as string,
    };
    const tempToken = this.jwtService.sign(payload, {
      expiresIn: '24h',
    });

    return { success: true, email: user.email, tempToken };
  }

  async resendConfirmationEmail(
    dto: ResendConfirmationDto,
  ): Promise<{ message: string }> {
    const generic = {
      message:
        'If that email exists and is unactivated, a new confirmation link has been sent.',
    };

    const user = await this.usersRepository.findOne({
      where: { email: dto.email.toLowerCase() },
    });

    if (!user || user.isActivated) {
      return generic;
    }

    user.activationToken = randomUUID();
    user.activationTokenExpiry = new Date(
      Date.now() + AuthService.ACTIVATION_TOKEN_TTL_HOURS * 60 * 60 * 1000,
    );
    await this.usersRepository.save(user);
    await this.mailService.sendActivationEmail(
      user.email,
      user.activationToken,
      user.displayName,
    );

    return generic;
  }

  async isDisplayNameAvailable(
    displayName: string,
  ): Promise<{ available: boolean }> {
    // Delegate to UsersService to avoid duplicate logic
    return this.usersService.isDisplayNameAvailable(displayName);
  }

  /** How long (hours) a password-reset token remains valid. */
  static readonly RESET_TOKEN_TTL_HOURS = 1;

  async forgotPassword(dto: ForgotPasswordDto): Promise<{ message: string }> {
    const generic = {
      message: 'If that email exists, a password reset link has been sent.',
    };

    const user = await this.usersRepository.findOne({
      where: { email: dto.email.toLowerCase() },
    });

    // Respond generically to prevent email enumeration
    if (!user || !user.isActivated) {
      return generic;
    }

    const token = randomUUID();
    const expiryMs = AuthService.RESET_TOKEN_TTL_HOURS * 60 * 60 * 1000;
    user.resetToken = token;
    user.resetTokenExpiry = new Date(Date.now() + expiryMs);
    await this.usersRepository.save(user);

    await this.mailService.sendPasswordResetEmail(
      user.email,
      token,
      user.displayName,
      AuthService.RESET_TOKEN_TTL_HOURS,
    );

    return generic;
  }

  async resetPassword(
    dto: ResetPasswordDto,
  ): Promise<{ success: boolean; email: string | null; reason?: string }> {
    const user = await this.usersRepository.findOne({
      where: { resetToken: dto.token },
    });

    if (!user || !user.resetToken || !user.resetTokenExpiry) {
      return {
        success: false,
        email: null,
        reason: 'Invalid or expired reset token',
      };
    }

    if (user.resetTokenExpiry < new Date()) {
      return {
        success: false,
        email: user.email,
        reason: 'Reset token has expired',
      };
    }

    user.passwordHash = await bcrypt.hash(dto.password, 12);
    user.resetToken = null;
    user.resetTokenExpiry = null;
    await this.usersRepository.save(user);

    return { success: true, email: user.email };
  }

  async login(
    dto: LoginDto,
  ): Promise<{ accessToken: string; canAddPasskey?: boolean } | null> {
    const user = await this.usersRepository.findOne({
      where: { email: dto.email.toLowerCase() },
    });

    if (!user) {
      return null;
    }

    const passwordMatch = await bcrypt.compare(dto.password, user.passwordHash);
    if (!passwordMatch) {
      return null;
    }

    if (!user.isActivated) {
      throw new UnauthorizedException(
        'Account not activated. Please check your email.',
      );
    }

    if (user.isBlocked) {
      throw new ForbiddenException('Account has been blocked');
    }

    const payload: JwtPayload = {
      sub: user.id,
      email: user.email,
      displayName: user.displayName,
      role: user.role as string,
    };

    const accessToken = this.jwtService.sign(payload);

    // Check if user has any passkeys
    const credentialCount = await this.credentialsRepository.count({
      where: { userId: user.id },
    });
    const canAddPasskey = credentialCount === 0;

    return { accessToken, ...(canAddPasskey && { canAddPasskey: true }) };
  }

  /** How long (hours) a delete-account token remains valid. */
  static readonly DELETE_TOKEN_TTL_HOURS = 24;

  async requestAccountDeletion(
    userId: string,
  ): Promise<{ message: string } | null> {
    const user = await this.usersRepository.findOne({
      where: { id: userId },
    });

    if (!user) {
      return null;
    }

    // Generate deletion token and send email
    const token = randomUUID();
    const expiryMs = AuthService.DELETE_TOKEN_TTL_HOURS * 60 * 60 * 1000;
    user.deleteToken = token;
    user.deleteTokenExpiry = new Date(Date.now() + expiryMs);
    await this.usersRepository.save(user);

    await this.mailService.sendAccountDeletionEmail(
      user.email,
      token,
      user.displayName,
      AuthService.DELETE_TOKEN_TTL_HOURS,
    );

    return {
      message:
        'We have sent you an email with instructions to confirm account deletion. Please check your inbox. If you do not receive the email within a few minutes, please check your spam folder.',
    };
  }

  async loginAndDelete(dto: LoginDto): Promise<{ message: string } | null> {
    const user = await this.usersRepository.findOne({
      where: { email: dto.email.toLowerCase() },
    });

    if (!user) {
      return null;
    }

    const passwordMatch = await bcrypt.compare(dto.password, user.passwordHash);
    if (!passwordMatch) {
      return null;
    }

    // Use the shared method to request deletion
    const result = await this.requestAccountDeletion(user.id);
    if (!result) {
      return null;
    }

    return result;
  }

  async confirmDelete(
    token: string,
  ): Promise<{ success: boolean; email: string | null; reason?: string }> {
    const user = await this.usersRepository.findOne({
      where: { deleteToken: token },
    });

    if (!user || !user.deleteToken || !user.deleteTokenExpiry) {
      return {
        success: false,
        email: null,
        reason: 'Invalid or expired deletion token',
      };
    }

    if (user.deleteTokenExpiry < new Date()) {
      return {
        success: false,
        email: user.email,
        reason: 'Deletion token has expired',
      };
    }

    // Delete the account
    const userEmail = user.email;
    await this.usersService.deleteAccount(user.id);

    return { success: true, email: userEmail };
  }

  // ===== WebAuthn / Passkey Methods =====

  /**
   * Store a WebAuthn challenge in Redis with TTL.
   */
  private async storeChallenge(
    userId: string,
    challenge: string,
  ): Promise<void> {
    const key = `challenge:${userId}`;
    await this.cacheService.set(
      key,
      challenge,
      AuthService.CHALLENGE_TTL_SECONDS,
    );
  }

  /**
   * Retrieve a WebAuthn challenge from Redis.
   */
  private async getChallenge(userId: string): Promise<string | null> {
    const key = `challenge:${userId}`;
    return await this.cacheService.get<string>(key);
  }

  /**
   * Delete a WebAuthn challenge from Redis.
   */
  private async deleteChallenge(userId: string): Promise<void> {
    const key = `challenge:${userId}`;
    await this.cacheService.del(key);
  }

  /**
   * Start passkey registration for an authenticated user.
   * Generates registration options and stores challenge.
   */
  async startPasskeyRegistration(userId: string) {
    const user = await this.usersRepository.findOne({ where: { id: userId } });
    if (!user) {
      return null;
    }

    if (!user.isActivated) {
      throw new UnauthorizedException(
        'Account must be activated before registering passkeys',
      );
    }

    if (user.isBlocked) {
      throw new ForbiddenException('Account has been blocked');
    }

    const rpId = this.configService.get<string>('WEBAUTHN_RP_ID');
    const rpName = this.configService.get<string>('WEBAUTHN_RP_NAME');
    if (!rpId || !rpName) {
      throw new Error('WEBAUTHN_RP_ID and WEBAUTHN_RP_NAME must be configured');
    }

    const options = await generateRegistrationOptions({
      rpName,
      rpID: rpId,
      userName: user.email,
      userDisplayName: user.displayName,
      attestationType: 'none',
      authenticatorSelection: {
        // Allow both platform and cross-platform authenticators (configurable)
        userVerification: 'preferred',
        residentKey: 'preferred',
        requireResidentKey: false,
      },
      supportedAlgorithmIDs: [-7, -257],
    });

    // Store challenge in Redis with TTL
    await this.storeChallenge(userId, options.challenge);
    this.logger.log(`Passkey registration started for user ${userId}`);

    return options;
  }

  /**
   * Finish passkey registration by verifying attestation and saving credential.
   * Includes automatic cleanup of old unused credentials.
   */
  async finishPasskeyRegistration(
    userId: string,
    dto: FinishPasskeyRegistrationDto,
  ): Promise<{ success: boolean } | null> {
    const user = await this.usersRepository.findOne({ where: { id: userId } });
    if (!user) {
      return null;
    }

    const expectedChallenge = await this.getChallenge(userId);
    if (!expectedChallenge) {
      throw new BadRequestException(
        'No challenge found or challenge expired. Please try again.',
      );
    }

    const rpId = this.configService.get<string>('WEBAUTHN_RP_ID');
    const expectedOrigin = this.configService.get<string>('WEBAUTHN_ORIGIN');
    if (!rpId || !expectedOrigin) {
      throw new Error('WEBAUTHN_RP_ID and WEBAUTHN_ORIGIN must be configured');
    }
    const origins = expectedOrigin.split(',').map((o) => o.trim());

    let verification: VerifiedRegistrationResponse;
    try {
      verification = await verifyRegistrationResponse({
        response: dto.data,
        expectedChallenge,
        expectedOrigin: origins,
        expectedRPID: rpId,
      });
    } catch (error) {
      await this.deleteChallenge(userId);
      this.logger.error(
        `Passkey registration verification failed for user ${userId}: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
      throw new BadRequestException('Passkey verification failed');
    } finally {
      // Always clear challenge after verification attempt
      await this.deleteChallenge(userId);
    }

    if (!verification.verified || !verification.registrationInfo) {
      throw new BadRequestException('Passkey verification failed');
    }

    const { credential } = verification.registrationInfo;

    // Check if this credential already exists
    const existingCred = await this.credentialsRepository.findOne({
      where: { credentialId: Buffer.from(credential.id, 'base64url') },
    });
    if (existingCred) {
      throw new ConflictException('This passkey is already registered');
    }

    // Use transaction to ensure atomicity (save + cleanup + limit enforcement)
    const result = await this.credentialsRepository.manager.transaction(
      async (transactionalEntityManager) => {
        // Save the new credential with lastUsedAt set to prevent accidental cleanup
        const newCredential = transactionalEntityManager.create(Credential, {
          userId: user.id,
          credentialId: Buffer.from(credential.id, 'base64url'),
          publicKey: Buffer.from(credential.publicKey),
          counter: credential.counter,
          transports: credential.transports || null,
          lastUsedAt: new Date(), // Set to now to prevent cleanup
        });
        await transactionalEntityManager.save(newCredential);

        // Automatic cleanup: delete credentials unused for 90+ days
        const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
        const deleteResult = await transactionalEntityManager
          .createQueryBuilder()
          .delete()
          .from(Credential)
          .where('userId = :userId', { userId: user.id })
          .andWhere('lastUsedAt IS NOT NULL') // Only cleanup credentials that have been used
          .andWhere('lastUsedAt < :ninetyDaysAgo', { ninetyDaysAgo })
          .andWhere('id != :newCredId', { newCredId: newCredential.id })
          .execute();

        if (deleteResult.affected && deleteResult.affected > 0) {
          this.logger.log(
            `Deleted ${deleteResult.affected} old credential(s) for user ${userId}`,
          );
        }

        // Ensure we don't have more than 5 credentials total
        const allCreds = await transactionalEntityManager.find(Credential, {
          where: { userId: user.id },
          order: { createdAt: 'DESC' },
        });
        if (allCreds.length > 5) {
          const toDelete = allCreds.slice(5);
          await transactionalEntityManager.remove(toDelete);
          this.logger.log(
            `Removed ${toDelete.length} credential(s) to enforce 5-credential limit for user ${userId}`,
          );
        }

        return { success: true, credentialId: newCredential.id };
      },
    );

    this.logger.log(
      `Passkey registered successfully for user ${userId}, credentialId: ${result.credentialId}`,
    );

    return { success: true };
  }

  /**
   * Start passkey login by providing authentication options.
   * Fetches all user's credentials and includes them in allowCredentials.
   * Uses constant-time response to prevent user enumeration.
   */
  async startPasskeyLogin(dto: StartPasskeyLoginDto) {
    const user = await this.usersRepository.findOne({
      where: { email: dto.email.toLowerCase() },
    });

    // Always fetch credentials to prevent timing attacks
    const credentials = user
      ? await this.credentialsRepository.find({ where: { userId: user.id } })
      : [];

    // Generic error for all failure cases to prevent user enumeration
    if (
      !user ||
      !user.isActivated ||
      user.isBlocked ||
      credentials.length === 0
    ) {
      // Add artificial delay to match successful flow timing
      await new Promise((resolve) => setTimeout(resolve, 100));
      throw new UnauthorizedException(
        'Invalid credentials or no passkeys registered for this account.',
      );
    }

    const rpId = this.configService.get<string>('WEBAUTHN_RP_ID');
    if (!rpId) {
      throw new Error('WEBAUTHN_RP_ID must be configured');
    }

    const options = await generateAuthenticationOptions({
      rpID: rpId,
      allowCredentials: credentials.map((cred) => ({
        id: isoBase64URL.fromBuffer(Uint8Array.from(cred.credentialId)),
        transports: (cred.transports || []) as AuthenticatorTransport[],
      })),
      userVerification: 'preferred',
    });

    // Store challenge in Redis with TTL
    await this.storeChallenge(user.id, options.challenge);
    this.logger.log(`Passkey login attempt for user ${user.email}`);

    return options;
  }

  /**
   * Finish passkey login by verifying assertion and issuing JWT token.
   * Updates lastUsedAt and counter for the credential.
   */
  async finishPasskeyLogin(
    dto: FinishPasskeyLoginDto,
  ): Promise<{ accessToken: string } | null> {
    // Extract user ID from the response (it's in the user handle)
    const credentialIdBuffer = Buffer.from(dto.data.id, 'base64url');

    const credential = await this.credentialsRepository.findOne({
      where: { credentialId: credentialIdBuffer },
      relations: ['user'],
    });

    if (!credential) {
      return null;
    }

    const user = credential.user;
    if (!user.isActivated) {
      throw new UnauthorizedException(
        'Account not activated. Please check your email.',
      );
    }

    if (user.isBlocked) {
      throw new ForbiddenException('Account has been blocked');
    }

    const expectedChallenge = await this.getChallenge(user.id);
    if (!expectedChallenge) {
      throw new BadRequestException(
        'No challenge found or challenge expired. Please try again.',
      );
    }

    const rpId = this.configService.get<string>('WEBAUTHN_RP_ID');
    const expectedOrigin = this.configService.get<string>('WEBAUTHN_ORIGIN');
    if (!rpId || !expectedOrigin) {
      throw new Error('WEBAUTHN_RP_ID and WEBAUTHN_ORIGIN must be configured');
    }
    const origins = expectedOrigin.split(',').map((o) => o.trim());

    let verification: VerifiedAuthenticationResponse;
    try {
      verification = await verifyAuthenticationResponse({
        response: dto.data,
        expectedChallenge,
        expectedOrigin: origins,
        expectedRPID: rpId,
        credential: {
          id: isoBase64URL.fromBuffer(Uint8Array.from(credential.credentialId)),
          publicKey: Uint8Array.from(credential.publicKey),
          counter: Number(credential.counter),
        },
        requireUserVerification: false,
      });
    } catch (error) {
      await this.deleteChallenge(user.id);
      this.logger.warn(
        `Passkey login verification failed for user ${user.email}: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
      throw new UnauthorizedException('Passkey verification failed');
    } finally {
      // Always clear challenge after verification attempt
      await this.deleteChallenge(user.id);
    }

    if (!verification.verified) {
      throw new UnauthorizedException('Passkey verification failed');
    }

    // Verify counter rollback protection (detect cloned authenticators)
    const oldCounter = Number(credential.counter);
    const newCounter = Number(verification.authenticationInfo.newCounter);

    // Counter must increase (or both be 0 for non-incrementing authenticators)
    if (newCounter > 0 || oldCounter > 0) {
      if (newCounter <= oldCounter) {
        // CRITICAL SECURITY EVENT: Possible cloned authenticator
        this.logger.error(
          `Counter rollback detected for credential ${credential.id}: ` +
            `old=${oldCounter}, new=${newCounter}. Possible cloned authenticator. User: ${user.email}`,
        );

        throw new UnauthorizedException(
          'Authentication failed. Please contact support.',
        );
      }
    }

    // Update credential counter and lastUsedAt
    credential.counter = newCounter;
    credential.lastUsedAt = new Date();
    await this.credentialsRepository.save(credential);

    // Issue JWT token
    const payload: JwtPayload = {
      sub: user.id,
      email: user.email,
      displayName: user.displayName,
      role: user.role as string,
    };

    const accessToken = this.jwtService.sign(payload);
    return { accessToken };
  }

  /**
   * List all passkeys for a user.
   * Returns sanitized credential information (excludes sensitive fields).
   */
  async listCredentials(userId: string): Promise<
    Array<{
      id: string;
      createdAt: Date;
      lastUsedAt: Date | null;
      transports: string[] | null;
    }>
  > {
    const credentials = await this.credentialsRepository.find({
      where: { userId },
      order: { createdAt: 'DESC' },
    });

    return credentials.map((cred) => ({
      id: cred.id,
      createdAt: cred.createdAt,
      lastUsedAt: cred.lastUsedAt,
      transports: cred.transports,
      // Don't expose credentialId, publicKey, or counter
    }));
  }

  /**
   * Delete a specific passkey for a user.
   * Prevents deletion of last passkey if user has no password.
   */
  async deleteCredential(userId: string, credentialId: string): Promise<boolean> {
    const credential = await this.credentialsRepository.findOne({
      where: { id: credentialId, userId },
    });

    if (!credential) {
      return false;
    }

    // Prevent deleting last passkey if user has no password (account lockout protection)
    const credCount = await this.credentialsRepository.count({
      where: { userId },
    });
    const user = await this.usersRepository.findOne({ where: { id: userId } });

    if (credCount === 1 && user && !user.passwordHash) {
      throw new BadRequestException(
        'Cannot delete last passkey. Set a password first to avoid account lockout.',
      );
    }

    await this.credentialsRepository.remove(credential);
    this.logger.log(`Passkey ${credentialId} deleted for user ${userId}`);
    return true;
  }
}
