/**
 * Absolute URL of a file bundled with the app (see scripts/copy-runtime-assets.mjs).
 * Works the same on the office web server and inside the desktop app; nothing is fetched
 * from the internet.
 */
export function assetUrl(path: string): string {
  const base = ((import.meta as any).env?.BASE_URL as string | undefined) || '/';
  const href = typeof window !== 'undefined' ? window.location.href : 'http://localhost/';
  return new URL(base.replace(/\/?$/, '/') + path.replace(/^\//, ''), href).href;
}
