import { Body, Controller, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { UserBlockService } from './user-block.service';

export class BlockUserDto {
  @IsString() @MinLength(3) @MaxLength(500) reason!: string;
}

@ApiTags('admin-users')
@Roles('ADMIN')
@Controller('admin/users')
export class AdminUsersController {
  constructor(private readonly blocks: UserBlockService) {}

  @Post(':id/block')
  @HttpCode(HttpStatus.OK)
  block(@CurrentUser('sub') adminId: string, @Param('id') id: string, @Body() dto: BlockUserDto) {
    return this.blocks.block(adminId, id, dto.reason);
  }

  @Post(':id/unblock')
  @HttpCode(HttpStatus.OK)
  unblock(@CurrentUser('sub') adminId: string, @Param('id') id: string) {
    return this.blocks.unblock(adminId, id);
  }
}
