# Cộng đồng "Vườn Tubu" — Pha 1b (Frontend) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Xây giao diện Mini App cho cộng đồng hỏi–đáp shoppable, tiêu thụ API Pha 1a: bảng tin theo danh mục, composer nhiều loại bài (Hỏi đáp/Khoe vườn/Mẹo) có ảnh + gắn sản phẩm, trang chi tiết bài với trả lời + best-answer + "Mua cây này", hiện tên+avatar+badge chuyên gia.

**Architecture:** Rewrite `apps/miniapp/src/pages/feed.tsx` + `apps/miniapp/src/services/feed-api.ts` (chỉ `feed.tsx` import feed-api → an toàn). Thêm trang `post-detail.tsx` (route `/feed/:id`), component composer (Sheet) + product-picker. Thêm 1 endpoint backend nhỏ `GET /feed/categories` (danh mục hiện chỉ được seed, chưa có API đọc). Tái dùng: `MultiImageUpload`, `ProductCard`, `PullToRefresh`, `useAuthStore`, `getErrorMessage`, `useDebounced`, lucide icons, `vi` i18n.

**Tech Stack:** React 18 + zmp-ui (ZaUI) + @tanstack/react-query v5 (useInfiniteQuery cursor), zustand auth store, lucide-react, Cloudinary (client upload). Backend: NestJS (1 endpoint bổ sung).

## Global Constraints

- **API contract (Pha 1a, cố định):** `GET /feed?category=&kind=&sort=new|popular&cursor=` → `{ posts: FeedItem[], nextCursor: string|null }`; `GET /feed/:id` → FeedItem; `POST /feed {kind?,categoryId?,title?,body,images?,productSlugs?}` → `{id}`; `PATCH /feed/:id {title?,body?,images?}`; `DELETE /feed/:id`; `POST /feed/:id/react` → `{liked}`; `GET /feed/:id/comments` → Comment[]; `POST /feed/:id/comments {body}` → `{id}`; `POST /feed/:id/best-answer/:commentId`. Tạo bài `kind ∈ {MANUAL,QUESTION,SHOWCASE,TIP}` (HARVEST/MILESTONE/SPECIES chỉ auto-post). QUESTION bắt buộc `title`. Giới hạn: title ≤160, body 1..5000, ảnh ≤6, productSlugs ≤5, comment 1..500.
- **FeedItem shape:** `{ id, kind, status, title:string|null, body, images:string[], meta, createdAt, author:string, avatar:string|null, badge:'EXPERT'|null, category:{slug,name,icon}|null, productTags:{slug,name,thumbnail,salePrice,basePrice}[], likeCount, commentCount, liked, bestCommentId:string|null }`. **Comment shape:** `{ id, body, author, avatar:string|null, badge:'EXPERT'|null, isAccepted, createdAt }`.
- Auth: xem cộng đồng yêu cầu đăng nhập (giữ như feed hiện tại). Lấy user role qua `useAuthStore((s) => s.user?.role)`; auth gate qua `login()`.
- Copy tiếng Việt qua `vi.community.*` (KHÔNG hard-code chuỗi trong JSX — sửa luôn nợ kỹ thuật của feed.tsx cũ). Lỗi qua `getErrorMessage` từ `services/api.ts` (KHÔNG dùng helper `msg()` cũ).
- Icon chức năng dùng `lucide-react`; giữ emoji cho danh mục/loại bài minh hoạ.
- Điều hướng dùng `useNavigate`/`useParams` từ `zmp-ui` (KHÔNG từ react-router-dom).
- Verify FE: `pnpm --filter @tubutree/miniapp typecheck` (tsc --noEmit) + `pnpm --filter @tubutree/miniapp build` (tsc + vite build). Miniapp KHÔNG có jest — không viết unit test FE; gate là typecheck + build sạch. Verify hành vi bằng chạy app để sau (ngoài phạm vi plan này).
- Backend verify: `pnpm --filter @tubutree/api test` (jest) cho task backend.
- Không phá module khác: chỉ `feed.tsx` import `feed-api.ts`. `ProductCard` prop `{ product: ProductCard }` — chip gắn SP có thể dùng bản rút gọn riêng (productTags không đủ field cho ProductCard đầy đủ).

---

### Task 1 (Backend): Endpoint `GET /feed/categories`

**Files:**
- Modify: `apps/api/src/modules/feed/community-feed.service.ts`
- Modify: `apps/api/src/modules/feed/community-feed.controller.ts`
- Modify: `apps/api/src/modules/feed/community-feed.service.spec.ts`

