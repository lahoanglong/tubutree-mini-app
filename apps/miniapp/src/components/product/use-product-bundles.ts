import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { bundleKeys } from '@tubutree/app-core/queries/bundle';
import { getProductBundles } from '../../services/bundle-api';

const STALE_MS = 30_000;
/** Thời gian tối đa trang sản phẩm giữ khung chờ cho khối Combo/Mua kèm; API chậm hơn thì hiện trang trước, khối chèn sau. */
export const PDP_BUNDLES_WAIT_MS = 300;

/** Bộ Combo/Mua kèm của một sản phẩm. Trang gọi hook này cùng lúc với tải sản phẩm (cùng khoá với `PdpBundles` nên chỉ một request). */
export function useProductBundles(slug: string | undefined) {
  return useQuery({
    queryKey: bundleKeys.product(slug ?? ''),
    queryFn: () => getProductBundles(slug!),
    enabled: !!slug,
    staleTime: STALE_MS,
    retry: false,
    // Lỗi thì khối ẩn, không tự gọi lại mỗi lần khối gắn vào: nếu không, truy vấn lỗi về trạng thái đang tải và khung chờ của trang bật lại.
    retryOnMount: false,
  });
}

/**
 * true khi trang nên còn giữ khung chờ vì bộ chưa về (tối đa `PDP_BUNDLES_WAIT_MS`). Khối nằm giữa màn đầu: chèn nó sau khi trang đã vẽ sẽ đẩy
 * các hàng bên dưới (Số lượng, mô tả...) xuống. Về trước hạn (có bộ, rỗng hay lỗi) thì hết chờ ngay; quá hạn thì thôi chờ để API treo không
 * giữ trang, khối sẽ chèn khi về. Chỉ chờ MỘT lần cho mỗi sản phẩm: hết chờ rồi thì lần tải lại sau đó (làm mới nền) không dựng lại khung chờ.
 */
export function useBundlesWait(slug: string | undefined): boolean {
  const loading = useProductBundles(slug).isLoading;
  const [releasedFor, setReleasedFor] = useState<string | undefined>(undefined);
  useEffect(() => {
    if (!loading) {
      setReleasedFor(slug);
      return;
    }
    const timer = setTimeout(() => setReleasedFor(slug), PDP_BUNDLES_WAIT_MS);
    return () => clearTimeout(timer);
  }, [loading, slug]);
  return loading && releasedFor !== slug;
}
