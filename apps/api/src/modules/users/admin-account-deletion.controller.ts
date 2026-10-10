import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AccountDeletionService, type DeletionListStatus } from './account-deletion.service';

class ListDeletionRequestsQuery {
  @IsOptional() @IsIn(['PENDING', 'RESOLVED', 'ALL']) status?: DeletionListStatus;
}

class ProcessDeletionRequestDto {
  @IsOptional() @IsString() @MaxLength(500) note?: string;
}

@Roles('ADMIN')
@Controller('admin/account-deletion-requests')
export class AdminAccountDeletionController {
  constructor(private readonly deletion: AccountDeletionService) {}

  @Get()
  list(@Query() q: ListDeletionRequestsQuery) {
    return this.deletion.list(q.status ?? 'PENDING');
  }

  @Post(':id/process')
  process(@CurrentUser('sub') adminId: string, @Param('id') id: string, @Body() dto: ProcessDeletionRequestDto) {
    return this.deletion.process(id, adminId, dto.note);
  }
}