**Interfaces:**
- Produces: `CommunityFeedService.getCategories()` → `Promise<{ slug: string; name: string; icon: string | null }[]>` (chỉ `isActive`, sắp theo `order` asc); endpoint `GET /feed/categories` (đặt TRƯỚC `GET /feed/:id` trong controller để không bị nuốt bởi route param).

- [ ] **Step 1: Viết test thất bại**

Thêm vào `community-feed.service.spec.ts` (thêm `communityCategory.findMany` vào `makePrisma()` base: `communityCategory: { findMany: jest.fn().mockResolvedValue([]) }`):

```typescript
describe('CommunityFeedService.getCategories', () => {
  it('trả danh mục active, sắp theo order, map slug/name/icon', async () => {
    const prisma = makePrisma();
    (prisma.communityCategory.findMany as jest.Mock).mockResolvedValue([
      { slug: 'cham-soc', name: 'Chăm sóc cây', icon: '🌱' },
    ]);
    const r = await makeSvc(prisma).getCategories();
    expect(prisma.communityCategory.findMany).toHaveBeenCalledWith({
      where: { isActive: true },
      orderBy: { order: 'asc' },
      select: { slug: true, name: true, icon: true },
    });
    expect(r).toEqual([{ slug: 'cham-soc', name: 'Chăm sóc cây', icon: '🌱' }]);
  });
});
```

- [ ] **Step 2: Chạy test để xác nhận fail**

Run: `pnpm --filter @tubutree/api test -- community-feed.service.spec`
Expected: FAIL — `getCategories is not a function`.

- [ ] **Step 3: Thêm method vào service**

Trong `community-feed.service.ts` thêm:

```typescript
  async getCategories() {
    return this.prisma.communityCategory.findMany({
      where: { isActive: true },
      orderBy: { order: 'asc' },
      select: { slug: true, name: true, icon: true },
    });
  }
```

- [ ] **Step 4: Thêm endpoint vào controller (TRƯỚC route `:id`)**

Trong `community-feed.controller.ts`, thêm ngay sau `@Get()` getFeed và TRƯỚC `@Get(':id')`:

```typescript
  @Get('categories')
  categories() {
    return this.feed.getCategories();
  }
```

- [ ] **Step 5: Chạy test + typecheck**

Run: `pnpm --filter @tubutree/api test -- community-feed.service.spec && pnpm --filter @tubutree/api typecheck`
Expected: PASS + typecheck sạch.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules/feed/
git commit -m "feat(community): GET /feed/categories cho FE tabs danh mục"
```

---

### Task 2 (FE): Rewrite `feed-api.ts` + `suggestProducts` + i18n `community`

**Files:**
- Rewrite: `apps/miniapp/src/services/feed-api.ts`
- Modify: `apps/miniapp/src/services/shop-api.ts` (thêm `suggestProducts`)
- Modify: `apps/miniapp/src/i18n/vi.ts` (thêm namespace `community`)

**Interfaces:**
- Produces (feed-api): types `FeedPostKind`, `FeedItem`, `FeedComment`, `FeedCategory`, `ProductTag`, `FeedPage`; functions `getCategories()`, `getFeed(params)`, `getPost(id)`, `createPost(input)`, `editPost(id,patch)`, `deletePost(id)`, `reactPost(id)`, `getComments(id)`, `addComment(id,body)`, `setBestAnswer(id,commentId)`.
- Produces (shop-api): `suggestProducts(q)` → `Promise<{slug,name,thumbnail,basePrice}[]>`.

- [ ] **Step 1: Rewrite `apps/miniapp/src/services/feed-api.ts`**

```typescript
import { api } from './api';

export type FeedPostKind = 'MANUAL' | 'HARVEST' | 'MILESTONE' | 'SPECIES' | 'QUESTION' | 'SHOWCASE' | 'TIP';
export type FeedSort = 'new' | 'popular';

export interface ProductTag {
  slug: string;
  name: string;
  thumbnail: string | null;
  salePrice: number | null;
  basePrice: number;
}
export interface FeedCategory {
  slug: string;
  name: string;
  icon: string | null;
}
export interface FeedItem {
  id: string;
  kind: FeedPostKind;
  status: string;
  title: string | null;
  body: string;
  images: string[];
  meta: unknown;
  createdAt: string;
  author: string;
  avatar: string | null;
  badge: 'EXPERT' | null;
  category: FeedCategory | null;
  productTags: ProductTag[];
  likeCount: number;
  commentCount: number;
  liked: boolean;
  bestCommentId: string | null;
}
export interface FeedComment {
  id: string;
  body: string;
  author: string;
  avatar: string | null;
  badge: 'EXPERT' | null;
  isAccepted: boolean;
  createdAt: string;
}
export interface FeedPage {
  posts: FeedItem[];
  nextCursor: string | null;
}
export interface CreatePostInput {
  kind: Exclude<FeedPostKind, 'HARVEST' | 'MILESTONE' | 'SPECIES'>;
  categoryId?: string;
  title?: string;
  body: string;
  images?: string[];
  productSlugs?: string[];
}

