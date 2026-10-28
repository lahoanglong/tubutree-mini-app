import { Type } from 'class-transformer';
import { IsDefined, IsInt, IsISO8601, IsOptional, IsString, Max, MaxLength, Min, ValidateIf } from 'class-validator';
import { NOTIFICATION_PAGE_MAX } from '../notification-feed.service';

/** Query của `GET /me/notifications`: bỏ trống toàn bộ thì trả 50 tin mới nhất như trước. */
export class NotificationListQuery {
  /** Có `beforeId` thì bắt buộc có mốc này: id chỉ phân định các tin cùng `sentAt`. */
  @ValidateIf((o: NotificationListQuery) => o.before !== undefined || o.beforeId !== undefined)
  @IsDefined({ message: 'Thiếu mốc thời gian của tin cuối trang trước.' })
  @IsISO8601({}, { message: 'Mốc thời gian phân trang không hợp lệ.' })
  before?: string;

  @IsOptional()
  @IsString({ message: 'Mã tin cuối trang trước không hợp lệ.' })
  @MaxLength(64, { message: 'Mã tin cuối trang trước không hợp lệ.' })
  beforeId?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'Số tin mỗi trang phải là số nguyên.' })
  @Min(1, { message: 'Số tin mỗi trang phải từ 1 đến 50.' })
  @Max(NOTIFICATION_PAGE_MAX, { message: 'Số tin mỗi trang phải từ 1 đến 50.' })
  limit?: number;
}
