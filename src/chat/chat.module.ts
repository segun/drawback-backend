import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { RealtimeModule } from '../realtime/realtime.module';
import { UsersModule } from '../users/users.module';
import { ChatController } from './chat.controller';
import { ChatService } from './chat.service';
import { ChatRequest } from './entities/chat-request.entity';
import { SavedChat } from './entities/saved-chat.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([ChatRequest, SavedChat]),
    UsersModule,
    AuthModule,
    forwardRef(() => RealtimeModule),
  ],
  controllers: [ChatController],
  providers: [ChatService],
  exports: [ChatService],
})
export class ChatModule {}
