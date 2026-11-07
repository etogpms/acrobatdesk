import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFHexString,
  PDFName,
  PDFNumber,
  PDFPage,
  PDFRef,
  PDFString,
  PDFBool
} from 'pdf-lib';
import { AnnotationItem, CommentReply } from '../types/pdf';

/**
 * Comments and highlights as real PDF annotations, so they show up in Acrobat, Preview, Chrome…
 *  - import: Text (sticky-note) and Highlight annotations, with their reply threads, become editable
 *    items in the app and are taken out of the working copy (so they are not drawn twice);
 *  - export: highlights become /Highlight annotations (carrying their comment, like Acrobat does),
 *    other comments become /Text annotations; replies are linked with /IRT.
 * Coordinates follow the rest of the app: percentages of the page size, origin top-left.
 */

const IMPORTABLE = new Set(['/Text', '/Highlight']);

const str = (v: unknown): string => {
  if (v instanceof PDFString || v instanceof PDFHexString) return v.decodeText();
  return '';
};

const nums = (v: unknown): number[] =>
  v instanceof PDFArray ? v.asArray().map((n) => (n instanceof PDFNumber ? n.asNumber() : 0)) : [];

const toHex = (c: number[]) =>
  '#' + c.slice(0, 3).map((v) => Math.round(Math.min(1, Math.max(0, v)) * 255).toString(16).padStart(2, '0')).join('');

const fromHex = (hex?: string, fallback = [1, 0.8, 0.2]) => {
  if (!hex || !/^#[0-9a-f]{6}$/i.test(hex)) return fallback;
  return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
};

/** "D:20261106120000+08'00'" → ms */
const parsePdfDate = (s: string): number => {
  const m = s.match(/D:(\d{4})(\d{2})?(\d{2})?(\d{2})?(\d{2})?(\d{2})?/);
  if (!m) return Date.now();
  const [, y, mo = '01', d = '01', h = '00', mi = '00', se = '00'] = m;
  const t = Date.UTC(+y, +mo - 1, +d, +h, +mi, +se);
  return isNaN(t) ? Date.now() : t;
};

const pdfDate = (ms: number) => {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, '0');
  return `D:${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}Z`;
};

