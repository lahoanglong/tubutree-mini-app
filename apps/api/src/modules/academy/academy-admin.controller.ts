import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { Roles } from '../../common/decorators/roles.decorator';
import type { AcademyService } from './academy.service';
import type { CreateCourseDto, CreateLessonDto, UpdateCourseDto, UpdateLessonDto } from './dto/academy.dto';

/** Admin: quản lý khoá học/bài học CTV Academy (courses + lessons CRUD). */
@Roles('ADMIN')
@Controller('admin/academy')
export class AcademyAdminController {
  constructor(private readonly academy: AcademyService) {}

  @Get('courses')
  listCourses() {
    return this.academy.adminListCourses();
  }

  @Post('courses')
  createCourse(@Body() dto: CreateCourseDto) {
    return this.academy.createCourse(dto);
  }

  @Patch('courses/:id')
  updateCourse(@Param('id') id: string, @Body() dto: UpdateCourseDto) {
    return this.academy.updateCourse(id, dto);
  }

  @Delete('courses/:id')
  deleteCourse(@Param('id') id: string) {
    return this.academy.deleteCourse(id);
  }

  @Post('courses/:id/lessons')
  addLesson(@Param('id') courseId: string, @Body() dto: CreateLessonDto) {
    return this.academy.addLesson(courseId, dto);
  }

  @Patch('lessons/:id')
  updateLesson(@Param('id') id: string, @Body() dto: UpdateLessonDto) {
    return this.academy.updateLesson(id, dto);
  }

  @Delete('lessons/:id')
  deleteLesson(@Param('id') id: string) {
    return this.academy.deleteLesson(id);
  }
}
