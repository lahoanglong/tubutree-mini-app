import { Body, Controller, Get, Param, Patch } from '@nestjs/common';
import { Roles } from '../../common/decorators/roles.decorator';
import { AllowStaff } from '../../common/staff-permissions';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { NotificationTemplatesAdminService } from './notification-templates-admin.service';
import { UpdateNotificationTemplateDto } from './dto/update-notification-template.dto';

@Roles('ADMIN')
@AllowStaff('MARKETING')
@Controller('admin/notification-templates')
export class NotificationTemplatesAdminController {
  constructor(private readonly templates: NotificationTemplatesAdminService) {}

  @Get()
  list() {
    return this.templates.list();
  }

  @Patch(':code')
  update(
    @CurrentUser('sub') actorId: string,
    @CurrentUser('role') role: string,
    @Param('code') code: string,
    @Body() dto: UpdateNotificationTemplateDto,
  ) {
    return this.templates.update(code, dto, { id: actorId, staff: role === 'STAFF' });
  }
}
