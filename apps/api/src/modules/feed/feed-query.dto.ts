import { Transform } from 'class-transformer';
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { truncateCodePoints } from '../../common/truncate-code-points';
import { SEARCH_Q_MAX_LENGTH } from '../catalog/dto/suggest-query.dto';

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
  // Ô tìm kiếm dán nguyên chuỗi dài: cắt như /search/suggest thay vì 400 làm mất cả bảng tin. Mảng giữ nguyên cho IsString từ chối.
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? truncateCodePoints(value, SEARCH_Q_MAX_LENGTH) : value))
  @IsString()
  q?: string;
  @IsOptional() @IsString() unanswered?: string;
  @IsOptional() @IsString() @MaxLength(100) tag?: string;
}
