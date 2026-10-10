import { Controller, Get, Header, Query } from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { PublicCache } from '../../common/decorators/public-cache.decorator';
import { HomeMeQuery } from './dto/home-me-query.dto';
import { HomeService } from './home.service';

@Controller('home')
export class HomeController {
  constructor(private readonly home: HomeService) {}

  /** Khối công khai của Trang chủ, gộp một request. Không đọc người dùng → an toàn cache chung. */
  @Public()
  // LIVE vì blob chứa khối flash sale (quota giảm theo từng đơn).
  @PublicCache('LIVE')
  @Get()
  publicBlocks() {
    return this.home.getPublic();
  }

  /** Khối cá nhân hoá (cần JWT). `private, no-store`: không để proxy/CDN giữ chung giữa các khách. */
  @Get('me')
  @Header('Cache-Control', 'private, no-store')
  me(@CurrentUser('sub') userId: string, @Query() q: HomeMeQuery) {
    return this.home.getForUser(userId, q.purchasedLimit);
  }
}
