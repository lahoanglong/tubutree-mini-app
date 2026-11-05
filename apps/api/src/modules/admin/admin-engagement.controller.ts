import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { IsBoolean, IsIn, IsInt, IsNotEmpty, IsString, Max, MaxLength, Min } from 'class-validator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { MISSION_KINDS, type MissionKind } from '../../common/mission-kinds';
import { Roles } from '../../common/decorators/roles.decorator';
import { AdminEngagementService } from './admin-engagement.service';
import { OptionalNotNull } from '../../common/decorators/optional-not-null.decorator';
import { Trim } from '../../common/decorators/trim.decorator';


/** Trần điểm thưởng một nhiệm vụ: quà rẻ nhất trong danh mục đổi điểm giá 20.000 điểm, nhiệm vụ seed thưởng 15.000–50.000. */
export const MISSION_REWARD_POINTS_MAX = 500_000;

export class UpdateMissionDto {
  @OptionalNotNull() @Trim() @IsString() @IsNotEmpty() @MaxLength(80) title?: string;
  @OptionalNotNull() @Trim() @IsString() @MaxLength(300) description?: string;
  @OptionalNotNull() @IsInt() @Min(0) @Max(MISSION_REWARD_POINTS_MAX) rewardPoints?: number;
  @OptionalNotNull() @IsBoolean() disabled?: boolean;
}

export class CreateMissionDto {
  @Trim() @IsString() @IsNotEmpty() @MaxLength(80) title!: string;
  @Trim() @IsString() @MaxLength(300) description!: string;
  @IsIn([...MISSION_KINDS]) kind!: MissionKind;
  /** Trần theo loại kiểm ở service (MISSION_GOAL_MAX); 365 là trần chung của mọi loại. */
  @IsInt() @Min(1) @Max(365) goal!: number;
  @IsInt() @Min(0) @Max(MISSION_REWARD_POINTS_MAX) rewardPoints!: number;
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

  @Post('missions')
  createMission(@CurrentUser('sub') adminId: string, @Body() dto: CreateMissionDto) {
    return this.engagement.createMission(adminId, dto);
  }

  @Patch('missions/:id')
  updateMission(@Param('id') id: string, @Body() dto: UpdateMissionDto) {
    return this.engagement.updateMission(id, dto);
  }
}
