import { PDFArray, PDFDict, PDFDocument, PDFName, PDFPage, PDFRawStream, PDFRef, PDFStream, decodePDFRawStream } from 'pdf-lib';

/**
 * Removes specific images from a page's content for real (not just covered up): the page's
 * content streams are parsed, each image draw ("/Im0 Do" or an inline BI…EI image) is located
 * with its on-page box, and the matching draws are blanked out. Nested Form XObjects are
 * followed too. Bounding boxes are in PDF user space: [x0, y0, x1, y1].
 */

export type BBox = [number, number, number, number];
type Matrix = [number, number, number, number, number, number];

const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];

export const multiply = (m1: Matrix, m2: Matrix): Matrix => [
  m1[0] * m2[0] + m1[1] * m2[2],
  m1[0] * m2[1] + m1[1] * m2[3],
  m1[2] * m2[0] + m1[3] * m2[2],
  m1[2] * m2[1] + m1[3] * m2[3],
  m1[4] * m2[0] + m1[5] * m2[2] + m2[4],
  m1[4] * m2[1] + m1[5] * m2[3] + m2[5]
];

/** Box covered by the unit square (where images are drawn) under a transform. */
export function unitSquareBBox(m: Matrix): BBox {
  const pts = [
    [m[4], m[5]],
    [m[0] + m[4], m[1] + m[5]],
    [m[2] + m[4], m[3] + m[5]],
    [m[0] + m[2] + m[4], m[1] + m[3] + m[5]]
  ];
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}

export const bboxClose = (a: BBox, b: BBox, tol = 1.5) => a.every((v, i) => Math.abs(v - b[i]) <= tol);

interface Hit {
  start: number;
  end: number;
  bbox: BBox;
}

const WS = new Set([0, 9, 10, 12, 13, 32]);
const DELIM = new Set('()<>[]{}/%'.split('').map((c) => c.charCodeAt(0)));

/** Scan one decoded content stream, calling back for every image draw. */
function scan(
  src: string,
  state: { ctm: Matrix; stack: Matrix[] },
  onImage: (name: string | null, start: number, end: number, ctm: Matrix) => void
) {
  const n = src.length;
  let i = 0;
  type Operand = { kind: 'num' | 'name' | 'other'; value: string; start: number };
  let operands: Operand[] = [];

  const isWs = (c: number) => WS.has(c);
  const isRegular = (c: number) => !WS.has(c) && !DELIM.has(c);

  while (i < n) {
    const c = src.charCodeAt(i);
    if (isWs(c)) {
      i++;
      continue;
    }
    const start = i;
    const ch = src[i];
    if (ch === '%') {
      while (i < n && src[i] !== '\n' && src[i] !== '\r') i++;
      continue;
    }
    if (ch === '(') {
      let depth = 0;
      for (; i < n; i++) {
        const x = src[i];
        if (x === '\\') {
          i++;
          continue;
        }
        if (x === '(') depth++;
        else if (x === ')' && --depth === 0) {
          i++;
          break;
        }
      }
      operands.push({ kind: 'other', value: '', start });
      continue;
    }
    if (ch === '<' && src[i + 1] === '<') {
      // dictionary operand (e.g. for BDC): skip balanced << >>, minding strings
      let depth = 0;
      while (i < n) {
        if (src[i] === '<' && src[i + 1] === '<') {
          depth++;
          i += 2;
        } else if (src[i] === '>' && src[i + 1] === '>') {
          depth--;
          i += 2;
          if (depth === 0) break;
        } else if (src[i] === '(') {
          let d = 0;
          for (; i < n; i++) {
            if (src[i] === '\\') {
              i++;
              continue;
            }
            if (src[i] === '(') d++;
            else if (src[i] === ')' && --d === 0) {
              i++;
              break;
            }
          }
        } else i++;
      }
      operands.push({ kind: 'other', value: '', start });
      continue;
    }
    if (ch === '<') {
      const close = src.indexOf('>', i);
      i = close < 0 ? n : close + 1;
      operands.push({ kind: 'other', value: '', start });
      continue;
    }
    if (ch === '[' || ch === ']' || ch === '{' || ch === '}' || ch === '>' || ch === ')') {
      i++;
      operands.push({ kind: 'other', value: ch, start });
      continue;
    }
    if (ch === '/') {
      i++;
      while (i < n && isRegular(src.charCodeAt(i))) i++;
      operands.push({ kind: 'name', value: src.slice(start + 1, i), start });
      continue;
    }
    while (i < n && isRegular(src.charCodeAt(i))) i++;
    const tok = src.slice(start, i);
    if (/^[+-]?(\d+\.?\d*|\.\d+)$/.test(tok)) {
      operands.push({ kind: 'num', value: tok, start });
      continue;
    }

    // ---- operator ----
    switch (tok) {
      case 'q':
        state.stack.push(state.ctm);
        break;
      case 'Q':
        state.ctm = state.stack.pop() || state.ctm;
        break;
      case 'cm': {
        const nums = operands.slice(-6).map((o) => parseFloat(o.value));
        if (nums.length === 6 && nums.every((v) => !isNaN(v))) state.ctm = multiply(nums as Matrix, state.ctm);
        break;
      }
      case 'Do': {
        const nameOp = operands[operands.length - 1];
        if (nameOp && nameOp.kind === 'name') onImage(nameOp.value, nameOp.start, i, state.ctm);
        break;
      }
      case 'BI': {
        // Inline image: dictionary entries, then ID, raw bytes, EI
        const id = src.indexOf('ID', i);
        if (id < 0) {
          i = n;
          break;
        }
        let j = id + 3; // "ID" + one whitespace byte
        const re = /[\s\0]EI(?=[\s\0]|$)/g;
        re.lastIndex = j;
        const m = re.exec(src);
        j = m ? m.index + m[0].length : n;
        onImage(null, start, j, state.ctm);
        i = j;
        break;
      }
      default:
        break;
    }
    operands = [];
  }
}

