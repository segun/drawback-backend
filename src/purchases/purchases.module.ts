import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from '../users/entities/user.entity';
import { PurchasesController } from './purchases.controller';
import { PurchasesService } from './purchases.service';
import { SubscriptionEventsService } from './subscription-events.service';

@Module({
  imports: [TypeOrmModule.forFeature([User])],
  controllers: [PurchasesController],
  providers: [PurchasesService, SubscriptionEventsService],
  exports: [PurchasesService],
})
export class PurchasesModule {}
