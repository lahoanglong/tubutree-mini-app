import { IsIn, IsOptional } from 'class-validator';
import { PaginationQuery } from '../../../common/pagination';
import { PRODUCT_SORTS, type ProductSort } from './product-query.dto';

/** `GET /brand/public/:slug/products`: trang và kiểu sắp xếp như `/products`, không có bộ lọc khác (nhãn đã cố định bởi slug). */
export class BrandProductsQuery extends PaginationQuery {
  @IsOptional()
  @IsIn([...PRODUCT_SORTS])
  sort?: ProductSort;
}