/** Read comments/highlights out of a PDF. Returns the PDF without them, plus the app items. */
export async function importComments(bytes: Uint8Array): Promise<{ bytes: Uint8Array; annotations: AnnotationItem[] } | null> {
  let doc: PDFDocument;
  try {
    doc = await PDFDocument.load(bytes, { ignoreEncryption: true });
  } catch {
    return null;
  }
  const ctx = doc.context;
  const out: AnnotationItem[] = [];
  let changed = false;

  doc.getPages().forEach((page, pageIndex) => {
    // Rotated pages keep their annotations as they are (coordinates would need rotating)
    if ((page.getRotation().angle || 0) % 360 !== 0) return;
    const annots = page.node.lookupMaybe(PDFName.of('Annots'), PDFArray);
    if (!annots) return;
    const { width: W, height: H } = page.getSize();
    const pct = (x: number, y: number) => ({ x: (x / W) * 100, y: ((H - y) / H) * 100 });

    type Raw = { ref: PDFRef | null; dict: PDFDict; subtype: string; irt: string | null; key: string };
    const raws: Raw[] = [];
    annots.asArray().forEach((entry, i) => {
      const dict = entry instanceof PDFRef ? ctx.lookup(entry) : entry;
      if (!(dict instanceof PDFDict)) return;
      const subtype = (dict.get(PDFName.of('Subtype')) as PDFName | undefined)?.asString() || '';
      const irt = dict.get(PDFName.of('IRT'));
      raws.push({
        ref: entry instanceof PDFRef ? entry : null,
        dict,
        subtype,
        irt: irt instanceof PDFRef ? irt.toString() : null,
        key: entry instanceof PDFRef ? entry.toString() : `direct-${pageIndex}-${i}`
      });
    });

    const parents = raws.filter((r) => IMPORTABLE.has(r.subtype) && !r.irt);
    if (!parents.length) return;
    const removeKeys = new Set<string>();
    const byKey = new Map<string, AnnotationItem>();

    for (const r of parents) {
      const rect = nums(r.dict.get(PDFName.of('Rect')));
      if (rect.length < 4) continue;
      const contents = str(r.dict.get(PDFName.of('Contents')));
      const author = str(r.dict.get(PDFName.of('T'))) || 'Unknown';
      const created = parsePdfDate(str(r.dict.get(PDFName.of('M'))) || str(r.dict.get(PDFName.of('CreationDate'))));
      const color = nums(r.dict.get(PDFName.of('C')));
      const resolved = r.dict.get(PDFName.of('AcroDeskResolved')) === PDFBool.True;

      if (r.subtype === '/Highlight') {
        const qp = nums(r.dict.get(PDFName.of('QuadPoints')));
        const rects: Array<{ x: number; y: number; w: number; h: number }> = [];
        for (let k = 0; k + 7 < qp.length; k += 8) {
          const xs = [qp[k], qp[k + 2], qp[k + 4], qp[k + 6]];
          const ys = [qp[k + 1], qp[k + 3], qp[k + 5], qp[k + 7]];
          const a = pct(Math.min(...xs), Math.max(...ys));
          const b = pct(Math.max(...xs), Math.min(...ys));
          rects.push({ x: a.x, y: a.y, w: b.x - a.x, h: b.y - a.y });
        }
        if (!rects.length) {
          const a = pct(rect[0], rect[3]);
          const b = pct(rect[2], rect[1]);
          rects.push({ x: a.x, y: a.y, w: b.x - a.x, h: b.y - a.y });
        }
        const bx0 = Math.min(...rects.map((q) => q.x));
        const by0 = Math.min(...rects.map((q) => q.y));
        const hl: AnnotationItem = {
          id: `highlight-imp-${pageIndex}-${out.length}-${Date.now()}`,
          pageIndex,
          type: 'highlight',
          x: bx0,
          y: by0,
          width: Math.max(...rects.map((q) => q.x + q.w)) - bx0,
          height: Math.max(...rects.map((q) => q.y + q.h)) - by0,
          rects,
          quote: str(r.dict.get(PDFName.of('AcroDeskQuote'))) || undefined,
          color: color.length >= 3 ? toHex(color) : '#FBBF24',
          opacity: (r.dict.get(PDFName.of('CA')) as PDFNumber | undefined)?.asNumber?.() ?? 0.35,
          author,
          createdAt: created
        };
        out.push(hl);
        byKey.set(r.key, hl);
        if (contents.trim()) {
          const c: AnnotationItem = {
            id: `note-imp-${pageIndex}-${out.length}-${Date.now()}`,
            pageIndex,
            type: 'note',
            x: Math.min(97, hl.x + (hl.width || 0)),
            y: Math.max(0, hl.y - 1.5),
            width: 3,
            height: 2,
            content: contents,
            author,
            anchor: { kind: 'annotation', id: hl.id },
            replies: [],
            resolved,
            createdAt: created
          };
          out.push(c);
          byKey.set(r.key, c); // replies attach to the comment thread
        }
      } else {
        const a = pct(rect[0], rect[3]);
        const c: AnnotationItem = {
          id: `note-imp-${pageIndex}-${out.length}-${Date.now()}`,
          pageIndex,
          type: 'note',
          x: a.x,
          y: a.y,
          width: 3,
          height: 2,
          content: contents,
          author,
          anchor: { kind: 'point' },
          replies: [],
          resolved,
          createdAt: created
        };
        out.push(c);
        byKey.set(r.key, c);
      }
      removeKeys.add(r.key);
    }

    // Replies (/IRT) join their parent's thread; popups of removed annotations go too
    for (const r of raws) {
      if (r.irt && byKey.has(r.irt)) {
        const parent = byKey.get(r.irt)!;
        if (parent.type !== 'note') continue;
        const reply: CommentReply = {
          id: `reply-imp-${Math.random().toString(36).slice(2, 9)}`,
          author: str(r.dict.get(PDFName.of('T'))) || 'Unknown',
          text: str(r.dict.get(PDFName.of('Contents'))),
          createdAt: parsePdfDate(str(r.dict.get(PDFName.of('M'))))
        };
        if (reply.text.trim()) parent.replies = [...(parent.replies || []), reply];
        removeKeys.add(r.key);
      }
      if (r.subtype === '/Popup') {
        const parent = r.dict.get(PDFName.of('Parent'));
        if (parent instanceof PDFRef && removeKeys.has(parent.toString())) removeKeys.add(r.key);
      }
    }
    for (const r of raws) {
      // A popup whose parent was imported (checked again now that all parents are known)
      if (r.subtype === '/Popup') {
        const parent = r.dict.get(PDFName.of('Parent'));
        if (parent instanceof PDFRef && removeKeys.has(parent.toString())) removeKeys.add(r.key);
      }
    }

    if (removeKeys.size) {
      const kept = annots.asArray().filter((entry, i) => {
        const key = entry instanceof PDFRef ? entry.toString() : `direct-${pageIndex}-${i}`;
        return !removeKeys.has(key);
      });
      page.node.set(PDFName.of('Annots'), ctx.obj(kept));
      changed = true;
    }
  });

  if (!changed) return null;
  return { bytes: await doc.save(), annotations: out };
}

