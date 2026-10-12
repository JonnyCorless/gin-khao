// Daily nudge: one notification at your chosen time, skipped once today's session is done.
import { Capacitor } from '@capacitor/core';
import { LocalNotifications } from '@capacitor/local-notifications';
import { currentStreak, dayLog, P } from './store';

const BASE = 1000;
const DAYS = 14;
const native = Capacitor.isNativePlatform();

const MESSAGES = [
  'Fifteen minutes of Thai before work?',
  'Eight new phrases and a quick review are ready.',
  'Your review cards are due. It only takes a few minutes.',
  'Ready for the till today? Quick session waiting.',
];

export async function askPermission(): Promise<boolean> {
  if (!native) return false;
  const r = await LocalNotifications.requestPermissions();
  return r.display === 'granted';
}

export async function scheduleReminders() {
  if (!native) return;
  try {
    const pending = await LocalNotifications.getPending();
    const ours = pending.notifications.filter(n => n.id >= BASE && n.id < BASE + 100).map(n => ({ id: n.id }));
    if (ours.length) await LocalNotifications.cancel({ notifications: ours });
    const p = P();
    if (!p.settings.reminderOn) return;
    if ((await LocalNotifications.checkPermissions()).display !== 'granted') return;
    const [hh, mm] = p.settings.reminderTime.split(':').map(Number);
    const doneToday = !!dayLog(p).done;
    const streak = currentStreak(p);
    const now = Date.now();
    const notifications = [];
    for (let d = 0; d < DAYS; d++) {
      const at = new Date();
      at.setDate(at.getDate() + d);
      at.setHours(hh, mm, 0, 0);
      if (at.getTime() <= now || (d === 0 && doneToday)) continue;
      const body = streak >= 2 && d <= 1 ? `Keep your ${streak}-day streak going.` : MESSAGES[(at.getDate() + d) % MESSAGES.length];
      notifications.push({ id: BASE + d, title: 'Gin Khao', body, schedule: { at, allowWhileIdle: true }, extra: { route: 'today' } });
    }
    if (notifications.length) await LocalNotifications.schedule({ notifications });
  } catch { /* notifications unavailable */ }
}

export function onReminderTap(go: (route: string) => void) {
  if (!native) return;
  LocalNotifications.addListener('localNotificationActionPerformed', a => go(a.notification.extra?.route ?? 'today')).catch(() => {});
}
