-- Lời mời nhân sự (RoleGrant) mang theo nhóm việc để người được mời mở app lần đầu là có đúng quyền.
-- Chỉ thêm: cột mảng mặc định rỗng, lời mời hiện có giữ hành vi cũ (không nhóm).

-- AlterTable
ALTER TABLE "role_grants" ADD COLUMN     "staffPermissions" TEXT[] DEFAULT ARRAY[]::TEXT[];
