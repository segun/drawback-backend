import {
  ConflictException,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
  forwardRef,
  Inject,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import * as bcrypt from 'bcrypt';
import { randomUUID } from 'crypto';
import { Repository } from 'typeorm';
import { MailService } from '../mail/mail.service';
import { User } from '../users/entities/user.entity';
import { UserMode } from '../users/enums/user-mode.enum';
import { UsersService } from '../users/users.service';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { ResendConfirmationDto } from './dto/resend-confirmation.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { JwtPayload } from './interfaces/jwt-payload.interface';

@Injectable()
export class AuthService {
  /** How long (hours) an activation token remains valid. */
  static readonly ACTIVATION_TOKEN_TTL_HOURS = 24;

  constructor(
    @InjectRepository(User)
    private readonly usersRepository: Repository<User>,
    private readonly jwtService: JwtService,
    private readonly mailService: MailService,
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

  async confirmEmail(
    token: string,
  ): Promise<{ success: boolean; email: string | null; reason?: string }> {
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

    return { success: true, email: user.email };
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

  async login(dto: LoginDto): Promise<{ accessToken: string }> {
    const user = await this.usersRepository.findOne({
      where: { email: dto.email.toLowerCase() },
    });

    if (!user) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const passwordMatch = await bcrypt.compare(dto.password, user.passwordHash);
    if (!passwordMatch) {
      throw new UnauthorizedException('Invalid credentials');
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
    return { accessToken };
  }

  /** How long (hours) a delete-account token remains valid. */
  static readonly DELETE_TOKEN_TTL_HOURS = 24;

  async requestAccountDeletion(userId: string): Promise<{ message: string }> {
    const user = await this.usersRepository.findOne({
      where: { id: userId },
    });

    if (!user) {
      throw new UnauthorizedException('User not found');
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

  async loginAndDelete(dto: LoginDto): Promise<{ message: string }> {
    const user = await this.usersRepository.findOne({
      where: { email: dto.email.toLowerCase() },
    });

    if (!user) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const passwordMatch = await bcrypt.compare(dto.password, user.passwordHash);
    if (!passwordMatch) {
      throw new UnauthorizedException('Invalid credentials');
    }

    // Use the shared method to request deletion
    return this.requestAccountDeletion(user.id);
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
}
