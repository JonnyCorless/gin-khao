import { Capacitor } from '@capacitor/core';
import { Haptics, ImpactStyle, NotificationType } from '@capacitor/haptics';

const native = Capacitor.isNativePlatform();
export const tap = () => { if (native) Haptics.impact({ style: ImpactStyle.Light }).catch(() => {}); };
export const good = () => { if (native) Haptics.notification({ type: NotificationType.Success }).catch(() => {}); };
export const bad = () => { if (native) Haptics.notification({ type: NotificationType.Error }).catch(() => {}); };
