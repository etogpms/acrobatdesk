import { PDFDocument, PDFFont, PDFPage, StandardFonts, rgb } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import { PdfTextBlock, TextRun } from '../types/pdf';
import { FontFamilyId, getFamily, loadFontBytes } from './fontLibrary';
import { pitchFor } from './textFormatting';

/**
 * Writes edited text blocks into a page: covers the original glyphs and draws the new styled
 * runs with the same bundled font files the editor shows, so saved output matches the screen.
 */

type Color = ReturnType<typeof rgb>;

export class RunFontProvider {
  private cache = new Map<string, Promise<PDFFont>>();
  private registered = false;

  constructor(private doc: PDFDocument) {}

  get(family: FontFamilyId, bold: boolean, italic: boolean): Promise<PDFFont> {
    const key = `${family}|${bold ? 1 : 0}|${italic ? 1 : 0}`;
    let p = this.cache.get(key);
    if (!p) {
      p = this.load(family, bold, italic);
      this.cache.set(key, p);
    }
    return p;
  }

  private async load(family: FontFamilyId, bold: boolean, italic: boolean): Promise<PDFFont> {
    try {
      if (!this.registered) {
        this.doc.registerFontkit(fontkit);
        this.registered = true;
      }
      const bytes = await loadFontBytes(family, bold, italic);
      return await this.doc.embedFont(bytes, { subset: true });
    } catch (err) {
      // Offline or font file missing: fall back to the closest standard PDF font
      console.warn('Falling back to a standard PDF font:', err);
      const generic = getFamily(family).generic;
      const std =
        generic === 'serif'
          ? bold && italic ? StandardFonts.TimesRomanBoldItalic : bold ? StandardFonts.TimesRomanBold : italic ? StandardFonts.TimesRomanItalic : StandardFonts.TimesRoman
          : generic === 'monospace'
          ? bold && italic ? StandardFonts.CourierBoldOblique : bold ? StandardFonts.CourierBold : italic ? StandardFonts.CourierOblique : StandardFonts.Courier
          : bold && italic ? StandardFonts.HelveticaBoldOblique : bold ? StandardFonts.HelveticaBold : italic ? StandardFonts.HelveticaOblique : StandardFonts.Helvetica;
      return this.doc.embedFont(std);
    }
  }
}

interface Seg {
  text: string;
  font: PDFFont;
  underline: boolean;
}

const blockRuns = (b: PdfTextBlock): TextRun[] =>
  b.runs && b.runs.length ? b.runs : [{ text: b.currentText || '', bold: !!b.isBold, italic: !!b.isItalic }];

const familyOf = (b: PdfTextBlock): FontFamilyId =>
  b.fontChoice && b.fontChoice !== 'auto' ? b.fontChoice : b.autoFamilyId || 'liberation-sans';

const measure = (font: PDFFont, text: string, size: number) => {
  try {
    return font.widthOfTextAtSize(text, size);
  } catch {
    return text.length * size * 0.5;
  }
};

function drawSeg(page: PDFPage, seg: Seg, x: number, y: number, size: number, color: Color): number {
  const w = measure(seg.font, seg.text, size);
  if (seg.text) {
    try {
      page.drawText(seg.text, { x, y, size, font: seg.font, color });
    } catch {
      // Standard-font fallback cannot encode some characters; keep what it can
      page.drawText(seg.text.replace(/[^\x20-\x7E]/g, '?'), { x, y, size, font: seg.font, color });
    }
  }
  if (seg.underline && w > 0) {
    page.drawLine({
      start: { x, y: y - size * 0.12 },
      end: { x: x + w, y: y - size * 0.12 },
      thickness: Math.max(0.5, size * 0.06),
      color
    });
  }
  return w;
}

export async function drawTextBlock(
  page: PDFPage,
  block: PdfTextBlock,
  fonts: RunFontProvider,
  pageWidth: number,
  pageHeight: number,
  parseColor: (hex: string | undefined, fallback: { r: number; g: number; b: number }) => Color
) {
  const fs = block.fontSize || 12;
  const family = familyOf(block);
  const runs = blockRuns(block);
  const segs: Seg[] = await Promise.all(
    runs.map(async (r) => ({ text: r.text, font: await fonts.get(family, !!r.bold, !!r.italic), underline: !!r.underline }))
  );
  const color = parseColor(block.color, { r: 0.05, g: 0.05, b: 0.05 });
  const bg = parseColor(block.backgroundColor, { r: 1, g: 1, b: 1 });

  if ((block.lineCount || 1) > 1) {
    drawParagraph(page, block, segs, pageWidth, pageHeight, color, bg);
    return;
  }

  // ---- single line / table cell ----
  const line = segs.map((s) => ({ ...s, text: s.text.replace(/\n/g, ' ') }));
  const elemX = (block.xPct / 100) * pageWidth;
  const elemW = (block.widthPct / 100) * pageWidth;
  const textW = line.reduce((sum, s) => sum + measure(s.font, s.text, fs), 0);
  const indent = ((block.indentPct || 0) / 100) * pageWidth;
  // Keep the text aligned the way it was in its cell (an added indent shifts it like on screen)
  const textX =
    block.align === 'center' ? elemX + (elemW - textW + indent) / 2 : block.align === 'right' ? elemX + elemW - textW : elemX + indent;
  const maskX = Math.min(elemX, textX);
  const maskW = Math.max(elemX + elemW, textX + textW) - maskX;
  const baseline = pageHeight - (block.yPct / 100) * pageHeight - fs;
  // Cover only the glyph band so nearby table borders survive; padded sideways for overhangs
  const pad = Math.max(1, fs * 0.15);
  page.drawRectangle({ x: Math.max(0, maskX - pad), y: Math.max(0, baseline - fs * 0.22), width: maskW + pad * 2, height: fs * 1.12, color: bg });
  let x = textX;
  for (const s of line) x += drawSeg(page, s, x, Math.max(0, baseline), fs, color);
}

