import { Module } from '@nestjs/common';
import { WalletModule } from '../wallet/wallet.module';
import { CommunityFeedController } from './community-feed.controller';
import { CommunityFeedService } from './community-feed.service';
import { CommunityRewardService } from './community-reward.service';

@Module({
  imports: [WalletModule],
  controllers: [CommunityFeedController],
  providers: [CommunityFeedService, CommunityRewardService],
  exports: [CommunityFeedService],
})
export class FeedModule {}
