import { PDFDocument, StandardFonts, degrees, rgb, PDFFont } from 'pdf-lib';

/**
 * Real page-level PDF operations. Every function takes PDF bytes and returns new PDF bytes,
 * so what the user sees is always what gets saved.
 *
 * Structural operations also return a `mapping` array: mapping[newIndex] = oldIndex
 * (or null for a page that did not exist before). The app uses it to carry annotations,
 * text edits and OCR results along with their pages.
 */

export type PageMapping = Array<number | null>;

export interface StructuralResult {
  bytes: Uint8Array;
  mapping: PageMapping;
}

const load = (bytes: Uint8Array) => PDFDocument.load(bytes, { ignoreEncryption: true });

export async function getPageCount(bytes: Uint8Array): Promise<number> {
  return (await load(bytes)).getPageCount();
}

/** Rebuild the document from a list of source page indices (may repeat, omit or reorder). */
export async function reorderPages(bytes: Uint8Array, order: number[]): Promise<StructuralResult> {
  const src = await load(bytes);
  const out = await PDFDocument.create();
  const copied = await out.copyPages(src, order);
  copied.forEach((p) => out.addPage(p));
  copyMetadata(src, out);
  return { bytes: await out.save(), mapping: [...order] };
}

export async function deletePages(bytes: Uint8Array, indices: number[]): Promise<StructuralResult> {
  const total = await getPageCount(bytes);
  const remove = new Set(indices);
  const order = range(total).filter((i) => !remove.has(i));
  if (order.length === 0) throw new Error('A document must keep at least one page.');
  return reorderPages(bytes, order);
}

export async function duplicatePages(bytes: Uint8Array, indices: number[]): Promise<StructuralResult> {
  const total = await getPageCount(bytes);
  const dup = new Set(indices);
  const order: number[] = [];
  range(total).forEach((i) => {
    order.push(i);
    if (dup.has(i)) order.push(i);
  });
  return reorderPages(bytes, order);
}

export async function movePage(bytes: Uint8Array, from: number, to: number): Promise<StructuralResult> {
  const total = await getPageCount(bytes);
  const order = range(total);
  const [moved] = order.splice(from, 1);
  order.splice(to, 0, moved);
  return reorderPages(bytes, order);
}

export async function rotatePages(bytes: Uint8Array, indices: number[], delta: number): Promise<StructuralResult> {
  const doc = await load(bytes);
  const total = doc.getPageCount();
  indices.forEach((i) => {
    const page = doc.getPage(i);
    const current = page.getRotation().angle || 0;
    page.setRotation(degrees((((current + delta) % 360) + 360) % 360));
  });
  return { bytes: await doc.save(), mapping: range(total) };
}

/** Insert a blank page (sized like its neighbour) at `atIndex`. */
export async function insertBlankPage(bytes: Uint8Array, atIndex: number): Promise<StructuralResult> {
  const doc = await load(bytes);
  const total = doc.getPageCount();
  const ref = doc.getPage(Math.min(Math.max(atIndex - 1, 0), total - 1));
  const { width, height } = ref.getSize();
  doc.insertPage(atIndex, [width, height]);
  const mapping: PageMapping = range(total);
  mapping.splice(atIndex, 0, null);
  return { bytes: await doc.save(), mapping };
}

/** Merge pages of another PDF into this one at `atIndex`. */
export async function insertPdf(
  bytes: Uint8Array,
  otherBytes: Uint8Array,
  atIndex: number,
  otherPages?: number[]
): Promise<StructuralResult> {
  const doc = await load(bytes);
  const other = await load(otherBytes);
  const total = doc.getPageCount();
  const pick = otherPages && otherPages.length ? otherPages : range(other.getPageCount());
  const copied = await doc.copyPages(other, pick);
  copied.forEach((p, i) => doc.insertPage(atIndex + i, p));
  const mapping: PageMapping = range(total);
  mapping.splice(atIndex, 0, ...pick.map(() => null));
  return { bytes: await doc.save(), mapping };
}

/** Combine several PDF files (in order) into one new document. */
export async function combinePdfs(files: Array<{ bytes: Uint8Array; pages?: number[] }>): Promise<Uint8Array> {
  const out = await PDFDocument.create();
  for (const f of files) {
    const src = await load(f.bytes);
    const pick = f.pages && f.pages.length ? f.pages : range(src.getPageCount());
    const copied = await out.copyPages(src, pick);
    copied.forEach((p) => out.addPage(p));
  }
  return out.save();
}

/** Copy the given pages into a new standalone PDF. */
export async function extractPages(bytes: Uint8Array, indices: number[]): Promise<Uint8Array> {
  const src = await load(bytes);
  const out = await PDFDocument.create();
  const copied = await out.copyPages(src, indices);
  copied.forEach((p) => out.addPage(p));
  copyMetadata(src, out);
  return out.save();
}

/** Split into several PDFs, one per group of page indices. */
export async function splitPdf(bytes: Uint8Array, groups: number[][]): Promise<Uint8Array[]> {
  const results: Uint8Array[] = [];
  for (const g of groups) {
    if (g.length) results.push(await extractPages(bytes, g));
  }
  return results;
}

export type PageNumberPosition =
  | 'bottom-center'
  | 'bottom-right'
  | 'bottom-left'
  | 'top-center'
  | 'top-right'
  | 'top-left';

