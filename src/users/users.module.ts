import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AppConfigModule } from '../app-config/app-config.module';
import { AuthModule } from '../auth/auth.module';
import { ChatModule } from '../chat/chat.module';
import { ChatRequest } from '../chat/entities/chat-request.entity';
import { StorageModule } from '../storage/storage.module';
import { UserBlock } from './entities/user-block.entity';
import { User } from './entities/user.entity';
import { Subscription } from './entities/subscription.entity';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([User, UserBlock, ChatRequest, Subscription]),
    forwardRef(() => AuthModule),
    forwardRef(() => ChatModule),
    StorageModule,
    AppConfigModule,
  ],
  controllers: [UsersController],
  providers: [UsersService],
  exports: [UsersService],
})
export class UsersModule {}
