import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { Transform, Type } from 'class-transformer';
import { IsIn, IsOptional, IsString, MaxLength, MinLength, ValidateNested } from 'class-validator';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AccountDeletionService, OVERRIDE_REASON_MAX, OVERRIDE_REASON_MIN, type DeletionListStatus } from './account-deletion.service';

class ListDeletionRequestsQuery {
  @IsOptional() @IsIn(['PENDING', 'RESOLVED', 'ALL']) status?: DeletionListStatus;
}

class WalletOverrideDto {
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(OVERRIDE_REASON_MIN)
  @MaxLength(OVERRIDE_REASON_MAX)
  reason!: string;
}

class ProcessDeletionRequestDto {
  @IsOptional() @IsString() @MaxLength(500) note?: string;

  /** Chỉ bỏ blocker số dư Ví dương; các vướng mắc khác vẫn chặn. Lý do bắt buộc, lưu cùng số tiền bị trừ. */
  @IsOptional() @ValidateNested() @Type(() => WalletOverrideDto) overrideWalletBalance?: WalletOverrideDto;
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
    return this.deletion.process(id, adminId, dto.note, dto.overrideWalletBalance);
  }
}
