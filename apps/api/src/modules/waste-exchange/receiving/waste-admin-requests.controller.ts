import { Body, Controller, Get, HttpCode, Param, Patch, Post, Put, Query, Req } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Type } from 'class-transformer';
import { IsBoolean, IsIn, IsInt, IsNotEmpty, IsOptional, IsString, Max, MaxLength, Min, MinLength, ValidateIf, ValidateNested } from 'class-validator';
import type { Request } from 'express';
import {
  WASTE_METHOD_VALUES,
  WASTE_REQUEST_QUEUE_FILTER_VALUES,
  WASTE_REQUEST_STATUS_VALUES,
  WASTE_UNMATCHED_STATUS_VALUES,
  type WasteMethod,
  type WasteRequestQueueFilter,
  type WasteRequestStatus,
  type WasteUnmatchedResolveRequest,
  type WasteUnmatchedStatus,
} from '@tubutree/shared-types';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { OptionalNotNull } from '../../../common/decorators/optional-not-null.decorator';
import { Roles } from '../../../common/decorators/roles.decorator';
import { Trim } from '../../../common/decorators/trim.decorator';
import { deviceMetaOf } from '../core/waste-events';
import { WasteAdminRequestsService } from './waste-admin-requests.service';
import { WasteConfirmService } from './waste-confirm.service';
import { WasteReceiveService } from './waste-receive.service';
import { WasteConfirmDto, WasteMatchDto, WasteRejectDto } from './waste-receiving.dto';
import { WasteReverseService } from './waste-reverse.service';

export class AdminWasteRequestQueryDto {
  @IsOptional() @IsIn(WASTE_METHOD_VALUES) method?: WasteMethod;
  @IsOptional() @IsIn(WASTE_REQUEST_STATUS_VALUES) status?: WasteRequestStatus;
  @IsOptional() @IsIn(WASTE_REQUEST_QUEUE_FILTER_VALUES) filter?: WasteRequestQueueFilter;
  @IsOptional() @IsString() @MaxLength(64) userId?: string;
  @IsOptional() @IsString() @MaxLength(64) pointId?: string;
  @IsOptional() @IsString() @MaxLength(100) cursor?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit?: number;
}

export class WasteLookupQueryDto {
  @IsString() @MinLength(1) @MaxLength(64) code!: string;
}

export class WasteReceiveDto {
  @IsOptional() @ValidateNested() @Type(() => WasteMatchDto) match?: WasteMatchDto;
  @IsOptional() @IsInt() @Min(1) @Max(100000) receivedWeightGrams?: number;
}

export class WasteReverseDto {
  @Trim() @IsString() @IsNotEmpty() @MaxLength(500) reason!: string;
}

export class WasteCloseLostDto {
  @Trim() @IsString() @IsNotEmpty() @MaxLength(500) reason!: string;
}

export class WasteReopenDto {
  @Trim() @IsString() @IsNotEmpty() @MaxLength(500) reason!: string;
  @IsOptional() @IsString() @MaxLength(64) unmatchedId?: string;
}

export class WasteCostDto {
  @OptionalNotNull() @IsInt() @Min(0) @Max(100000000) carrierCostVnd?: number;
  @OptionalNotNull() @IsInt() @Min(1) @Max(100000) receivedWeightGrams?: number;
}

export class WasteUnmatchedCreateDto {
  @IsOptional() @IsString() @MaxLength(60) carrier?: string;
  @IsOptional() @IsString() @MaxLength(64) trackingCode?: string;
  @IsString() @MinLength(1) @MaxLength(200) description!: string;
}

export class WasteUnmatchedResolveDto {
  @IsIn(['MATCH', 'CLOSE']) action!: 'MATCH' | 'CLOSE';
  @ValidateIf((o: WasteUnmatchedResolveDto) => o.action === 'MATCH') @IsString() @MaxLength(64) requestId?: string;
  @Trim() @IsString() @IsNotEmpty() @MaxLength(500) note!: string;
}

export class WasteUnmatchedListQueryDto {
  @IsOptional() @IsIn(WASTE_UNMATCHED_STATUS_VALUES) status?: WasteUnmatchedStatus;
}

export class WasteUserFlagsDto {
  @OptionalNotNull() @IsBoolean() shipLocked?: boolean;
  @OptionalNotNull() @IsBoolean() blocked?: boolean;
  @Trim() @IsString() @IsNotEmpty() @MaxLength(500) reason!: string;
}

@Controller('admin/waste')
export class WasteAdminRequestsController {
  constructor(
    private readonly admin: WasteAdminRequestsService,
    private readonly receiveService: WasteReceiveService,
    private readonly confirmService: WasteConfirmService,
    private readonly reverseService: WasteReverseService,
  ) {}

