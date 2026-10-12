import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.ginkhao.app',
  appName: 'Gin Khao',
  webDir: 'dist',
  android: { allowMixedContent: false },
};

export default config;
