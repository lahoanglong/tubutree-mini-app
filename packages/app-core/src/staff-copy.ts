/**
 * Lời báo sau khi admin lưu quyền theo SĐT. Vai trò không đổi mà nhóm việc đã đổi ngay thì không được nói "sẽ áp khi họ mở app";
 * người đã là nhân viên mà nhóm không đổi thì cũng không có gì đang chờ áp.
 */
export function grantDoneText(
  r: { applied: boolean; permissionsChanged?: boolean },
  phone: string,
  permissionNames: readonly string[],
  alreadyStaff = false,
): string {
  if (r.applied) return 'Đã cấp quyền & áp ngay.';
  if (r.permissionsChanged) return `Đã đổi nhóm việc của ${phone} thành ${permissionNames.join(', ')}.`;
  if (alreadyStaff) return `${phone} đã là nhân viên, nhóm việc giữ nguyên.`;
  return 'Đã lưu quyền (sẽ áp khi họ mở app).';
}

/**
 * Dòng gợi ý dưới ô chọn nhóm việc ở form Thêm nhân sự. `existingNames` là nhóm đang có của người có SĐT đang gõ khi họ đã là nhân viên
 * (null = chưa phải): máy chủ thay nhóm cũ bằng nhóm vừa chọn, chọn trống thì giữ nguyên. `pendingNames` là nhóm của lời mời đang chờ
 * trùng SĐT (chỉ xét khi chưa là nhân viên): chọn nhóm thì thay nhóm của lời mời, chọn trống thì lời mời giữ nhóm cũ.
 */
export function grantPermissionsHint(existingNames: readonly string[] | null, pendingNames: readonly string[] | null = null): string {
  if (existingNames !== null) {
    const current = existingNames.length ? existingNames.join(', ') : 'chưa có nhóm nào';
    return `Người này đã là nhân viên. Nhóm đang có: ${current}. Chọn nhóm: lưu sẽ thay bằng nhóm bạn chọn. Không chọn nhóm nào: giữ nguyên nhóm đang có.`;
  }
  if (pendingNames && pendingNames.length) {
    return `Lời mời đang chờ với nhóm: ${pendingNames.join(', ')}. Chọn nhóm: lưu sẽ thay bằng nhóm bạn chọn. Không chọn nhóm nào: giữ nguyên nhóm của lời mời.`;
  }
  return 'Không chọn nhóm nào: chỉ dùng quầy thu ngân, Đổi rác và chấm công.';
}