  @Get('requests')
  @Roles('STAFF', 'ADMIN')
  queue(@CurrentUser('sub') userId: string, @Query() query: AdminWasteRequestQueryDto) {
    return this.admin.queue(userId, query);
  }

  @Get('requests/lookup')
  @Roles('STAFF', 'ADMIN')
  @Throttle({ default: { ttl: 60_000, limit: 30 } })
  lookup(@CurrentUser('sub') userId: string, @Query() query: WasteLookupQueryDto) {
    return this.admin.lookup(userId, query.code);
  }

  @Get('requests/:id')
  @Roles('STAFF', 'ADMIN')
  detail(@CurrentUser('sub') userId: string, @Param('id') id: string) {
    return this.admin.detail(userId, id);
  }

  @Post('requests/:id/receive')
  @Roles('STAFF', 'ADMIN')
  @Throttle({ default: { ttl: 60_000, limit: 30 } })
  @HttpCode(200)
  receive(@CurrentUser('sub') userId: string, @Param('id') id: string, @Body() body: WasteReceiveDto) {
    return this.receiveService.receive(userId, id, body);
  }

  @Post('requests/:id/confirm')
  @Roles('STAFF', 'ADMIN')
  @Throttle({ default: { ttl: 60_000, limit: 30 } })
  confirm(@CurrentUser('sub') callerUserId: string, @Param('id') id: string, @Body() body: WasteConfirmDto, @Req() req: Request) {
    return this.confirmService.confirm({ callerUserId, requestId: id, route: 'ADMIN', device: deviceMetaOf(req) }, body);
  }

  @Post('requests/:id/reject')
  @Roles('STAFF', 'ADMIN')
  @Throttle({ default: { ttl: 60_000, limit: 30 } })
  reject(@CurrentUser('sub') callerUserId: string, @Param('id') id: string, @Body() body: WasteRejectDto, @Req() req: Request) {
    return this.confirmService.reject({ callerUserId, requestId: id, route: 'ADMIN', device: deviceMetaOf(req) }, body);
  }

  @Post('requests/:id/reverse')
  @Roles('ADMIN')
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  reverse(@CurrentUser('sub') userId: string, @Param('id') id: string, @Body() body: WasteReverseDto) {
    return this.reverseService.reverse(userId, id, body);
  }

  @Patch('requests/:id/cost')
  @Roles('ADMIN')
  @Throttle({ default: { ttl: 60_000, limit: 30 } })
  setCost(@CurrentUser('sub') userId: string, @Param('id') id: string, @Body() body: WasteCostDto) {
    return this.admin.setCost(userId, id, body);
  }

  @Post('requests/:id/close-lost')
  @Roles('ADMIN')
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  closeLost(@CurrentUser('sub') userId: string, @Param('id') id: string, @Body() body: WasteCloseLostDto) {
    return this.confirmService.closeLost(userId, id, body);
  }

  @Post('requests/:id/reopen')
  @Roles('ADMIN')
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  reopen(@CurrentUser('sub') userId: string, @Param('id') id: string, @Body() body: WasteReopenDto) {
    return this.admin.reopen(userId, id, body);
  }

  @Get('unmatched')
  @Roles('STAFF', 'ADMIN')
  listUnmatched(@CurrentUser('sub') userId: string, @Query() query: WasteUnmatchedListQueryDto) {
    return this.receiveService.listUnmatched(userId, query);
  }

  @Post('unmatched')
  @Roles('STAFF', 'ADMIN')
  @Throttle({ default: { ttl: 60_000, limit: 30 } })
  createUnmatched(@CurrentUser('sub') userId: string, @Body() body: WasteUnmatchedCreateDto) {
    return this.receiveService.createUnmatched(userId, body);
  }

  @Post('unmatched/:id/resolve')
  @Roles('STAFF', 'ADMIN')
  @Throttle({ default: { ttl: 60_000, limit: 30 } })
  resolveUnmatched(@CurrentUser('sub') userId: string, @Param('id') id: string, @Body() body: WasteUnmatchedResolveDto) {
    return this.receiveService.resolveUnmatched(userId, id, body as WasteUnmatchedResolveRequest);
  }

  @Get('users/:userId/flags')
  @Roles('ADMIN')
  getFlags(@CurrentUser('sub') callerId: string, @Param('userId') userId: string) {
    return this.admin.getFlags(callerId, userId);
  }

  @Put('users/:userId/flags')
  @Roles('ADMIN')
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  setFlags(@CurrentUser('sub') callerId: string, @Param('userId') userId: string, @Body() body: WasteUserFlagsDto) {
    return this.admin.setFlags(callerId, userId, body);
  }
}
