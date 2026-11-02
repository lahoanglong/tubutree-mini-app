import { Injectable } from '@nestjs/common';

/**
 * Cờ "danh sách URL ảnh được phép đổi cỡ đã cũ". Không phụ thuộc gì (chỉ là một boolean) nên CatalogModule, PancakeModule và
 * MerchantModule cùng import ImageRegistryModule mà không tạo vòng module. API chạy MỘT tiến trình (một container), nên cờ trong
 * bộ nhớ là đủ; chạy nhiều bản thì bản khác vẫn chỉ biết ảnh mới sau tối đa 5 phút (TTL) hoặc 30 giây (lần tra trượt).
 * Đánh dấu rẻ (không chạm DB); cờ chỉ là boolean nên các lần đánh dấu liên tiếp gộp lại. Có /img xen giữa thì một lượt đồng bộ có thể gây vài lần nạp nối tiếp, mỗi lần một truy vấn rẻ.
 */
@Injectable()
export class ImageRegistryStale {
  private stale = false;

  markStale(): void {
    this.stale = true;
  }

  isStale(): boolean {
    return this.stale;
  }

  /** Gọi ngay trước khi nạp lại: đánh dấu đến sau đó vẫn còn nguyên cho lần nạp kế tiếp. */
  clear(): void {
    this.stale = false;
  }
}
