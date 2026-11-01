import { IsIn, IsOptional } from 'class-validator';
import type { CampaignPlacement } from '@prisma/client';

export class CampaignListQuery {
  @IsIn(['HOME_TOP', 'OFFERS_TOP']) placement!: CampaignPlacement;
  // ALL không nhận: "hỏi theo loại khách" chỉ có NEW hoặc RETURNING, không hỏi thì bỏ tham số.
  @IsOptional() @IsIn(['NEW', 'RETURNING']) audience?: 'NEW' | 'RETURNING';
}
