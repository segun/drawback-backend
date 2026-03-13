import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
  Redirect,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Throttle } from '@nestjs/throttler';
import { User } from '../users/entities/user.entity';
import { AuthService } from './auth.service';
import { CurrentUser } from './current-user.decorator';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { LoginDto } from './dto/login.dto';
import {
  CredentialResponseDto,
  FinishPasskeyRegistrationDto,
  FinishPasskeyLoginDto,
  StartPasskeyLoginDto,
} from './dto/passkey.dto';
import { RegisterDto } from './dto/register.dto';
import { ResendConfirmationDto } from './dto/resend-confirmation.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { JwtAuthGuard } from './jwt-auth.guard';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly configService: ConfigService,
  ) {}

  @Throttle({ auth: { ttl: 60000, limit: 5 } })
  @Post('register')
  register(@Body() dto: RegisterDto) {
    return this.authService.register(dto);
  }

  @Get('confirm/:token')
  @Redirect()
  async confirm(@Param('token') token: string) {
    const frontendUrl = this.configService.getOrThrow<string>('FRONTEND_URL');
    const base = `${frontendUrl}/confirm`;
    const result = await this.authService.confirmEmail(token);

    if (result.success) {
      const email = encodeURIComponent(result.email as string);
      const tempToken = encodeURIComponent(result.tempToken as string);
      return {
        url: `${base}?status=success&email=${email}&temp_token=${tempToken}`,
        statusCode: 302,
      };
    }

    const reason = encodeURIComponent(String(result.reason ?? 'Unknown error'));
    const emailParam = result.email
      ? `&email=${encodeURIComponent(String(result.email))}`
      : '';
    return {
      url: `${base}?status=error&reason=${reason}${emailParam}`,
      statusCode: 302,
    };
  }

  @Get('confirm-delete/:token')
  @Redirect()
  async confirmDelete(@Param('token') token: string) {
    const frontendUrl = this.configService.getOrThrow<string>('FRONTEND_URL');
    const base = `${frontendUrl}/delete-my-account`;
    const result = await this.authService.confirmDelete(token);

    if (result.success) {
      const message = encodeURIComponent(
        'Your account has been successfully deleted',
      );
      return {
        url: `${base}?status=success&message=${message}`,
        statusCode: 302,
      };
    }

    const message = encodeURIComponent(
      String(result.reason ?? 'Account deletion failed'),
    );
    return {
      url: `${base}?status=fail&message=${message}`,
      statusCode: 302,
    };
  }

  @Throttle({ auth: { ttl: 60000, limit: 5 } })
  @Post('resend-confirmation')
  resendConfirmation(
    @Body() dto: ResendConfirmationDto,
  ): Promise<{ message: string }> {
    return this.authService.resendConfirmationEmail(dto);
  }

  @Throttle({ auth: { ttl: 60000, limit: 5 } })
  @Post('login')
  login(@Body() dto: LoginDto) {
    return this.authService.login(dto);
  }

  @Throttle({ auth: { ttl: 60000, limit: 5 } })
  @Post('login-and-delete')
  loginAndDelete(@Body() dto: LoginDto): Promise<{ message: string }> {
    return this.authService.loginAndDelete(dto);
  }

  @Throttle({ auth: { ttl: 60000, limit: 5 } })
  @Post('forgot-password')
  forgotPassword(@Body() dto: ForgotPasswordDto): Promise<{ message: string }> {
    return this.authService.forgotPassword(dto);
  }

  @Throttle({ auth: { ttl: 60000, limit: 5 } })
  @Post('reset-password')
  async resetPassword(
    @Body() dto: ResetPasswordDto,
  ): Promise<{ status: string; message: string; email?: string }> {
    const result = await this.authService.resetPassword(dto);

    if (result.success) {
      return {
        status: 'success',
        message: 'Your password has been reset successfully.',
        email: result.email as string,
      };
    }

    return {
      status: 'error',
      message: result.reason ?? 'Password reset failed',
      ...(result.email ? { email: result.email } : {}),
    };
  }

  @Get('display-name/check')
  @Throttle({ dnCheck: { ttl: 60000, limit: 10 } })
  checkDisplayName(@Query('name') name: string) {
    if (!name) {
      throw new BadRequestException('name query parameter is required');
    }
    return this.authService.isDisplayNameAvailable(name);
  }

  // ===== WebAuthn / Passkey Endpoints =====

  @UseGuards(JwtAuthGuard)
  @Throttle({ auth: { ttl: 60000, limit: 10 } })
  @Post('passkey/register/start')
  startPasskeyRegistration(@CurrentUser() user: User) {
    return this.authService.startPasskeyRegistration(user.id);
  }

  @UseGuards(JwtAuthGuard)
  @Throttle({ auth: { ttl: 60000, limit: 10 } })
  @Post('passkey/register/finish')
  finishPasskeyRegistration(
    @CurrentUser() user: User,
    @Body() dto: FinishPasskeyRegistrationDto,
  ) {
    return this.authService.finishPasskeyRegistration(user.id, dto);
  }

  @Throttle({ auth: { ttl: 60000, limit: 5 } })
  @Post('passkey/login/start')
  startPasskeyLogin(@Body() dto: StartPasskeyLoginDto) {
    return this.authService.startPasskeyLogin(dto);
  }

  @Throttle({ auth: { ttl: 60000, limit: 5 } })
  @Post('passkey/login/finish')
  finishPasskeyLogin(@Body() dto: FinishPasskeyLoginDto) {
    return this.authService.finishPasskeyLogin(dto);
  }

  // ===== Passkey Credential Management =====

  @UseGuards(JwtAuthGuard)
  @Get('passkey/credentials')
  async listCredentials(
    @CurrentUser() user: User,
  ): Promise<CredentialResponseDto[]> {
    return this.authService.listCredentials(user.id);
  }

  @UseGuards(JwtAuthGuard)
  @Delete('passkey/credentials/:id')
  async deleteCredential(
    @CurrentUser() user: User,
    @Param('id') credId: string,
  ): Promise<{ success: boolean }> {
    await this.authService.deleteCredential(user.id, credId);
    return { success: true };
  }
}
