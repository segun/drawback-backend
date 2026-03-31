import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { RealtimeModule } from '../realtime/realtime.module';
import { UsersModule } from '../users/users.module';
import { ChatController } from './chat.controller';
import { ChatService } from './chat.service';
import { ChatRequest } from './entities/chat-request.entity';
import { SavedChat } from './entities/saved-chat.entity';
import { GroupChat } from './entities/group-chat.entity';
import { GroupChatMember } from './entities/group-chat-member.entity';
import { GroupChatInvitation } from './entities/group-chat-invitation.entity';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      ChatRequest,
      SavedChat,
      GroupChat,
      GroupChatMember,
      GroupChatInvitation,
    ]),
    forwardRef(() => AuthModule),
    forwardRef(() => UsersModule),
    forwardRef(() => RealtimeModule),
    NotificationsModule,
  ],
  controllers: [ChatController],
  providers: [ChatService],
  exports: [ChatService],
})
export class ChatModule {}
