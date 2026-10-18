import { ForbiddenException } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { JwtPayload } from '@tubutree/shared-types';
import { RolesGuard } from '../../common/guards/roles.guard';
import { CommunityFeedController } from './community-feed.controller';

type Handler = keyof CommunityFeedController;

function canRun(handler: Handler, user: Partial<JwtPayload> | undefined): boolean {
  const ctx = {
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
    getHandler: () => CommunityFeedController.prototype[handler],
    getClass: () => CommunityFeedController,
  } as unknown as ExecutionContext;
  try {
    return new RolesGuard(new Reflector()).canActivate(ctx);
  } catch (e) {
    if (e instanceof ForbiddenException) return false;
    throw e;
  }
}

const cskh = { role: 'STAFF', staffPermissions: ['CSKH'] } as Partial<JwtPayload>;
const kho = { role: 'STAFF', staffPermissions: ['KHO'] } as Partial<JwtPayload>;
const marketing = { role: 'STAFF', staffPermissions: ['MARKETING'] } as Partial<JwtPayload>;
const keToan = { role: 'STAFF', staffPermissions: ['KE_TOAN'] } as Partial<JwtPayload>;
const staffNoGroup = { role: 'STAFF', staffPermissions: [] } as Partial<JwtPayload>;
const admin = { role: 'ADMIN' } as Partial<JwtPayload>;
const customer = { role: 'CUSTOMER' } as Partial<JwtPayload>;

// Kiểm duyệt hằng ngày (duyệt/từ chối/ẩn/ghim + hàng chờ) mở cho nhóm CSKH và MARKETING để bài của khách không nằm chờ chủ shop.
const MODERATION: Handler[] = ['adminPending', 'adminPublished', 'adminUnanswered', 'adminReports', 'resolveReport', 'approve', 'reject', 'hide', 'pin'];
// Sự kiện và chọn người thắng (có thưởng Điểm Xanh) vẫn chỉ ADMIN.
const ADMIN_ONLY: Handler[] = ['createEvent', 'adminEvents', 'adminEventParticipants', 'closeEvent', 'pickWinner'];

describe('CommunityFeedController — quyền kiểm duyệt', () => {
  it.each(MODERATION)('%s: ADMIN và STAFF nhóm CSKH hoặc MARKETING được', (h) => {
    expect(canRun(h, admin)).toBe(true);
    expect(canRun(h, cskh)).toBe(true);
    expect(canRun(h, marketing)).toBe(true);
  });

  it.each(MODERATION)('%s: STAFF chỉ nhóm KHO hoặc KE_TOAN, STAFF chưa có nhóm, khách và người chưa đăng nhập bị chặn', (h) => {
    expect(canRun(h, kho)).toBe(false);
    expect(canRun(h, keToan)).toBe(false);
    expect(canRun(h, staffNoGroup)).toBe(false);
    expect(canRun(h, customer)).toBe(false);
    expect(canRun(h, undefined)).toBe(false);
  });

  it.each(ADMIN_ONLY)('%s: chỉ ADMIN, mọi nhóm nhân viên đều bị chặn', (h) => {
    expect(canRun(h, admin)).toBe(true);
    expect(canRun(h, cskh)).toBe(false);
    expect(canRun(h, kho)).toBe(false);
    expect(canRun(h, marketing)).toBe(false);
    expect(canRun(h, keToan)).toBe(false);
    expect(canRun(h, customer)).toBe(false);
  });
});
