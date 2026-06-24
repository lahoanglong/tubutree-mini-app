import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { IsString, MaxLength, MinLength } from 'class-validator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { CommunityFeedService } from './community-feed.service';

class CreatePostDto {
  @IsString() @MinLength(1) @MaxLength(1000) body!: string;
}
class CommentDto {
  @IsString() @MinLength(1) @MaxLength(500) body!: string;
}

@Controller('feed')
export class CommunityFeedController {
  constructor(private readonly feed: CommunityFeedService) {}

  @Get()
  getFeed(@CurrentUser('sub') userId: string) {
    return this.feed.getFeed(userId);
  }

  @Post()
  createPost(@CurrentUser('sub') userId: string, @Body() dto: CreatePostDto) {
    return this.feed.createPost(userId, dto.body);
  }

  @Post(':id/react')
  react(@CurrentUser('sub') userId: string, @Param('id') id: string) {
    return this.feed.toggleReaction(userId, id);
  }

  @Get(':id/comments')
  comments(@Param('id') id: string) {
    return this.feed.getComments(id);
  }

  @Post(':id/comments')
  addComment(@CurrentUser('sub') userId: string, @Param('id') id: string, @Body() dto: CommentDto) {
    return this.feed.addComment(userId, id, dto.body);
  }
}
