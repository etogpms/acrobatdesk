export type ToolMode = 
  | 'select' 
  | 'hand' 
  | 'edit_text'
  | 'edit_image'
  | 'highlight' 
  | 'underline' 
  | 'pen' 
  | 'text' 
  | 'signature' 
  | 'stamp' 
  | 'shape' 
  | 'redact' 
  | 'note' 
  | 'ocr' 
  | 'organize';

/** Default style for new "Add text" boxes. */
export interface TextToolStyle {
  fontChoice: 'auto' | import('../services/fontLibrary').FontFamilyId;
  bold: boolean;
  italic: boolean;
}

export type PageTool = 'organize' | 'split' | 'extract' | 'insert' | 'combine' | 'page_numbers';

/** A stretch of text with one style, so formatting can apply to just part of a block. */
export interface TextRun {
  text: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
}

export interface PdfTextBlock {
  id: string;
  pageIndex: number;
  originalText: string;
  currentText: string;
  isModified: boolean;
  xPct: number;
  yPct: number;
  widthPct: number;
  heightPct: number;
  fontSize: number; // in pt
  fontFamily?: string;
  isBold?: boolean;
  isItalic?: boolean;
  /** Weight / slant the PDF text had originally (the embedded font already carries it). */
  originalBold?: boolean;
  originalItalic?: boolean;
  /** Styled text; when absent the block is a single run of `currentText` in the block style. */
  runs?: TextRun[];
  /** Font name found in the PDF (e.g. "Calibri") and the bundled family that stands in for it. */
  detectedFont?: string;
  autoFamilyId?: import('../services/fontLibrary').FontFamilyId;
  /** 'auto' (default) keeps the detected font; otherwise one of the bundled families. */
  fontChoice?: 'auto' | import('../services/fontLibrary').FontFamilyId;
  /** Browser font-family name pdf.js registered for the embedded PDF font. */
  embeddedFamily?: string;
  /** Detected alignment within its table cell / column. */
  align?: 'left' | 'center' | 'right' | 'justify';
  /** Paragraph geometry (only for blocks spanning several lines). */
  lineCount?: number;
  /** Baseline-to-baseline distance in PDF points. */
  linePitch?: number;
  /** Left edge of the first line and of the following lines (for indents / hanging bullets). */
  firstLineXPct?: number;
  contLeftPct?: number;
  /** Alignment before the user changed it (restored by Revert). */
  originalAlign?: 'left' | 'center' | 'right' | 'justify';
  /** Extra left indent added by the user (page %). */
  indentPct?: number;
  /** Line spacing chosen by the user (multiple of single spacing); unset keeps the PDF's own. */
  lineSpacing?: number;
  color?: string;
  backgroundColor?: string;
  colorsSampled?: boolean;
}

/** An image found on a PDF page. bboxUser is in PDF user space [x0, y0, x1, y1]. */
export interface PdfImageItem {
  id: string;
  pageIndex: number;
  bboxUser: [number, number, number, number];
  xPct: number;
  yPct: number;
  widthPct: number;
  heightPct: number;
  pixelWidth: number;
  pixelHeight: number;
  /** Tagged as a signature inside the PDF (by AcrobatDesk when it was saved). */
  signatureMarked?: boolean;
  /** Looks like a handwritten signature (automatic detection). */
  signatureLikely?: boolean;
}

export interface SearchMatch {
  id: string;
  pageIndex: number; // 0-based
  text: string;
  xPct: number;
  yPct: number;
  widthPct: number;
  heightPct: number;
  snippet?: string;
  snippetMatchStart?: number;
  snippetMatchLength?: number;
}

export interface SearchOptions {
  matchCase: boolean;
  wholeWord: boolean;
}

export type ShapeType = 'rectangle' | 'circle' | 'line' | 'arrow';

export interface Point {
  x: number;
  y: number;
}

export interface DrawingPath {
  points: Point[];
  color: string;
  width: number;
  opacity: number;
}

export type CommentAnchor =
  | { kind: 'annotation'; id: string }
  | { kind: 'image'; bboxUser: [number, number, number, number]; rect: { x: number; y: number; w: number; h: number } }
  | { kind: 'point' };

export interface CommentReply {
  id: string;
  author: string;
  text: string;
  createdAt: number;
}

export interface AnnotationItem {
  id: string;
  pageIndex: number; // 0-based
  type: 'highlight' | 'underline' | 'pen' | 'text' | 'signature' | 'stamp' | 'shape' | 'redact' | 'note' | 'image' | 'image_removal' | 'image_flag';
  /** 'image' objects that came from a signature keep their protection. */
  isSignature?: boolean;
  /** For 'image_flag': the user's own call on whether an original PDF image is a signature. */
  flagBBox?: [number, number, number, number];
  flagSignature?: boolean;
  /** For 'image_removal': the original image's box in PDF user space, removed from the file on save. */
  removedImageBBox?: [number, number, number, number];
  /** Highlights over text: one rectangle per line (page %), and the highlighted words. */
  rects?: Array<{ x: number; y: number; w: number; h: number }>;
  quote?: string;
  /** Comments ('note'): what the comment is attached to, its replies and status. */
  anchor?: CommentAnchor;
  replies?: CommentReply[];
  resolved?: boolean;
  /** Opacity for highlights (0–1). */
  opacity?: number;
  x: number; // percentage (0 to 100) or pt relative to page width
  y: number; // percentage (0 to 100) or pt relative to page height
  width?: number;
  height?: number;
  color?: string;
  content?: string; // Text content or comment
  fontSize?: number;
  fontFamily?: string;
  isBold?: boolean;
  isItalic?: boolean;
  /** Added text: 'auto' (default) uses the font detected from nearby PDF text; otherwise a bundled family. */
  fontChoice?: 'auto' | import('../services/fontLibrary').FontFamilyId;
  /** Added text: bundled family / PDF font name found next to where the text was placed. */
  autoFamilyId?: import('../services/fontLibrary').FontFamilyId;
  detectedFont?: string;
  isUnderline?: boolean;
  /** Added text: paragraph alignment and line spacing (multiple of single spacing). */
  textAlign?: 'left' | 'center' | 'right' | 'justify';
  lineSpacing?: number;
  drawingPath?: DrawingPath;
  shapeType?: ShapeType;
  imageData?: string; // Base64 data URL for signature or stamp
  author?: string;
  createdAt: number;
  updatedAt?: number;
}

export interface OcrWord {
  text: string;
  confidence: number;
  bbox: {
    x0: number;
    y0: number;
    x1: number;
    y1: number;
  };
}

export interface OcrLine {
  text: string;
  confidence: number;
  words: OcrWord[];
}

export interface OcrPageResult {
  pageIndex: number;
  text: string;
  confidence: number;
  lines: OcrLine[];
  timestamp: number;
}

export interface SavedSignature {
  id: string;
  name: string;
  type: 'drawn' | 'typed' | 'uploaded';
  dataUrl: string;
  createdAt: number;
}

export interface DocumentMetadata {
  title: string;
  author?: string;
  pageCount: number;
  fileSizeBytes: number;
  lastModified: number;
  fileName: string;
  isLocalDesktopFile: boolean;
  fileHandle?: FileSystemFileHandle | null;
}

export interface PageInfo {
  pageIndex: number;
  rotation: number; // 0, 90, 180, 270
  width: number;
  height: number;
  thumbnailUrl?: string;
}

export interface RecentFileRecord {
  id: string;
  fileName: string;
  pageCount: number;
  fileSizeBytes: number;
  lastOpened: number;
  thumbnailDataUrl?: string;
}
