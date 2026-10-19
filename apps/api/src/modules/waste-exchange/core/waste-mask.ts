import { maskFullName } from '../../../common/mask-name';
import { maskPhoneOrNull } from '../../../common/mask-pii';

export function customerView(
  u: { fullName: string | null; phone: string | null; id: string },
  viewerIsAdmin: boolean,
  includeUserId = false,
): { name: string; phone: string | null; userId?: string } {
  if (!viewerIsAdmin) return { name: maskFullName(u.fullName), phone: maskPhoneOrNull(u.phone) };
  return {
    name: u.fullName?.trim() ? u.fullName : 'Khách Tubu',
    phone: u.phone,
    ...(includeUserId ? { userId: u.id } : {}),
  };
}
