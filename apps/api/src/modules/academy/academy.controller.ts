import { Controller, Get, Param, Post } from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AcademyService } from './academy.service';

/** CTV Academy: khoá học/bài học đào tạo CTV — xem danh sách, chi tiết, đánh dấu đã học. */
@Controller('academy')
export class AcademyController {
  constructor(private readonly academy: AcademyService) {}

  @Get('courses')
  listCourses(@CurrentUser('sub') userId: string) {
    return this.academy.listCourses(userId);
  }

  @Get('courses/:id')
  getCourse(@CurrentUser('sub') userId: string, @Param('id') id: string) {
    return this.academy.getCourse(userId, id);
  }

  @Post('lessons/:id/complete')
  completeLesson(@CurrentUser('sub') userId: string, @Param('id') id: string) {
    return this.academy.completeLesson(userId, id);
  }
}
