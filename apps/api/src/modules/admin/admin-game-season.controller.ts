import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsDate, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';
import { Roles } from '../../common/decorators/roles.decorator';
import { OptionalNotNull } from '../../common/decorators/optional-not-null.decorator';
import { AdminGameSeasonService } from './admin-game-season.service';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
/** Chuỗi rỗng nghĩa là xoá giá trị (cột cho phép null). */
const blankToNull = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() || null : value);

export class CreateSeasonDto {
  @Transform(trim) @IsString() @IsNotEmpty() @MaxLength(80) name!: string;
  @IsOptional() @Transform(blankToNull) @IsString() @MaxLength(120) theme?: string | null;
  @IsOptional() @Transform(blankToNull) @IsString() @MaxLength(80) region?: string | null;
  @Type(() => Date) @IsDate() startAt!: Date;
  @Type(() => Date) @IsDate() endAt!: Date;
}

export class UpdateSeasonDto {
  @OptionalNotNull() @Transform(trim) @IsString() @IsNotEmpty() @MaxLength(80) name?: string;
  @IsOptional() @Transform(blankToNull) @IsString() @MaxLength(120) theme?: string | null;
  @IsOptional() @Transform(blankToNull) @IsString() @MaxLength(80) region?: string | null;
  @OptionalNotNull() @Type(() => Date) @IsDate() startAt?: Date;
  @OptionalNotNull() @Type(() => Date) @IsDate() endAt?: Date;
}

@ApiTags('admin-engagement')
@Roles('ADMIN')
@Controller('admin/engagement/seasons')
export class AdminGameSeasonController {
  constructor(private readonly seasons: AdminGameSeasonService) {}

  @Get()
  list() {
    return this.seasons.list();
  }

  @Post()
  create(@Body() dto: CreateSeasonDto) {
    return this.seasons.create(dto);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateSeasonDto) {
    return this.seasons.update(id, dto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.seasons.remove(id);
  }
}
