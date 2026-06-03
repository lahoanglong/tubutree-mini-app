/** Shape rút gọn của Pancake POS Open API (Build Spec §8). */

export interface PancakeVariationDTO {
  id: string;
  sku?: string;
  fields?: Record<string, string>;
  retail_price?: number;
  sale_price?: number;
  remain_quantity?: number;
  weight?: number;
}

export interface PancakeProductDTO {
  product_id: string;
  name: string;
  description?: string;
  images?: string[];
  variations?: PancakeVariationDTO[];
}

export interface PancakeProductsResponse {
  data?: PancakeProductDTO[];
  products?: PancakeProductDTO[];
  total?: number;
}

export interface PancakeCreateOrderItem {
  variation_id: string;
  quantity: number;
  discount_each_product?: number;
}

export interface PancakeCreateOrderBody {
  customer: {
    name: string;
    phone_number: string;
    address: string;
    ward_id?: string;
    district_id?: string;
    province_id?: string;
    fb_id?: string;
  };
  items: PancakeCreateOrderItem[];
  shipping_fee: number;
  total_discount: number;
  tags?: string[];
  note?: string;
  extension?: {
    external_order_id?: string;
    invoice_request?: { tax_code: string; company_name: string; address: string; email: string };
  };
}

export interface PancakeCreateOrderResponse {
  id?: string;
  order_id?: string;
  success?: boolean;
}