export const getCategories = () =>
  api.get<FeedCategory[]>('/feed/categories').then((r) => r.data);

export const getFeed = (params: { category?: string; kind?: string; sort?: FeedSort; cursor?: string } = {}) =>
  api.get<FeedPage>('/feed', { params }).then((r) => r.data);

export const getPost = (id: string) => api.get<FeedItem>(`/feed/${id}`).then((r) => r.data);

export const createPost = (input: CreatePostInput) =>
  api.post<{ id: string }>('/feed', input).then((r) => r.data);

export const editPost = (id: string, patch: { title?: string; body?: string; images?: string[] }) =>
  api.patch<{ ok: boolean }>(`/feed/${id}`, patch).then((r) => r.data);

export const deletePost = (id: string) => api.delete<{ ok: boolean }>(`/feed/${id}`).then((r) => r.data);

export const reactPost = (id: string) =>
  api.post<{ liked: boolean }>(`/feed/${id}/react`).then((r) => r.data);

export const getComments = (id: string) =>
  api.get<FeedComment[]>(`/feed/${id}/comments`).then((r) => r.data);

export const addComment = (id: string, body: string) =>
  api.post<{ id: string }>(`/feed/${id}/comments`, { body }).then((r) => r.data);

export const setBestAnswer = (id: string, commentId: string) =>
  api.post<{ ok: boolean }>(`/feed/${id}/best-answer/${commentId}`).then((r) => r.data);
```

- [ ] **Step 2: Thêm `suggestProducts` vào `shop-api.ts`**

Thêm ngay dưới `fetchBoughtTogether` (cạnh các catalog helper):

```typescript
export interface ProductSuggestion { slug: string; name: string; thumbnail: string | null; basePrice: number; }
export const suggestProducts = (q: string) =>
  api.get<ProductSuggestion[]>('/search/suggest', { params: { q } }).then((r) => r.data);
```

- [ ] **Step 3: Thêm namespace `community` vào `vi.ts`**

Thêm 1 key `community` vào object `vi` (theo shape hiện có):

```typescript
  community: {
    title: 'Cộng đồng Vườn Tubu',
    subtitle: 'Hỏi đáp chăm cây, khoe vườn, cổ vũ nhau 🌿',
    tabAll: 'Tất cả',
    sortNew: 'Mới nhất',
    sortPopular: 'Nổi bật',
    compose: 'Đăng bài',
    kindQuestion: 'Hỏi đáp',
    kindShowcase: 'Khoe vườn',
    kindTip: 'Mẹo hay',
    titlePlaceholder: 'Tiêu đề câu hỏi (vd: Lá cây lưỡi hổ bị vàng?)',
    bodyPlaceholder: 'Chia sẻ chi tiết…',
    pickCategory: 'Chọn danh mục',
    addPhotos: 'Thêm ảnh',
    tagProducts: 'Gắn sản phẩm',
    searchProduct: 'Tìm sản phẩm để gắn…',
    maxProducts: 'Chỉ gắn tối đa 5 sản phẩm',
    post: 'Đăng',
    posted: 'Đã đăng bài 🌿',
    expert: 'Chuyên gia Tubu',
    bestAnswer: 'Câu trả lời hay nhất',
    markBest: 'Chọn hay nhất',
    answers: 'Trả lời',
    comment: 'Bình luận',
    commentPlaceholder: 'Viết trả lời…',
    send: 'Gửi',
    buyThis: 'Mua cây này',
    viewSolution: 'Xem giải pháp',
    emptyHeading: 'Chưa có bài viết nào',
    emptyBody: 'Hãy là người đầu tiên chia sẻ hoặc đặt câu hỏi!',
    edit: 'Sửa',
    delete: 'Xoá',
    deleted: 'Đã xoá bài',
    confirmDelete: 'Xoá bài viết này?',
    needTitle: 'Câu hỏi cần có tiêu đề',
    loginToView: 'Đăng nhập để xem cộng đồng',
  },
