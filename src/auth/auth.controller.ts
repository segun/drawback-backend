import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Redirect,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Throttle } from '@nestjs/throttler';
import { AuthService } from './auth.service';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { ResendConfirmationDto } from './dto/resend-confirmation.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';

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
      return { url: `${base}?status=success&email=${email}`, statusCode: 302 };
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
}
