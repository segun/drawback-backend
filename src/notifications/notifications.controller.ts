import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { User } from '../users/entities/user.entity';
import { NotificationsService } from './notifications.service';
import { RegisterPushTokenDto } from './dto/register-push-token.dto';
import { DeactivatePushTokenDto } from './dto/deactivate-push-token.dto';

@Controller('notifications')
@UseGuards(JwtAuthGuard)
@Throttle({ auth: { ttl: 60000, limit: 5 } })
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @Post('tokens')
  @HttpCode(HttpStatus.NO_CONTENT)
  async registerToken(
    @CurrentUser() user: User,
    @Body() dto: RegisterPushTokenDto,
  ): Promise<void> {
    await this.notificationsService.registerToken(user.id, dto);
  }

  @Post('tokens/deactivate')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deactivateToken(
    @CurrentUser() user: User,
    @Body() dto: DeactivatePushTokenDto,
  ): Promise<void> {
    await this.notificationsService.deactivateToken(user.id, dto);
  }
}
