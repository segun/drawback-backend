import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from '../users/entities/user.entity';
import { Subscription } from '../users/entities/subscription.entity';
import { AppleNotification } from './entities/apple-notification.entity';
import { PurchasesController } from './purchases.controller';
import { PurchasesService } from './purchases.service';
import { SubscriptionEventsService } from './subscription-events.service';
import { AppleSubscriptionEventsService } from './apple-subscription-events.service';

@Module({
  imports: [TypeOrmModule.forFeature([User, Subscription, AppleNotification])],
  controllers: [PurchasesController],
  providers: [
    PurchasesService,
    SubscriptionEventsService,
    AppleSubscriptionEventsService,
  ],
  exports: [PurchasesService],
})
export class PurchasesModule {}