/**
 * Re-flow an edited paragraph inside its original box: same left edges (first-line indent /
 * hanging bullet), same line pitch and alignment (incl. justification), styles kept per word part.
 */
function drawParagraph(page: PDFPage, block: PdfTextBlock, segs: Seg[], pageWidth: number, pageHeight: number, color: Color, bg: Color) {
  const fs = block.fontSize || 12;
  const pitch = block.lineSpacing ? pitchFor(fs, block.lineSpacing) : block.linePitch || fs * 1.2;
  const left = (block.xPct / 100) * pageWidth;
  const right = left + (block.widthPct / 100) * pageWidth;
  const indent = ((block.indentPct || 0) / 100) * pageWidth;
  const firstX = ((block.firstLineXPct ?? block.xPct) / 100) * pageWidth + indent;
  const contX = ((block.contLeftPct ?? block.xPct) / 100) * pageWidth + indent;
  const firstBaseline = pageHeight - (block.yPct / 100) * pageHeight - fs;
  const spaceW = segs.length ? measure(segs[0].font, ' ', fs) : fs * 0.25;

  // Tokenise into words (each word may mix styles) and hard line breaks
  type Word = { parts: Seg[]; width: number };
  type Token = Word | { spaces: number } | 'break';
  const tokens: Token[] = [];
  let cur: Word | null = null;
  for (const s of segs) {
    for (const piece of s.text.split(/(\n| +)/)) {
      if (!piece) continue;
      if (piece === '\n' || / +/.test(piece) && piece.trim() === '') {
        if (cur) tokens.push(cur);
        cur = null;
        tokens.push(piece === '\n' ? 'break' : { spaces: piece.length });
        continue;
      }
      if (!cur) cur = { parts: [], width: 0 };
      cur.parts.push({ ...s, text: piece });
      cur.width += measure(s.font, piece, fs);
    }
  }
  if (cur) tokens.push(cur);

  // Greedy wrap
  type Line = { words: Word[]; x: number; avail: number; last: boolean };
  const lines: Line[] = [];
  let words: Word[] = [];
  let lineW = 0;
  // Spaces at the start of a typed line (list levels) indent that line, as they do on screen
  let lead = 0;
  let atLineStart = true;
  const startX = () => (lines.length === 0 ? firstX : contX) + lead;
  const push = (last: boolean) => {
    lines.push({ words, x: startX(), avail: right - startX(), last });
    words = [];
    lineW = 0;
    lead = 0;
  };
  for (const t of tokens) {
    if (t === 'break') {
      push(true);
      atLineStart = true;
      continue;
    }
    if (typeof t === 'object' && 'spaces' in t) {
      if (atLineStart && !words.length) lead += t.spaces * spaceW;
      continue;
    }
    atLineStart = false;
    const add = (words.length ? spaceW : 0) + t.width;
    if (words.length && lineW + add > right - startX()) push(false);
    lineW += (words.length ? spaceW : 0) + t.width;
    words.push(t);
  }
  push(true);

  // Cover the original paragraph and any extra lines the new text needs
  const newBottomBaseline = firstBaseline - (lines.length - 1) * pitch;
  const origBottomBaseline = pageHeight - ((block.yPct + block.heightPct) / 100) * pageHeight + fs * 0.2;
  const bottom = Math.min(newBottomBaseline, origBottomBaseline) - fs * 0.25;
  const pad = Math.max(1, fs * 0.15);
  page.drawRectangle({ x: Math.max(0, left - pad), y: Math.max(0, bottom), width: right - left + pad * 2, height: firstBaseline + fs * 0.9 - bottom, color: bg });

  lines.forEach((ln, i) => {
    const y = firstBaseline - i * pitch;
    if (y < 0 || ln.words.length === 0) return;
    const wordsW = ln.words.reduce((sum, w) => sum + w.width, 0);
    const naturalW = wordsW + spaceW * (ln.words.length - 1);
    let x = ln.x;
    let gap = spaceW;
    if (block.align === 'justify' && !ln.last && ln.words.length > 1) gap = (ln.avail - wordsW) / (ln.words.length - 1);
    else if (block.align === 'center') x = left + (right - left - naturalW) / 2;
    else if (block.align === 'right') x = right - naturalW;
    ln.words.forEach((w, k) => {
      for (const part of w.parts) x += drawSeg(page, part, x, y, fs, color);
      if (k < ln.words.length - 1) x += gap;
    });
  });
}