```

- [ ] **Step 4: Typecheck**

Run: `pnpm --filter @tubutree/miniapp typecheck`
Expected: sạch (feed.tsx cũ sẽ báo lỗi vì dùng API cũ — Task 3 rewrite nó; nếu typecheck fail CHỈ do feed.tsx, chấp nhận và ghi rõ, sẽ hết sau Task 3). Nếu muốn xanh ngay, có thể để lỗi feed.tsx tồn tại tới Task 3 — ghi chú trong report.

- [ ] **Step 5: Commit**

```bash
git add apps/miniapp/src/services/feed-api.ts apps/miniapp/src/services/shop-api.ts apps/miniapp/src/i18n/vi.ts
git commit -m "feat(community): FE api layer (feed-api mới) + suggestProducts + i18n community"
```

---

### Task 3 (FE): Trang bảng tin `feed.tsx` — tabs danh mục, infinite cursor, PostCard, pull-to-refresh

**Files:**
- Rewrite: `apps/miniapp/src/pages/feed.tsx`
- Create: `apps/miniapp/src/components/community/post-card.tsx`
- Create: `apps/miniapp/src/utils/time-ago.ts` (trích `timeAgo` khỏi feed cũ để tái dùng ở detail)

**Interfaces:**
- Consumes: feed-api Task 2, `useDebounced`, `PullToRefresh`, `useAuthStore`, `getErrorMessage`, `vi.community`.
- Produces: `PostCard` component `{ post: FeedItem; onClick: () => void }`; `timeAgo(iso)`.

- [ ] **Step 1: Trích `timeAgo` sang util**

Create `apps/miniapp/src/utils/time-ago.ts`:

```typescript
export function timeAgo(iso: string): string {
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if (diff < 60) return 'vừa xong';
  if (diff < 3600) return `${Math.floor(diff / 60)} phút trước`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} giờ trước`;
  return `${Math.floor(diff / 86400)} ngày trước`;
}
```

- [ ] **Step 2: `PostCard` component**

Create `apps/miniapp/src/components/community/post-card.tsx`. Requirements (mirror styling of feed cũ + browse card conventions, dùng biến CSS `--leaf-*`/`--neutral-*`):
- Header: avatar tròn (img `post.avatar` hoặc fallback initial), `post.author`, badge "🌿 Chuyên gia Tubu" nếu `post.badge==='EXPERT'` (màu `--leaf-700`), `timeAgo(post.createdAt)`, chip danh mục `post.category?.icon + name`.
- Kind label: QUESTION → "❓ Hỏi đáp" + hiện `post.title` (bold); SHOWCASE → "🌿 Khoe vườn"; TIP → "💡 Mẹo hay"; các kind game giữ như cũ (🌳 Thu hoạch…). Body clamp 3 dòng.
- Ảnh: nếu `post.images.length`, hiện grid ảnh đầu (1 ảnh lớn hoặc lưới 2-3), lazy.
- Product chips: nếu `post.productTags.length`, hàng chip ngang (thumbnail nhỏ + tên + giá) — tap chip điều hướng PDP `navigate('/product/'+slug)` (dừng propagation để không mở detail bài).
- Footer: `💚/🤍 likeCount`, `💬 commentCount`, nếu QUESTION và `bestCommentId` → nhãn "✅ Đã có câu trả lời hay".
- Cả thẻ tap → `onClick()` (mở detail).

