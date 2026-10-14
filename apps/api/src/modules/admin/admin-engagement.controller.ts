import { Body, Controller, Get, Param, Patch } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsInt, IsNotEmpty, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { Roles } from '../../common/decorators/roles.decorator';
import { AdminEngagementService } from './admin-engagement.service';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

/** Trần điểm thưởng một nhiệm vụ: quà rẻ nhất trong danh mục đổi điểm giá 20 điểm, nhiệm vụ seed thưởng 20–50. */
export const MISSION_REWARD_POINTS_MAX = 500;

export class UpdateMissionDto {
  @IsOptional() @Transform(trim) @IsString() @IsNotEmpty() @MaxLength(80) title?: string;
  @IsOptional() @Transform(trim) @IsString() @MaxLength(300) description?: string;
  @IsOptional() @IsInt() @Min(0) @Max(MISSION_REWARD_POINTS_MAX) rewardPoints?: number;
}

@ApiTags('admin-engagement')
@Roles('ADMIN')
@Controller('admin/engagement')
export class AdminEngagementController {
  constructor(private readonly engagement: AdminEngagementService) {}

  @Get('missions')
  missions() {
    return this.engagement.listMissions();
  }

  @Patch('missions/:id')
  updateMission(@Param('id') id: string, @Body() dto: UpdateMissionDto) {
    return this.engagement.updateMission(id, dto);
  }

  @Get('rewards')
  rewards() {
    return this.engagement.rewardCatalog();
  }
}
