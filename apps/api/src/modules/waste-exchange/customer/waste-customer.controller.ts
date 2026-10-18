import { Body, Controller, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';
import type { WasteNearbyRequest } from '@tubutree/shared-types';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { WasteAccessService, type WasteCustomerContext, type WasteGateMode } from '../core/waste-access.service';
import { WasteConfigService } from '../core/waste-config.service';
import { WasteCatalogueService } from './waste-catalogue.service';
import { WasteMeService } from './waste-me.service';
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

@Controller('waste')
export class WasteCustomerController {
  constructor(
    private readonly access: WasteAccessService,
    private readonly config: WasteConfigService,
    private readonly meSvc: WasteMeService,
    private readonly catalogue: WasteCatalogueService,
    private readonly requests: WasteRequestsService,
  ) {}

  private async gate(userId: string, mode: WasteGateMode): Promise<WasteCustomerContext> {
    return this.access.customerGate(userId, mode, await this.config.isEnabled());
  }

  @Get('me')
  me(@CurrentUser('sub') userId: string) {
    return this.meSvc.me(userId);
  }

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
}