const latin1 = (bytes: Uint8Array) => {
  let s = '';
  const CHUNK = 0x8000;
  for (let k = 0; k < bytes.length; k += CHUNK) s += String.fromCharCode(...bytes.subarray(k, k + CHUNK));
  return s;
};

const toBytes = (s: string) => {
  const out = new Uint8Array(s.length);
  for (let k = 0; k < s.length; k++) out[k] = s.charCodeAt(k) & 0xff;
  return out;
};

const decode = (stream: PDFStream): Uint8Array => {
  if (stream instanceof PDFRawStream) return decodePDFRawStream(stream).decode();
  return (stream as any).getUnencodedContents?.() ?? new Uint8Array();
};

/** Replace a stream object's contents, keeping its dictionary (needed for Form XObjects). */
function replaceStream(doc: PDFDocument, ref: PDFRef, original: PDFStream, bytes: Uint8Array) {
  const fresh = doc.context.flateStream(bytes);
  original.dict.entries().forEach(([key, value]) => {
    const k = key.asString();
    if (k !== '/Length' && k !== '/Filter' && k !== '/DecodeParms') fresh.dict.set(key, value);
  });
  doc.context.assign(ref, fresh);
}

/**
 * Remove image draws whose on-page box matches one of `targets`.
 * Returns how many draws were removed and which targets could not be found.
 */
export function removeImagesFromPage(doc: PDFDocument, page: PDFPage, targets: BBox[]): { removed: number; unmatched: BBox[] } {
  if (!targets.length) return { removed: 0, unmatched: [] };
  const lookup = doc.context;
  let removed = 0;
  const remaining = [...targets];

  const takeMatch = (bbox: BBox) => {
    const idx = remaining.findIndex((t) => bboxClose(t, bbox));
    if (idx < 0) return false;
    remaining.splice(idx, 1);
    return true;
  };

  // Walk a list of streams that share one graphics state (page contents, or a form's stream)
  const processStreams = (
    streams: Array<{ ref: PDFRef | null; stream: PDFStream; setDirect?: (s: PDFStream) => void }>,
    resources: PDFDict | undefined,
    state: { ctm: Matrix; stack: Matrix[] }
  ) => {
    const xobjects = resources?.lookupMaybe(PDFName.of('XObject'), PDFDict);
    for (const entry of streams) {
      let src = latin1(decode(entry.stream));
      const hits: Hit[] = [];
      scan(src, state, (name, start, end, ctm) => {
        if (name === null) {
          if (takeMatch(unitSquareBBox(ctm))) hits.push({ start, end, bbox: unitSquareBBox(ctm) });
          return;
        }
        const xref = xobjects?.get(PDFName.of(name));
        const xobj = xref instanceof PDFRef ? lookup.lookup(xref) : xref;
        if (!(xobj instanceof PDFStream)) return;
        const subtype = xobj.dict.get(PDFName.of('Subtype'));
        if (subtype === PDFName.of('Image')) {
          const bbox = unitSquareBBox(ctm);
          if (takeMatch(bbox)) hits.push({ start, end, bbox });
        } else if (subtype === PDFName.of('Form') && remaining.length && xref instanceof PDFRef) {
          // Follow into the form with its own matrix and resources
          const mArr = xobj.dict.lookupMaybe(PDFName.of('Matrix'), PDFArray);
          const fm = mArr ? (mArr.asArray().map((v: any) => v.asNumber?.() ?? 0) as Matrix) : IDENTITY;
          const formRes = xobj.dict.lookupMaybe(PDFName.of('Resources'), PDFDict) || resources;
          processStreams([{ ref: xref, stream: xobj }], formRes, { ctm: multiply(fm, ctm), stack: [] });
        }
      });
      if (hits.length) {
        // Blank the draw commands with spaces (same length keeps every other offset valid)
        for (const h of hits) src = src.slice(0, h.start) + ' '.repeat(h.end - h.start) + src.slice(h.end);
        const bytes = toBytes(src);
        if (entry.ref) replaceStream(doc, entry.ref, entry.stream, bytes);
        else entry.setDirect?.(doc.context.flateStream(bytes));
        removed += hits.length;
      }
      if (!remaining.length) return;
    }
  };

  const node = page.node;
  const contents = node.get(PDFName.of('Contents'));
  const streams: Array<{ ref: PDFRef | null; stream: PDFStream; setDirect?: (s: PDFStream) => void }> = [];
  const add = (obj: unknown) => {
    if (obj instanceof PDFRef) {
      const s = lookup.lookup(obj);
      if (s instanceof PDFStream) streams.push({ ref: obj, stream: s });
    } else if (obj instanceof PDFStream) {
      streams.push({ ref: null, stream: obj, setDirect: (s) => node.set(PDFName.of('Contents'), lookup.register(s)) });
    }
  };
  if (contents instanceof PDFArray) contents.asArray().forEach(add);
  else {
    const resolved = contents instanceof PDFRef ? lookup.lookup(contents) : contents;
    if (resolved instanceof PDFArray) resolved.asArray().forEach(add);
    else add(contents);
  }

  processStreams(streams, node.Resources(), { ctm: IDENTITY, stack: [] });
  return { removed, unmatched: remaining };
}

