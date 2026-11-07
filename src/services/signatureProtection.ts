/**
 * Signature copy protection: when a signature is copied out of a document, the clipboard gets a
 * redacted placeholder instead of the real ink, so pasting it anywhere (another PDF, Word, email…)
 * never reproduces the signature.
 */

const STORAGE_KEY = 'acrobatdesk.protectSignatures';

export function readProtectSetting(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) !== 'off';
  } catch {
    return true;
  }
}

export function writeProtectSetting(on: boolean) {
  try {
    localStorage.setItem(STORAGE_KEY, on ? 'on' : 'off');
  } catch {
    /* storage unavailable */
  }
}

const loadImage = (src: string) =>
  new Promise<HTMLImageElement>((resolve, reject) => {
    const im = new Image();
    im.onload = () => resolve(im);
    im.onerror = () => reject(new Error('Image decode failed'));
    im.src = src;
  });

/** A solid redaction block with the signature's proportions. */
export async function makeRedactedSignature(sourceDataUrl: string): Promise<string> {
  let w = 600;
  let h = 200;
  try {
    const im = await loadImage(sourceDataUrl);
    const aspect = (im.naturalWidth || 3) / (im.naturalHeight || 1);
    w = 600;
    h = Math.max(120, Math.round(w / Math.min(Math.max(aspect, 1.2), 8)));
  } catch {
    /* keep default size */
  }
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#111111';
  ctx.fillRect(0, 0, w, h);
  // Diagonal hatching so it reads as "removed", not as a black image
  ctx.strokeStyle = 'rgba(255,255,255,0.07)';
  ctx.lineWidth = 10;
  for (let x = -h; x < w; x += 28) {
    ctx.beginPath();
    ctx.moveTo(x, h);
    ctx.lineTo(x + h, 0);
    ctx.stroke();
  }
  ctx.fillStyle = '#FFFFFF';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const big = Math.min(h * 0.28, 44);
  ctx.font = `bold ${big}px Arial, Helvetica, sans-serif`;
  ctx.fillText('SIGNATURE REDACTED', w / 2, h / 2 - big * 0.35, w * 0.9);
  ctx.fillStyle = 'rgba(255,255,255,0.6)';
  ctx.font = `${Math.max(12, big * 0.42)}px Arial, Helvetica, sans-serif`;
  ctx.fillText('Protected copy · original signature withheld', w / 2, h / 2 + big * 0.75, w * 0.9);
  return c.toDataURL('image/png');
}

/**
 * Does this image look like a handwritten signature? Small, wide, mostly blank background,
 * with sparse dark or blue-ish ink and little other colour (which rules out photos and most logos).
 */
export async function looksLikeSignature(
  dataUrl: string,
  onPage: { widthPct: number; heightPct: number }
): Promise<boolean> {
  if (onPage.widthPct > 45 || onPage.heightPct > 16 || onPage.widthPct < 3) return false;
  let im: HTMLImageElement;
  try {
    im = await loadImage(dataUrl);
  } catch {
    return false;
  }
  const aspect = im.naturalWidth / Math.max(1, im.naturalHeight);
  if (aspect < 1.2 || aspect > 10) return false;

  const W = Math.min(240, im.naturalWidth);
  const H = Math.max(1, Math.round(W / aspect));
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const ctx = c.getContext('2d');
  if (!ctx) return false;
  ctx.drawImage(im, 0, 0, W, H);
  const d = ctx.getImageData(0, 0, W, H).data;

  let bg = 0;
  let ink = 0;
  let inkLike = 0;
  let colourful = 0;
  for (let i = 0; i < d.length; i += 4) {
    const [r, g, b, a] = [d[i], d[i + 1], d[i + 2], d[i + 3]];
    const lum = 0.299 * r + 0.587 * g + 0.114 * b;
    if (a < 40 || lum > 215) {
      bg++;
      continue;
    }
    ink++;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const sat = max === 0 ? 0 : (max - min) / max;
    const blueInk = b > r + 15 && b > g;
    if (lum < 150 || blueInk) inkLike++;
    if (sat > 0.35 && !blueInk) colourful++;
  }
  const total = bg + ink;
  if (!total || !ink) return false;
  const inkFrac = ink / total;
  return inkFrac > 0.005 && inkFrac < 0.35 && inkLike / ink > 0.7 && colourful / ink < 0.12;
}
