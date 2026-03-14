import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
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
  getMe(@CurrentUser() user: User) {
    // Compute hasDiscoveryAccess dynamically
    const now = new Date();
    const hasDiscoveryAccess =
      user.subscriptionEndDate &&
      now < user.subscriptionEndDate &&
      user.subscriptionStatus === 'active';

    return {
      ...user,
      hasDiscoveryAccess, // Override with computed value
      subscription: user.subscriptionEndDate
        ? {
            tier: user.subscriptionTier,
            endDate: user.subscriptionEndDate,
            autoRenew: user.subscriptionAutoRenew,
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
    return this.authService.requestAccountDeletion(user.id);
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