/** Every image XObject drawn on a page with its on-page box (inline images have no dictionary). */
export function listImageDraws(doc: PDFDocument, page: PDFPage): Array<{ bbox: BBox; image: PDFStream }> {
  const lookup = doc.context;
  const found: Array<{ bbox: BBox; image: PDFStream }> = [];
  const visit = (stream: PDFStream, resources: PDFDict | undefined, state: { ctm: Matrix; stack: Matrix[] }, depth: number) => {
    if (depth > 6) return;
    const xobjects = resources?.lookupMaybe(PDFName.of('XObject'), PDFDict);
    scan(latin1(decode(stream)), state, (name, _s, _e, ctm) => {
      if (name === null) return;
      const xref = xobjects?.get(PDFName.of(name));
      const xobj = xref instanceof PDFRef ? lookup.lookup(xref) : xref;
      if (!(xobj instanceof PDFStream)) return;
      const subtype = xobj.dict.get(PDFName.of('Subtype'));
      if (subtype === PDFName.of('Image')) found.push({ bbox: unitSquareBBox(ctm), image: xobj });
      else if (subtype === PDFName.of('Form')) {
        const mArr = xobj.dict.lookupMaybe(PDFName.of('Matrix'), PDFArray);
        const fm = mArr ? (mArr.asArray().map((v: any) => v.asNumber?.() ?? 0) as Matrix) : IDENTITY;
        const formRes = xobj.dict.lookupMaybe(PDFName.of('Resources'), PDFDict) || resources;
        visit(xobj, formRes, { ctm: multiply(fm, ctm), stack: [] }, depth + 1);
      }
    });
  };
  const contents = page.node.get(PDFName.of('Contents'));
  const resolved = contents instanceof PDFRef ? lookup.lookup(contents) : contents;
  const list = resolved instanceof PDFArray ? resolved.asArray() : [contents];
  const state = { ctm: IDENTITY, stack: [] as Matrix[] };
  for (const entry of list) {
    const s = entry instanceof PDFRef ? lookup.lookup(entry) : entry;
    if (s instanceof PDFStream) visit(s, page.node.Resources(), state, 0);
  }
  return found;
}

/** Key stored on image XObjects that are signatures, so they stay protected after saving. */
export const SIGNATURE_MARK = 'AcroDeskSignature';

let cachedDoc: { bytes: Uint8Array; doc: Promise<PDFDocument> } | null = null;

/** Boxes (PDF user space) of images on a page that are tagged as signatures inside the file. */
export async function findMarkedSignatures(bytes: Uint8Array, pageIndex: number): Promise<BBox[]> {
  if (!cachedDoc || cachedDoc.bytes !== bytes) {
    cachedDoc = { bytes, doc: PDFDocument.load(bytes, { ignoreEncryption: true }) };
  }
  try {
    const doc = await cachedDoc.doc;
    if (pageIndex >= doc.getPageCount()) return [];
    return listImageDraws(doc, doc.getPage(pageIndex))
      .filter((d) => d.image.dict.has(PDFName.of(SIGNATURE_MARK)))
      .map((d) => d.bbox);
  } catch {
    return [];
  }
}
