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
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { User } from './entities/user.entity';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { SetUserModeDto } from './dto/set-user-mode.dto';
import { UsersService } from './users.service';

@UseGuards(JwtAuthGuard)
@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get('me')
  getMe(@CurrentUser() user: User) {
    return user;
  }

  @Patch('me')
  updateMe(@CurrentUser() user: User, @Body() dto: UpdateProfileDto) {
    return this.usersService.updateDisplayName(user.id, dto);
  }

  @Patch('me/mode')
  setMode(@CurrentUser() user: User, @Body() dto: SetUserModeDto) {
    return this.usersService.setMode(user.id, dto.mode);
  }

  @Delete('me')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteMe(@CurrentUser() user: User) {
    await this.usersService.deleteAccount(user.id);
  }

  @Get('public')
  listPublic(@CurrentUser() user: User) {
    return this.usersService.listPublic(user.id);
  }

  @Get('search')
  search(@CurrentUser() user: User, @Query('q') q: string) {
    return this.usersService.searchByDisplayName(q ?? '', user.id);
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
