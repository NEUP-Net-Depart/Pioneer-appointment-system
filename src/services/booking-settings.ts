import type { BookingNoticeManagementDto } from '../../shared/appointment-types.ts';
import type { StaffAccountDto } from '../../shared/staff-types.ts';
import type { bookingSettingsRepository, BookingSettingsCommand, BookingSuspensionRow } from '../db/booking-settings.ts';
import type { StaffService } from './staff-platform.ts';
import { fail } from '../lib/http.ts';
import { stringField } from '../lib/validation.ts';
import { CAMPUSES } from '../../shared/constants.ts';
import { bookingWindow, validReleaseTime } from '../../shared/booking-settings.ts';
import { requestId } from '../platform/contracts.ts';
import { dateKey,addDays } from '../../shared/time.ts';

const suspensionNotice=(row: BookingSuspensionRow,campus: string): BookingNoticeManagementDto =>({id:`suspension-${row.campusId}-${row.businessDate}`,campus,type:'suspension',businessDate:row.businessDate,
  title:`${row.businessDate.slice(5).replace('-','/')} 暂停维修`,content:row.reason||'该校区当日暂停维修，请选择其他日期。',important:false,enabled:true,
  revision:row.revision,startsAt:new Date(`${row.businessDate}T00:00:00+08:00`).toISOString(),endsAt:new Date(`${addDays(row.businessDate,1)}T00:00:00+08:00`).toISOString()});

export function bookingSettingsService(repository: ReturnType<typeof bookingSettingsRepository>, staff: Pick<StaffService, 'requirePermission'>, clock = () => new Date()) {
  const campusInput = (campus: unknown) => CAMPUSES.find(value => value === campus) || fail(400, '请选择有效校区');
  async function authorize(actor: StaffAccountDto, campus: string) {
    campusInput(campus);
    const { context } = await staff.requirePermission(actor, 'booking.manage', { campusId: campus });
    return { actorMemberId: context.actor.memberId, actorAccount: actor.account, authVersion: context.authVersion, occurredAt: clock().toISOString() };
  }
  return {
    async public(campus: string) {
      campusInput(campus);
      const instant = clock(), settings = await repository.settings(campus);
      if (!settings) throw new Error('Missing booking settings');
      const notices = await repository.notices(campus, instant.toISOString());
      const suspensions=(await repository.suspensions(campus,dateKey(instant))).map(row=>suspensionNotice(row,campus));
      return { ...settings, notices: [...notices.map(({ id, title, content, important, revision, displayMode }) => ({ id, title, content, important, revision, displayMode })),...suspensions],
        ...bookingWindow(instant, settings.releaseTime), serverNow: instant.toISOString() };
    },
    async list(actor: StaffAccountDto, value: unknown) {
      const campus = campusInput(value);
      await authorize(actor, campus);
      return { settings: await repository.settings(campus), notices: await repository.notices(campus),suspensions:(await repository.suspensions(campus,dateKey(clock()))).map(row=>suspensionNotice(row,campus)) };
    },
    async save(actor: StaffAccountDto, input: Record<string, unknown>, kind: 'settings' | 'notice') {
      if (!input || typeof input !== 'object') fail(400, '请核对配置内容');
      const campus = campusInput(input.campus);
      const audit = await authorize(actor, campus);
      const id = requestId(input.requestId);
      if (!id || typeof input.revision !== 'number' || !Number.isSafeInteger(input.revision) || input.revision < (kind === 'notice' ? -1 : 0)) fail(400, '请求标识或配置版本不正确');
      const base = { campus, requestId: id, revision: input.revision };
      let command: BookingSettingsCommand;
      if (kind === 'settings') {
        if (!validReleaseTime(input.releaseTime)) fail(400, '放号时间应为有效的小时和分钟');
        command = { kind, input: { ...base, releaseTime: input.releaseTime } };
      } else {
        const displayMode = input.displayMode ?? 'inline';
        if (displayMode !== 'inline' && displayMode !== 'modal') fail(400, '请选择页面展示或弹窗展示');
        if (typeof input.important !== 'boolean' || typeof input.enabled !== 'boolean') fail(400, '请核对公告级别和发布状态');
        if (typeof input.id !== 'string' || !/^[A-Za-z0-9-]{8,80}$/.test(input.id)) fail(400, '公告标识不正确');
        const starts = typeof input.startsAt === 'string' ? Date.parse(input.startsAt) : NaN;
        const ends = typeof input.endsAt === 'string' ? Date.parse(input.endsAt) : NaN;
        if (!Number.isFinite(starts) || !Number.isFinite(ends) || ends <= starts) fail(400, '公告结束时间必须晚于开始时间');
        command = { kind, input: { ...base, id: input.id, title: stringField(input.title, '公告标题', 80, true), content: stringField(input.content, '公告内容', 2000, true),
          important: input.important, enabled: input.enabled, displayMode, startsAt: new Date(starts).toISOString(), endsAt: new Date(ends).toISOString() } };
        if (input.revision === -1 && (await repository.notices(campus)).length >= 100) fail(400, '该校区公告已达100条，请编辑已有公告');
      }
      const saved = await repository.save(command, { ...audit, requestId: id });
      if (!saved || !saved.matches) fail(409, '配置、请求或权限已变化，请读取最新配置并核对后重试', 'BOOKING_SETTINGS_CONFLICT');
      return saved.result;
    }
  };
}
