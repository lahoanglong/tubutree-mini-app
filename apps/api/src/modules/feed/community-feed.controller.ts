import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { IsArray, IsBoolean, IsDateString, IsIn, IsInt, IsOptional, IsString, Max, Min, MaxLength, MinLength } from 'class-validator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { CommunityFeedService, type CreateEventInput, type CreatePostInput } from './community-feed.service';

const KINDS = ['MANUAL', 'QUESTION', 'SHOWCASE', 'TIP'] as const;
const REPORT_TARGET_TYPES = ['POST', 'COMMENT'] as const;

class CreatePostDto {
  @IsOptional() @IsIn(KINDS as unknown as string[]) kind?: (typeof KINDS)[number];
  @IsOptional() @IsString() categoryId?: string;
  @IsOptional() @IsString() @MaxLength(160) title?: string;
  @IsString() @MinLength(1) @MaxLength(5000) body!: string;
  @IsOptional() @IsArray() @IsString({ each: true }) images?: string[];
  @IsOptional() @IsArray() @IsString({ each: true }) productSlugs?: string[];
  @IsOptional() @IsArray() @IsString({ each: true }) tagSlugs?: string[];
  @IsOptional() @IsString() eventId?: string;
}
class EditPostDto {
  @IsOptional() @IsString() @MaxLength(160) title?: string;
  @IsOptional() @IsString() @MaxLength(5000) body?: string;
  @IsOptional() @IsArray() @IsString({ each: true }) images?: string[];
}
class CommentDto {
  @IsString() @MinLength(1) @MaxLength(500) body!: string;
}
class ReportDto {
  @IsIn(REPORT_TARGET_TYPES as unknown as string[]) targetType!: (typeof REPORT_TARGET_TYPES)[number];
  @IsOptional() @IsString() targetId?: string;
  @IsString() @MaxLength(500) reason!: string;
}
class PinDto {
  @IsOptional() @IsBoolean() pinned?: boolean;
}
class CreateEventDto {
  @IsString() @MaxLength(160) title!: string;
  @IsOptional() @IsString() @MaxLength(2000) description?: string;
  @IsOptional() @IsString() coverUrl?: string;
  @IsDateString() startAt!: string;
  @IsDateString() endAt!: string;
  @IsOptional() @IsInt() @Min(0) @Max(1000000) rewardXu?: number;
}
class PickWinnerDto {
  @IsString() userId!: string;
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
    @Query('q') q?: string,
    @Query('unanswered') unanswered?: string,
    @Query('tag') tag?: string,
  ) {
    return this.feed.getFeed(userId, {
      category,
      kind,
      sort,
      cursor,
      q,
      unanswered: unanswered === '1' || unanswered === 'true',
      tag,
    });
  }

  @Get('categories')
  categories() {
    return this.feed.getCategories();
  }

  // Literal path (leaderboard) phải khai TRƯỚC @Get(':id') để không bị :id nuốt mất.
  @Get('leaderboard')
  leaderboard() {
    return this.feed.getLeaderboard();
  }

  // Admin (literal paths) phải khai TRƯỚC @Get(':id') để không bị :id nuốt mất.
  @Roles('ADMIN')
  @Get('admin/pending')
  adminPending() {
    return this.feed.adminPending();
  }

  @Roles('ADMIN')
  @Get('admin/reports')
  adminReports() {
    return this.feed.adminReports();
  }

  // Sự kiện cộng đồng (Pha 4 Task 2) — literal path 'events' phải khai TRƯỚC @Get(':id').
  @Get('events')
  listEvents() {
    return this.feed.listEvents();
  }

  @Get('events/:id')
  getEvent(@Param('id') id: string) {
    return this.feed.getEvent(id);
  }

  @Get('events/:id/posts')
  eventPosts(@CurrentUser('sub') userId: string, @Param('id') id: string) {
    return this.feed.eventPosts(id, userId);
  }

  @Roles('ADMIN')
  @Post('events')
  createEvent(@Body() dto: CreateEventDto) {
    return this.feed.createEvent({
      title: dto.title,
      description: dto.description,
      coverUrl: dto.coverUrl,
      startAt: new Date(dto.startAt),
      endAt: new Date(dto.endAt),
      rewardXu: dto.rewardXu,
    } as CreateEventInput);
  }

  @Roles('ADMIN')
  @Post('events/:id/close')
  closeEvent(@Param('id') id: string) {
    return this.feed.closeEvent(id);
  }

  @Roles('ADMIN')
  @Post('events/:id/winner')
  pickWinner(@Param('id') id: string, @Body() dto: PickWinnerDto) {
    return this.feed.pickWinner(id, dto.userId);
  }

  @Get(':id')
  getPost(@CurrentUser('sub') userId: string, @Param('id') id: string) {
    return this.feed.getPost(userId, id);
  }

  @Post()
  createPost(@CurrentUser() user: { sub: string; role: string }, @Body() dto: CreatePostDto) {
    return this.feed.createPost(user.sub, user.role, dto as CreatePostInput);
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
  comments(@CurrentUser('sub') userId: string, @Param('id') id: string) {
    return this.feed.getComments(id, userId);
  }

  @Post(':id/comments')
  addComment(@CurrentUser() user: { sub: string; role: string }, @Param('id') id: string, @Body() dto: CommentDto) {
    return this.feed.addComment(user.sub, user.role, id, dto.body);
  }

  @Post(':id/best-answer/:commentId')
  bestAnswer(
    @CurrentUser() user: { sub: string; role: string },
    @Param('id') id: string,
    @Param('commentId') commentId: string,
  ) {
    return this.feed.setBestAnswer(user.sub, user.role, id, commentId);
  }

  @Post(':id/report')
  report(@CurrentUser('sub') userId: string, @Param('id') id: string, @Body() dto: ReportDto) {
    return this.feed.report(userId, {
      targetType: dto.targetType,
      targetId: dto.targetType === 'COMMENT' ? (dto.targetId ?? id) : id,
      reason: dto.reason,
    });
  }

  @Roles('ADMIN')
  @Post('admin/:id/approve')
  approve(@Param('id') id: string) {
    return this.feed.approvePost(id);
  }

  @Roles('ADMIN')
  @Post('admin/:id/reject')
  reject(@Param('id') id: string) {
    return this.feed.rejectPost(id);
  }

  @Roles('ADMIN')
  @Post('admin/reports/:id/resolve')
  resolveReport(@Param('id') id: string) {
    return this.feed.resolveReport(id);
  }

  @Roles('ADMIN')
  @Post('admin/:id/pin')
  pin(@Param('id') id: string, @Body() body: PinDto) {
    return this.feed.pinPost(id, body?.pinned !== false);
  }
}
