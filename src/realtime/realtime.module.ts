import { Module, forwardRef } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ChatModule } from '../chat/chat.module';
import { UsersModule } from '../users/users.module';
import { DrawGateway } from './draw.gateway';

@Module({
  imports: [UsersModule, AuthModule, forwardRef(() => ChatModule)],
  providers: [DrawGateway],
  exports: [DrawGateway],
})
export class RealtimeModule {}
