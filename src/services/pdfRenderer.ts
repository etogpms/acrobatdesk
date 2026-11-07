import { detectFamilyId, getFamily, FontFamilyId } from './fontLibrary';
import * as pdfjsLib from 'pdfjs-dist';
// The PDF worker is bundled by Vite with the app (no CDN)
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { assetUrl } from './assetUrl';

if (typeof window !== 'undefined' && !pdfjsLib.GlobalWorkerOptions.workerSrc) {
  pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
}

export interface RenderedPageMeta {
  pageNumber: number;
  width: number;
  height: number;
  aspectRatio: number;
}

interface LayoutRaster {
  data: Uint8ClampedArray;
  w: number;
  h: number;
  k: number;
}

export class PdfRendererService {
  private pdfDoc: pdfjsLib.PDFDocumentProxy | null = null;
  private currentBytes: Uint8Array | null = null;

  async loadDocument(bytes: Uint8Array): Promise<number> {
    this.currentBytes = bytes;
    // Clone bytes buffer to prevent detached ArrayBuffer issues
    const copiedBuffer = bytes.slice().buffer;
    const loadingTask = pdfjsLib.getDocument({
      data: copiedBuffer,
      // All of these ship with the app so PDFs open fully offline
      cMapUrl: assetUrl('vendor/pdfjs/cmaps/'),
      cMapPacked: true,
      standardFontDataUrl: assetUrl('vendor/pdfjs/standard_fonts/'),
      wasmUrl: assetUrl('vendor/pdfjs/wasm/'),
      iccUrl: assetUrl('vendor/pdfjs/iccs/')
    });
    if (this.pdfDoc && typeof (this.pdfDoc as any).destroy === 'function') {
      (this.pdfDoc as any).destroy();
    }
    this.searchIndexCache.clear();
    this.pdfDoc = await loadingTask.promise;
    return this.pdfDoc.numPages;
  }

  getNumPages(): number {
    return this.pdfDoc ? this.pdfDoc.numPages : 0;
  }

  async getPageMeta(pageNumber: number, rotation: number = 0): Promise<RenderedPageMeta> {
    if (!this.pdfDoc) throw new Error('No PDF document loaded');
    const page = await this.pdfDoc.getPage(pageNumber);
    const viewport = page.getViewport({ scale: 1.0, rotation: (page.rotate + rotation) % 360 });
    return {
      pageNumber,
      width: viewport.width,
      height: viewport.height,
      aspectRatio: viewport.width / viewport.height
    };
  }

  async renderPageToCanvas(
    pageNumber: number,
    canvas: HTMLCanvasElement,
    scale: number = 1.0,
    rotation: number = 0
  ): Promise<{ width: number; height: number }> {
    if (!this.pdfDoc) throw new Error('No PDF document loaded');
    const page = await this.pdfDoc.getPage(pageNumber);
    
    // Support high-DPI screens
    const dpr = window.devicePixelRatio || 1;
    const viewport = page.getViewport({ scale: scale * dpr, rotation: (page.rotate + rotation) % 360 });

    canvas.width = viewport.width;
    canvas.height = viewport.height;
    canvas.style.width = `${viewport.width / dpr}px`;
    canvas.style.height = `${viewport.height / dpr}px`;

    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) throw new Error('Could not get 2D context');

    // Fill clean white background
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const renderContext = {
      canvasContext: ctx,
      viewport: viewport,
      intent: 'display'
    };

