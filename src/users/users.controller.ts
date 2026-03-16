import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  UnauthorizedException,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { instanceToPlain } from 'class-transformer';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { AuthService } from '../auth/auth.service';
import { User } from './entities/user.entity';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { SetUserModeDto } from './dto/set-user-mode.dto';
import { SetAppearInSearchesDto } from './dto/set-appear-in-searches.dto';
import { SetDiscoveryGameDto } from './dto/set-discovery-game.dto';
import { DiscoveryUserResponseDto } from './dto/discovery-user-response.dto';
import { UsersService } from './users.service';

@UseGuards(JwtAuthGuard)
@Controller('users')
export class UsersController {
  constructor(
    private readonly usersService: UsersService,
    private readonly authService: AuthService,
  ) {}

  @Get('me')
  async getMe(@CurrentUser() user: User) {
    // Load subscription relation
    const userWithSub = await this.usersService.findOneWithSubscription(
      user.id,
    );
    if (!userWithSub) {
      throw new NotFoundException('User not found');
    }

    // Compute hasDiscoveryAccess dynamically based on subscription
    const now = new Date();
    const hasDiscoveryAccess =
      userWithSub.subscription?.endDate &&
      now < userWithSub.subscription.endDate &&
      userWithSub.subscription.status === 'active';

    // Use instanceToPlain to properly apply @Exclude() decorators
    const plainUser = instanceToPlain(userWithSub) as Record<string, unknown>;

    return {
      ...plainUser,
      hasDiscoveryAccess, // Override with computed value
      subscription: userWithSub.subscription
        ? {
            tier: userWithSub.subscription.tier,
            endDate: userWithSub.subscription.endDate,
            autoRenew: userWithSub.subscription.autoRenew,
          }
        : null,
    };
  }

  @Patch('me')
  updateMe(@CurrentUser() user: User, @Body() dto: UpdateProfileDto) {
    return this.usersService.updateDisplayName(user.id, dto);
  }

  @Patch('me/mode')
  setMode(@CurrentUser() user: User, @Body() dto: SetUserModeDto) {
    return this.usersService.setMode(user.id, dto.mode);
  }

  @Patch('me/appear-in-searches')
  setAppearInSearches(
    @CurrentUser() user: User,
    @Body() dto: SetAppearInSearchesDto,
  ) {
    return this.usersService.setAppearInSearches(user.id, dto.appearInSearches);
  }

  @Patch('me/discovery-game')
  setDiscoveryGame(
    @CurrentUser() user: User,
    @Body() dto: SetDiscoveryGameDto,
  ) {
    return this.usersService.setDiscoveryGame(
      user.id,
      dto.appearInDiscoveryGame,
      dto.base64Image,
    );
  }

  @Delete('me')
  async deleteMe(@CurrentUser() user: User): Promise<{ message: string }> {
    const result = await this.authService.requestAccountDeletion(user.id);
    if (!result) {
      throw new UnauthorizedException('User not found');
    }

    return result;
  }

  @Get('public')
  listPublic(@CurrentUser() user: User) {
    return this.usersService.listPublic(user.id);
  }

  @Get('search')
  @Throttle({ search: { ttl: 60000, limit: 20 } })
  search(@CurrentUser() user: User, @Query('q') q: string) {
    return this.usersService.searchByDisplayName(q ?? '', user.id);
  }

  // ── Discovery Game ───────────────────────────────────────────────────────

  @Get('discovery/random')
  @Throttle({ short: { ttl: 1000, limit: 10 } })
  async getRandomDiscovery(
    @CurrentUser() user: User,
  ): Promise<{ user: DiscoveryUserResponseDto | null }> {
    const userWithSub = await this.usersService.findOneWithSubscription(
      user.id,
    );

    if (!userWithSub) {
      throw new NotFoundException('User not found');
    }

    const subscription = userWithSub.subscription;
    const now = new Date();
    const hasSubscription =
      !!subscription &&
      (subscription.endDate > now ||
        subscription.status === 'grace_period' ||
        subscription.status === 'on_hold') &&
      subscription.status !== 'expired' &&
      subscription.status !== 'revoked';

    if (!hasSubscription) {
      throw new ForbiddenException({
        error: 'DISCOVERY_LOCKED',
        message: 'Discovery requires premium access',
      });
    }

    const randomUser = await this.usersService.getRandomDiscoveryUser(user);
    return { user: randomUser };
  }

  // ── Blocking ─────────────────────────────────────────────────────────────

  @Get('me/blocked')
  listBlocked(@CurrentUser() user: User) {
    return this.usersService.listBlocked(user.id);
  }

  @Post(':id/block')
  @HttpCode(HttpStatus.NO_CONTENT)
  async blockUser(
    @CurrentUser() user: User,
    @Param('id', ParseUUIDPipe) targetId: string,
  ) {
    await this.usersService.blockUser(user.id, targetId);
  }

  @Delete(':id/block')
  @HttpCode(HttpStatus.NO_CONTENT)
  async unblockUser(
    @CurrentUser() user: User,
    @Param('id', ParseUUIDPipe) targetId: string,
  ) {
    await this.usersService.unblockUser(user.id, targetId);
  }
}
