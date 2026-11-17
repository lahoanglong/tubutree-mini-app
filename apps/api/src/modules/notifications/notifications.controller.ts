import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { IsBoolean, IsIn, Matches } from 'class-validator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { NOTIFY_CONSENT_SOURCES, NotificationsService, type NotifyConsentSource } from './notifications.service';
import { NotificationFeedService } from './notification-feed.service';
import { NotificationListQuery } from './dto/notification-list-query.dto';
import { OptionalNotNull } from '../../common/decorators/optional-not-null.decorator';

class UpdateNotificationPrefsDto {
  @OptionalNotNull() @IsBoolean() notifyPromo?: boolean;
  @OptionalNotNull() @IsBoolean() notifyGarden?: boolean;
  @OptionalNotNull() @IsBoolean() notifySocial?: boolean;
  /** Nơi khách đổi công tắc; bỏ trống là trang Cài đặt. */
  @OptionalNotNull() @IsIn([...NOTIFY_CONSENT_SOURCES]) source?: NotifyConsentSource;
  /** Phiên bản câu chữ của công tắc khách thấy (vd `notify-prefs-v2`); bỏ trống là client cũ với công tắc gộp. */
  @OptionalNotNull() @Matches(/^[a-z0-9][a-z0-9._-]{0,39}$/) textVersion?: string;
}

@Controller('me/notifications')
export class NotificationsController {
  constructor(
    private readonly notifications: NotificationsService,
    private readonly feed: NotificationFeedService,
  ) {}

  /** Trả mảng (không bọc trang) vì bản Mini App và web đã phát hành đọc thẳng mảng; không tham số thì là 50 tin mới nhất. */
  @Get()
  list(@CurrentUser('sub') userId: string, @Query() q: NotificationListQuery) {
    return this.feed.list(userId, q);
  }

  @Get('unread-count')
  unreadCount(@CurrentUser('sub') userId: string) {
    return this.feed.unreadCount(userId);
  }

  @Get('prefs')
  getPrefs(@CurrentUser('sub') userId: string) {
    return this.notifications.getPrefs(userId);
  }

  @Patch('prefs')
  updatePrefs(@CurrentUser('sub') userId: string, @Body() dto: UpdateNotificationPrefsDto) {
    return this.notifications.updatePrefs(userId, dto);
  }

  @Post('read-all')
  markAllRead(@CurrentUser('sub') userId: string) {
    return this.notifications.markAllRead(userId);
  }

  @Post(':id/read')
  markRead(@CurrentUser('sub') userId: string, @Param('id') id: string) {
    return this.notifications.markRead(userId, id);
  }
}
