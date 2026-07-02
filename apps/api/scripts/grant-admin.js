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
 * (trên VM prod: gọi qua .github/workflows/ops.yml action=grant-admin, secret ADMIN_PHONE)
 */
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const phone = process.env.ADMIN_PHONE;
  if (!phone) throw new Error('Thiếu env ADMIN_PHONE');

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

main()
  .catch((e) => {
    console.error('FAIL:', e.message);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
