import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { IsArray, IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { CommunityFeedService, type CreatePostInput } from './community-feed.service';

const KINDS = ['MANUAL', 'QUESTION', 'SHOWCASE', 'TIP'] as const;

class CreatePostDto {
  @IsOptional() @IsIn(KINDS as unknown as string[]) kind?: (typeof KINDS)[number];
  @IsOptional() @IsString() categoryId?: string;
  @IsOptional() @IsString() @MaxLength(160) title?: string;
  @IsString() @MinLength(1) @MaxLength(5000) body!: string;
  @IsOptional() @IsArray() @IsString({ each: true }) images?: string[];
  @IsOptional() @IsArray() @IsString({ each: true }) productSlugs?: string[];
}
class EditPostDto {
  @IsOptional() @IsString() @MaxLength(160) title?: string;
  @IsOptional() @IsString() @MaxLength(5000) body?: string;
  @IsOptional() @IsArray() @IsString({ each: true }) images?: string[];
}
class CommentDto {
  @IsString() @MinLength(1) @MaxLength(500) body!: string;
}

@Controller('feed')
export class CommunityFeedController {
  constructor(private readonly feed: CommunityFeedService) {}

  @Get()
  getFeed(
    @CurrentUser('sub') userId: string,
    @Query('category') category?: string,
    @Query('kind') kind?: string,
    @Query('sort') sort?: 'new' | 'popular',
    @Query('cursor') cursor?: string,
  ) {
    return this.feed.getFeed(userId, { category, kind, sort, cursor });
  }

  @Get('categories')
  categories() {
    return this.feed.getCategories();
  }

  @Get(':id')
  getPost(@CurrentUser('sub') userId: string, @Param('id') id: string) {
    return this.feed.getPost(userId, id);
  }

  @Post()
  createPost(@CurrentUser('sub') userId: string, @Body() dto: CreatePostDto) {
    return this.feed.createPost(userId, dto as CreatePostInput);
  }

  @Patch(':id')
  editPost(@CurrentUser('sub') userId: string, @Param('id') id: string, @Body() dto: EditPostDto) {
    return this.feed.editPost(userId, id, dto);
  }

  @Delete(':id')
  deletePost(@CurrentUser() user: { sub: string; role: string }, @Param('id') id: string) {
    return this.feed.deletePost(user.sub, user.role, id);
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

  @Post(':id/best-answer/:commentId')
  bestAnswer(
    @CurrentUser() user: { sub: string; role: string },
    @Param('id') id: string,
    @Param('commentId') commentId: string,
  ) {
    return this.feed.setBestAnswer(user.sub, user.role, id, commentId);
  }
}
