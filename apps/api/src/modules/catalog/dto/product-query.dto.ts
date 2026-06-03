import { IsIn, IsOptional, IsString } from 'class-validator';
import { PaginationQuery } from '../../../common/pagination';

export class ProductQuery extends PaginationQuery {
  @IsOptional() @IsString() brand?: string;
  @IsOptional() @IsString() category?: string;
  @IsOptional() @IsString() q?: string;

  @IsOptional()
  @IsIn(['price_asc', 'price_desc', 'newest', 'best_seller', 'rating'])
  sort?: 'price_asc' | 'price_desc' | 'newest' | 'best_seller' | 'rating';
}
