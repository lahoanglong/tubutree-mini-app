# 🌳 Tubu Tree API

Backend API cho ứng dụng Tubu Tree Zalo Mini App.

## Cấu trúc dự án

```
tubutree-api/
├── prisma/
│   └── schema.prisma          # Cấu trúc database (các bảng)
├── src/
│   ├── index.ts               # Điểm khởi đầu - cấu hình Express server
│   ├── lib/
│   │   ├── prisma.ts          # Kết nối database (dùng chung)
│   │   └── helpers.ts         # Các hàm tiện ích dùng chung
│   ├── middlewares/
│   │   └── auth.middleware.ts  # Kiểm tra JWT token (xác thực đăng nhập)
│   ├── controllers/           # Logic xử lý cho mỗi API
│   │   ├── auth.controller.ts       # Đăng nhập bằng Zalo
│   │   ├── product.controller.ts    # Sản phẩm (lấy từ Pancake POS)
│   │   ├── cart.controller.ts       # Giỏ hàng
│   │   ├── order.controller.ts      # Đơn hàng
│   │   ├── address.controller.ts    # Địa chỉ giao hàng
│   │   ├── review.controller.ts     # Đánh giá sản phẩm
│   │   ├── wishlist.controller.ts   # Danh sách yêu thích
│   │   ├── banner.controller.ts     # Banner quảng cáo
│   │   ├── notification.controller.ts # Thông báo
│   │   └── webhook.controller.ts    # Nhận cập nhật từ POS
│   ├── services/              # Giao tiếp với bên ngoài
│   │   ├── zalo.service.ts    # Gọi Zalo API (xác thực user)
│   │   ├── pancake.service.ts # Gọi Pancake POS API (sản phẩm, đơn hàng)
│   │   └── redis.service.ts   # Bộ nhớ đệm (tăng tốc tải trang)
│   └── routes/                # Định nghĩa URL cho mỗi API
│       ├── index.ts           # Tổng hợp tất cả route
│       └── *.routes.ts        # Route cho từng module
├── .env.example               # Mẫu cấu hình
├── package.json               # Dependencies
└── tsconfig.json              # Cấu hình TypeScript
```

## Cài đặt và chạy

```bash
# 1. Cài đặt dependencies
npm install

# 2. Tạo file cấu hình
copy .env.example .env
# Sau đó mở .env và điền thông tin thật vào

# 3. Đồng bộ database
npm run db:push

# 4. Chạy server (chế độ phát triển)
npm run dev
```

## Danh sách API

### Công khai (không cần đăng nhập)

| Method | URL | Mô tả |
|--------|-----|--------|
| POST | `/api/auth/login` | Đăng nhập bằng Zalo |
| GET | `/api/products` | Danh sách sản phẩm |
| GET | `/api/products/categories` | Danh mục sản phẩm |
| GET | `/api/products/:sku` | Chi tiết sản phẩm |
| GET | `/api/banners` | Banner đang hoạt động |
| GET | `/api/reviews/product/:id` | Đánh giá của sản phẩm |

### Cần đăng nhập (gửi header `Authorization: Bearer <token>`)

| Method | URL | Mô tả |
|--------|-----|--------|
| GET | `/api/cart` | Xem giỏ hàng |
| POST | `/api/cart` | Thêm vào giỏ |
| PUT | `/api/cart/:id` | Cập nhật số lượng |
| DELETE | `/api/cart/:id` | Xóa khỏi giỏ |
| POST | `/api/orders` | Tạo đơn hàng |
| GET | `/api/orders` | Xem đơn hàng của tôi |
| GET | `/api/orders/:id` | Chi tiết đơn hàng |
| PUT | `/api/orders/:id/cancel` | Hủy đơn |
| POST | `/api/orders/:id/reorder` | Mua lại |
| GET | `/api/addresses` | Xem địa chỉ |
| POST | `/api/addresses` | Thêm địa chỉ |
| PUT | `/api/addresses/:id` | Sửa địa chỉ |
| DELETE | `/api/addresses/:id` | Xóa địa chỉ |
| GET | `/api/wishlists` | Xem yêu thích |
| POST | `/api/wishlists` | Thêm yêu thích |
| DELETE | `/api/wishlists/:id` | Bỏ yêu thích |
| GET | `/api/notifications` | Xem thông báo |
| PUT | `/api/notifications/:id/read` | Đánh dấu đã đọc |
| PUT | `/api/notifications/read-all` | Đánh dấu tất cả đã đọc |
| POST | `/api/reviews` | Viết đánh giá |

### Webhook (POS gọi đến)

| Method | URL | Mô tả |
|--------|-----|--------|
| POST | `/api/webhook/pancake` | Nhận cập nhật trạng thái đơn hàng |

## Luồng hoạt động

```
User mở Mini App
    → Đăng nhập Zalo (lấy accessToken)
    → POST /api/auth/login (đổi accessToken → JWT token)
    → Dùng JWT token cho các request sau

User xem sản phẩm
    → GET /api/products (lấy từ Pancake POS, cache 5 phút)

User đặt hàng
    → POST /api/cart (thêm vào giỏ)
    → POST /api/orders (tạo đơn → gửi lên Pancake POS)
    → POS xác nhận → webhook → gửi thông báo cho user
```
