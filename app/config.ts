// Where the content feed, web updates and APKs are published (GitHub Pages for this repo).
export const CONTENT_URL = 'https://jonnycorless.github.io/gin-khao/';
// Set by the Publish workflow: APK version from the tag, web build from the run number.
export const APP_VERSION: string = import.meta.env.VITE_APP_VERSION ?? 'dev';
export const WEB_BUILD: number = Number(import.meta.env.VITE_WEB_BUILD ?? 0);
