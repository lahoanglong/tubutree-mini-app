import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { IsBoolean } from 'class-validator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { NotificationsService } from './notifications.service';
import { OptionalNotNull } from '../../common/decorators/optional-not-null.decorator';

class UpdateNotificationPrefsDto {
  @OptionalNotNull() @IsBoolean() notifyPromo?: boolean;
  @OptionalNotNull() @IsBoolean() notifyGarden?: boolean;
}

@Controller('me/notifications')
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
  list(@CurrentUser('sub') userId: string) {
    return this.notifications.listForUser(userId);
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