    await (page.render(renderContext as any) as any).promise;
    return {
      width: viewport.width / dpr,
      height: viewport.height / dpr
    };
  }

  async renderThumbnail(pageNumber: number, targetWidth: number = 180, rotation: number = 0): Promise<string> {
    if (!this.pdfDoc) return '';
    try {
      const page = await this.pdfDoc.getPage(pageNumber);
      const rot = (page.rotate + rotation) % 360;
      const initialViewport = page.getViewport({ scale: 1.0, rotation: rot });
      const scale = targetWidth / initialViewport.width;
      const viewport = page.getViewport({ scale, rotation: rot });

      const canvas = document.createElement('canvas');
      canvas.width = viewport.width;
      canvas.height = viewport.height;

      const ctx = canvas.getContext('2d');
      if (!ctx) return '';
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      await (page.render({ canvasContext: ctx, viewport } as any) as any).promise;
      return canvas.toDataURL('image/jpeg', 0.85);
    } catch (e) {
      console.warn(`Failed to render thumbnail for page ${pageNumber}`, e);
      return '';
    }
  }

  // Extract raw page text items for search and selectable text layer
  async extractPageText(pageNumber: number): Promise<{ fullText: string; items: Array<{ str: string; x: number; y: number; width: number; height: number }> }> {
    if (!this.pdfDoc) return { fullText: '', items: [] };
    const page = await this.pdfDoc.getPage(pageNumber);
    const textContent = await page.getTextContent();
    const viewport = page.getViewport({ scale: 1.0 });

    const items: Array<{ str: string; x: number; y: number; width: number; height: number }> = [];
    const strings: string[] = [];

    for (const item of textContent.items as any[]) {
      if ('str' in item && item.str) {
        strings.push(item.str);
        // Transform coordinates
        const tx = item.transform;
        const x = tx[4];
        const y = viewport.height - tx[5] - (item.height || 10);
        items.push({
          str: item.str,
          x,
          y,
          width: item.width || 0,
          height: item.height || 12
        });
      }
    }

    return {
      fullText: strings.join(' '),
      items
    };
  }

  // ---- Layout raster: used to find table borders / shading between text ----
  private async rasterizeForLayout(page: any): Promise<LayoutRaster | null> {
    try {
      const k = 1.5;
      const viewport = page.getViewport({ scale: k });
      const canvas = document.createElement('canvas');
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) return null;
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvasContext: ctx, viewport }).promise;
      return { data: ctx.getImageData(0, 0, canvas.width, canvas.height).data, w: canvas.width, h: canvas.height, k };
    } catch {
      return null;
    }
  }

  /** Most common color in a rectangle (page units). */
  private regionBackground(r: LayoutRaster, x0: number, x1: number, y0: number, y1: number): number[] {
    const counts = new Map<number, number>();
    let best = 0;
    let bestKey = 0xffffff;
    const X0 = Math.max(0, Math.floor(x0 * r.k)), X1 = Math.min(r.w - 1, Math.ceil(x1 * r.k));
    const Y0 = Math.max(0, Math.floor(y0 * r.k)), Y1 = Math.min(r.h - 1, Math.ceil(y1 * r.k));
    const stepX = Math.max(1, Math.floor((X1 - X0) / 40));
    const stepY = Math.max(1, Math.floor((Y1 - Y0) / 20));
    for (let y = Y0; y <= Y1; y += stepY) {
      for (let x = X0; x <= X1; x += stepX) {
        const i = (y * r.w + x) * 4;
        const key = ((r.data[i] >> 4) << 8) | ((r.data[i + 1] >> 4) << 4) | (r.data[i + 2] >> 4);
        const c = (counts.get(key) || 0) + 1;
        counts.set(key, c);
        if (c > best) {
          best = c;
          bestKey = key;
        }
      }
    }
    return [((bestKey >> 8) & 15) * 17, ((bestKey >> 4) & 15) * 17, (bestKey & 15) * 17];
  }

  private isInk(r: LayoutRaster, X: number, Y: number, bg: number[], threshold = 120) {
    const i = (Y * r.w + X) * 4;
    return Math.abs(r.data[i] - bg[0]) + Math.abs(r.data[i + 1] - bg[1]) + Math.abs(r.data[i + 2] - bg[2]) > threshold;
  }

  private colorDistance(a: number[], b: number[]) {
    return Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]);
  }

  /** Is there something drawn (text or a bullet shape) in this box? */
  private hasMark(r: LayoutRaster, x0: number, x1: number, y0: number, y1: number): boolean {
    const X0 = Math.max(0, Math.floor(x0 * r.k)), X1 = Math.min(r.w - 1, Math.ceil(x1 * r.k));
    const Y0 = Math.max(0, Math.floor(y0 * r.k)), Y1 = Math.min(r.h - 1, Math.ceil(y1 * r.k));
    if (X1 <= X0 || Y1 <= Y0) return false;
    const bg = this.regionBackground(r, x0, x1, y0, y1);
    let ink = 0;
    for (let Y = Y0; Y <= Y1; Y++) for (let X = X0; X <= X1; X++) if (this.isInk(r, X, Y, bg)) ink++;
    return ink >= 4;
  }

  /** Is there a vertical line (cell border) in the gap between x0 and x1? */
  private hasVerticalRule(r: LayoutRaster, x0: number, x1: number, y0: number, y1: number): boolean {
    const X0 = Math.ceil(x0 * r.k) + 1, X1 = Math.floor(x1 * r.k) - 1;
    const Y0 = Math.max(0, Math.floor(y0 * r.k)), Y1 = Math.min(r.h - 1, Math.ceil(y1 * r.k));
    if (X1 < X0 || Y1 <= Y0) return false;
    const bg = this.regionBackground(r, x0, x1, y0, y1);
    // Light borders (e.g. grey on light-blue shading) need a lower threshold; requiring the
    // line to run through 85% of the text height keeps glyph fragments from counting.
    for (let X = X0; X <= X1; X++) {
      let ink = 0;
      for (let Y = Y0; Y <= Y1; Y++) if (this.isInk(r, X, Y, bg, 50)) ink++;
      if (ink >= (Y1 - Y0 + 1) * 0.85) return true;
    }
    // Different shading on the two sides of the gap = two different cells
    const gap = x1 - x0;
    const leftBg = this.regionBackground(r, x0 + gap * 0.05, x0 + gap * 0.3, y0, y1);
    const rightBg = this.regionBackground(r, x1 - gap * 0.3, x1 - gap * 0.05, y0, y1);
    return this.colorDistance(leftBg, rightBg) > 30;
  }

  /** x (page units) of the first vertical line between x0 and x1 across the band, or null. */
  private findVerticalRule(r: LayoutRaster, x0: number, x1: number, y0: number, y1: number): number | null {
    const X0 = Math.ceil(x0 * r.k) + 1, X1 = Math.min(r.w - 1, Math.floor(x1 * r.k));
    const Y0 = Math.max(0, Math.floor(y0 * r.k)), Y1 = Math.min(r.h - 1, Math.ceil(y1 * r.k));
    if (X1 < X0 || Y1 <= Y0) return null;
    const bg = this.regionBackground(r, x0, Math.min(x1, x0 + 20), y0, y1);
    for (let X = X0; X <= X1; X++) {
      let ink = 0;
      for (let Y = Y0; Y <= Y1; Y++) if (this.isInk(r, X, Y, bg, 50)) ink++;
      if (ink >= (Y1 - Y0 + 1) * 0.85) return X / r.k;
    }
    return null;
  }

  /** Is there a horizontal line or shading edge in the band between two text lines? */
  private hasHorizontalRule(r: LayoutRaster, x0: number, x1: number, y0: number, y1: number): boolean {
    const X0 = Math.max(0, Math.floor(x0 * r.k)), X1 = Math.min(r.w - 1, Math.ceil(x1 * r.k));
    const Y0 = Math.max(0, Math.floor(y0 * r.k)), Y1 = Math.min(r.h - 1, Math.ceil(y1 * r.k));
    if (X1 <= X0 || Y1 < Y0) return false;
    const bg = this.regionBackground(r, x0, x1, y0, y1);
    // A rule is one unbroken run of ink; the tops of letters always have gaps between them
    for (let Y = Y0; Y <= Y1; Y++) {
      let run = 0;
      let longest = 0;
      for (let X = X0; X <= X1; X++) {
        if (this.isInk(r, X, Y, bg, 50)) {
          run++;
          if (run > longest) longest = run;
        } else run = 0;
      }
      if (longest >= (X1 - X0 + 1) * 0.85) return true;
    }
    // A different background above vs. below also means two different cells
    const above = this.regionBackground(r, x0, x1, y0 - 1, y0);
    const below = this.regionBackground(r, x0, x1, y1, y1 + 1);
    return this.colorDistance(above, below) > 30;
  }

  // Map a PDF font name to a CSS font stack + style flags
  static describeFont(
    realName: string,
    genericFamily: string,
    boldFlag: boolean,
    italicFlag: boolean
  ): { cssFamily: string; isBold: boolean; isItalic: boolean; detectedFont: string; autoFamilyId: FontFamilyId } {
    const name = realName.replace(/^[A-Z]{6}\+/, '');
    const isBold = boldFlag || /bold|black|heavy|semibold|demi/i.test(name);
    const isItalic = italicFlag || /italic|oblique/i.test(name);
    const base = name
      .split(/[-,]/)[0]
      .replace(/(MT|PS|PSMT)$/, '')
      .replace(/(Bold|Italic|Oblique|Regular)+$/i, '')
      .trim();

    let fallback = 'Arial, Helvetica, sans-serif';
    if (/courier|mono|consol/i.test(name) || genericFamily === 'monospace') {
      fallback = '"Courier New", Courier, monospace';
    } else if (/times|georgia|garamond|cambria|book|serif/i.test(name.replace(/sans/i, '')) || genericFamily === 'serif') {
      fallback = '"Times New Roman", Times, serif';
    }
    const realBase = base && !/^g_d\d/.test(base) ? base : '';
    const cssFamily = realBase ? `"${realBase}", ${fallback}` : fallback;
    const generic = fallback.includes('monospace') ? 'monospace' : fallback.includes('serif') && !fallback.includes('sans') ? 'serif' : 'sans-serif';
    const autoFamilyId = detectFamilyId(realBase, generic);
    // Keep spaces in names like "Times New Roman" readable: "TimesNewRoman" -> "Times New Roman"
    const detectedFont = (realBase || getFamily(autoFamilyId).label).replace(/([a-z])([A-Z])/g, '$1 $2');
    return { cssFamily, isBold, isItalic, detectedFont, autoFamilyId };
  }

  // Extract structured editable text blocks for "Edit PDF Text" mode
  async extractPageTextBlocks(pageNumber: number): Promise<import('../types/pdf').PdfTextBlock[]> {
    if (!this.pdfDoc) return [];
    const page = await this.pdfDoc.getPage(pageNumber);
    const textContent = await page.getTextContent();
    const viewport = page.getViewport({ scale: 1.0 });

    // Load the page's fonts so we can read their real names (e.g. "ABCDEF+Arial-BoldMT")
    try {
      await page.getOperatorList();
    } catch {
      /* font info is best-effort */
    }
    const fontInfoCache = new Map<string, { cssFamily: string; isBold: boolean; isItalic: boolean; embeddedFamily?: string; detectedFont: string; autoFamilyId: FontFamilyId }>();
    const resolveFont = (fontName: string) => {
      const cached = fontInfoCache.get(fontName);
      if (cached) return cached;
      let realName = '';
      let boldFlag = false;
      let italicFlag = false;
      let embeddedFamily: string | undefined;
      try {
        const font: any = (page as any).commonObjs.get(fontName);
        realName = font?.name || '';
        // pdf.js registers embedded fonts with the browser under `loadedName`; using it
        // makes the editor show the document's real typeface (missing glyphs fall back).
        if (font?.loadedName && !font.missingFile && typeof document !== 'undefined') {
          embeddedFamily = font.loadedName;
        }
        boldFlag = Boolean(font?.bold || font?.black);
        italicFlag = Boolean(font?.italic);
      } catch {
        /* font not resolved */
      }
      const genericFamily = (textContent.styles as any)?.[fontName]?.fontFamily || 'sans-serif';
      const info = { ...PdfRendererService.describeFont(realName, genericFamily, boldFlag, italicFlag), embeddedFamily };
      fontInfoCache.set(fontName, info);
      return info;
    };

    const rawItems: Array<{
      str: string;
      x: number;
      y: number;
      width: number;
      height: number;
      fontSize: number;
      fontName: string;
      cssFamily: string;
      isBold: boolean;
      isItalic: boolean;
      embeddedFamily?: string;
      detectedFont: string;
      autoFamilyId: FontFamilyId;
    }> = [];

    for (const item of textContent.items as any[]) {
      if ('str' in item && item.str && item.str.trim() !== '') {
        const tx = item.transform;
        const fontSize = Math.hypot(tx[2], tx[3]) || item.height || 12;
        const x = tx[4];
        // Top of the em box (baseline - fontSize); height includes descenders
        const y = viewport.height - tx[5] - fontSize;
        const font = resolveFont(item.fontName || '');
        rawItems.push({
          str: item.str,
          x,
          y,
          width: item.width || Math.max(item.str.length * (fontSize * 0.5), 10),
          height: fontSize * 1.2,
          fontSize,
          fontName: item.fontName || 'Helvetica',
          ...font
        });
      }
    }

    // Sort items top-to-bottom, left-to-right
    // Items on the same baseline (within a fraction of the font size) count as one row
    const sameRow = (a: { y: number; fontSize: number }, b: { y: number; fontSize: number }) =>
      Math.abs(a.y - b.y) <= Math.min(a.fontSize, b.fontSize) * 0.35;
    rawItems.sort((a, b) => (sameRow(a, b) ? a.x - b.x : a.y - b.y));

    // Render the page off-screen once so we can see table borders and cell shading.
    const raster = await this.rasterizeForLayout(page);

    const W = viewport.width;
    const H = viewport.height;

    // ---- 1. Group text pieces into lines ----
    type Item = (typeof rawItems)[number];
    interface Line {
      items: Item[];
      text: string;
      x: number;
      right: number;
      baseline: number;
      fs: number;
    }
    const lines: Line[] = [];
    const makeLine = (items: Item[]): Line => {
      let text = '';
      items.forEach((it, k) => {
        if (k > 0) {
          const prev = items[k - 1];
          const gap = it.x - (prev.x + prev.width);
          // Re-insert spaces where the PDF positioned words apart instead of encoding a space
          if (gap > it.fontSize * 0.12 && !/\s$/.test(text) && !/^\s/.test(it.str)) text += ' ';
        }
        text += it.str;
      });
      const fs = items.reduce((sum, i) => sum + i.fontSize, 0) / items.length;
      return {
        items,
        text: text.replace(/\s+$/, ''),
        x: Math.min(...items.map((i) => i.x)),
        right: Math.max(...items.map((i) => i.x + i.width)),
        baseline: Math.max(...items.map((i) => i.y + i.fontSize)),
        fs
      };
    };

    let current: Item[] = [];
    for (const item of rawItems) {
      const prev = current[current.length - 1];
      if (prev) {
        const gap = item.x - (prev.x + prev.width);
        const fs = Math.min(item.fontSize, prev.fontSize);
        // Same line unless the pieces are separated by a column/cell border or a very wide gap.
        // Without a page raster we fall back to "about a word-space apart".
        const join =
          sameRow(item, prev) &&
          gap > -prev.fontSize &&
          (raster
            ? gap < fs * 4 && !this.hasVerticalRule(raster, prev.x + prev.width, item.x, item.y + fs * 0.15, item.y + fs * 1.05)
            : gap < Math.max(fs * 0.6, 1.5));
        if (!join) {
          lines.push(makeLine(current));
          current = [];
        }
      }
      current.push(item);
    }
    if (current.length) lines.push(makeLine(current));

    // ---- 2. Merge wrapped lines into paragraphs ----
    interface Para {
      lines: Line[];
      minLeft: number;
      maxRight: number;
      pitch?: number;
      align?: 'left' | 'center';
    }
    const sameStyle = (a: Line, b: Line) =>
      Math.abs(a.fs - b.fs) <= 0.6 &&
      a.items[0].isBold === b.items[0].isBold &&
      a.items[0].isItalic === b.items[0].isItalic &&
      a.items[0].cssFamily === b.items[0].cssFamily;
    const firstWordWidth = (l: Line) => {
      const first = l.items[0];
      const word = (first.str.trimStart().match(/^\S+/) || [''])[0];
      return first.width * (word.length / Math.max(first.str.length, 1));
    };

    // Right edge available to a line: the first cell border to its right, otherwise the widest
    // right edge of nearby lines that start at about the same x (the column's margin).
    const columnRightCache = new Map<Line, number>();
    const columnRight = (l: Line): number => {
      const cached = columnRightCache.get(l);
      if (cached !== undefined) return cached;
      let margin = l.right;
      for (const o of lines) {
        if (Math.abs(o.x - l.x) <= l.fs * 3 && Math.abs(o.baseline - l.baseline) <= l.fs * 40) margin = Math.max(margin, o.right);
      }
      if (raster) {
        const rule = this.findVerticalRule(raster, l.right, Math.min(W, margin + l.fs), l.baseline - l.fs * 0.8, l.baseline + l.fs * 0.15);
        if (rule !== null) margin = Math.min(margin, rule);
      }
      columnRightCache.set(l, margin);
      return margin;
    };

    const paras: Para[] = [];
    const canAppend = (p: Para, l: Line): number | null => {
      const prev = p.lines[p.lines.length - 1];
      if (!sameStyle(prev, l)) return null;
      const fs = l.fs;
      // A bullet or list number always starts a new paragraph
      if (/^[•●▪■◦‣○·∙\-–—*]\s?/.test(l.text) && !/^[-–—]\w/.test(l.text)) return null;
      if (/^\(?(\d{1,3}|[a-z]|[ivx]{1,4})[.)]\s/.test(l.text)) return null;
      // ...including bullets drawn as shapes: a mark just left of this line that the line above lacks
      if (
        raster &&
        this.hasMark(raster, l.x - fs * 2.5, l.x - fs * 0.2, l.baseline - fs * 0.75, l.baseline) &&
        !this.hasMark(raster, l.x - fs * 2.5, l.x - fs * 0.2, prev.baseline - fs * 0.75, prev.baseline)
      ) {
        return null;
      }
      const pitch = l.baseline - prev.baseline;
      // Up to ~double spacing (Word "Double" ≈ 2.4× the font size); the wrap check below and the
      // equal-spacing rule keep separate items (headings, list rows, table rows) apart
      if (pitch < fs * 0.95 || pitch > fs * 2.8) return null;
      if (p.pitch !== undefined && Math.abs(pitch - p.pitch) > fs * 0.2) return null;
      if (l.x >= p.maxRight || l.right <= p.minLeft) return null;

      const space = fs * 0.28;
      const contLeft = p.lines.length >= 2 ? p.lines[1].x : null;
      const leftOk = contLeft !== null ? Math.abs(l.x - contLeft) <= fs * 0.4 : Math.abs(l.x - prev.x) <= fs * 3;
      const centerOk = Math.abs((l.x + l.right) / 2 - (prev.x + prev.right) / 2) <= fs * 0.6;
      let align: 'left' | 'center';
      if (p.align === 'center') {
        if (!centerOk) return null;
        align = 'center';
      } else if (leftOk) {
        align = 'left';
      } else if (centerOk && p.lines.length === 1) {
        align = 'center';
      } else {
        return null;
      }

      // The previous line must have wrapped: the next line's first word would not have fit
      // before the right edge of the text column (a cell border, or the margin nearby text uses)
      if (align === 'left') {
        const boundary = Math.max(columnRight(prev), l.right);
        if (prev.right + space + firstWordWidth(l) <= boundary - fs * 0.3) return null;
      } else {
        const maxW = Math.max(p.maxRight - p.minLeft, l.right - l.x);
        if (prev.right - prev.x + space + firstWordWidth(l) <= maxW - fs * 0.3) return null;
      }

      // No table border or shading change between the two lines
      if (raster) {
        const top = prev.baseline + fs * 0.23;
        const bottom = l.baseline - fs * 0.8;
        const xl = Math.max(prev.x, l.x);
        const xr = Math.min(prev.right, l.right);
        if (bottom > top && xr > xl && this.hasHorizontalRule(raster, xl, xr, top, bottom)) return null;
      }
      p.align = align;
      return pitch;
    };

    for (const l of lines) {
      let best: { p: Para; pitch: number } | null = null;
      for (const p of paras) {
        const pitch = canAppend(p, l);
        if (pitch !== null && (!best || pitch < best.pitch)) best = { p, pitch };
      }
      if (best) {
        best.p.lines.push(l);
        best.p.pitch = best.p.pitch ?? best.pitch;
        best.p.minLeft = Math.min(best.p.minLeft, l.x);
        best.p.maxRight = Math.max(best.p.maxRight, l.right);
      } else {
        paras.push({ lines: [l], minLeft: l.x, maxRight: l.right });
      }
    }

    // ---- 3. Emit editable blocks ----
    const blocks: import('../types/pdf').PdfTextBlock[] = [];
    for (const p of paras) {
      const first = p.lines[0];
      const last = p.lines[p.lines.length - 1];
      const fs = p.lines.reduce((sum, l) => sum + l.fs, 0) / p.lines.length;
      const font = first.items[0];
      const text = p.lines.reduce((acc, l, i) => (i === 0 ? l.text : /-$/.test(acc) ? acc + l.text : `${acc} ${l.text}`), '');
      const top = first.baseline - fs;
      const isPara = p.lines.length > 1;

      let align: import('../types/pdf').PdfTextBlock['align'];
      if (isPara) {
        align = p.align === 'center' ? 'center' : 'left';
        if (align === 'left') {
          const nonLast = p.lines.slice(0, -1);
          if (nonLast.every((l) => Math.abs(l.right - p.maxRight) <= fs * 0.35) && last.right < p.maxRight - fs) {
            align = 'justify';
          }
        }
      }
      const contLeft = isPara ? p.lines[1].x : first.x;

      blocks.push({
        id: `block-${pageNumber}-${blocks.length}-${Date.now()}`,
        pageIndex: pageNumber - 1,
        originalText: text,
        currentText: text,
        isModified: false,
        xPct: Math.max(0, (p.minLeft / W) * 100),
        yPct: Math.max(0, (top / H) * 100),
        widthPct: Math.min(100, (Math.max(p.maxRight - p.minLeft, 4) / W) * 100),
        heightPct: Math.min(100, ((last.baseline + fs * 0.2 - top) / H) * 100),
        fontSize: Math.round(fs * 10) / 10,
        fontFamily: font.cssFamily,
        isBold: font.isBold,
        isItalic: font.isItalic,
        originalBold: font.isBold,
        originalItalic: font.isItalic,
        detectedFont: font.detectedFont,
        autoFamilyId: font.autoFamilyId,
        fontChoice: 'auto',
        embeddedFamily: p.lines.every((l) => l.items.every((i) => i.embeddedFamily === font.embeddedFamily)) ? font.embeddedFamily : undefined,
        align,
        lineCount: p.lines.length,
        // Average baseline spacing over the whole paragraph (individual gaps can vary slightly)
        linePitch: isPara ? Math.round(((last.baseline - first.baseline) / (p.lines.length - 1)) * 100) / 100 : undefined,
        firstLineXPct: (first.x / W) * 100,
        contLeftPct: (contLeft / W) * 100,
        color: '#000000',
        backgroundColor: '#FFFFFF'
      });
    }

    return blocks;
  }

  // Search the whole document. Text pieces on a page are joined so phrases that span
  // several PDF text runs still match; each hit gets a highlight box and a context snippet.
  async searchDocument(
    query: string,
    options: import('../types/pdf').SearchOptions
  ): Promise<import('../types/pdf').SearchMatch[]> {
    if (!this.pdfDoc || !query || query.trim().length === 0) return [];
    const trimmed = query.trim();
    const escaped = trimmed
      .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      .replace(/\s+/g, '\\s+');
    const pattern = options.wholeWord ? `(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])` : escaped;
    let regex: RegExp;
    try {
      regex = new RegExp(pattern, options.matchCase ? 'gu' : 'giu');
    } catch {
      return [];
    }

    const matches: import('../types/pdf').SearchMatch[] = [];
    const numPages = this.pdfDoc.numPages;
    for (let p = 1; p <= numPages; p++) {
      const { text, runs, vw, vh } = await this.getSearchIndex(p);
      regex.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = regex.exec(text)) !== null) {
        if (m[0].length === 0) {
          regex.lastIndex++;
          continue;
        }
        const s = m.index;
        const e = s + m[0].length;
        const hitRuns = runs.filter((r) => r.end > s && r.start < e);
        if (hitRuns.length === 0) continue;
        // Highlight the part of each run covered by the match, kept to the first line
        const first = hitRuns[0];
        const boxes = hitRuns
          .filter((r) => Math.abs(r.y - first.y) < first.h * 0.6)
          .map((r) => {
            const a = Math.max(s, r.start) - r.start;
            const b = Math.min(e, r.end) - r.start;
            const runText = text.slice(r.start, r.end);
            return { x: r.x + r.w * this.widthRatio(runText, a, r.serif), x2: r.x + r.w * this.widthRatio(runText, b, r.serif), y: r.y, h: r.h };
          });
        const x = Math.min(...boxes.map((b) => b.x));
        const x2 = Math.max(...boxes.map((b) => b.x2));
        const y = Math.min(...boxes.map((b) => b.y));
        const h = Math.max(...boxes.map((b) => b.h));

        const ctxStart = Math.max(0, s - 40);
        const ctxEnd = Math.min(text.length, e + 40);
        matches.push({
          id: `match-${p}-${matches.length}`,
          pageIndex: p - 1,
          text: m[0],
          snippet: `${ctxStart > 0 ? '…' : ''}${text.slice(ctxStart, ctxEnd).replace(/\s+/g, ' ')}${ctxEnd < text.length ? '…' : ''}`,
          snippetMatchStart: s - ctxStart + (ctxStart > 0 ? 1 : 0),
          snippetMatchLength: m[0].length,
          xPct: (x / vw) * 100,
          yPct: (y / vh) * 100,
          widthPct: Math.min((Math.max(x2 - x, 4) / vw) * 100, 100),
          heightPct: Math.min((h / vh) * 100, 20)
        });
      }
    }
    return matches;
  }

  /** Every word on a page with its box (page %), in reading order — used for text highlights. */
  async getPageWords(pageNumber: number): Promise<Array<{ text: string; x: number; y: number; w: number; h: number; line: number }>> {
    if (!this.pdfDoc) return [];
    const { text, runs, vw, vh } = await this.getSearchIndex(pageNumber);
    const words: Array<{ text: string; x: number; y: number; w: number; h: number; line: number }> = [];
    let line = -1;
    let lastY = -Infinity;
    for (const r of runs) {
      const runText = text.slice(r.start, r.end);
      if (Math.abs(r.y - lastY) > r.h * 0.4) {
        line++;
        lastY = r.y;
      }
      const re = /\S+/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(runText)) !== null) {
        const a = this.widthRatio(runText, m.index, r.serif);
        const b = this.widthRatio(runText, m.index + m[0].length, r.serif);
        words.push({
          text: m[0],
          x: ((r.x + r.w * a) / vw) * 100,
          y: ((r.y + r.h * 0.04) / vh) * 100,
          w: (Math.max(r.w * (b - a), 1) / vw) * 100,
          h: ((r.h * 0.96) / vh) * 100,
          line
        });
      }
    }
    return words;
  }

  private searchIndexCache = new Map<number, { text: string; runs: Array<{ start: number; end: number; x: number; y: number; w: number; h: number; serif: boolean }>; vw: number; vh: number }>();
  private measureCtx: CanvasRenderingContext2D | null = null;

  /** Fraction of a run's width taken by its first `chars` characters, using real glyph widths. */
  private widthRatio(runText: string, chars: number, serif: boolean): number {
    if (chars <= 0) return 0;
    if (chars >= runText.length) return 1;
    if (!this.measureCtx) this.measureCtx = document.createElement('canvas').getContext('2d');
    const ctx = this.measureCtx;
    if (!ctx) return chars / runText.length;
    ctx.font = serif ? '20px "Times New Roman", Times, serif' : '20px Arial, Helvetica, sans-serif';
    const full = ctx.measureText(runText).width;
    return full > 0 ? ctx.measureText(runText.slice(0, chars)).width / full : chars / runText.length;
  }

  private async getSearchIndex(pageNumber: number) {
    const cached = this.searchIndexCache.get(pageNumber);
    if (cached) return cached;
    const page = await this.pdfDoc!.getPage(pageNumber);
    const viewport = page.getViewport({ scale: 1.0, rotation: 0 });
    const textContent = await page.getTextContent();
    let text = '';
    const runs: Array<{ start: number; end: number; x: number; y: number; w: number; h: number; serif: boolean }> = [];
    let prev: { x: number; y: number; w: number; h: number } | null = null;
    for (const item of textContent.items as any[]) {
      if (!('str' in item)) continue;
      const str: string = item.str;
      const tx = item.transform;
      const fontSize = Math.hypot(tx[2], tx[3]) || item.height || 12;
      const x = tx[4];
      const y = viewport.height - tx[5] - fontSize;
      const w = item.width || Math.max(str.length * fontSize * 0.5, 4);
      if (str.length > 0) {
        // Insert a separator between runs unless they visually touch on the same line
        if (prev && text.length > 0 && !/\s$/.test(text)) {
          const sameLine = Math.abs(prev.y - y) < fontSize * 0.5;
          const gap = x - (prev.x + prev.w);
          if (!sameLine || gap > fontSize * 0.15) text += ' ';
        }
        const family = (textContent.styles as any)?.[item.fontName]?.fontFamily || '';
        runs.push({ start: text.length, end: text.length + str.length, x, y, w, h: fontSize * 1.2, serif: family === 'serif' });
        text += str;
        prev = { x, y, w, h: fontSize };
      }
      if (item.hasEOL && !/\s$/.test(text)) text += ' ';
    }
    const entry = { text, runs, vw: viewport.width, vh: viewport.height };
    this.searchIndexCache.set(pageNumber, entry);
    return entry;
  }

  // ---------------- Images ----------------

  private imageSources = new Map<string, { pageNumber: number; objId?: string; inline?: any; bboxUser: [number, number, number, number] }>();

  /** Find every image drawn on a page, with its box on the page. */
  async extractPageImages(pageNumber: number): Promise<import('../types/pdf').PdfImageItem[]> {
    if (!this.pdfDoc) return [];
    const page = await this.pdfDoc.getPage(pageNumber);
    const ops = await page.getOperatorList();
    const OPS = pdfjsLib.OPS as any;
    const viewport = page.getViewport({ scale: 1.0 });
    type M = [number, number, number, number, number, number];
    const mul = (a: M, b: M): M => [
      a[0] * b[0] + a[1] * b[2],
      a[0] * b[1] + a[1] * b[3],
      a[2] * b[0] + a[3] * b[2],
      a[2] * b[1] + a[3] * b[3],
      a[4] * b[0] + a[5] * b[2] + b[4],
      a[4] * b[1] + a[5] * b[3] + b[5]
    ];
    let ctm: M = [1, 0, 0, 1, 0, 0];
    const stack: M[] = [];
    const items: import('../types/pdf').PdfImageItem[] = [];

    const record = (objId: string | undefined, inline: any, w: number, h: number) => {
      const corners = [
        [ctm[4], ctm[5]],
        [ctm[0] + ctm[4], ctm[1] + ctm[5]],
        [ctm[2] + ctm[4], ctm[3] + ctm[5]],
        [ctm[0] + ctm[2] + ctm[4], ctm[1] + ctm[3] + ctm[5]]
      ];
      const bboxUser: [number, number, number, number] = [
        Math.min(...corners.map((p) => p[0])),
        Math.min(...corners.map((p) => p[1])),
        Math.max(...corners.map((p) => p[0])),
        Math.max(...corners.map((p) => p[1]))
      ];
      const vp = corners.map(([x, y]) => viewport.convertToViewportPoint(x, y));
      const vx0 = Math.min(...vp.map((p) => p[0]));
      const vy0 = Math.min(...vp.map((p) => p[1]));
      const vx1 = Math.max(...vp.map((p) => p[0]));
      const vy1 = Math.max(...vp.map((p) => p[1]));
      // Skip hairline / full-page background images that aren't useful to edit
      if (vx1 - vx0 < 3 || vy1 - vy0 < 3) return;
      const id = `img-${pageNumber}-${items.length}-${Date.now()}`;
      this.imageSources.set(id, { pageNumber, objId, inline, bboxUser });
      items.push({
        id,
        pageIndex: pageNumber - 1,
        bboxUser,
        xPct: (vx0 / viewport.width) * 100,
        yPct: (vy0 / viewport.height) * 100,
        widthPct: ((vx1 - vx0) / viewport.width) * 100,
        heightPct: ((vy1 - vy0) / viewport.height) * 100,
        pixelWidth: w,
        pixelHeight: h
      });
    };

    for (let i = 0; i < ops.fnArray.length; i++) {
      const fn = ops.fnArray[i];
      const args = ops.argsArray[i];
      if (fn === OPS.save) stack.push(ctm);
      else if (fn === OPS.restore) ctm = stack.pop() || ctm;
      else if (fn === OPS.transform) ctm = mul(args as M, ctm);
      else if (fn === OPS.paintFormXObjectBegin) {
        stack.push(ctm);
        if (Array.isArray(args?.[0]) && args[0].length === 6) ctm = mul(args[0] as M, ctm);
      } else if (fn === OPS.paintFormXObjectEnd) ctm = stack.pop() || ctm;
      else if (fn === OPS.paintImageXObject) record(args[0], undefined, args[1], args[2]);
      else if (fn === OPS.paintInlineImageXObject) record(undefined, args[0], args[0]?.width || 0, args[0]?.height || 0);
    }
    return items;
  }

  /** The image's own pixels as a PNG data URL (falls back to a crop of the rendered page). */
  async getImageDataUrl(item: import('../types/pdf').PdfImageItem): Promise<string> {
    const src = this.imageSources.get(item.id);
    let img: any = src?.inline;
    if (!img && src?.objId && this.pdfDoc) {
      const page = await this.pdfDoc.getPage(src.pageNumber);
      const objs = src.objId.startsWith('g_') ? (page as any).commonObjs : (page as any).objs;
      img = await new Promise((resolve) => {
        const timer = setTimeout(() => resolve(null), 3000);
        try {
          objs.get(src.objId, (data: any) => {
            clearTimeout(timer);
            resolve(data);
          });
        } catch {
          clearTimeout(timer);
          resolve(null);
        }
      });
    }
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    if (img && ctx) {
      const w = img.width || img.bitmap?.width;
      const h = img.height || img.bitmap?.height;
      if (w && h) {
        canvas.width = w;
        canvas.height = h;
        if (img.bitmap) {
          ctx.drawImage(img.bitmap, 0, 0);
          return canvas.toDataURL('image/png');
        }
        if (img.data) {
          const out = ctx.createImageData(w, h);
          const d = img.data as Uint8ClampedArray;
          if (img.kind === 3 || d.length === w * h * 4) out.data.set(d.subarray(0, w * h * 4));
          else if (img.kind === 2 || d.length === w * h * 3) {
            for (let p = 0, q = 0; p < w * h; p++, q += 3) {
              out.data[p * 4] = d[q];
              out.data[p * 4 + 1] = d[q + 1];
              out.data[p * 4 + 2] = d[q + 2];
              out.data[p * 4 + 3] = 255;
            }
          } else {
            // 1-bit grayscale rows padded to whole bytes
            const rowBytes = Math.ceil(w / 8);
            for (let y = 0; y < h; y++)
              for (let x = 0; x < w; x++) {
                const bit = (d[y * rowBytes + (x >> 3)] >> (7 - (x & 7))) & 1;
                const v = bit ? 255 : 0;
                const o = (y * w + x) * 4;
                out.data[o] = out.data[o + 1] = out.data[o + 2] = v;
                out.data[o + 3] = 255;
              }
          }
          ctx.putImageData(out, 0, 0);
          return canvas.toDataURL('image/png');
        }
      }
    }
    // Fallback: crop the area from a high-resolution render of the page
    return this.cropPageArea(item, 3);
  }

  async cropPageArea(item: { pageIndex: number; xPct: number; yPct: number; widthPct: number; heightPct: number }, scale = 3): Promise<string> {
    if (!this.pdfDoc) return '';
    const page = await this.pdfDoc.getPage(item.pageIndex + 1);
    const viewport = page.getViewport({ scale });
    const full = document.createElement('canvas');
    full.width = Math.ceil(viewport.width);
    full.height = Math.ceil(viewport.height);
    const fctx = full.getContext('2d')!;
    fctx.fillStyle = '#FFFFFF';
    fctx.fillRect(0, 0, full.width, full.height);
    await (page.render({ canvasContext: fctx, viewport } as any) as any).promise;
    const x = (item.xPct / 100) * full.width;
    const y = (item.yPct / 100) * full.height;
    const w = Math.max(1, (item.widthPct / 100) * full.width);
    const h = Math.max(1, (item.heightPct / 100) * full.height);
    const out = document.createElement('canvas');
    out.width = Math.round(w);
    out.height = Math.round(h);
    out.getContext('2d')!.drawImage(full, x, y, w, h, 0, 0, out.width, out.height);
    return out.toDataURL('image/png');
  }

  // Get high-resolution image data URL for OCR processing
  async getPageImageForOcr(pageNumber: number, rotation: number = 0): Promise<string> {
    if (!this.pdfDoc) throw new Error('No PDF document loaded');
    const page = await this.pdfDoc.getPage(pageNumber);
    // 2.0x scale gives crisp character recognition for Tesseract OCR
    const viewport = page.getViewport({ scale: 2.0, rotation: (page.rotate + rotation) % 360 });
    const canvas = document.createElement('canvas');
    canvas.width = viewport.width;
    canvas.height = viewport.height;

    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Could not get 2D canvas context for OCR');

    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    await (page.render({ canvasContext: ctx, viewport } as any) as any).promise;
    return canvas.toDataURL('image/png');
  }

  destroy() {
    if (this.pdfDoc) {
      if (typeof (this.pdfDoc as any).destroy === 'function') {
        (this.pdfDoc as any).destroy();
      }
      this.pdfDoc = null;
    }
    this.currentBytes = null;
  }
}