export type PageNumberFormat = 'n' | 'page-n' | 'page-n-of-total' | 'n-of-total' | 'dash-n';

export interface PageNumberOptions {
  position: PageNumberPosition;
  format: PageNumberFormat;
  startAt: number;
  fontSize: number;
  marginPt: number;
  color: string;
  bold: boolean;
  /** 0-based page indices to number; others are skipped. */
  pages: number[];
}

export function formatPageNumber(format: PageNumberFormat, n: number, total: number): string {
  switch (format) {
    case 'page-n':
      return `Page ${n}`;
    case 'page-n-of-total':
      return `Page ${n} of ${total}`;
    case 'n-of-total':
      return `${n} / ${total}`;
    case 'dash-n':
      return `- ${n} -`;
    default:
      return `${n}`;
  }
}

/** Stamp page numbers into the page content, upright regardless of page rotation. */
export async function addPageNumbers(bytes: Uint8Array, opts: PageNumberOptions): Promise<StructuralResult> {
  const doc = await load(bytes);
  const total = doc.getPageCount();
  const font: PDFFont = await doc.embedFont(opts.bold ? StandardFonts.HelveticaBold : StandardFonts.Helvetica);
  const color = hexToRgb(opts.color);
  const selected = [...new Set(opts.pages)].filter((i) => i >= 0 && i < total).sort((a, b) => a - b);
  const numberedTotal = opts.startAt + selected.length - 1;

  selected.forEach((pageIdx, k) => {
    const page = doc.getPage(pageIdx);
    const { width: W, height: H } = page.getSize();
    const rot = (((page.getRotation().angle || 0) % 360) + 360) % 360;
    // Visual (as displayed) page size
    const vw = rot % 180 === 0 ? W : H;
    const vh = rot % 180 === 0 ? H : W;

    const text = formatPageNumber(opts.format, opts.startAt + k, numberedTotal);
    const textW = font.widthOfTextAtSize(text, opts.fontSize);
    const m = opts.marginPt;

    let vx = (vw - textW) / 2;
    if (opts.position.endsWith('left')) vx = m;
    if (opts.position.endsWith('right')) vx = vw - m - textW;
    const vy = opts.position.startsWith('top') ? vh - m - opts.fontSize : m;

    // Map visual coordinates back into unrotated page space
    let x = vx;
    let y = vy;
    if (rot === 90) {
      x = W - vy;
      y = vx;
    } else if (rot === 180) {
      x = W - vx;
      y = H - vy;
    } else if (rot === 270) {
      x = vy;
      y = H - vx;
    }

    page.drawText(text, { x, y, size: opts.fontSize, font, color, rotate: degrees(rot) });
  });

  return { bytes: await doc.save(), mapping: range(total) };
}

/**
 * Parse a page range string like "1-3, 5, 8-" into 0-based indices.
 * Returns null if anything is out of range or malformed.
 */
export function parsePageRanges(input: string, total: number): number[] | null {
  const parts = input.split(',').map((s) => s.trim()).filter(Boolean);
  if (parts.length === 0) return null;
  const out: number[] = [];
  for (const part of parts) {
    const m = part.match(/^(\d*)\s*-\s*(\d*)$/);
    if (m) {
      const a = m[1] ? parseInt(m[1], 10) : 1;
      const b = m[2] ? parseInt(m[2], 10) : total;
      if (a < 1 || b > total || a > b) return null;
      for (let i = a; i <= b; i++) out.push(i - 1);
    } else if (/^\d+$/.test(part)) {
      const n = parseInt(part, 10);
      if (n < 1 || n > total) return null;
      out.push(n - 1);
    } else {
      return null;
    }
  }
  return out;
}

/** Turn a list of 0-based indices into a compact "1-3, 5" label. */
export function formatPageRanges(indices: number[]): string {
  const sorted = [...new Set(indices)].sort((a, b) => a - b);
  const parts: string[] = [];
  let start = -1;
  let prev = -2;
  for (const i of [...sorted, Infinity]) {
    if (i !== prev + 1) {
      if (start >= 0) parts.push(start === prev ? `${start + 1}` : `${start + 1}-${prev + 1}`);
      start = i;
    }
    prev = i;
  }
  return parts.join(', ');
}

export function range(n: number): number[] {
  return Array.from({ length: n }, (_, i) => i);
}

function copyMetadata(src: PDFDocument, out: PDFDocument) {
  try {
    const title = src.getTitle();
    const author = src.getAuthor();
    if (title) out.setTitle(title);
    if (author) out.setAuthor(author);
  } catch {
    /* metadata is optional */
  }
}

function hexToRgb(hex: string) {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h.padEnd(6, '0');
  return rgb(
    parseInt(full.slice(0, 2), 16) / 255,
    parseInt(full.slice(2, 4), 16) / 255,
    parseInt(full.slice(4, 6), 16) / 255
  );
}

/**
 * New page order after moving `moving` pages so they land before `dropBefore`
 * (an index in the current order; use `total` to drop at the end).
 */
export function computeMoveOrder(total: number, moving: number[], dropBefore: number): number[] {
  const movingSet = new Set(moving);
  const block = range(total).filter((i) => movingSet.has(i));
  const rest = range(total).filter((i) => !movingSet.has(i));
  const insertAt = rest.filter((i) => i < dropBefore).length;
  rest.splice(insertAt, 0, ...block);
  return rest;
}