/** Write the app's highlights and comments onto a page as real PDF annotations. */
export function exportCommentsToPage(doc: PDFDocument, page: PDFPage, items: AnnotationItem[], allItems: AnnotationItem[]) {
  const ctx = doc.context;
  const { width: W, height: H } = page.getSize();
  const px = (xPct: number) => (xPct / 100) * W;
  const py = (yPct: number) => H - (yPct / 100) * H;
  const text = (s: string) => PDFHexString.fromText(s || '');

  const comments = items.filter((a) => a.type === 'note');
  const commentFor = (id: string) =>
    comments.find((c) => c.anchor?.kind === 'annotation' && c.anchor.id === id);

  const addReplies = (parentRef: PDFRef, rect: number[], c: AnnotationItem) => {
    for (const r of c.replies || []) {
      const reply = ctx.obj({
        Type: 'Annot',
        Subtype: 'Text',
        Rect: rect,
        Contents: text(r.text),
        T: text(r.author),
        M: PDFString.of(pdfDate(r.createdAt)),
        IRT: parentRef,
        RT: 'R',
        Name: 'Comment',
        F: 56, // NoZoom | NoRotate | NoView: listed in the thread, not drawn as an extra icon
        Open: false
      });
      page.node.addAnnot(ctx.register(reply));
    }
  };

  const used = new Set<string>();

  // Highlights (with the comment attached, if any)
  for (const h of items.filter((a) => a.type === 'highlight')) {
    const rects = h.rects && h.rects.length ? h.rects : [{ x: h.x, y: h.y, w: h.width || 0, h: h.height || 0 }];
    const quads: number[] = [];
    rects.forEach((q) => {
      const x1 = px(q.x), x2 = px(q.x + q.w), yTop = py(q.y), yBot = py(q.y + q.h);
      quads.push(x1, yTop, x2, yTop, x1, yBot, x2, yBot);
    });
    const xs = rects.flatMap((q) => [px(q.x), px(q.x + q.w)]);
    const ys = rects.flatMap((q) => [py(q.y), py(q.y + q.h)]);
    const bbox = [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
    const color = fromHex(h.color);
    const opacity = h.opacity ?? 0.35;

    // Appearance: translucent multiply fill, so every viewer draws it the same way
    const ops =
      `/GS0 gs ${color.map((v) => v.toFixed(3)).join(' ')} rg ` +
      rects.map((q) => `${px(q.x).toFixed(2)} ${py(q.y + q.h).toFixed(2)} ${(px(q.x + q.w) - px(q.x)).toFixed(2)} ${(py(q.y) - py(q.y + q.h)).toFixed(2)} re`).join(' ') +
      ' f';
    const ap = ctx.flateStream(new TextEncoder().encode(ops), {
      Type: 'XObject',
      Subtype: 'Form',
      BBox: bbox,
      Resources: { ExtGState: { GS0: { Type: 'ExtGState', ca: opacity, CA: opacity, BM: 'Multiply' } } }
    });

    const c = commentFor(h.id);
    if (c) used.add(c.id);
    const dict: Record<string, any> = {
      Type: 'Annot',
      Subtype: 'Highlight',
      Rect: bbox,
      QuadPoints: quads,
      C: color,
      CA: opacity,
      F: 4, // Print
      T: text(c?.author || h.author || 'AcrobatDesk'),
      M: PDFString.of(pdfDate(c?.createdAt || h.updatedAt || h.createdAt)),
      AP: { N: ctx.register(ap) }
    };
    if (c?.content) dict.Contents = text(c.content);
    if (h.quote) dict.AcroDeskQuote = text(h.quote);
    if (c?.resolved) dict.AcroDeskResolved = true;
    const ref = ctx.register(ctx.obj(dict));
    page.node.addAnnot(ref);
    if (c) addReplies(ref, bbox, c);
  }

  // Other comments: sticky-note (/Text) annotations at the comment's pin
  for (const c of comments) {
    if (used.has(c.id)) continue;
    let ax = c.x;
    let ay = c.y;
    if (c.anchor?.kind === 'annotation') {
      const anchorId = c.anchor.id;
      const target = allItems.find((a) => a.id === anchorId);
      if (target) {
        ax = target.x + (target.width || 0);
        ay = target.y;
      }
    } else if (c.anchor?.kind === 'image') {
      ax = c.anchor.rect.x + c.anchor.rect.w;
      ay = c.anchor.rect.y;
    }
    const x = Math.min(px(ax), W - 20);
    const y = Math.max(py(ay), 20);
    const rect = [x, y - 20, x + 20, y];
    const dict: Record<string, any> = {
      Type: 'Annot',
      Subtype: 'Text',
      Rect: rect,
      Contents: text(c.content || ''),
      T: text(c.author || 'AcrobatDesk'),
      M: PDFString.of(pdfDate(c.updatedAt || c.createdAt)),
      Name: 'Comment',
      C: [1, 0.82, 0.2],
      F: 24, // NoZoom | NoRotate
      Open: false
    };
    if (c.resolved) dict.AcroDeskResolved = true;
    const ref = ctx.register(ctx.obj(dict));
    page.node.addAnnot(ref);
    addReplies(ref, rect, c);
  }
}