```tsx
import { Box, Text, useNavigate } from 'zmp-ui';
import type { FeedItem } from '../../services/feed-api';
import { timeAgo } from '../../utils/time-ago';
import { formatVnd } from '../../utils/format';
import { vi } from '../../i18n/vi';

const KIND_LABEL: Partial<Record<FeedItem['kind'], string>> = {
  QUESTION: '❓ ' + vi.community.kindQuestion,
  SHOWCASE: '🌿 ' + vi.community.kindShowcase,
  TIP: '💡 ' + vi.community.kindTip,
  HARVEST: '🌳 Thu hoạch',
  SPECIES: '📒 Sưu tập loài',
  MILESTONE: '🌍 Mốc cộng đồng',
};

export default function PostCard({ post, onClick }: { post: FeedItem; onClick: () => void }) {
  const navigate = useNavigate();
  const label = KIND_LABEL[post.kind];
  return (
    <Box onClick={onClick} className="tubu-press" p={4} mt={2} style={{ background: 'var(--neutral-0)', cursor: 'pointer' }}>
      <Box flex alignItems="center" style={{ gap: 8 }}>
        {post.avatar
          ? <img src={post.avatar} alt="" width={32} height={32} style={{ borderRadius: '50%', objectFit: 'cover' }} />
          : <Box style={{ width: 32, height: 32, borderRadius: '50%', background: 'var(--leaf-200)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Text size="small">🌱</Text></Box>}
        <Box style={{ flex: 1 }}>
          <Box flex alignItems="center" style={{ gap: 6 }}>
            <Text size="small" bold>{post.author}</Text>
            {post.badge === 'EXPERT' && <Text size="xSmall" bold style={{ color: 'var(--leaf-700)' }}>🌿 {vi.community.expert}</Text>}
          </Box>
          <Text size="xSmall" style={{ color: 'var(--neutral-400)' }}>
            {timeAgo(post.createdAt)}{post.category ? ` · ${post.category.icon ?? ''} ${post.category.name}` : ''}
          </Text>
        </Box>
      </Box>
      {label && <Text size="xSmall" bold style={{ color: 'var(--leaf-700)', marginTop: 6 }}>{label}</Text>}
      {post.title && <Text bold style={{ marginTop: 2 }}>{post.title}</Text>}
      <Text size="small" style={{ marginTop: 4, color: 'var(--neutral-900)', display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{post.body}</Text>
      {post.images[0] && (
        <img src={post.images[0]} alt="" loading="lazy" style={{ width: '100%', borderRadius: 'var(--radius-lg)', marginTop: 8, maxHeight: 220, objectFit: 'cover' }} />
      )}
      {post.productTags.length > 0 && (
        <Box flex style={{ gap: 8, marginTop: 8, overflowX: 'auto' }}>
          {post.productTags.map((p) => (
            <Box key={p.slug} onClick={(e) => { e.stopPropagation(); navigate(`/product/${p.slug}`); }}
              flex alignItems="center" style={{ gap: 6, padding: 6, borderRadius: 'var(--radius-md)', border: '1px solid var(--neutral-100)', flex: '0 0 auto', maxWidth: 200 }}>
              {p.thumbnail && <img src={p.thumbnail} alt="" width={28} height={28} style={{ borderRadius: 6, objectFit: 'cover' }} />}
              <Box><Text size="xSmall" style={{ display: '-webkit-box', WebkitLineClamp: 1, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{p.name}</Text>
              <Text size="xSmall" bold style={{ color: 'var(--primary-700)' }}>{formatVnd(p.salePrice ?? p.basePrice)}</Text></Box>
            </Box>
          ))}
        </Box>
      )}
      <Box flex style={{ gap: 16, marginTop: 10 }}>
        <Text size="small" style={{ color: post.liked ? 'var(--leaf-700)' : 'var(--neutral-500)' }}>{post.liked ? '💚' : '🤍'} {post.likeCount}</Text>
        <Text size="small" style={{ color: 'var(--neutral-500)' }}>💬 {post.commentCount}</Text>
        {post.kind === 'QUESTION' && post.bestCommentId && <Text size="small" style={{ color: 'var(--leaf-700)' }}>✅ Đã có câu trả lời hay</Text>}
      </Box>
    </Box>
  );
}
```

- [ ] **Step 3: Rewrite `feed.tsx` (list page)**

Requirements:
- Auth gate: nếu chưa đăng nhập → empty-state + nút `login()` (`vi.community.loginToView`).
- Header: title/subtitle; nút "Đăng bài" (icon lucide `Plus`/`PencilLine`) mở `<PostComposer>` (Sheet — Task 4) qua state `composing`.
- Category tabs: `getCategories` query → Chip "Tất cả" (undefined) + mỗi danh mục (icon+name), state `category`. Sort chips: Mới/Nổi bật (`sort`).
- List: `useInfiniteQuery` cursor:
```tsx
const feed = useInfiniteQuery({
  queryKey: ['community', category, sort],
  queryFn: ({ pageParam }) => getFeed({ category, sort, cursor: pageParam as string | undefined }),
  initialPageParam: undefined as string | undefined,
  getNextPageParam: (last) => last.nextCursor ?? undefined,
  enabled: authed,
});
const posts = feed.data?.pages.flatMap((p) => p.posts) ?? [];
```
- `<PullToRefresh onRefresh={() => feed.refetch()} />` là con đầu trong `<Page>`.
- Render `PostCard` list → `onClick={() => navigate('/feed/'+post.id)}`. Nút "Tải thêm" khi `feed.hasNextPage` (hoặc IntersectionObserver — giữ đơn giản: nút "Xem thêm" gọi `feed.fetchNextPage()`).
- Empty state khi 0 bài.
- Composer success → `feed.refetch()`.
- Dùng `getErrorMessage` cho lỗi; Chip component có thể copy từ `browse.tsx`.

Sườn:

