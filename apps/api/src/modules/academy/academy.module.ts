import { Module } from '@nestjs/common';
import { AcademyService } from './academy.service';
import { AcademyController } from './academy.controller';
import { AcademyAdminController } from './academy-admin.controller';

@Module({
  controllers: [AcademyController, AcademyAdminController],
  providers: [AcademyService],
  exports: [AcademyService],
})
export class AcademyModule {}
