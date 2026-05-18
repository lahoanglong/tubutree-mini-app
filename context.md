# 📋 CONTEXT - Ngữ cảnh dự án Tubu Tree

> **Cập nhật lần cuối:** 18/05/2026
> **Trạng thái tổng:** Backend API đã hoàn thành code → Chưa cài đặt / chưa chạy thử

---

## 1. Dự án là gì?

**Tubu Tree** là một **Zalo Mini App thương mại điện tử** (bán hàng online).

Người dùng mở Mini App trong Zalo → xem sản phẩm → thêm giỏ hàng → đặt hàng → thanh toán.

Dữ liệu sản phẩm và đơn hàng được quản lý bởi **Pancake POS** (hệ thống bán hàng bên thứ 3). Backend API đóng vai trò **cầu nối** giữa Mini App và Pancake POS.

---

## 2. Kiến trúc tổng quan

```
┌─────────────────┐     ┌──────────────────┐     ┌───────────────┐
│  Zalo Mini App  │────▶│  Tubu Tree API   │────▶│  Pancake POS  │
│  (Frontend)     │◀────│  (Backend - đây) │◀────│  (Sản phẩm,   │
│  React + ZMP-UI │     │  Node.js Express │     │   đơn hàng)   │
└─────────────────┘     └──────┬───────────┘     └───────────────┘
                               │
                    ┌──────────┼──────────┐
                    │          │          │
              ┌─────┴────┐ ┌──┴───┐ ┌────┴────┐
              │PostgreSQL│ │Redis │ │Zalo API │
              │(Database)│ │(Cache)│ │(Xác thực)│
              └──────────┘ └──────┘ └─────────┘
```

---

## 3. Công nghệ sử dụng

| Thành phần | Công nghệ | Ghi chú |
|-----------|-----------|---------|
| Backend API | Node.js + Express + TypeScript | Đã code xong |
| Database | PostgreSQL 15 | Chạy qua Docker |
| Cache | Redis 7 | Chạy qua Docker |
| ORM | Prisma | Quản lý database schema |
| Xác thực | JWT + Zalo OAuth | Token hết hạn 30 ngày |
| Quản lý sản phẩm | Pancake POS API | Sản phẩm không lưu trong DB |
| Frontend | React + ZMP-UI | ⚠️ **CHƯA LÀM** |
| Admin Panel | Chưa xác định | ⚠️ **CHƯA LÀM** |

---

## 4. Cấu trúc thư mục

```
d:\test\mini_app\
├── docker-compose.yml              ← Cấu hình Docker (PostgreSQL + Redis)
├── tubutree-api/                   ← Bản code local (có thể xóa, dùng bản Git)
└── tubutree-mini-app/              ← ⭐ REPO GIT CHÍNH (clone từ GitHub)
    ├── .gitignore
    ├── context.md                  ← 📋 BẠN ĐANG ĐỌC FILE NÀY
    ├── docker-compose.yml
    └── tubutree-api/              ← Backend API
        ├── .env.example           ← Mẫu cấu hình (copy thành .env)
        ├── README.md              ← Hướng dẫn chi tiết
        ├── package.json           ← Dependencies
        ├── tsconfig.json
        ├── prisma/
        │   └── schema.prisma     ← Cấu trúc 10 bảng database
        └── src/
            ├── index.ts           ← Entry point (khởi chạy server)
            ├── lib/               ← Module dùng chung
            │   ├── prisma.ts      ← Kết nối DB (1 instance duy nhất)
            │   └── helpers.ts     ← Hàm tiện ích (getUserId, handleError...)
            ├── middlewares/
            │   └── auth.middleware.ts  ← Kiểm tra JWT token
            ├── controllers/       ← Logic xử lý 10 module
            ├── services/          ← Giao tiếp bên ngoài
            │   ├── zalo.service.ts     ← Zalo API (xác thực user)
            │   ├── pancake.service.ts  ← Pancake POS (sản phẩm, đơn hàng)
            │   └── redis.service.ts    ← Redis cache
            └── routes/            ← Định nghĩa URL API
```

---

## 5. Database - 10 bảng

| Bảng | Vai trò | Ghi chú |
|------|---------|---------|
| User | Người dùng | Đăng nhập bằng Zalo |
| Address | Địa chỉ giao hàng | 1 user → nhiều địa chỉ |
| CartItem | Giỏ hàng | Unique: user + product + variant |
| OrderRef | Tham chiếu đơn hàng | Chi tiết đơn nằm trên POS |
| Review | Đánh giá sản phẩm | 1-5 sao + comment + ảnh |
| Wishlist | Yêu thích | Unique: user + product |
| Notification | Thông báo | Tự tạo khi đơn hàng thay đổi |
| Banner | Banner quảng cáo | Có thời gian hiển thị |
| FlashSale | Flash sale | Giá sale + thời gian + tồn kho |
| SearchHistory | Lịch sử tìm kiếm | Lưu từ khóa |
| Setting | Cài đặt hệ thống | Key-value linh hoạt |

---

## 6. Danh sách API (27 endpoints)

### Công khai (không cần đăng nhập)
- `POST /api/auth/login` — Đăng nhập bằng Zalo
- `GET /api/products` — Danh sách sản phẩm
- `GET /api/products/categories` — Danh mục
- `GET /api/products/:sku` — Chi tiết sản phẩm
- `GET /api/banners` — Banner đang hoạt động
- `GET /api/reviews/product/:id` — Đánh giá sản phẩm

