import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { AdminGuard } from '../auth/admin.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { User } from '../users/entities/user.entity';
import { AdminService } from './admin.service';
import { BanUsersDto } from './dto/ban-users.dto';
import { PaginationQueryDto } from './dto/pagination-query.dto';
import { ResetUserPasswordsDto } from './dto/reset-user-passwords.dto';
import { UnbanUsersDto } from './dto/unban-users.dto';
import { UserFilterQueryDto } from './dto/user-filter-query.dto';
import { UserSearchQueryDto } from './dto/user-search-query.dto';

@Controller('admin')
@UseGuards(AdminGuard)
@Throttle({ admin: { ttl: 60000, limit: 100 } })
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  @Get('users')
  listUsers(@Query() query: PaginationQueryDto) {
    return this.adminService.listUsers(query);
  }

  @Get('users/filter')
  filterUsers(@Query() query: UserFilterQueryDto) {
    return this.adminService.filterUsers(query);
  }

  @Get('users/search')
  searchUsers(@Query() query: UserSearchQueryDto) {
    return this.adminService.searchUsers(query);
  }

  @Get('users/:userId')
  getUserDetails(@Param('userId', ParseUUIDPipe) userId: string) {
    return this.adminService.getUserDetails(userId);
  }

  @Post('users/ban')
  banUsers(@CurrentUser() admin: User, @Body() dto: BanUsersDto) {
    return this.adminService.banUsers(admin, dto);
  }

  @Post('users/unban')
  unbanUsers(@CurrentUser() admin: User, @Body() dto: UnbanUsersDto) {
    return this.adminService.unbanUsers(admin, dto.userIds);
  }

  @Post('users/reset-passwords')
  resetPasswords(
    @CurrentUser() admin: User,
    @Body() dto: ResetUserPasswordsDto,
  ) {
    return this.adminService.resetUserPasswords(admin, dto.userIds);
  }
}
