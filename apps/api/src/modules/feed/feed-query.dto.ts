import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

export const FEED_POST_KINDS = ['MANUAL', 'HARVEST', 'MILESTONE', 'SPECIES', 'QUESTION', 'SHOWCASE', 'TIP'] as const;
export type FeedPostKindValue = (typeof FEED_POST_KINDS)[number];

/**
 * Query của GET /feed. ValidationPipe toàn cục bật forbidNonWhitelisted nên phải khai báo ĐỦ mọi
 * query miniapp gửi. Giá trị ngoài enum hoặc mảng (?x=a&x=b) lọt xuống where của Prisma thành
 * PrismaClientValidationError → 500; chặn ở đây để trả 400.
 */
export class FeedQuery {
  @IsOptional() @IsString() @MaxLength(100) category?: string;
  @IsOptional() @IsIn([...FEED_POST_KINDS]) kind?: FeedPostKindValue;
  // Không siết enum: service coi mọi giá trị khác 'popular' là 'new', giá trị lạ không gây lỗi.
  @IsOptional() @IsString() sort?: string;
  @IsOptional() @IsString() @MaxLength(200) cursor?: string;
  @IsOptional() @IsString() @MaxLength(100) q?: string;
  @IsOptional() @IsString() unanswered?: string;
  @IsOptional() @IsString() @MaxLength(100) tag?: string;
}
