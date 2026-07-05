import { IsBoolean, IsIn, IsInt, IsOptional, IsString, Min } from 'class-validator';

export class CreateCourseDto {
  @IsString() title!: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsString() coverUrl?: string;
  @IsOptional() @IsInt() @Min(0) sortOrder?: number;
  @IsOptional() @IsBoolean() isPublished?: boolean;
}

export class UpdateCourseDto {
  @IsOptional() @IsString() title?: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsString() coverUrl?: string;
  @IsOptional() @IsInt() @Min(0) sortOrder?: number;
  @IsOptional() @IsBoolean() isPublished?: boolean;
}

export class CreateLessonDto {
  @IsString() title!: string;
  @IsIn(['VIDEO', 'ARTICLE']) contentType!: 'VIDEO' | 'ARTICLE';
  @IsOptional() @IsString() videoUrl?: string;
  @IsOptional() @IsString() body?: string;
  @IsOptional() @IsInt() @Min(0) sortOrder?: number;
}

export class UpdateLessonDto {
  @IsOptional() @IsString() title?: string;
  @IsOptional() @IsIn(['VIDEO', 'ARTICLE']) contentType?: 'VIDEO' | 'ARTICLE';
  @IsOptional() @IsString() videoUrl?: string;
  @IsOptional() @IsString() body?: string;
  @IsOptional() @IsInt() @Min(0) sortOrder?: number;
}
