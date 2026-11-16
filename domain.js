export const ACTIVE_BOOKINGS = ['booked', 'checked_in'];
export const PROBE_LABELS = { available: '可領用', in_use: '使用中', inspection: '待檢查', retired: '已報廢' };
export const BOOKING_LABELS = { booked: '已預約', checked_in: '使用中', completed: '已完成', cancelled: '已取消', no_show: '未到場' };
export const STATUS_LABELS = { approved: '已核准', pending: '待審核', disabled: '已停用' };
export const isActive = (user, now = Date.now()) => user?.status === 'approved' && (!user.suspended_until || new Date(user.suspended_until).getTime() <= now);
export const isAdmin = user => user?.role === 'admin';
export function canTake(user, probe, grants, now = Date.now()) {
  return isActive(user, now) && user.can_take_probes && grants.some(g => g.probe_id === probe.id && g.user_id === user.id);
}
export const taipeiDate = (d = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
export function addDays(date, days) { const d = new Date(`${date}T12:00:00+08:00`); d.setUTCDate(d.getUTCDate() + days); return taipeiDate(d); }
export function monday(date) { const dow = new Date(`${date}T12:00:00+08:00`).getUTCDay(); return addDays(date, -(dow === 0 ? 6 : dow - 1)); }
export const localTime = value => new Intl.DateTimeFormat('zh-TW', { timeZone: 'Asia/Taipei', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(value));
export const dateTime = value => new Intl.DateTimeFormat('zh-TW', { timeZone: 'Asia/Taipei', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(value));
export function validateBooking(user, start, end, bookings, now = Date.now(), excludeId = null) {
  if (!isActive(user, now) || (!user.can_book && !isAdmin(user))) throw Error('帳號尚未取得預約資格，或仍在停權期間。');
  const s = new Date(start), e = new Date(end), duration = e - s;
  if (!Number.isFinite(s.getTime()) || !Number.isFinite(e.getTime()) || duration <= 0) throw Error('請選擇有效的開始與結束時間。');
  if (s.getTime() <= now) throw Error('預約開始時間必須在未來。');
  if (!isAdmin(user)) {
    const day = new Date(s.getTime() + 8 * 3600000), finish = new Date(e.getTime() + 8 * 3600000);
    if (duration > 4 * 3600000) throw Error('每次預約最多 4 小時。');
    if (day.getUTCDay() === 0 || day.getUTCDay() === 6 || taipeiDate(s) !== taipeiDate(e) || day.getUTCHours() < 9 || finish.getUTCHours() > 19 || (finish.getUTCHours() === 19 && finish.getUTCMinutes() > 0)) throw Error('一般使用者可預約週一至週五 09:00–19:00。');
    if (day.getUTCMinutes() || finish.getUTCMinutes() || day.getUTCSeconds() || finish.getUTCSeconds() || duration % 3600000) throw Error('請以整點、每小時為單位預約。');
  }
  if (bookings.some(b => b.id !== excludeId && ACTIVE_BOOKINGS.includes(b.status) && s < new Date(b.end_at) && e > new Date(b.start_at))) throw Error('這個時段已被預約，請重新選擇。');
}
export function calendarLink(booking) {
  const stamp = x => new Date(x).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
  const q = new URLSearchParams({ action: 'TEMPLATE', text: 'Vero AFM 預約', dates: `${stamp(booking.start_at)}/${stamp(booking.end_at)}`, details: `預約編號：${booking.id}\n請於預約時間到場並填寫使用紀錄。`, ctz: 'Asia/Taipei' });
  return `https://calendar.google.com/calendar/render?${q}`;
}
