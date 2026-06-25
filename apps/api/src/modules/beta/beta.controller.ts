import { Body, Controller, Get, Post } from '@nestjs/common';
import { IsString, MaxLength, MinLength } from 'class-validator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { BetaService } from './beta.service';

class FeedbackDto {
  @IsString() @MinLength(1) @MaxLength(2000) message!: string;
}

@Controller('beta')
export class BetaController {
  constructor(private readonly beta: BetaService) {}

  @Get('me')
  status(@CurrentUser('sub') userId: string) {
    return this.beta.getStatus(userId);
  }

  @Post('join')
  join(@CurrentUser('sub') userId: string) {
    return this.beta.join(userId);
  }

  @Post('leave')
  leave(@CurrentUser('sub') userId: string) {
    return this.beta.leave(userId);
  }

  @Post('feedback')
  feedback(@CurrentUser('sub') userId: string, @Body() dto: FeedbackDto) {
    return this.beta.submitFeedback(userId, dto.message);
  }
}
