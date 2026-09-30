import { useQuery } from '@tanstack/react-query';
import { getCart } from '../services/shop-api';
import { useAuthStore } from '../store/auth';

/** Số món trong giỏ cho header — một hook thay 3 bản useQuery(['cart']) lặp (spec §3.5). Dùng
 * chung queryKey ['cart'] nên không phát sinh request mới; gate theo auth tránh 401. */
export function useCartCount(): number {
  const authed = useAuthStore((s) => s.status === 'authenticated');
  return useQuery({ queryKey: ['cart'], queryFn: getCart, enabled: authed }).data?.itemCount ?? 0;
}
