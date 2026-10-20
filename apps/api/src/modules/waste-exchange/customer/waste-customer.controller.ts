import { Body, Controller, Get, Headers, HttpCode, Param, Patch, Post, Put, Query } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, Equals, IsArray, IsBoolean, IsIn, IsInt, IsNotEmpty, IsOptional, IsString, Max, MaxLength, Min, MinLength, ValidateNested } from 'class-validator';
import { WASTE_METHOD_VALUES, type WasteCreateRequest, type WasteEditRequest, type WasteLineInput, type WasteMethod, type WasteNearbyRequest, type WastePreviewRequest, type WasteTrackingRequest } from '@tubutree/shared-types';
import { Public } from '../../../common/decorators/public.decorator';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { OptionalNotNull } from '../../../common/decorators/optional-not-null.decorator';
import { Trim } from '../../../common/decorators/trim.decorator';
import { requireIdempotencyKey } from '../../../common/idempotency-key';
import { WASTE_MAX_REQUEST_LINES } from '../waste.constants';
import { WasteAccessService, type WasteCustomerContext, type WasteGateMode } from '../core/waste-access.service';
import { WasteConfigService } from '../core/waste-config.service';
import { WasteCatalogueService } from './waste-catalogue.service';
import { WasteMeService } from './waste-me.service';
import { WastePreviewService } from './waste-preview.service';
import { WasteRequestsService } from './waste-requests.service';

export class WastePointsQueryDto implements Pick<WasteNearbyRequest, 'provinceCode'> {
  @IsOptional()
  @IsString()
  @MaxLength(20)
  provinceCode?: string;
}

export class WasteNearbyDto implements WasteNearbyRequest {
  @IsOptional()
  @IsString()
  @MaxLength(20)
  provinceCode?: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(2048)
  locationToken!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(4096)
  zaloAccessToken!: string;
}

export class WasteLineDto implements WasteLineInput {
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  itemId!: string;

  @IsInt()
  @Min(1)
  @Max(1000)
  declaredQty!: number;
}

export class WastePreviewDto implements WastePreviewRequest {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(WASTE_MAX_REQUEST_LINES)
  @ValidateNested({ each: true })
  @Type(() => WasteLineDto)
  lines!: WasteLineDto[];

  @IsOptional()
  @IsIn(WASTE_METHOD_VALUES)
  method?: WasteMethod;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  pointId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  provinceCode?: string;
}

export class WasteCreateDto implements WasteCreateRequest {
  @IsIn(WASTE_METHOD_VALUES)
  method!: WasteMethod;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(WASTE_MAX_REQUEST_LINES)
  @ValidateNested({ each: true })
  @Type(() => WasteLineDto)
  lines!: WasteLineDto[];

  @IsOptional()
  @IsString()
  @MaxLength(64)
  pointId?: string;

  @Equals(true)
  consent!: true;

  @IsOptional()
  @IsBoolean()
  packagingConsent?: boolean;

  @IsOptional()
  @IsBoolean()
  postagePaidConsent?: boolean;
}

export class WasteEditDto implements WasteEditRequest {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(WASTE_MAX_REQUEST_LINES)
  @ValidateNested({ each: true })
  @Type(() => WasteLineDto)
  lines!: WasteLineDto[];

  @OptionalNotNull()
  @IsString()
  @MaxLength(64)
  pointId?: string;
}

export class WasteTrackingDto implements WasteTrackingRequest {
  @Trim()
  @IsString()
  @MinLength(1)
  @MaxLength(60)
  carrier!: string;

  @Trim()
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  trackingCode!: string;
}

@Controller('waste')
export class WasteCustomerController {
  constructor(
    private readonly access: WasteAccessService,
    private readonly config: WasteConfigService,
    private readonly meSvc: WasteMeService,
    private readonly catalogue: WasteCatalogueService,
    private readonly requests: WasteRequestsService,
    private readonly previews: WastePreviewService,
  ) {}

  private async gate(userId: string, mode: WasteGateMode): Promise<WasteCustomerContext> {
    return this.access.customerGate(userId, mode, await this.config.isEnabled());
  }

  @Get('me')
  me(@CurrentUser('sub') userId: string) {
    return this.meSvc.me(userId);
  }

  // Công khai: chỉ trả chữ thể lệ do admin soạn (không dữ liệu riêng, không cần cờ chương trình), trang /doi-rac/quy-dinh trên web đọc khi chưa đăng nhập.
  @Public()
  @Get('rules')
  rules() {
    return this.meSvc.rules();
  }

  @Get('items')
  async items(@CurrentUser('sub') userId: string) {
    await this.gate(userId, 'FULL');
    return this.catalogue.listItems();
  }

  @Get('points')
  async points(@CurrentUser('sub') userId: string, @Query() q: WastePointsQueryDto) {
    await this.gate(userId, 'FULL');
    return this.catalogue.listPoints(q.provinceCode);
  }

  @Post('points/nearby')
  @HttpCode(200)
  @Throttle({ default: { ttl: 60_000, limit: 30 } })
  async nearby(@CurrentUser('sub') userId: string, @Body() body: WasteNearbyDto) {
    await this.gate(userId, 'FULL');
    return this.catalogue.nearbyPoints(body);
  }

  @Post('preview')
  @HttpCode(200)
  @Throttle({ default: { ttl: 60_000, limit: 60 } })
  async preview(@CurrentUser('sub') userId: string, @Body() body: WastePreviewDto) {
    await this.gate(userId, 'FULL');
    return this.previews.preview(userId, body);
  }

  @Get('requests')
  async list(@CurrentUser('sub') userId: string) {
    await this.gate(userId, 'OWN');
    return this.requests.list(userId);
  }

  @Get('requests/by-order/:orderId')
  async byOrder(@CurrentUser('sub') userId: string, @Param('orderId') orderId: string) {
    await this.gate(userId, 'OWN');
    return this.requests.byOrder(userId, orderId);
  }

  @Get('requests/:id')
  async detail(@CurrentUser('sub') userId: string, @Param('id') id: string) {
    await this.gate(userId, 'OWN');
    return this.requests.detail(userId, id);
  }

  @Post('requests')
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  async create(@CurrentUser('sub') userId: string, @Headers('idempotency-key') rawKey: unknown, @Body() body: WasteCreateDto) {
    await this.gate(userId, 'FULL');
    return this.requests.create(userId, requireIdempotencyKey(rawKey), body);
  }

  @Patch('requests/:id')
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  async edit(@CurrentUser('sub') userId: string, @Param('id') id: string, @Body() body: WasteEditDto) {
    await this.gate(userId, 'FULL');
    return this.requests.edit(userId, id, body);
  }

  @Put('requests/:id/tracking')
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  async setTracking(@CurrentUser('sub') userId: string, @Param('id') id: string, @Body() body: WasteTrackingDto) {
    await this.gate(userId, 'OWN');
    return this.requests.setTracking(userId, id, body);
  }

  @Post('requests/:id/cancel')
  @HttpCode(200)
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  async cancel(@CurrentUser('sub') userId: string, @Param('id') id: string) {
    await this.gate(userId, 'OWN');
    return this.requests.cancel(userId, id);
  }
}
