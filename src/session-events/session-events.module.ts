import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SessionEventsService } from './session-events.service';
import { SessionEvent } from './entities/session-event.entity';
import { User } from '../users/entities/user.entity';

@Module({
  imports: [TypeOrmModule.forFeature([SessionEvent, User])],
  providers: [SessionEventsService],
  exports: [SessionEventsService],
})
export class SessionEventsModule {}
