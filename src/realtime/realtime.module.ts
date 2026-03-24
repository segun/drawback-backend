import { Module, forwardRef } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ChatModule } from '../chat/chat.module';
import { UsersModule } from '../users/users.module';
import { SessionEventsModule } from '../session-events/session-events.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { DrawGateway } from './draw.gateway';

@Module({
  imports: [
    forwardRef(() => UsersModule),
    forwardRef(() => AuthModule),
    forwardRef(() => ChatModule),
    SessionEventsModule,
    NotificationsModule,
  ],
  providers: [DrawGateway],
  exports: [DrawGateway],
})
export class RealtimeModule {}
