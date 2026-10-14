import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ArrayMaxSize, IsArray, IsBoolean, IsDateString, IsIn, IsInt, IsOptional, IsString, Max, Min, MaxLength, MinLength } from 'class-validator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { CursorPageQuery } from '../../common/cursor-page-query.dto';
import { IsUploadedImage, PUBLIC_CONTENT_IMAGE } from '../../common/uploaded-image';
import { FeedQuery } from './feed-query.dto';
import { CommunityFeedService, type CreateEventInput, type CreatePostInput } from './community-feed.service';

const KINDS = ['MANUAL', 'QUESTION', 'SHOWCASE', 'TIP'] as const;
const REPORT_TARGET_TYPES = ['POST', 'COMMENT'] as const;

/** Khớp MultiImageUpload ở Mini App (max=6). */
const MAX_POST_IMAGES = 6;

export class CreatePostDto {
  @IsOptional() @IsIn(KINDS as unknown as string[]) kind?: (typeof KINDS)[number];
  @IsOptional() @IsString() categoryId?: string;
  @IsOptional() @IsString() @MaxLength(160) title?: string;
  @IsString() @MinLength(1) @MaxLength(5000) body!: string;
  @IsOptional() @IsArray() @ArrayMaxSize(MAX_POST_IMAGES) @IsUploadedImage(PUBLIC_CONTENT_IMAGE, { each: true }) images?: string[];
  @IsOptional() @IsArray() @ArrayMaxSize(20) @IsString({ each: true }) @MaxLength(200, { each: true }) productSlugs?: string[];
  @IsOptional() @IsArray() @ArrayMaxSize(20) @IsString({ each: true }) @MaxLength(100, { each: true }) tagSlugs?: string[];
  @IsOptional() @IsString() eventId?: string;
}
export class EditPostDto {
  @IsOptional() @IsString() @MaxLength(160) title?: string;
  @IsOptional() @IsString() @MaxLength(5000) body?: string;
  @IsOptional() @IsArray() @ArrayMaxSize(MAX_POST_IMAGES) @IsUploadedImage(PUBLIC_CONTENT_IMAGE, { each: true }) images?: string[];
}
class CommentDto {
  @IsString() @MinLength(1) @MaxLength(500) body!: string;
}
class ReportDto {
  @IsIn(REPORT_TARGET_TYPES as unknown as string[]) targetType!: (typeof REPORT_TARGET_TYPES)[number];
  @IsOptional() @IsString() targetId?: string;
  @IsString() @MaxLength(500) reason!: string;
}
class RejectPostDto {
  @IsOptional() @IsString() @MaxLength(200) reason?: string;
}
class PinDto {
  @IsOptional() @IsBoolean() pinned?: boolean;
}
export class CreateEventDto {
  @IsString() @MaxLength(160) title!: string;
  @IsOptional() @IsString() @MaxLength(2000) description?: string;
  @IsOptional() @IsString() coverUrl?: string;
  @IsDateString() startAt!: string;
  @IsDateString() endAt!: string;
  // Điểm Xanh (1 điểm = 1.000đ). Trần 1.000 điểm = 1.000.000đ như trần xu cũ; gửi rewardXu sẽ bị
  // ValidationPipe (forbidNonWhitelisted) từ chối thay vì âm thầm hiểu nhầm đơn vị.
  @IsOptional() @IsInt() @Min(0) @Max(1000) rewardPoints?: number;
}
class PickWinnerDto {
  @IsString() userId!: string;
}

@Controller('feed')
export class CommunityFeedController {
  constructor(private readonly feed: CommunityFeedService) {}

  @Get()
  getFeed(@CurrentUser('sub') userId: string, @Query() query: FeedQuery) {
    return this.feed.getFeed(userId, {
      category: query.category,
      kind: query.kind,
      sort: query.sort === 'popular' ? 'popular' : query.sort === 'new' ? 'new' : undefined,
      cursor: query.cursor,
      q: query.q,
      unanswered: query.unanswered === '1' || query.unanswered === 'true',
      tag: query.tag,
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

  @Get('events/:id/posts')
  eventPosts(@CurrentUser('sub') userId: string, @Param('id') id: string, @Query() query: CursorPageQuery) {
    return this.feed.eventPosts(id, userId, query.take ? Number(query.take) : undefined, query.cursor);
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
      rewardPoints: dto.rewardPoints,
    } as CreateEventInput);
  }

  // Quản trị: sự kiện đang mở/đã đóng (kèm người thắng) và người dự thi để chọn người thắng. Literal path khai TRƯỚC @Get(':id').
  @Roles('ADMIN')
  @Get('admin/events')
  adminEvents(@Query('status') status?: string) {
    return this.feed.adminEvents(status === 'CLOSED' ? 'CLOSED' : 'OPEN');
  }

  @Roles('ADMIN')
  @Get('admin/events/:id/participants')
  adminEventParticipants(@Param('id') id: string) {
    return this.feed.adminEventParticipants(id);
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

  /**
   * Throttler toàn cục là 60 request/phút cho MỌI endpoint — thừa sức để một tài khoản đã tin
   * cậy (chỉ cần 1 đơn DELIVERED) đăng 60 bài/phút, tất cả lên thẳng PUBLISHED nên kiểm duyệt
   * cũng không thấy gì trong hàng chờ; dọn là xoá tay từng bài. 5 bài/phút vẫn thoải mái cho
   * người dùng thật.
   */
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post()
  createPost(@CurrentUser() user: { sub: string; role: string }, @Body() dto: CreatePostDto) {
    return this.feed.createPost(user.sub, user.role, dto as CreatePostInput);
  }

  @Patch(':id')
  editPost(@CurrentUser() user: { sub: string; role: string }, @Param('id') id: string, @Body() dto: EditPostDto) {
    // role cần cho re-moderation: sửa nội dung bài đã duyệt của user chưa tin cậy → về PENDING.
    return this.feed.editPost(user.sub, id, dto, user.role);
  }

  /** Gỡ 1 bình luận (tác giả bình luận hoặc ADMIN) — khai báo TRƯỚC `@Delete(':id')` để
   *  'comments' không bị nuốt thành postId nếu sau này đổi sang route 1 đoạn. */
  @Delete('comments/:commentId')
  removeComment(@CurrentUser() user: { sub: string; role: string }, @Param('commentId') commentId: string) {
    return this.feed.removeComment(user.sub, user.role, commentId);
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
  comments(@CurrentUser('sub') userId: string, @Param('id') id: string, @Query() query: CursorPageQuery) {
    return this.feed.getComments(id, userId, query.take ? Number(query.take) : undefined, query.cursor);
  }

  @Throttle({ default: { limit: 15, ttl: 60_000 } })
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

  @Throttle({ default: { limit: 10, ttl: 60_000 } })
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
  reject(@Param('id') id: string, @Body() dto: RejectPostDto) {
    return this.feed.rejectPost(id, dto?.reason);
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
