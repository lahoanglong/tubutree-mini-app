import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { IsBoolean, IsOptional } from 'class-validator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { NotificationsService } from './notifications.service';

class UpdateNotificationPrefsDto {
  @IsOptional() @IsBoolean() notifyPromo?: boolean;
  @IsOptional() @IsBoolean() notifyGarden?: boolean;
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

  @Post(':id/read')
  markRead(@CurrentUser('sub') userId: string, @Param('id') id: string) {
    return this.notifications.markRead(userId, id);
  }
}
