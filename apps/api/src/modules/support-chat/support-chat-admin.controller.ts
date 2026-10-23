import { Body, Controller, Delete, Get, Param, Post, Put, Query } from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { AllowStaff } from '../../common/staff-permissions';
import { AdminListQuery, AdminReplyDto, AdminSettingsDto } from './dto/admin.dto';
import { SupportChatAdminService } from './support-chat-admin.service';

/** Cầu nối, nhóm Zalo và cấu hình là việc của ADMIN; hội thoại và trả lời mở cho nhân viên CSKH. */
@Roles('ADMIN')
@Controller('admin/support-chat')
export class SupportChatAdminController {
  constructor(private readonly admin: SupportChatAdminService) {}

  @Get('bridge')
  @AllowStaff('CSKH')
  bridge() {
    return this.admin.bridgeStatus();
  }

  @Post('bridge/qr')
  qrStart(@CurrentUser('sub') adminId: string) {
    return this.admin.qrStart(adminId);
  }

  @Get('bridge/qr')
  qrStatus() {
    return this.admin.qrStatus();
  }

  @Post('bridge/logout')
  logout(@CurrentUser('sub') adminId: string) {
    return this.admin.logout(adminId);
  }

  @Post('bridge/reconnect')
  reconnect(@CurrentUser('sub') adminId: string) {
    return this.admin.reconnect(adminId);
  }

  @Get('bridge/groups')
  groups() {
    return this.admin.groups();
  }

  @Post('bridge/test')
  test() {
    return this.admin.test();
  }

  @Put('settings')
  settings(@CurrentUser('sub') adminId: string, @Body() dto: AdminSettingsDto) {
    return this.admin.updateSettings(adminId, dto);
  }

  @Get('conversations')
  @AllowStaff('CSKH')
  list(@Query() q: AdminListQuery) {
    return this.admin.list(q);
  }

  @Get('conversations/:id')
  @AllowStaff('CSKH')
  get(@Param('id') id: string) {
    return this.admin.get(id);
  }

  @Post('conversations/:id/reply')
  @AllowStaff('CSKH')
  reply(@CurrentUser('sub') adminId: string, @Param('id') id: string, @Body() dto: AdminReplyDto) {
    return this.admin.reply(adminId, id, dto.body);
  }

  @Post('conversations/:id/block')
  @AllowStaff('CSKH')
  block(@CurrentUser('sub') adminId: string, @Param('id') id: string) {
    return this.admin.block(adminId, id);
  }

  @Delete('conversations/:id/block')
  @AllowStaff('CSKH')
  unblock(@Param('id') id: string) {
    return this.admin.unblock(id);
  }

  @Post('forwards/:id/resend')
  @AllowStaff('CSKH')
  resend(@Param('id') id: string) {
    return this.admin.resend(id);
  }
}
