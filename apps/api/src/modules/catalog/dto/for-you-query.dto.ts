import { IsOptional, IsString, Matches } from 'class-validator';
import { SEED_PATTERN } from '../catalog-seed';

/** Query của `GET /products/for-you`: chỉ `seed` (ngày VN) để xoay 10 gợi ý trong ngày. */
export class ForYouQuery {
  @IsOptional() @IsString() @Matches(SEED_PATTERN)
  seed?: string;
}