### Cần đăng nhập (JWT token)
- Giỏ hàng: GET, POST, PUT, DELETE `/api/cart`
- Đơn hàng: POST, GET, GET/:id, PUT/:id/cancel, POST/:id/reorder `/api/orders`
- Địa chỉ: GET, POST, PUT, DELETE `/api/addresses`
- Yêu thích: GET, POST, DELETE `/api/wishlists`
- Thông báo: GET, PUT/:id/read, PUT/read-all `/api/notifications`
- Đánh giá: POST `/api/reviews`

### Webhook
- `POST /api/webhook/pancake` — Nhận cập nhật từ POS

### Admin (TODO: thêm xác thực admin)
- Banner CRUD: `/api/banners/admin`

---

## 7. Tiến độ chi tiết

### ✅ Đã hoàn thành

| Hạng mục | Trạng thái | Ngày |
|----------|-----------|------|
| Lên kế hoạch kiến trúc | ✅ Xong | 07/05/2026 |
| Thiết kế database schema (Prisma) | ✅ Xong | 08/05/2026 |
| Docker Compose (PostgreSQL + Redis) | ✅ Xong | 08/05/2026 |
| Backend API - tất cả controllers | ✅ Xong | 16/05/2026 |
| Backend API - tất cả routes | ✅ Xong | 16/05/2026 |
| Backend API - services (Zalo, Pancake, Redis) | ✅ Xong | 16/05/2026 |
| Backend API - auth middleware (JWT) | ✅ Xong | 16/05/2026 |
| Đơn giản hóa code + comment tiếng Việt | ✅ Xong | 18/05/2026 |
| Push code lên GitHub | ✅ Xong | 18/05/2026 |

### 🔲 Chưa làm

| Hạng mục | Ưu tiên | Ghi chú |
|----------|---------|---------|
| `npm install` + cài dependencies | 🔴 Cao | Chưa chạy |
| Tạo file `.env` với thông tin thật | 🔴 Cao | Cần Zalo App ID, Pancake API Key |
| Chạy Docker (PostgreSQL + Redis) | 🔴 Cao | `docker-compose up -d` |
| Chạy `npm run db:push` (tạo bảng DB) | 🔴 Cao | Sau khi Docker chạy |
| Chạy server `npm run dev` (test thử) | 🔴 Cao | Kiểm tra API hoạt động |
| Input validation chi tiết | 🟡 Trung bình | Hiện chỉ kiểm tra cơ bản |
| Admin authentication middleware | 🟡 Trung bình | Banner admin chưa có bảo vệ |
| Rate limiting | 🟡 Trung bình | Chống spam API |
| Frontend (Zalo Mini App - React) | 🔴 Cao | **Chưa bắt đầu** |
| Admin Panel (quản lý banner, thống kê) | 🟡 Trung bình | **Chưa bắt đầu** |
| Tích hợp thanh toán VietQR / ZaloPay | 🟡 Trung bình | Có cấu hình .env, chưa code |
| Deploy lên server production | 🟢 Thấp | Sau khi test xong |

---

## 8. Thông tin cần chuẩn bị

Để chạy được dự án, cần điền vào file `.env`:

| Biến | Lấy ở đâu | Đã có? |
|------|-----------|--------|
| `DATABASE_URL` | Docker Compose tự tạo | ✅ Mặc định OK |
| `REDIS_URL` | Docker Compose tự tạo | ✅ Mặc định OK |
| `ZALO_APP_ID` | https://developers.zalo.me | ❌ Chưa có |
| `ZALO_APP_SECRET` | https://developers.zalo.me | ❌ Chưa có |
| `PANCAKE_SHOP_ID` | Pancake Dashboard → Settings | ❌ Chưa có |
| `PANCAKE_API_KEY` | Pancake Dashboard → Settings → API | ❌ Chưa có |
| `JWT_SECRET` | Tự tạo chuỗi ngẫu nhiên | ✅ Có mặc định |
| `VIETQR_*` | Thông tin ngân hàng | ❌ Chưa có |

---

## 9. Lệnh khởi chạy nhanh

```bash
# 1. Vào thư mục dự án
cd d:\test\mini_app\tubutree-mini-app

# 2. Chạy PostgreSQL + Redis
docker-compose up -d

# 3. Cài dependencies
cd tubutree-api
npm install

# 4. Tạo file cấu hình
copy .env.example .env
# → Mở .env và điền ZALO_APP_ID, PANCAKE_SHOP_ID, PANCAKE_API_KEY

# 5. Tạo bảng database
npm run db:push

# 6. Chạy server
npm run dev
# → Server chạy tại http://localhost:3000
```

---

## 10. Git Repository

- **URL:** https://github.com/lahoanglong/tubutree-mini-app
- **Local:** `d:\test\mini_app\tubutree-mini-app\`
- **Branch:** main

---

## 11. Bước tiếp theo gợi ý

1. **Cài đặt và chạy thử Backend API** (mục 9 ở trên)
2. **Test API bằng Postman/Thunder Client** — đảm bảo các endpoint hoạt động
3. **Bắt đầu làm Frontend** — Zalo Mini App bằng React + ZMP-UI
4. **Làm Admin Panel** — quản lý banner, xem thống kê đơn hàng
5. **Tích hợp thanh toán** — VietQR / ZaloPay
