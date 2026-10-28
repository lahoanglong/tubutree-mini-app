import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsIn, IsInt, IsNotEmpty, IsOptional, IsString, MaxLength, Min } from 'class-validator';
import { Roles } from '../../common/decorators/roles.decorator';
import { OptionalNotNull } from '../../common/decorators/optional-not-null.decorator';
import { PaginationQuery } from '../../common/pagination';
import { GameQuizService, QUIZ_CATEGORIES, QUIZ_DIFFICULTIES } from '../game/game-quiz.service';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
const trimEach = ({ value }: { value: unknown }) => (Array.isArray(value) ? value.map((v) => (typeof v === 'string' ? v.trim() : v)) : value);
/** Chuỗi rỗng nghĩa là xoá giá trị (cột cho phép null). */
const blankToNull = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() || null : value);

export class CreateQuizDto {
  @Transform(trim) @IsString() @IsNotEmpty() @MaxLength(300) question!: string;
  @Transform(trimEach) @IsArray() @ArrayMinSize(2) @ArrayMaxSize(4) @IsString({ each: true }) @IsNotEmpty({ each: true }) @MaxLength(120, { each: true }) options!: string[];
  @IsInt() @Min(0) correct!: number;
  @IsIn(QUIZ_CATEGORIES) category!: string;
  @IsIn(QUIZ_DIFFICULTIES) difficulty!: number;
  @IsOptional() @Transform(blankToNull) @IsString() @MaxLength(500) explanation?: string | null;
}

export class UpdateQuizDto {
  @OptionalNotNull() @Transform(trim) @IsString() @IsNotEmpty() @MaxLength(300) question?: string;
  @OptionalNotNull() @Transform(trimEach) @IsArray() @ArrayMinSize(2) @ArrayMaxSize(4) @IsString({ each: true }) @IsNotEmpty({ each: true }) @MaxLength(120, { each: true }) options?: string[];
  @OptionalNotNull() @IsInt() @Min(0) correct?: number;
  @OptionalNotNull() @IsIn(QUIZ_CATEGORIES) category?: string;
  @OptionalNotNull() @IsIn(QUIZ_DIFFICULTIES) difficulty?: number;
  @IsOptional() @Transform(blankToNull) @IsString() @MaxLength(500) explanation?: string | null;
}

/**
 * Câu đố hằng ngày của Vườn Xanh (bảng game_quizzes): chỉ xem, thêm, sửa. Không xoá và không bật/tắt vì bảng không có cờ
 * bật/tắt; thưởng nước theo độ khó, thưởng điểm luôn 0 và không nhận từ client.
 */
@ApiTags('admin-engagement')
@Roles('ADMIN')
@Controller('admin/engagement/quiz')
export class AdminGameQuizController {
  constructor(private readonly quizzes: GameQuizService) {}

  @Get()
  list(@Query() q: PaginationQuery) {
    return this.quizzes.listForAdmin(q.page, q.limit);
  }

  @Post()
  create(@Body() dto: CreateQuizDto) {
    return this.quizzes.createForAdmin(dto);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateQuizDto) {
    return this.quizzes.updateForAdmin(id, dto);
  }
}
