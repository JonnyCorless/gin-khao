import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.ginkhao.app',
  appName: 'Gin Khao',
  webDir: 'dist',
  // Android 15 draws apps edge to edge; keep the web view clear of the status and navigation bars.
  android: { allowMixedContent: false, adjustMarginsForEdgeToEdge: 'auto' },
};

export default config;
