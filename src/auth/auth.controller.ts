import { Body, Controller, Get, Param, Post, Redirect } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Throttle } from '@nestjs/throttler';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { ResendConfirmationDto } from './dto/resend-confirmation.dto';

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
    const frontendUrl = this.configService.get<string>('FRONTEND_URL', 'http://localhost:5173');
    const base = `${frontendUrl}/confirm`;
    const result = await this.authService.confirmEmail(token);

    if (result.success) {
      const email = encodeURIComponent(result.email!);
      return { url: `${base}?status=success&email=${email}`, statusCode: 302 };
    }

    const reason = encodeURIComponent(result.reason ?? 'Unknown error');
    const emailParam = result.email ? `&email=${encodeURIComponent(result.email)}` : '';
    return { url: `${base}?status=error&reason=${reason}${emailParam}`, statusCode: 302 };
  }

  @Throttle({ auth: { ttl: 60000, limit: 5 } })
  @Post('resend-confirmation')
  resendConfirmation(@Body() dto: ResendConfirmationDto) {
    return this.authService.resendConfirmationEmail(dto);
  }

  @Throttle({ auth: { ttl: 60000, limit: 5 } })
  @Post('login')
  login(@Body() dto: LoginDto) {
    return this.authService.login(dto);
  }
}
