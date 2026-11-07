/**
 * Bundled, freely licensed fonts (see public/fonts/LICENSE-*). Each is metric-compatible with a
 * common Office font, so edited text keeps the same widths and line breaks as the original, and
 * the very same files are used on screen and when saving the PDF.
 */

export type FontFamilyId = 'carlito' | 'caladea' | 'liberation-sans' | 'liberation-serif' | 'liberation-mono';

export interface FontFamilyDef {
  id: FontFamilyId;
  /** Name shown in the font menu */
  label: string;
  /** Office font it stands in for */
  matches: string;
  cssName: string;
  generic: 'sans-serif' | 'serif' | 'monospace';
  files: { regular: string; bold: string; italic: string; boldItalic: string };
}

const file = (base: string) => ({
  regular: `${base}-Regular.ttf`,
  bold: `${base}-Bold.ttf`,
  italic: `${base}-Italic.ttf`,
  boldItalic: `${base}-BoldItalic.ttf`
});

export const FONT_FAMILIES: FontFamilyDef[] = [
  { id: 'carlito', label: 'Calibri', matches: 'Carlito', cssName: 'AD Carlito', generic: 'sans-serif', files: file('Carlito') },
  { id: 'liberation-sans', label: 'Arial / Helvetica', matches: 'Liberation Sans', cssName: 'AD Liberation Sans', generic: 'sans-serif', files: file('LiberationSans') },
  { id: 'liberation-serif', label: 'Times New Roman', matches: 'Liberation Serif', cssName: 'AD Liberation Serif', generic: 'serif', files: file('LiberationSerif') },
  { id: 'caladea', label: 'Cambria', matches: 'Caladea', cssName: 'AD Caladea', generic: 'serif', files: file('Caladea') },
  { id: 'liberation-mono', label: 'Courier New', matches: 'Liberation Mono', cssName: 'AD Liberation Mono', generic: 'monospace', files: file('LiberationMono') }
];

export const getFamily = (id: FontFamilyId): FontFamilyDef => FONT_FAMILIES.find((f) => f.id === id) || FONT_FAMILIES[1];

/** Pick the bundled family that best stands in for a font name found in the PDF. */
export function detectFamilyId(fontName: string, generic: string): FontFamilyId {
  const n = fontName.toLowerCase();
  if (/calibri|carlito/.test(n)) return 'carlito';
  if (/cambria|caladea/.test(n)) return 'caladea';
  if (/courier|mono|consolas|menlo/.test(n) || generic === 'monospace') return 'liberation-mono';
  if (/times|georgia|garamond|book ?antiqua|palatino|minion|serif/.test(n.replace(/sans/g, '')) || generic === 'serif') {
    return 'liberation-serif';
  }
  return 'liberation-sans';
}

/** Bundled family used for an added-text annotation (older ones only stored a font name). */
export function annotationFamilyId(ann: {
  fontChoice?: 'auto' | FontFamilyId;
  autoFamilyId?: FontFamilyId;
  fontFamily?: string;
}): FontFamilyId {
  if (ann.fontChoice && ann.fontChoice !== 'auto') return ann.fontChoice;
  if (ann.autoFamilyId) return ann.autoFamilyId;
  return detectFamilyId(ann.fontFamily || '', '');
}

/** CSS font stack for a family; `preferred` (e.g. the real "Calibri") is tried first when installed. */
export function cssStack(id: FontFamilyId, preferred?: string): string {
  const f = getFamily(id);
  const first = preferred && !/^g_d\d/.test(preferred) ? `"${preferred}", ` : '';
  return `${first}"${f.cssName}", ${f.generic}`;
}

/** Register @font-face rules once; browsers only download a file when text actually uses it. */
let registered = false;
export function registerFontFaces() {
  if (registered || typeof document === 'undefined') return;
  registered = true;
  const rules = FONT_FAMILIES.flatMap((f) => [
    face(f.cssName, f.files.regular, 400, 'normal'),
    face(f.cssName, f.files.bold, 700, 'normal'),
    face(f.cssName, f.files.italic, 400, 'italic'),
    face(f.cssName, f.files.boldItalic, 700, 'italic')
  ]).join('\n');
  const style = document.createElement('style');
  style.setAttribute('data-acrobatdesk-fonts', '');
  style.textContent = rules;
  document.head.appendChild(style);
}

function face(name: string, fileName: string, weight: number, style: string) {
  return `@font-face{font-family:"${name}";src:url("${fontUrl(fileName)}") format("truetype");font-weight:${weight};font-style:${style};font-display:swap;}`;
}

function fontUrl(fileName: string) {
  const base = (import.meta as any).env?.BASE_URL || '/';
  return `${base.replace(/\/$/, '')}/fonts/${fileName}`;
}

/** Make sure a family's faces are loaded before measuring text with them. */
export async function preloadFamily(id: FontFamilyId): Promise<void> {
  registerFontFaces();
  const f = getFamily(id);
  try {
    await Promise.all([
      document.fonts.load(`400 16px "${f.cssName}"`),
      document.fonts.load(`700 16px "${f.cssName}"`),
      document.fonts.load(`italic 400 16px "${f.cssName}"`),
      document.fonts.load(`italic 700 16px "${f.cssName}"`)
    ]);
  } catch {
    /* fall back to system fonts */
  }
}

const bytesCache = new Map<string, Promise<Uint8Array>>();

/** Raw TTF bytes for embedding into a saved PDF. */
export function loadFontBytes(id: FontFamilyId, bold: boolean, italic: boolean): Promise<Uint8Array> {
  const f = getFamily(id);
  const fileName = bold && italic ? f.files.boldItalic : bold ? f.files.bold : italic ? f.files.italic : f.files.regular;
  let p = bytesCache.get(fileName);
  if (!p) {
    p = fetch(fontUrl(fileName)).then(async (r) => {
      if (!r.ok) throw new Error(`Font file ${fileName} could not be loaded (${r.status})`);
      return new Uint8Array(await r.arrayBuffer());
    });
    bytesCache.set(fileName, p);
    p.catch(() => bytesCache.delete(fileName));
  }
  return p;
}
