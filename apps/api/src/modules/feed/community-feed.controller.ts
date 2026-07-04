import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { IsArray, IsBoolean, IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { CommunityFeedService, type CreatePostInput } from './community-feed.service';

const KINDS = ['MANUAL', 'QUESTION', 'SHOWCASE', 'TIP'] as const;
const REPORT_TARGET_TYPES = ['POST', 'COMMENT'] as const;

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
class ReportDto {
  @IsIn(REPORT_TARGET_TYPES as unknown as string[]) targetType!: (typeof REPORT_TARGET_TYPES)[number];
  @IsString() targetId!: string;
  @IsString() @MaxLength(500) reason!: string;
}
class PinDto {
  @IsOptional() @IsBoolean() pinned?: boolean;
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

  @Post(':id/report')
  report(@CurrentUser('sub') userId: string, @Param('id') id: string, @Body() dto: ReportDto) {
    return this.feed.report(userId, {
      targetType: dto.targetType,
      targetId: dto.targetType === 'COMMENT' ? dto.targetId : id,
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
