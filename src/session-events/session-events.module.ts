import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SessionEventsService } from './session-events.service';
import { SessionEvent } from './entities/session-event.entity';

@Module({
  imports: [TypeOrmModule.forFeature([SessionEvent])],
  providers: [SessionEventsService],
  exports: [SessionEventsService],
})
export class SessionEventsModule {}
