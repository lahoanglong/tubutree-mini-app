import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { IsBoolean } from 'class-validator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { NotificationsService } from './notifications.service';
import { NotificationFeedService } from './notification-feed.service';
import { NotificationListQuery } from './dto/notification-list-query.dto';
import { OptionalNotNull } from '../../common/decorators/optional-not-null.decorator';

class UpdateNotificationPrefsDto {
  @OptionalNotNull() @IsBoolean() notifyPromo?: boolean;
  @OptionalNotNull() @IsBoolean() notifyGarden?: boolean;
}

@Controller('me/notifications')
export class NotificationsController {
  constructor(
    private readonly notifications: NotificationsService,
    private readonly feed: NotificationFeedService,
  ) {}

  /** Trả MẢNG như bản cũ; không tham số thì vẫn là 50 tin mới nhất. */
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