```tsx
import { useState } from 'react';
import { Box, Page, Text, Button, Spinner, useNavigate, useSnackbar } from 'zmp-ui';
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { getFeed, getCategories, type FeedSort } from '../services/feed-api';
import { useAuthStore } from '../store/auth';
import { vi } from '../i18n/vi';
import { PullToRefresh } from '../components/pull-to-refresh';
import PostCard from '../components/community/post-card';
import PostComposer from '../components/community/post-composer';

export default function FeedPage() {
  const status = useAuthStore((s) => s.status);
  const login = useAuthStore((s) => s.login);
  const authed = status === 'authenticated';
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [category, setCategory] = useState<string | undefined>(undefined);
  const [sort, setSort] = useState<FeedSort>('new');
  const [composing, setComposing] = useState(false);

  const cats = useQuery({ queryKey: ['community', 'categories'], queryFn: getCategories, enabled: authed, staleTime: 60_000 });
  const feed = useInfiniteQuery({
    queryKey: ['community', category, sort],
    queryFn: ({ pageParam }) => getFeed({ category, sort, cursor: pageParam as string | undefined }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    enabled: authed,
  });
  const posts = feed.data?.pages.flatMap((p) => p.posts) ?? [];

  if (!authed) {
    return (
      <Page className="page"><Box style={{ textAlign: 'center', padding: 48 }}>
        <Text style={{ fontSize: 48 }}>🌿</Text>
        <Text style={{ marginTop: 8 }}>{vi.community.loginToView}</Text>
        <Button style={{ marginTop: 12 }} onClick={() => void login()}>Đăng nhập</Button>
      </Box></Page>
    );
  }
  return (
    <Page className="page" style={{ background: 'var(--neutral-50)', paddingBottom: 80 }}>
      <PullToRefresh onRefresh={() => feed.refetch()} />
      {/* header + tabs (Chip) + sort + nút Đăng bài mở composer */}
      {/* list PostCard → navigate(`/feed/${p.id}`); nút Xem thêm nếu hasNextPage */}
      <PostComposer visible={composing} onClose={() => setComposing(false)} categories={cats.data ?? []} onPosted={() => { setComposing(false); void feed.refetch(); }} />
    </Page>
  );
}
```
(Điền header/tabs/sort/list/empty theo mô tả trên; Chip mirror `browse.tsx`.)

- [ ] **Step 4: Typecheck + build**

Run: `pnpm --filter @tubutree/miniapp typecheck && pnpm --filter @tubutree/miniapp build`
Expected: sạch (PostComposer import sẽ đỏ tới khi Task 4 tạo — nếu làm tuần tự, tạo file stub `post-composer.tsx` tối thiểu ở Task 3 rồi hoàn thiện ở Task 4, HOẶC gộp Task 3+4. Khuyến nghị: tạo stub composer trả `null` ở cuối Task 3 để build xanh, Task 4 thay nội dung).

- [ ] **Step 5: Commit**

```bash
git add apps/miniapp/src/pages/feed.tsx apps/miniapp/src/components/community/ apps/miniapp/src/utils/time-ago.ts
git commit -m "feat(community): trang bảng tin — tabs danh mục, infinite cursor, PostCard, pull-to-refresh"
```

---

### Task 4 (FE): Composer Sheet — loại bài, danh mục, ảnh, gắn sản phẩm

**Files:**
- Create/replace: `apps/miniapp/src/components/community/post-composer.tsx`
- Create: `apps/miniapp/src/components/community/product-picker.tsx`

**Interfaces:**
- Consumes: `createPost`, `suggestProducts`, `MultiImageUpload`, `useDebounced`, `getErrorMessage`, `vi.community`.
- Produces: `PostComposer` `{ visible: boolean; onClose: () => void; categories: FeedCategory[]; onPosted: () => void }`; `ProductPicker` `{ value: ProductSuggestion[]; onChange: (v: ProductSuggestion[]) => void; max?: number }`.

- [ ] **Step 1: `ProductPicker` component**

`apps/miniapp/src/components/community/product-picker.tsx`: ô `Input.Search` → `useDebounced(q, 300)` → `useQuery(['suggest', dq], () => suggestProducts(dq), { enabled: dq.length >= 1 })` → danh sách gợi ý (thumbnail+tên+giá); tap thêm vào `value` (cap `max=5`, chặn trùng slug, `vi.community.maxProducts` khi vượt); chip đã chọn có nút ✕ để bỏ. Không có kết quả → dòng nhẹ "Không tìm thấy".

- [ ] **Step 2: `PostComposer` Sheet**

