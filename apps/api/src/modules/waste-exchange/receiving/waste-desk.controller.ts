import { Body, Controller, Get, Param, Post, Put, Req } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { IsString, MaxLength } from 'class-validator';
import type { Request } from 'express';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { deviceMetaOf } from '../core/waste-events';
import { WasteConfirmService } from './waste-confirm.service';
import { WasteDeskService } from './waste-desk.service';
import { WasteConfirmDto, WasteRejectDto } from './waste-receiving.dto';

export class WasteDeskLookupDto {
  @IsString() @MaxLength(64) code!: string;
}

export class WastePerkDto {
  @IsString() @MaxLength(300) perkText!: string;
}

@Controller('waste/desk')
export class WasteDeskController {
  constructor(
    private readonly desk: WasteDeskService,
    private readonly confirmService: WasteConfirmService,
  ) {}

  @Get('points')
  points(@CurrentUser('sub') userId: string) {
    return this.desk.points(userId);
  }

  @Post('lookup')
  @Throttle({ default: { ttl: 60_000, limit: 30 } })
  lookup(@CurrentUser('sub') userId: string, @Body() body: WasteDeskLookupDto) {
    return this.desk.lookup(userId, body.code);
  }

  @Post('requests/:id/confirm')
  @Throttle({ default: { ttl: 60_000, limit: 30 } })
  confirm(@CurrentUser('sub') userId: string, @Param('id') id: string, @Body() body: WasteConfirmDto, @Req() req: Request) {
    return this.confirmService.confirm({ callerUserId: userId, requestId: id, route: 'DESK', device: deviceMetaOf(req) }, body);
  }

  @Post('requests/:id/reject')
  @Throttle({ default: { ttl: 60_000, limit: 30 } })
  reject(@CurrentUser('sub') userId: string, @Param('id') id: string, @Body() body: WasteRejectDto, @Req() req: Request) {
    return this.confirmService.reject({ callerUserId: userId, requestId: id, route: 'DESK', device: deviceMetaOf(req) }, body);
  }

  @Put('points/:pointId/perk')
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  submitPerk(@CurrentUser('sub') userId: string, @Param('pointId') pointId: string, @Body() body: WastePerkDto) {
    return this.desk.submitPerk(userId, pointId, body);
  }
}
