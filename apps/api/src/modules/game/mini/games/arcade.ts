import type { MiniArcadeGameId } from '@tubutree/shared-types';
import type { MiniContentRow } from './game-def';

/**
 * Game thao tác không có mục trong `game_content_items`: mỗi ván ghi một id mục ảo (cột `contentIds` của ván và mã ván khách) để đường
 * phát/chấm chung chạy y như game nội dung. Số cuối là phiên bản luật: đổi luật chơi thì tăng số, ván đang dở theo luật cũ bị từ chối thay vì chấm sai luật.
 */
export const ARCADE_CONTENT_ID: Record<MiniArcadeGameId, string> = {
  eco_merge: 'arcade:eco_merge:1',
  green_conveyor: 'arcade:green_conveyor:1',
};

export const ARCADE_ID_PREFIX = 'arcade:';

export function arcadeRow(game: MiniArcadeGameId): MiniContentRow {
  return { id: ARCADE_CONTENT_ID[game], game, payload: null, explanation: '', sourceUrl: '', productSlug: null };
}

export const arcadePayloadError = (title: string) => `${title} chạy theo luật cài sẵn, không có mục nội dung để thêm hay sửa.`;