`apps/miniapp/src/components/community/post-composer.tsx` — mirror `WriteReview` trong `reviews-section.tsx` (Sheet visible/onClose autoHeight, padding safe-bottom, useMutation + useSnackbar):
- Chọn loại bài: 3 chip QUESTION/SHOWCASE/TIP (mặc định QUESTION).
- Danh mục: chip từ `categories` (chọn 1 → `categoryId` = tìm theo… **lưu ý**: API tạo bài nhận `categoryId` nhưng categories chỉ có `slug`. Backend `getCategories` trả slug/name/icon KHÔNG có id. → Sửa: FE gửi theo slug? Backend createPost nhận `categoryId`. **Giải quyết:** ở Task 1 mở rộng `getCategories` trả thêm `id` (thêm `id: true` vào select) và `FeedCategory` thêm `id`. Composer gửi `categoryId = selectedCategory.id`. (Cập nhật Task 1 select + Task 2 type `FeedCategory` thêm `id: string`.)**
- QUESTION: hiện ô `title` (Input, ≤160) — bắt buộc; validate `vi.community.needTitle`.
- Body: `Input.TextArea` (≤5000), bắt buộc.
- Ảnh: `<MultiImageUpload value={images} onChange={setImages} max={6} />` (tự ẩn nếu Cloudinary chưa cấu hình).
- Gắn SP: `<ProductPicker value={products} onChange={setProducts} max={5} />`.
- Submit: `createPost({ kind, categoryId, title: kind==='QUESTION'?title:undefined, body, images, productSlugs: products.map(p=>p.slug) })` → success: snackbar `vi.community.posted`, reset, `onPosted()`.
- Lỗi qua `getErrorMessage`.

- [ ] **Step 3: Cập nhật Task 1/2 cho `categoryId`**

(Nếu chưa làm ở Task 1) đảm bảo `getCategories` select có `id: true` và `FeedCategory` type có `id: string`. Cập nhật test Task 1 tương ứng (thêm `id` vào expected select + mock row). Chạy lại `pnpm --filter @tubutree/api test -- community-feed.service.spec`.

- [ ] **Step 4: Typecheck + build**

Run: `pnpm --filter @tubutree/miniapp typecheck && pnpm --filter @tubutree/miniapp build`
Expected: sạch.

- [ ] **Step 5: Commit**

```bash
git add apps/miniapp/src/components/community/ apps/api/src/modules/feed/ apps/miniapp/src/services/feed-api.ts
git commit -m "feat(community): composer Sheet (loại/danh mục/ảnh/gắn SP) + product picker"
```

---

### Task 5 (FE): Trang chi tiết bài `/feed/:id` — trả lời, best-answer, sửa/xoá, "Mua cây này"

**Files:**
- Create: `apps/miniapp/src/pages/post-detail.tsx`
- Modify: `apps/miniapp/src/components/app.tsx` (route `/feed/:id`)

**Interfaces:**
- Consumes: `getPost`, `getComments`, `addComment`, `setBestAnswer`, `deletePost`, `editPost`, `reactPost`, `useAuthStore` (role + user id?), `ProductCard` chips, `vi.community`, `timeAgo`.

- [ ] **Step 1: Đăng ký route**

Trong `apps/miniapp/src/components/app.tsx`: thêm `const PostDetailPage = lazy(() => import('../pages/post-detail'));` và `<Route path="/feed/:id" element={<PostDetailPage />} />` ngay sau `<Route path="/feed" ...>`.

- [ ] **Step 2: `post-detail.tsx`**

Requirements:
- `const { id } = useParams<{ id: string }>();` `getPost(id!)` + `getComments(id!)` (enabled `!!id`).
- Hiển thị bài đầy đủ: header (avatar/author/badge/category/time), title (QUESTION), body full, gallery ảnh (tất cả `images`), product chips lớn — với SHOWCASE có SP → nút nổi bật `vi.community.buyThis` → PDP; QUESTION → `vi.community.viewSolution`.
- React (💚), số like/comment.
- Danh sách trả lời (`getComments`): mỗi comment header (avatar/author/badge "🌿 Chuyên gia" nếu EXPERT/time), body; comment `isAccepted` → khung nhấn mạnh + nhãn `✅ vi.community.bestAnswer`.
- Ô thêm trả lời (Input + Gửi) → `addComment` → invalidate `['community', id, 'comments']` + `['community', ...]`.
- **Best-answer:** chỉ hiện nút `vi.community.markBest` trên mỗi comment nếu `post.kind==='QUESTION'` và (người xem là chủ bài HOẶC role ADMIN). Chủ bài xác định thế nào? `getPost` DTO KHÔNG trả `userId` chủ bài. **Giải quyết:** thêm `authorId` (hoặc `isOwner: boolean`) vào FeedItem DTO — cập nhật backend `toItem` để trả `isOwner` (so `p.userId === userId` — getFeed/getPost đều có userId). Đơn giản & không lộ id người khác: trả `isOwner: p.userId === userId`. (Cập nhật backend Task: `toItem` cần userId — hiện `toItem(p)` không nhận userId; đổi `toItem(p, userId)` và truyền vào ở getFeed/getPost. Thêm `isOwner` vào FeedItem type FE.) Nút best-answer POST `setBestAnswer(id, commentId)` → invalidate.
- **Sửa/Xoá (chủ bài):** nếu `post.isOwner` → menu: Sửa (mở sheet nhỏ sửa title/body) → `editPost`; Xoá → confirm (`vi.community.confirmDelete`) → `deletePost` → `navigate('/feed')` + snackbar `vi.community.deleted`.
- Back-button đã có toàn cục (`back-button.tsx`).
- Lỗi qua `getErrorMessage`.

- [ ] **Step 3: Backend bổ sung `isOwner` vào FeedItem**

Trong `apps/api/src/modules/feed/community-feed.service.ts`: đổi mapper `toItem(p)` → `toItem(p, userId)` và thêm `isOwner: p.userId === userId` vào object trả. Cập nhật cả 2 nơi gọi (getFeed map, getPost) truyền `userId`. Cập nhật `community-feed.service.spec.ts` (getFeed/getPost tests) thêm `isOwner` kỳ vọng + đảm bảo `user` include có `id`? `p.userId` là scalar trên FeedPost (luôn có) → không cần include thêm. Thêm `isOwner: boolean` vào `FeedItem` FE type (Task 2). Chạy `pnpm --filter @tubutree/api test -- community-feed.service.spec`.

- [ ] **Step 4: Typecheck + build (FE) + test (BE)**

Run: `pnpm --filter @tubutree/api test -- community-feed.service.spec && pnpm --filter @tubutree/miniapp typecheck && pnpm --filter @tubutree/miniapp build`
Expected: tất cả sạch/pass.

- [ ] **Step 5: Commit**

```bash
git add apps/miniapp/src/pages/post-detail.tsx apps/miniapp/src/components/app.tsx apps/api/src/modules/feed/ apps/miniapp/src/services/feed-api.ts
git commit -m "feat(community): trang chi tiết bài — trả lời, best-answer, sửa/xoá, Mua cây này"
```

---

## Self-Review

**1. Spec coverage (Pha 1 FE):** bảng tin theo danh mục (T3) ✅; composer nhiều loại + ảnh + gắn SP (T4) ✅; chi tiết bài + trả lời + best-answer (T5) ✅; badge chuyên gia (T3/T5) ✅; chip SP → PDP + "Mua cây này" (T3/T5) ✅; hiện tên+avatar (DTO Pha 1a + T3/T5) ✅; sửa/xoá (T5) ✅; danh mục API (T1) ✅; gắn SP search (T2 suggestProducts + T4 picker) ✅. Hoãn Pha 2+: tìm kiếm bài/tag/thông báo/reputation/sự kiện/kiểm duyệt UI.

**2. Placeholder scan:** Các bước FE cite mã sườn + file mẫu cụ thể (reviews-section/browse/orders) cho phần styling dài — không có TODO/TBD. Hai chỗ phát sinh yêu cầu backend nhỏ được nêu tường minh và kèm cách sửa: (a) `categoryId` → thêm `id` vào getCategories (T4 Step 3); (b) `isOwner` → thêm vào toItem (T5 Step 3).

**3. Type consistency:** `FeedItem`/`FeedComment`/`FeedCategory`/`CreatePostInput` (T2) khớp DTO backend Pha 1a + 2 bổ sung (`FeedCategory.id`, `FeedItem.isOwner`). `PostComposer`/`ProductPicker`/`PostCard` props nhất quán giữa T3/T4/T5. `getFeed` params khớp controller query. Cursor infinite-query `initialPageParam: undefined` + `getNextPageParam: last.nextCursor`.

## Ghi chú
- Không thêm tab bottom-nav mới cho /feed (không phải pattern hiện tại) — điểm vào cộng đồng giữ như hiện có (profile/home). Nếu muốn nổi bật hơn, cân nhắc riêng.
- Sau khi cả Pha 1a+1b xong: verify bằng chạy app (skill `run`/`verify`) rồi merge trọn Pha 1 vào main; deploy cần `prisma migrate deploy` + `prisma:seed`.
