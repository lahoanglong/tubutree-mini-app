import { Body, Controller, Get, Param, Patch } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsInt, IsNotEmpty, IsString, Max, MaxLength, Min } from 'class-validator';
import { Roles } from '../../common/decorators/roles.decorator';
import { AdminEngagementService } from './admin-engagement.service';
import { OptionalNotNull } from '../../common/decorators/optional-not-null.decorator';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

/** Trần điểm thưởng một nhiệm vụ: quà rẻ nhất trong danh mục đổi điểm giá 20.000 điểm, nhiệm vụ seed thưởng 15.000–50.000. */
export const MISSION_REWARD_POINTS_MAX = 500_000;

export class UpdateMissionDto {
  @OptionalNotNull() @Transform(trim) @IsString() @IsNotEmpty() @MaxLength(80) title?: string;
  @OptionalNotNull() @Transform(trim) @IsString() @MaxLength(300) description?: string;
  @OptionalNotNull() @IsInt() @Min(0) @Max(MISSION_REWARD_POINTS_MAX) rewardPoints?: number;
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
