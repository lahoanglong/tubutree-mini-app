/**
 * BOOTSTRAP-ONLY: cấp role ADMIN cho 1 user theo SĐT (tạo user nếu chưa có).
 *
 * Dùng khi CHƯA có admin nào để đăng nhập web panel (admin đầu tiên), hoặc user đích chưa
 * mở Mini App lần nào (chưa có User row). Với các lần cấp quyền THÔNG THƯỜNG (đã có admin),
 * dùng trang Admin → tab "Người dùng" → "Cấp / đổi vai trò" (POST /admin/users/role,
 * có @Roles('ADMIN') + log ai đổi) thay vì chạy script SSH này.
 *
 * KHÔNG hardcode SĐT trong source (repo public) — luôn đọc từ env ADMIN_PHONE.
 * Dùng: ADMIN_PHONE=<số điện thoại> node scripts/grant-admin.js
 * SĐT được chuẩn hoá về dạng User.phone vẫn lưu (0xxxxxxxxx, 10 số) trước khi tra: nhập +84912345678 hay 84912345678 đều
 * ra 0912345678, không thì script tạo thêm một user ADMIN mới thay vì nâng user Zalo thật.
 * (trên VM prod: gọi qua .github/workflows/ops.yml action=grant-admin, secret ADMIN_PHONE)
 */
const { PrismaClient } = require('@prisma/client');

// Cùng luật với normalizeZaloPhone (src/common/phone.ts); script chạy bằng node thuần trong image nên không import được bản TS.
function normalizeAdminPhone(raw) {
  if (!raw) return null;
  const digits = String(raw).replace(/[^0-9]/g, '');
  if (!digits) return null;
  let formatted = digits;
  if (digits.startsWith('84')) formatted = `0${digits.slice(2)}`;
  else if (!digits.startsWith('0')) formatted = `0${digits}`;
  return /^0\d{9}$/.test(formatted) ? formatted : null;
}

async function main(prisma) {
  const raw = process.env.ADMIN_PHONE;
  if (!raw) throw new Error('Thiếu env ADMIN_PHONE');
  const phone = normalizeAdminPhone(raw);
  if (!phone) throw new Error('ADMIN_PHONE phải là SĐT Việt Nam 10 số (0912345678, +84912345678 hoặc 84912345678)');

  const existing = await prisma.user.findUnique({ where: { phone } });
  if (existing) {
    await prisma.user.update({ where: { phone }, data: { role: 'ADMIN' } });
    console.log(`OK: user hiện có (id=${existing.id}) đã set role=ADMIN.`);
    return;
  }

  const suffix = phone.slice(-6);
  const user = await prisma.user.create({
    data: {
      phone,
      fullName: `Admin ${suffix}`,
      role: 'ADMIN',
      referralCode: `ADMIN${suffix}${Date.now().toString(36).slice(-4)}`,
    },
  });
  console.log(`OK: user mới (id=${user.id}) tạo với role=ADMIN.`);
}

if (require.main === module) {
  const prisma = new PrismaClient();
  main(prisma)
    .catch((e) => {
      console.error('FAIL:', e.message);
      process.exit(1);
    })
    .finally(() => prisma.$disconnect());
}

module.exports = { normalizeAdminPhone };
