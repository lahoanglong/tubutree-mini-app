import { Module } from '@nestjs/common';
import { CommunityFeedController } from './community-feed.controller';
import { CommunityFeedService } from './community-feed.service';

@Module({
  controllers: [CommunityFeedController],
  providers: [CommunityFeedService],
  exports: [CommunityFeedService],
})
export class FeedModule {}
