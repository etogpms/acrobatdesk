import React, { useRef, useEffect, useState, useCallback } from 'react';
import { Trash2, GripHorizontal, Check, Edit3, MessageSquare, MessageSquarePlus, Highlighter, RotateCcw, Copy as CopyIcon, Replace, Image as ImageIcon, ShieldCheck, PenLine } from 'lucide-react';
import {
  ToolMode,
  AnnotationItem,
  Point,
  DrawingPath,
  ShapeType,
  SearchMatch,
  PdfTextBlock,
  TextRun,
  PdfImageItem,
  TextToolStyle
} from '../types/pdf';
import { bboxClose } from '../services/contentStreamEditor';
import { CommentThread } from './CommentThread';
import { makeRedactedSignature } from '../services/signatureProtection';
import { PdfRendererService } from '../services/pdfRenderer';
import { RichTextEditor, RichTextEditorApi, RunAttr, runsText } from './RichTextEditor';
import { ParagraphControls } from './ParagraphControls';
import { ListKind, Sel, applyList, changeListLevel, listAt, pitchFor, runsToText, shiftLines, textToRuns } from '../services/textFormatting';
import { FONT_FAMILIES, FontFamilyId, annotationFamilyId, cssStack, getFamily, preloadFamily, registerFontFaces } from '../services/fontLibrary';

interface PdfCanvasProps {
  renderer: PdfRendererService;
  documentBytes?: Uint8Array | null;
  currentPage: number;
  scale: number;
  rotation: number;
  toolMode: ToolMode;
  activeColor: string;
  strokeWidth: number;
  fontSize: number;
  textStyle?: TextToolStyle;
  shapeType: ShapeType;
  annotations: AnnotationItem[];
  selectedAnnotationId: string | null;
  onSelectAnnotation: (id: string | null) => void;
  onAddAnnotation: (ann: AnnotationItem) => void;
  onUpdateAnnotation: (ann: AnnotationItem) => void;
  onDeleteAnnotation: (id: string) => void;
  activeSignatureDataUrl: string | null;
  onOpenSignatureModal: () => void;
  searchMatches?: SearchMatch[];
  currentSearchMatchIndex?: number;
  textBlocks?: PdfTextBlock[];
  onUpdateTextBlock?: (block: PdfTextBlock) => void;
  images?: PdfImageItem[];
  onAddAnnotations?: (list: AnnotationItem[]) => void;
  insertImageToken?: number;
  onNotify?: (msg: string) => void;
  activeCommentId?: string | null;
  onActiveCommentChange?: (id: string | null) => void;
  authorName?: string;
  protectSignatures?: boolean;
}

export const PdfCanvas: React.FC<PdfCanvasProps> = ({
  renderer,
  documentBytes,
  currentPage,
  scale,
  rotation,
  toolMode,
  activeColor,
  strokeWidth,
  fontSize,
  textStyle = { fontChoice: 'auto', bold: false, italic: false },
  shapeType,
  annotations,
  selectedAnnotationId,
  onSelectAnnotation,
  onAddAnnotation,
  onUpdateAnnotation,
  onDeleteAnnotation,
  activeSignatureDataUrl,
  onOpenSignatureModal,
  searchMatches = [],
  currentSearchMatchIndex = -1,
  textBlocks = [],
  onUpdateTextBlock,
  images = [],
  onAddAnnotations,
  insertImageToken = 0,
  onNotify,
  activeCommentId = null,
  onActiveCommentChange,
  authorName = 'Me',
  protectSignatures = true
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const overlayRef = useRef<HTMLDivElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasReadyRef = useRef(false);

  const [pageSize, setPageSize] = useState<{ width: number; height: number }>({ width: 595, height: 842 });
  const [isDrawing, setIsDrawing] = useState(false);
  const [currentPath, setCurrentPath] = useState<Point[]>([]);
  const [dragStart, setDragStart] = useState<{ x: number; y: number } | null>(null);
  const [dragCurrent, setDragCurrent] = useState<{ x: number; y: number } | null>(null);

  // PDF Text Block Editing state
  const [activeEditingBlockId, setActiveEditingBlockId] = useState<string | null>(null);
  const editorApiRef = useRef<RichTextEditorApi | null>(null);
  const [activeAttrs, setActiveAttrs] = useState<Record<RunAttr, boolean>>({ bold: false, italic: false, underline: false });
  const [fontMenuOpen, setFontMenuOpen] = useState(false);
  const [annFontMenuOpen, setAnnFontMenuOpen] = useState(false);
  const [fontsVersion, setFontsVersion] = useState(0);
  const [caretList, setCaretList] = useState<'bullet' | 'number' | null>(null);
  const refreshActiveAttrs = useCallback(() => {
    const a = editorApiRef.current?.activeAttrs();
    if (a) setActiveAttrs((prev) => (prev.bold === a.bold && prev.italic === a.italic && prev.underline === a.underline ? prev : a));
    const snap = editorApiRef.current?.snapshot();
    if (snap) setCaretList(listAt(snap.text, snap.sel));
  }, []);
  useEffect(() => {
    setFontMenuOpen(false);
  }, [activeEditingBlockId]);
  useEffect(() => {
    registerFontFaces();
    // Re-measure once web fonts (bundled or embedded) finish loading
    const onDone = () => setFontsVersion((v) => v + 1);
    document.fonts?.addEventListener?.('loadingdone', onDone);
    return () => document.fonts?.removeEventListener?.('loadingdone', onDone);
  }, []);

  // Moving existing element
  const [draggingElementId, setDraggingElementId] = useState<string | null>(null);
  const [elementDragOffset, setElementDragOffset] = useState<{ x: number; y: number }>({ x: 0, y: 0 });

  // Live position/size while dragging or resizing; committed once (one undo step) on release
  const [livePatch, setLivePatch] = useState<{ id: string; x?: number; y?: number; width?: number; height?: number } | null>(null);

  // Resizing existing element
  const [resizingElementId, setResizingElementId] = useState<string | null>(null);
  const [resizeStart, setResizeStart] = useState<{ x: number; y: number; w: number; h: number } | null>(null);

  // In-place text editing
  const [editingTextId, setEditingTextId] = useState<string | null>(null);
  const [editingTextValue, setEditingTextValue] = useState<string>('');
  const textAreaRef = useRef<HTMLTextAreaElement | null>(null);
  const [, setTaSelTick] = useState(0);
  useEffect(() => {
    setAnnFontMenuOpen(false);
  }, [selectedAnnotationId, editingTextId]);

  // Image editing
  const [selectedImageId, setSelectedImageId] = useState<string | null>(null);
  const imageClipboardRef = useRef<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const replaceTargetRef = useRef<{ kind: 'existing'; img: PdfImageItem } | { kind: 'annotation'; id: string } | null>(null);
  const pendingLiftRef = useRef<{ img: PdfImageItem; mode: 'move' | 'resize'; x: number; y: number } | null>(null);
  const liftingRef = useRef(false);
  const pasteCountRef = useRef(0);

  // Sticky note popover
  // The open comment thread lives in App so the Comments panel and the page stay in sync
  const activeNoteId = activeCommentId;
  const setActiveNoteId = (id: string | null) => onActiveCommentChange?.(id);

  // Words on the page (for highlights that snap to text) and comment UI state
  const [pageWords, setPageWords] = useState<Array<{ text: string; x: number; y: number; w: number; h: number; line: number }>>([]);
  const [textSel, setTextSel] = useState<{ a: number; b: number; mode: 'highlight' | 'note' } | null>(null);
  const [hlPrompt, setHlPrompt] = useState<{ id: string; x: number; y: number } | null>(null);
  const [ctxMenu, setCtxMenu] = useState<
    | null
    | {
        clientX: number;
        clientY: number;
        xPct: number;
        yPct: number;
        target: { kind: 'ann'; ann: AnnotationItem } | { kind: 'image'; img: PdfImageItem } | { kind: 'word'; idx: number } | { kind: 'point' };
      }
  >(null);
  const pendingHighlightRef = useRef<string | null>(null);
  const noteDownRef = useRef<{ x: number; y: number } | null>(null);

  // Render PDF Page to Canvas
  useEffect(() => {
    let isCancelled = false;
    const render = async () => {
      if (!canvasRef.current || renderer.getNumPages() === 0) return;
      canvasReadyRef.current = false;
      try {
        const size = await renderer.renderPageToCanvas(
          currentPage,
          canvasRef.current,
          scale,
          rotation
        );
        if (!isCancelled) {
          setPageSize(size);
          canvasReadyRef.current = true;
        }
      } catch (err) {
        console.warn('Canvas render interrupted:', err);
      }
    };
    render();
    return () => {
      isCancelled = true;
    };
  }, [renderer, documentBytes, currentPage, scale, rotation]);

  // Helper: Get percentage coordinate relative to overlay
  const getRelativeCoords = (e: React.MouseEvent<HTMLDivElement>): { xPct: number; yPct: number; pxX: number; pxY: number } => {
    if (!overlayRef.current) return { xPct: 0, yPct: 0, pxX: 0, pxY: 0 };
    const rect = overlayRef.current.getBoundingClientRect();
    const pxX = e.clientX - rect.left;
    const pxY = e.clientY - rect.top;
    const xPct = Math.min(Math.max((pxX / rect.width) * 100, 0), 100);
    const yPct = Math.min(Math.max((pxY / rect.height) * 100, 0), 100);
    return { xPct, yPct, pxX, pxY };
  };

  // Mouse Down
  const handleMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.button !== 0) return; // Left click only
    const { xPct, yPct, pxX, pxY } = getRelativeCoords(e);
    // Pressing anywhere on the page closes the open comment thread (the thread itself stops propagation)
    if (activeNoteId) setActiveNoteId(null);
    setHlPrompt(null);

    if (toolMode === 'pen') {
      setIsDrawing(true);
      setCurrentPath([{ x: xPct, y: yPct }]);
    } else if ((toolMode === 'highlight' || toolMode === 'note') && wordAt(xPct, yPct) >= 0) {
      // Starting on a word: select text word by word
      const idx = wordAt(xPct, yPct);
      setHlPrompt(null);
      setTextSel({ a: idx, b: idx, mode: toolMode });
    } else if (toolMode === 'highlight' || toolMode === 'redact' || toolMode === 'shape') {
      setHlPrompt(null);
      setIsDrawing(true);
      setDragStart({ x: xPct, y: yPct });
      setDragCurrent({ x: xPct, y: yPct });
    } else if (toolMode === 'text') {
      // Create new text box at this position, in the chosen font (Auto = match the nearest PDF text)
      const near = detectFontNear(xPct, yPct);
      const newAnn: AnnotationItem = {
        id: `text-${Date.now()}`,
        pageIndex: currentPage - 1,
        type: 'text',
        x: xPct,
        y: yPct,
        width: 30,
        height: 6,
        content: 'Type text here...',
        fontSize,
        fontChoice: textStyle.fontChoice,
        autoFamilyId: near?.autoFamilyId,
        detectedFont: near?.detectedFont,
        color: activeColor,
        isBold: textStyle.bold,
        isItalic: textStyle.italic,
        createdAt: Date.now()
      };
      preloadFamily(annotationFamilyId(newAnn)).then(() => setFontsVersion((v) => v + 1));
      onAddAnnotation(newAnn);
      onSelectAnnotation(newAnn.id);
      setEditingTextId(newAnn.id);
      setEditingTextValue('Type text here...');
    } else if (toolMode === 'note') {
      // Not on text: a click pins a comment to this spot (on mouse up)
      noteDownRef.current = { x: xPct, y: yPct };
    } else if (toolMode === 'signature') {
      if (activeSignatureDataUrl) {
        // Place active signature
        const newAnn: AnnotationItem = {
          id: `sig-${Date.now()}`,
          pageIndex: currentPage - 1,
          type: 'signature',
          x: xPct,
          y: yPct,
          width: 25,
          height: 10,
          imageData: activeSignatureDataUrl,
          createdAt: Date.now()
        };
        onAddAnnotation(newAnn);
        onSelectAnnotation(newAnn.id);
      } else {
        onOpenSignatureModal();
      }
    } else if (toolMode === 'select' || toolMode === 'edit_image') {
      // Clicking background deselects
      if (e.target === overlayRef.current) {
        setSelectedImageId(null);
        onSelectAnnotation(null);
        setEditingTextId(null);
        setActiveNoteId(null);
      }
    }
  };

  // Mouse Move
  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const { xPct, yPct } = getRelativeCoords(e);

    // Dragging an original PDF image: turn it into a movable image object on first real move
    const pending = pendingLiftRef.current;
    if (pending && !liftingRef.current && Math.hypot(xPct - pending.x, yPct - pending.y) > 0.4) {
      pendingLiftRef.current = null;
      liftingRef.current = true;
      liftExistingImage(pending.img).then((ann) => {
        liftingRef.current = false;
        if (!ann) return;
        if (pending.mode === 'move') {
          setDraggingElementId(ann.id);
          setElementDragOffset({ x: pending.x - ann.x, y: pending.y - ann.y });
        } else {
          setResizingElementId(ann.id);
          setResizeStart({ x: pending.x, y: pending.y, w: ann.width || 10, h: ann.height || 10 });
        }
      });
      return;
    }

    if (isDrawing) {
      if (toolMode === 'pen') {
        setCurrentPath(prev => [...prev, { x: xPct, y: yPct }]);
      } else if (toolMode === 'highlight' || toolMode === 'redact' || toolMode === 'shape') {
        setDragCurrent({ x: xPct, y: yPct });
      }
    }
  };

  // Dragging / resizing follow the mouse across the whole window (not just the page), and the
  // release is caught even outside the page so an object never stays stuck to the cursor.
  useEffect(() => {
    if (!draggingElementId && !resizingElementId) return;
    const id = draggingElementId || resizingElementId;
    const element = annotations.find((a) => a.id === id);
    if (!element) return;

    const toPct = (ev: MouseEvent) => {
      const rect = overlayRef.current?.getBoundingClientRect();
      if (!rect) return { xPct: 0, yPct: 0 };
      return { xPct: ((ev.clientX - rect.left) / rect.width) * 100, yPct: ((ev.clientY - rect.top) / rect.height) * 100 };
    };
    let latest: { x?: number; y?: number; width?: number; height?: number } | null = null;

    const onMove = (ev: MouseEvent) => {
      const { xPct, yPct } = toPct(ev);
      if (draggingElementId) {
        const w = element.width || 5;
        const h = element.height || 5;
        latest = {
          x: Math.min(Math.max(xPct - elementDragOffset.x, 0), 100 - w),
          y: Math.min(Math.max(yPct - elementDragOffset.y, 0), 100 - h)
        };
      } else if (resizeStart) {
        const isImage = element.type === 'image' || element.type === 'signature' || element.type === 'stamp';
        const minW = isImage ? 1 : 5;
        const width = Math.max(minW, Math.min(100 - element.x, resizeStart.w + (xPct - resizeStart.x)));
        // Pictures (images, signatures, stamps) keep their proportions unless Shift is held
        const height =
          isImage && !ev.shiftKey
            ? Math.max(0.5, Math.min(100 - element.y, width * (resizeStart.h / resizeStart.w)))
            : Math.max(isImage ? 0.5 : 3, Math.min(100 - element.y, resizeStart.h + (yPct - resizeStart.y)));
        latest = { width, height };
      }
      if (latest) setLivePatch({ id: element.id, ...latest });
    };

    const onUp = () => {
      if (latest) onUpdateAnnotation({ ...element, ...latest, updatedAt: Date.now() });
      setLivePatch(null);
      setDraggingElementId(null);
      setResizingElementId(null);
      setResizeStart(null);
    };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    // annotations intentionally read once per drag; the patch is applied on release
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draggingElementId, resizingElementId, annotations.some((a) => a.id === (draggingElementId || resizingElementId))]);

  // Mouse Up
  const handleMouseUp = (e?: React.MouseEvent<HTMLDivElement>) => {
    pendingLiftRef.current = null;

    if (toolMode === 'note' && noteDownRef.current && e) {
      const { xPct, yPct } = getRelativeCoords(e);
      const start = noteDownRef.current;
      noteDownRef.current = null;
      if (Math.hypot(xPct - start.x, yPct - start.y) < 1) {
        const c = newComment({ kind: 'point' }, start.x, start.y);
        addAnnotations([c]);
        setActiveNoteId(c.id);
      }
      return;
    }

    if (isDrawing) {
      if (toolMode === 'pen' && currentPath.length > 1) {
        const newAnn: AnnotationItem = {
          id: `pen-${Date.now()}`,
          pageIndex: currentPage - 1,
          type: 'pen',
          x: 0,
          y: 0,
          drawingPath: {
            points: currentPath,
            color: activeColor,
            width: strokeWidth,
            opacity: 1
          },
          createdAt: Date.now()
        };
        onAddAnnotation(newAnn);
      } else if ((toolMode === 'highlight' || toolMode === 'redact' || toolMode === 'shape') && dragStart && dragCurrent) {
        const left = Math.min(dragStart.x, dragCurrent.x);
        const top = Math.min(dragStart.y, dragCurrent.y);
        const width = Math.abs(dragCurrent.x - dragStart.x);
        const height = Math.abs(dragCurrent.y - dragStart.y);

        if (width > 1 && height > 0.5) {
          const newAnn: AnnotationItem = {
            id: `${toolMode}-${Date.now()}`,
            pageIndex: currentPage - 1,
            type: toolMode,
            x: left,
            y: top,
            width,
            height,
            color: toolMode === 'highlight' ? activeColor : toolMode === 'redact' ? '#000000' : activeColor,
            shapeType: toolMode === 'shape' ? shapeType : undefined,
            createdAt: Date.now()
          };
          onAddAnnotation(newAnn);
          onSelectAnnotation(newAnn.id);
        }
      }

      setIsDrawing(false);
      setCurrentPath([]);
      setDragStart(null);
      setDragCurrent(null);
    }

  };

  // Start moving element
  const handleElementMouseDown = (e: React.MouseEvent, ann: AnnotationItem) => {
    e.stopPropagation();
    onSelectAnnotation(ann.id);
    const target = e.target as HTMLElement;
    const typing = editingTextId === ann.id || target.tagName === 'TEXTAREA' || target.tagName === 'INPUT' || target.isContentEditable;

    // Placed objects (signatures, stamps, images, shapes, text boxes…) can be dragged whatever tool
    // is active, e.g. right after placing a signature while still in Signature mode.
    const isTextHighlight = ann.type === 'highlight' && !!ann.rects?.length;
    if (ann.type === 'highlight' && e.button === 0) {
      const thread = annotations.find((n) => n.type === 'note' && n.anchor?.kind === 'annotation' && n.anchor.id === ann.id);
      if (thread) setActiveNoteId(thread.id);
    }
    if (e.button === 0 && !typing && toolMode !== 'edit_text' && !isTextHighlight) {
      e.preventDefault(); // no native image drag / text selection
      setSelectedImageId(null);
      const { xPct, yPct } = getRelativeCoords(e as any);
      setDraggingElementId(ann.id);
      setElementDragOffset({
        x: xPct - ann.x,
        y: yPct - ann.y
      });
    }
  };

  // Start resizing element
  const handleResizeMouseDown = (e: React.MouseEvent, ann: AnnotationItem) => {
    e.stopPropagation();
    e.preventDefault();
    onSelectAnnotation(ann.id);
    const { xPct, yPct } = getRelativeCoords(e as any);
    setResizingElementId(ann.id);
    setResizeStart({
      x: xPct,
      y: yPct,
      w: ann.width || 20,
      h: ann.height || 10
    });
  };

  /** Font of the PDF text closest to a point on the current page (for "Auto detect"). */
  const detectFontNear = (xPct: number, yPct: number): { autoFamilyId: FontFamilyId; detectedFont?: string } | null => {
    let best: PdfTextBlock | null = null;
    let bestD = Infinity;
    for (const b of textBlocks) {
      if (b.pageIndex !== currentPage - 1 || !b.autoFamilyId || !b.originalText.trim()) continue;
      const dxPct = xPct < b.xPct ? b.xPct - xPct : xPct > b.xPct + b.widthPct ? xPct - (b.xPct + b.widthPct) : 0;
      const dyPct = yPct < b.yPct ? b.yPct - yPct : yPct > b.yPct + b.heightPct ? yPct - (b.yPct + b.heightPct) : 0;
      // Compare in page points; text on the same line counts as closer than text above/below
      const dx = (dxPct / 100) * pageSize.width;
      const dy = (dyPct / 100) * pageSize.height * 1.5;
      const d = dx * dx + dy * dy;
      if (d < bestD) {
        bestD = d;
        best = b;
      }
    }
    return best ? { autoFamilyId: best.autoFamilyId!, detectedFont: best.detectedFont } : null;
  };

  /** Typography of an added text box (line height 1.25 × size at single spacing, as when saved). */
  const annTextStyle = (ann: AnnotationItem): React.CSSProperties => {
    const auto = !ann.fontChoice || ann.fontChoice === 'auto';
    return {
      fontFamily: cssStack(annotationFamilyId(ann), auto ? ann.detectedFont : undefined),
      fontWeight: ann.isBold ? 700 : 400,
      fontStyle: ann.isItalic ? 'italic' : 'normal',
      textDecoration: ann.isUnderline ? 'underline' : undefined,
      textAlign: ann.textAlign || 'left',
      lineHeight: 1.25 * (ann.lineSpacing || 1)
    };
  };

  // Save text edit
  const handleTextSave = (id: string) => {
    const element = annotations.find(a => a.id === id);
    if (element) {
      onUpdateAnnotation({
        ...element,
        content: editingTextValue,
        updatedAt: Date.now()
      });
    }
    setEditingTextId(null);
  };

  // Sample the rendered page under a text block to find its background and ink colors,
  // so the editor and the saved replacement blend into the page.
  const sampleBlockColors = (b: PdfTextBlock): { color: string; backgroundColor: string; align: PdfTextBlock['align'] } | null => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx || !canvasReadyRef.current) return null;
    const x = Math.floor((b.xPct / 100) * canvas.width);
    const y = Math.floor((b.yPct / 100) * canvas.height);
    const w = Math.max(1, Math.min(canvas.width - x, Math.ceil((b.widthPct / 100) * canvas.width)));
    const h = Math.max(1, Math.min(canvas.height - y, Math.ceil((b.heightPct / 100) * canvas.height)));
    let data: Uint8ClampedArray;
    try {
      data = ctx.getImageData(x, y, w, h).data;
    } catch {
      return null;
    }
    const buckets = new Map<number, { count: number; r: number; g: number; b: number }>();
    for (let i = 0; i < data.length; i += 4) {
      const key = ((data[i] >> 3) << 10) | ((data[i + 1] >> 3) << 5) | (data[i + 2] >> 3);
      const bucket = buckets.get(key);
      if (bucket) {
        bucket.count++;
        bucket.r += data[i];
        bucket.g += data[i + 1];
        bucket.b += data[i + 2];
      } else {
        buckets.set(key, { count: 1, r: data[i], g: data[i + 1], b: data[i + 2] });
      }
    }
    const avg = (k: { count: number; r: number; g: number; b: number }) => [k.r / k.count, k.g / k.count, k.b / k.count];
    const sorted = [...buckets.values()].sort((a, c) => c.count - a.count);
    if (sorted.length === 0) return null;
    const bg = avg(sorted[0]);
    const dist = (p: number[]) => Math.hypot(p[0] - bg[0], p[1] - bg[1], p[2] - bg[2]);
    // Ink = the most frequent color clearly different from the background
    const ink = sorted.map(avg).find((p) => dist(p) > 120) ||
      sorted.map(avg).sort((p, q) => dist(q) - dist(p))[0];
    const hex = (p: number[]) => '#' + p.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');
    return { color: hex(ink), backgroundColor: hex(bg), align: detectAlignment(ctx, canvas, x, y, w, h, bg) };
  };

  // Look left and right of the text for the cell's vertical borders. Equal space on both sides
  // means the text is centered in its cell; text hugging the right border is right-aligned.
  const detectAlignment = (
    ctx: CanvasRenderingContext2D,
    canvas: HTMLCanvasElement,
    x: number,
    y: number,
    w: number,
    h: number,
    bg: number[]
  ): 'left' | 'center' | 'right' => {
    const maxScan = Math.floor(canvas.width * 0.4);
    const rows = [y + Math.floor(h * 0.2), y + Math.floor(h * 0.5), y + Math.floor(h * 0.8)];
    let strip: Uint8ClampedArray[];
    const sx = Math.max(0, x - maxScan);
    const sw = Math.min(canvas.width, x + w + maxScan) - sx;
    try {
      strip = rows.map((ry) => ctx.getImageData(sx, Math.min(Math.max(ry, 0), canvas.height - 1), sw, 1).data);
    } catch {
      return 'left';
    }
    // A border pixel is clearly darker/different than the background on all three sample rows
    const isLine = (px: number) =>
      strip.every((row) => {
        const i = (px - sx) * 4;
        return Math.hypot(row[i] - bg[0], row[i + 1] - bg[1], row[i + 2] - bg[2]) > 90;
      });
    let left = -1;
    for (let px = x - 1; px >= sx; px--) if (isLine(px)) { left = x - px; break; }
    let right = -1;
    for (let px = x + w; px < sx + sw; px++) if (isLine(px)) { right = px - (x + w); break; }
    if (left < 0 || right < 0) return 'left';
    const tol = Math.max(4, (left + right) * 0.2);
    if (Math.abs(left - right) <= tol) return 'center';
    return right < left ? 'right' : 'left';
  };

  const startEditingBlock = (b: PdfTextBlock) => {
    if (!b.colorsSampled) {
      const colors = sampleBlockColors(b);
      if (colors && b.align) colors.align = b.align;
      if (colors && onUpdateTextBlock) {
        onUpdateTextBlock({ ...b, ...colors, colorsSampled: true });
      }
    }
    preloadFamily(effectiveFamily(b)).then(() => setFontsVersion((v) => v + 1));
    setActiveEditingBlockId(b.id);
  };

  // ---------- fonts & runs ----------

  const effectiveFamily = (b: PdfTextBlock): FontFamilyId =>
    b.fontChoice && b.fontChoice !== 'auto' ? b.fontChoice : b.autoFamilyId || 'liberation-sans';

  const blockRuns = (b: PdfTextBlock): TextRun[] =>
    b.runs && b.runs.length ? b.runs : [{ text: b.currentText, bold: !!b.isBold, italic: !!b.isItalic }];

  /** Typography for one run. Unchanged runs in Auto mode use the PDF's own embedded font. */
  const runStyle = (b: PdfTextBlock, run: TextRun): React.CSSProperties => {
    const auto = !b.fontChoice || b.fontChoice === 'auto';
    const fam = effectiveFamily(b);
    const useEmbedded =
      auto && Boolean(b.embeddedFamily) && !!run.bold === !!b.originalBold && !!run.italic === !!b.originalItalic;
    const preferred = auto ? b.detectedFont : undefined;
    return {
      fontFamily: useEmbedded ? `"${b.embeddedFamily}", ${cssStack(fam, preferred)}` : cssStack(fam, preferred),
      fontWeight: run.bold ? 700 : 400,
      fontStyle: run.italic ? 'italic' : 'normal',
      // The embedded face already carries its weight/slant; don't let the browser fake it again
      fontSynthesis: useEmbedded ? 'none' : undefined,
      textDecoration: run.underline ? 'underline' : undefined
    } as React.CSSProperties;
  };

  const handleCommitRuns = (b: PdfTextBlock, runs: TextRun[]) => {
    if (!onUpdateTextBlock) return;
    const text = runsText(runs);
    const styleChanged = runs.some((r) => !!r.bold !== !!b.originalBold || !!r.italic !== !!b.originalItalic || r.underline);
    onUpdateTextBlock({
      ...b,
      runs,
      currentText: text,
      // Stays modified if text/styling changed or size/font were adjusted earlier
      isModified: text !== b.originalText || styleChanged || b.isModified
    });
    setActiveEditingBlockId(null);
  };

  // Measure the real ascent/descent of the font the browser will use, so the text baseline
  // can be placed exactly where the PDF put it (fonts differ a lot in their built-in metrics).
  const measureCtxRef = useRef<CanvasRenderingContext2D | null>(null);
  const fontMetrics = (b: PdfTextBlock): { asc: number; desc: number } => {
    if (!measureCtxRef.current) measureCtxRef.current = document.createElement('canvas').getContext('2d');
    const ctx = measureCtxRef.current;
    const st = runStyle(b, blockRuns(b)[0] || { text: '' });
    if (ctx) {
      ctx.font = `${st.fontStyle} ${st.fontWeight} 100px ${st.fontFamily}`;
      const m = ctx.measureText('Hg');
      if (m.fontBoundingBoxAscent > 0) {
        return { asc: m.fontBoundingBoxAscent / 100, desc: m.fontBoundingBoxDescent / 100 };
      }
    }
    return { asc: 0.9, desc: 0.22 };
  };
  /** Vertical shift that puts the baseline at top + fontSize (where the PDF baseline is). */
  const baselineShiftPx = (b: PdfTextBlock) => {
    const px = (b.fontSize || 12) * scale;
    return px - fontMetrics(b).asc * px;
  };

  /** Container typography at the current zoom; per-run family/weight come from runStyle. */
  const blockBaseStyle = (b: PdfTextBlock): React.CSSProperties => {
    const px = (b.fontSize || 12) * scale;
    const { asc, desc } = fontMetrics(b);
    return {
      ...runStyle(b, blockRuns(b)[0] || { text: '' }),
      textDecoration: undefined,
      fontSize: `${px}px`,
      lineHeight: `${(asc + desc) * px}px`,
      color: b.color || '#000000',
      whiteSpace: 'pre',
      letterSpacing: 'normal'
    };
  };

  /** Baseline-to-baseline distance in PDF points (user line spacing, else the PDF's own). */
  const blockPitch = (b: PdfTextBlock) =>
    b.lineSpacing ? pitchFor(b.fontSize || 12, b.lineSpacing) : b.linePitch || (b.fontSize || 12) * 1.2;

  /** Layout numbers (in screen px) for a multi-line paragraph block. */
  const paragraphLayout = (b: PdfTextBlock) => {
    const fs = (b.fontSize || 12) * scale;
    const pitch = blockPitch(b) * scale;
    const { asc, desc } = fontMetrics(b);
    const padLeft = (((b.contLeftPct ?? b.xPct) - b.xPct + (b.indentPct || 0)) / 100) * pageSize.width;
    const indent = (((b.firstLineXPct ?? b.xPct) - (b.contLeftPct ?? b.xPct)) / 100) * pageSize.width;
    // CSS puts the first baseline at half-leading + ascent; shift so it lands at top + fontSize
    const shift = fs - ((pitch - (asc + desc) * fs) / 2 + asc * fs);
    const origHeight = (b.heightPct / 100) * pageSize.height;
    const style: React.CSSProperties = {
      ...blockBaseStyle(b),
      lineHeight: `${pitch}px`,
      whiteSpace: 'pre-wrap',
      overflowWrap: 'break-word',
      textAlign: b.align === 'justify' ? 'justify' : b.align === 'center' ? 'center' : 'left',
      textAlignLast: b.align === 'center' ? 'center' : 'left',
      textIndent: `${indent}px`,
      paddingLeft: `${padLeft}px`
    };
    return { fs, pitch, shift, origHeight, style };
  };

  const renderRuns = (b: PdfTextBlock) =>
    blockRuns(b).map((r, i) => (
      <span key={i} style={runStyle(b, r)}>
        {r.text}
      </span>
    ));

  const styleKeyFor = (b: PdfTextBlock) => `${b.fontChoice || 'auto'}|${b.fontSize}|${fontsVersion}`;

  const renderTextBlock = (b: PdfTextBlock) => {
    const isEditing = activeEditingBlockId === b.id;
    const isModified = b.isModified;
    if (!isModified && toolMode !== 'edit_text') return null;

    const active = isEditing || isModified;
    const bg = b.backgroundColor || '#FFFFFF';
    const fs = (b.fontSize || 12) * scale;
    const sidePad = Math.max(2, fs * 0.15);
    const isPara = (b.lineCount || 1) > 1;

    const wrapperProps = {
      onMouseDown: (e: React.MouseEvent) => {
        if (toolMode === 'edit_text') e.stopPropagation();
      },
      onClick: (e: React.MouseEvent) => {
        if (toolMode === 'edit_text' && !isEditing) {
          e.stopPropagation();
          startEditingBlock(b);
        }
      },
      className: `absolute ${isEditing ? 'z-40' : toolMode === 'edit_text' ? 'z-20 cursor-text' : 'z-10'} ${
        toolMode === 'edit_text' && !isEditing ? 'hover:outline hover:outline-1 hover:outline-blue-400/70' : ''
      }`
    };
    const editOutline = isEditing ? { outline: '1px solid rgba(59,130,246,0.55)', outlineOffset: '2px' } : {};

    const editor = (base: React.CSSProperties) => (
      <RichTextEditor
        ref={editorApiRef}
        initialRuns={blockRuns(b)}
        multiline={isPara}
        baseStyle={base}
        runStyle={(r) => runStyle(b, r)}
        styleKey={styleKeyFor(b)}
        onCommit={(runs) => handleCommitRuns(b, runs)}
        onCancel={() => setActiveEditingBlockId(null)}
        onSelectionChange={refreshActiveAttrs}
      />
    );

    if (isPara) {
      const L = paragraphLayout(b);
      return (
        <div
          key={b.id}
          {...wrapperProps}
          style={{
            left: `${b.xPct}%`,
            top: `${b.yPct}%`,
            width: `${b.widthPct}%`,
            height: active ? undefined : `${b.heightPct}%`,
            ...editOutline
          }}
        >
          {active && (
            // Covers the original paragraph (and any extra lines the new text needs),
            // limited to the glyph band so rules above/below stay visible.
            <div
              aria-hidden
              className="absolute pointer-events-none"
              style={{
                backgroundColor: bg,
                zIndex: -1,
                top: `${fs * 0.1}px`,
                left: `-${sidePad}px`,
                right: `-${sidePad}px`,
                height: `max(${L.origHeight - fs * 0.1}px, calc(100% + ${L.shift + fs * 1.12 - L.pitch}px))`
              }}
            />
          )}
          {isEditing ? (
            <div style={{ position: 'relative', top: `${L.shift}px` }}>{editor(L.style)}</div>
          ) : isModified ? (
            <div style={{ ...L.style, position: 'relative', top: `${L.shift}px` }}>{renderRuns(b)}</div>
          ) : null}
        </div>
      );
    }

    // Single line / table cell: anchor at the aligned side so longer or shorter values stay in place
    const base: React.CSSProperties = { ...blockBaseStyle(b), paddingLeft: b.indentPct ? `${(b.indentPct / 100) * pageSize.width}px` : undefined };
    const anchorLeft =
      active && b.align === 'center' ? b.xPct + b.widthPct / 2 : active && b.align === 'right' ? b.xPct + b.widthPct : b.xPct;
    return (
      <div
        key={b.id}
        {...wrapperProps}
        style={{
          left: `${anchorLeft}%`,
          transform: active && b.align === 'center' ? 'translateX(-50%)' : active && b.align === 'right' ? 'translateX(-100%)' : undefined,
          textAlign: b.align === 'right' ? 'right' : b.align === 'center' ? 'center' : 'left',
          top: `${b.yPct}%`,
          minWidth: `${b.widthPct}%`,
          width: active ? 'max-content' : `${b.widthPct}%`,
          height: `${b.heightPct}%`,
          ...editOutline
        }}
      >
        {active && (
          <div
            aria-hidden
            className="absolute pointer-events-none"
            style={{ backgroundColor: bg, zIndex: -1, top: `${fs * 0.1}px`, height: `${fs * 1.12}px`, left: `-${sidePad}px`, right: `-${sidePad}px` }}
          />
        )}
        {isEditing ? (
          <div style={{ position: 'relative', top: `${baselineShiftPx(b)}px` }}>{editor({ ...base, minWidth: '1ch' })}</div>
        ) : isModified ? (
          <div style={{ ...base, position: 'relative', top: `${baselineShiftPx(b)}px` }}>{renderRuns(b)}</div>
        ) : null}
      </div>
    );
  };

  // Edit controls live in a bar pinned to the top of the document view, never over the text
  const renderEditToolbar = () => {
    const b = textBlocks.find((t) => t.id === activeEditingBlockId);
    if (!b) return null;
    const btn = 'px-2 py-1 rounded bg-neutral-800 hover:bg-neutral-700';
    const toggleBtn = (attr: RunAttr, label: React.ReactNode, title: string, extra = '') => (
      <button
        onClick={() => {
          editorApiRef.current?.toggle(attr);
          refreshActiveAttrs();
        }}
        className={`px-2 py-1 rounded ${extra} ${activeAttrs[attr] ? 'bg-blue-600' : 'bg-neutral-800 hover:bg-neutral-700'}`}
        title={title}
      >
        {label}
      </button>
    );
    const auto = !b.fontChoice || b.fontChoice === 'auto';
    const fontLabel = auto ? `Auto · ${b.detectedFont || getFamily(effectiveFamily(b)).label}` : getFamily(b.fontChoice as FontFamilyId).label;
    return (
      <div
        className="absolute top-3 left-1/2 -translate-x-1/2 z-50 flex flex-wrap justify-center items-center gap-1.5 w-max max-w-[calc(100%-24px)] bg-neutral-900/95 text-white px-2 py-1.5 rounded-lg shadow-xl border border-neutral-700 text-[11px] select-none whitespace-nowrap"
        onMouseDown={(e) => {
          // Keep focus (and the selection) in the text so clicking a control doesn't close the editor
          e.preventDefault();
          e.stopPropagation();
        }}
      >
        <span className="text-blue-300 font-medium pr-1">{(b.lineCount || 1) > 1 ? `Paragraph · ${b.lineCount} lines` : 'Text'}</span>

        {/* Font family */}
        <div className="relative">
          <button onClick={() => setFontMenuOpen((o) => !o)} className={`${btn} min-w-[150px] text-left flex items-center justify-between gap-2`} title="Font">
            <span className="truncate max-w-[160px]">{fontLabel}</span>
            <span className="text-neutral-400">▾</span>
          </button>
          {fontMenuOpen && (
            <div className="absolute top-full left-0 mt-1 w-72 bg-neutral-900 border border-neutral-700 rounded-md shadow-2xl py-1 z-50 whitespace-normal">
              {[{ id: 'auto' as const, label: `Auto (detected: ${b.detectedFont || 'unknown'})`, sub: `Matches the PDF · saves as ${getFamily(b.autoFamilyId || 'liberation-sans').matches}` },
                ...FONT_FAMILIES.map((f) => ({ id: f.id, label: f.label, sub: f.matches === f.label ? '' : `saves as ${f.matches}`, css: cssStack(f.id) }))].map((opt) => {
                const selected = (b.fontChoice || 'auto') === opt.id;
                return (
                  <button
                    key={opt.id}
                    onClick={() => {
                      setFontMenuOpen(false);
                      if (opt.id !== 'auto') preloadFamily(opt.id).then(() => setFontsVersion((v) => v + 1));
                      onUpdateTextBlock?.({ ...b, fontChoice: opt.id, isModified: b.isModified || opt.id !== 'auto' });
                    }}
                    className={`block w-full text-left px-3 py-1.5 hover:bg-neutral-800 ${selected ? 'text-blue-300 bg-neutral-800/60' : 'text-neutral-200'}`}
                  >
                    <div style={'css' in opt ? { fontFamily: (opt as any).css, fontSize: 13 } : { fontSize: 12 }}>{opt.label}</div>
                    {opt.sub && <div className="text-[10px] text-neutral-500">{opt.sub}</div>}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <button
          onClick={() => onUpdateTextBlock?.({ ...b, fontSize: Math.max(Math.round(((b.fontSize || 12) - 0.5) * 10) / 10, 4), isModified: true })}
          className={`${btn} font-mono`}
          title="Decrease font size"
        >
          A-
        </button>
        <span className="font-mono text-neutral-300 w-10 text-center">{b.fontSize}pt</span>
        <button
          onClick={() => onUpdateTextBlock?.({ ...b, fontSize: Math.min(Math.round(((b.fontSize || 12) + 0.5) * 10) / 10, 72), isModified: true })}
          className={`${btn} font-mono`}
          title="Increase font size"
        >
          A+
        </button>
        {toggleBtn('bold', 'B', 'Bold selected text (⌘/Ctrl+B)', 'font-bold')}
        {toggleBtn('italic', 'I', 'Italic selected text (⌘/Ctrl+I)', 'italic font-serif')}
        {toggleBtn('underline', 'U', 'Underline selected text (⌘/Ctrl+U)', 'underline')}
        <span className="w-px h-5 bg-neutral-700 mx-0.5" />
        <ParagraphControls
          align={b.align || 'left'}
          onAlign={(align) => onUpdateTextBlock?.({ ...b, align, originalAlign: b.originalAlign ?? b.align, isModified: true })}
          activeList={caretList}
          onList={(kind) => editorApiRef.current?.transform((runs, sel) => applyList(runs, sel, kind))}
          onIndent={(delta) => {
            // Inside a list: change the item's level; otherwise indent the whole block (0.5in steps)
            let handled = false;
            editorApiRef.current?.transform((runs, sel) => {
              const r = changeListLevel(runs, sel, delta);
              handled = !!r;
              return r;
            });
            if (handled) return;
            const step = (36 / (pageSize.width / scale)) * 100;
            const next = Math.max(0, Math.min((b.indentPct || 0) + delta * step, b.widthPct * 0.8));
            if (next !== (b.indentPct || 0)) onUpdateTextBlock?.({ ...b, indentPct: next || undefined, isModified: true });
          }}
          lineSpacing={b.lineSpacing ?? null}
          onLineSpacing={(v) => onUpdateTextBlock?.({ ...b, lineSpacing: v ?? undefined, isModified: true })}
          hasOriginalSpacing
          lineSpacingDisabledReason={(b.lineCount || 1) > 1 ? undefined : 'Line spacing applies to paragraphs (text on several lines)'}
        />
        {b.isModified && (
          <button
            onClick={() => {
              editorApiRef.current?.discard();
              onUpdateTextBlock?.({
                ...b,
                currentText: b.originalText,
                runs: undefined,
                fontChoice: 'auto',
                align: b.originalAlign ?? b.align,
                originalAlign: undefined,
                indentPct: undefined,
                lineSpacing: undefined,
                isModified: false
              });
              setActiveEditingBlockId(null);
            }}
            className={`${btn} text-amber-400 flex items-center gap-1`}
            title="Revert back to original PDF text"
          >
            <RotateCcw className="w-3 h-3" />
            <span>Revert</span>
          </button>
        )}
        <button
          onClick={() => editorApiRef.current?.commit()}
          className="p-1 bg-blue-600 hover:bg-blue-500 text-white rounded"
          title={`Done (Enter). Select words to style them${(b.lineCount || 1) > 1 ? ' · Shift+Enter for a new line' : ''}`}
        >
          <Check className="w-3.5 h-3.5" />
        </button>
      </div>
    );
  };

  // Font / size / bold / italic bar for an added text box (selected or being typed in)
  const renderTextAnnToolbar = () => {
    const id = editingTextId || selectedAnnotationId;
    const ann = annotations.find((a) => a.id === id && a.type === 'text');
    if (!ann || activeEditingBlockId) return null;
    const btn = 'px-2 py-1 rounded bg-neutral-800 hover:bg-neutral-700';
    const update = (patch: Partial<AnnotationItem>) => onUpdateAnnotation({ ...ann, ...patch, updatedAt: Date.now() });
    const auto = !ann.fontChoice || ann.fontChoice === 'auto';
    const fam = annotationFamilyId(ann);
    const autoName = ann.detectedFont || getFamily(fam).label;
    const fontLabel = auto ? `Auto · ${autoName}` : getFamily(fam).label;
    const size = ann.fontSize || 12;
    const typing = editingTextId === ann.id;
    // Current text and selection of the box (live textarea while typing)
    const boxText = (): { text: string; sel: Sel } => {
      const ta = textAreaRef.current;
      return typing && ta ? { text: editingTextValue, sel: [ta.selectionStart, ta.selectionEnd] } : { text: ann.content || '', sel: null };
    };
    const editBoxText = (fn: (runs: ReturnType<typeof textToRuns>, sel: Sel) => { runs: ReturnType<typeof textToRuns>; sel: Sel } | null) => {
      const { text, sel } = boxText();
      const res = fn(textToRuns(text), sel);
      if (!res) return;
      const next = runsToText(res.runs);
      if (!typing) {
        update({ content: next });
        return;
      }
      setEditingTextValue(next);
      requestAnimationFrame(() => {
        const ta = textAreaRef.current;
        if (ta && res.sel) ta.setSelectionRange(res.sel[0], res.sel[1]);
        setTaSelTick((t) => t + 1);
      });
    };
    const toggle = (on: boolean | undefined, label: React.ReactNode, title: string, extra: string, patch: Partial<AnnotationItem>) => (
      <button onClick={() => update(patch)} className={`px-2 py-1 rounded ${extra} ${on ? 'bg-blue-600' : 'bg-neutral-800 hover:bg-neutral-700'}`} title={title}>
        {label}
      </button>
    );
    return (
      <div
        className="absolute top-3 left-1/2 -translate-x-1/2 z-50 flex flex-wrap justify-center items-center gap-1.5 w-max max-w-[calc(100%-24px)] bg-neutral-900/95 text-white px-2 py-1.5 rounded-lg shadow-xl border border-neutral-700 text-[11px] select-none whitespace-nowrap"
        onMouseDown={(e) => {
          // Keep focus in the text box so clicking a control doesn't end typing
          e.preventDefault();
          e.stopPropagation();
        }}
      >
        <span className="text-emerald-300 font-medium pr-1">Text box</span>
        <div className="relative">
          <button onClick={() => setAnnFontMenuOpen((o) => !o)} className={`${btn} min-w-[150px] text-left flex items-center justify-between gap-2`} title="Font">
            <span className="truncate max-w-[160px]">{fontLabel}</span>
            <span className="text-neutral-400">▾</span>
          </button>
          {annFontMenuOpen && (
            <div className="absolute top-full left-0 mt-1 w-72 bg-neutral-900 border border-neutral-700 rounded-md shadow-2xl py-1 z-50 whitespace-normal">
              {[
                {
                  id: 'auto' as const,
                  label: 'Auto detect',
                  sub: ann.autoFamilyId ? `Matches nearby PDF text: ${autoName}` : 'No PDF text nearby · uses Arial',
                  css: undefined as string | undefined
                },
                ...FONT_FAMILIES.map((f) => ({ id: f.id, label: f.label, sub: f.matches === f.label ? '' : `saves as ${f.matches}`, css: cssStack(f.id) }))
              ].map((opt) => {
                const selected = (ann.fontChoice || 'auto') === opt.id;
                return (
                  <button
                    key={opt.id}
                    onClick={() => {
                      setAnnFontMenuOpen(false);
                      const patch: Partial<AnnotationItem> = { fontChoice: opt.id };
                      if (opt.id === 'auto' && !ann.autoFamilyId) {
                        const near = detectFontNear(ann.x, ann.y);
                        if (near) Object.assign(patch, near);
                      }
                      preloadFamily(annotationFamilyId({ ...ann, ...patch })).then(() => setFontsVersion((v) => v + 1));
                      update(patch);
                    }}
                    className={`block w-full text-left px-3 py-1.5 hover:bg-neutral-800 ${selected ? 'text-blue-300 bg-neutral-800/60' : 'text-neutral-200'}`}
                  >
                    <div style={opt.css ? { fontFamily: opt.css, fontSize: 13 } : { fontSize: 12 }}>{opt.label}</div>
                    {opt.sub && <div className="text-[10px] text-neutral-500">{opt.sub}</div>}
                  </button>
                );
              })}
            </div>
          )}
        </div>
        <button onClick={() => update({ fontSize: Math.max(size - 1, 4) })} className={`${btn} font-mono`} title="Decrease font size">
          A-
        </button>
        <span className="font-mono text-neutral-300 w-10 text-center">{size}pt</span>
        <button onClick={() => update({ fontSize: Math.min(size + 1, 96) })} className={`${btn} font-mono`} title="Increase font size">
          A+
        </button>
        {toggle(ann.isBold, 'B', 'Bold', 'font-bold', { isBold: !ann.isBold })}
        {toggle(ann.isItalic, 'I', 'Italic', 'italic font-serif', { isItalic: !ann.isItalic })}
        {toggle(ann.isUnderline, 'U', 'Underline', 'underline', { isUnderline: !ann.isUnderline })}
        <span className="w-px h-5 bg-neutral-700 mx-0.5" />
        <ParagraphControls
          align={ann.textAlign || 'left'}
          onAlign={(textAlign) => update({ textAlign })}
          activeList={listAt(boxText().text, boxText().sel)}
          onList={(kind: ListKind) => editBoxText((runs, sel) => applyList(runs, sel, kind))}
          onIndent={(delta) => editBoxText((runs, sel) => changeListLevel(runs, sel, delta) || shiftLines(runs, sel, delta))}
          lineSpacing={ann.lineSpacing ?? 1}
          onLineSpacing={(v) => update({ lineSpacing: v ?? undefined })}
        />
        <span className="text-neutral-500 px-1">Double-click the box to type</span>
      </div>
    );
  };

  // ---------------- Image editing ----------------

  const isImageRemoved = (img: PdfImageItem) =>
    annotations.some(
      (a) => a.type === 'image_removal' && a.pageIndex === img.pageIndex && a.removedImageBBox && bboxClose(a.removedImageBBox, img.bboxUser, 0.5)
    );
  const visibleImages = images.filter((img) => img.pageIndex === currentPage - 1 && !isImageRemoved(img));
  const selectedImage = visibleImages.find((i) => i.id === selectedImageId) || null;
  const selectedImageAnn = annotations.find(
    (a) => a.id === selectedAnnotationId && (a.type === 'image' || a.type === 'signature' || a.type === 'stamp') && a.imageData
  );

  /** Most common color in a thin ring just outside an area: what the page looks like behind it. */
  const sampleRingColor = (xPct: number, yPct: number, wPct: number, hPct: number): string => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx || !canvasReadyRef.current) return '#FFFFFF';
    const x0 = Math.floor((xPct / 100) * canvas.width) - 4;
    const y0 = Math.floor((yPct / 100) * canvas.height) - 4;
    const x1 = Math.ceil(((xPct + wPct) / 100) * canvas.width) + 4;
    const y1 = Math.ceil(((yPct + hPct) / 100) * canvas.height) + 4;
    const counts = new Map<string, { n: number; r: number; g: number; b: number }>();
    const take = (x: number, y: number, w: number, h: number) => {
      x = Math.max(0, x);
      y = Math.max(0, y);
      w = Math.min(canvas.width - x, w);
      h = Math.min(canvas.height - y, h);
      if (w <= 0 || h <= 0) return;
      const d = ctx.getImageData(x, y, w, h).data;
      for (let i = 0; i < d.length; i += 16) {
        const key = `${d[i] >> 4},${d[i + 1] >> 4},${d[i + 2] >> 4}`;
        const c = counts.get(key) || { n: 0, r: 0, g: 0, b: 0 };
        c.n++;
        c.r += d[i];
        c.g += d[i + 1];
        c.b += d[i + 2];
        counts.set(key, c);
      }
    };
    try {
      take(x0, y0, x1 - x0, 3);
      take(x0, y1 - 3, x1 - x0, 3);
      take(x0, y0, 3, y1 - y0);
      take(x1 - 3, y0, 3, y1 - y0);
    } catch {
      return '#FFFFFF';
    }
    // Average of the most common color bucket = the page background around the image
    let best: { n: number; r: number; g: number; b: number } | null = null;
    counts.forEach((c) => {
      if (!best || c.n > best.n) best = c;
    });
    if (!best) return '#FFFFFF';
    const { n, r, g, b } = best as { n: number; r: number; g: number; b: number };
    return '#' + [r / n, g / n, b / n].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');
  };

  const removalFor = (img: PdfImageItem): AnnotationItem => ({
    id: `imgdel-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    pageIndex: img.pageIndex,
    type: 'image_removal',
    x: img.xPct,
    y: img.yPct,
    width: img.widthPct,
    height: img.heightPct,
    color: sampleRingColor(img.xPct, img.yPct, img.widthPct, img.heightPct),
    removedImageBBox: img.bboxUser,
    content: `Removed image (${img.pixelWidth}×${img.pixelHeight}px)`,
    createdAt: Date.now()
  });

  const addAnnotations = (list: AnnotationItem[]) => {
    if (onAddAnnotations) onAddAnnotations(list);
    else list.forEach(onAddAnnotation);
  };

  const deleteExistingImage = (img: PdfImageItem) => {
    addAnnotations([removalFor(img)]);
    setSelectedImageId(null);
    onNotify?.('Image removed (it is deleted from the file when you save · ⌘Z to undo)');
  };

  /** Replace an original image by an editable image object with the same pixels, in the same place. */
  const liftExistingImage = async (img: PdfImageItem): Promise<AnnotationItem | null> => {
    try {
      const dataUrl = await renderer.getImageDataUrl(img);
      const ann: AnnotationItem = {
        id: `image-${Date.now()}`,
        pageIndex: img.pageIndex,
        type: 'image',
        x: img.xPct,
        y: img.yPct,
        width: img.widthPct,
        height: img.heightPct,
        imageData: dataUrl,
        isSignature: isSignatureImage(img),
        content: isSignatureImage(img) ? 'Signature' : `Image (${img.pixelWidth}×${img.pixelHeight}px)`,
        createdAt: Date.now()
      };
      addAnnotations([removalFor(img), ann]);
      setSelectedImageId(null);
      onSelectAnnotation(ann.id);
      return ann;
    } catch (err) {
      console.warn('Could not lift image:', err);
      return null;
    }
  };

  const toPngBlob = (dataUrl: string): Promise<Blob> =>
    new Promise((resolve, reject) => {
      const im = new Image();
      im.onload = () => {
        const c = document.createElement('canvas');
        c.width = im.naturalWidth;
        c.height = im.naturalHeight;
        c.getContext('2d')!.drawImage(im, 0, 0);
        c.toBlob((b) => (b ? resolve(b) : reject(new Error('PNG encode failed'))), 'image/png');
      };
      im.onerror = () => reject(new Error('Image decode failed'));
      im.src = dataUrl;
    });

  // ----- Which images are signatures? -----
  /** The user's own call on an original PDF image, if they made one. */
  const imageFlagFor = (img: PdfImageItem) =>
    annotations.find((a) => a.type === 'image_flag' && a.pageIndex === img.pageIndex && a.flagBBox && bboxClose(a.flagBBox, img.bboxUser, 0.5));
  const isSignatureImage = (img: PdfImageItem) => {
    const flag = imageFlagFor(img);
    return flag ? !!flag.flagSignature : !!(img.signatureMarked || img.signatureLikely);
  };
  const isSignatureAnn = (a: AnnotationItem) => a.type === 'signature' || !!a.isSignature;

  const setImageSignatureFlag = (img: PdfImageItem, value: boolean) => {
    const flag = imageFlagFor(img);
    if (flag) onUpdateAnnotation({ ...flag, flagSignature: value, content: value ? 'Marked as signature' : 'Marked as not a signature', updatedAt: Date.now() });
    else
      addAnnotations([
        {
          id: `imgflag-${Date.now()}`,
          pageIndex: img.pageIndex,
          type: 'image_flag',
          x: img.xPct,
          y: img.yPct,
          width: img.widthPct,
          height: img.heightPct,
          flagBBox: img.bboxUser,
          flagSignature: value,
          content: value ? 'Marked as signature' : 'Marked as not a signature',
          createdAt: Date.now()
        }
      ]);
  };

  /**
   * Copy to the system clipboard (and an in-app fallback clipboard). Signatures are never copied
   * as-is while protection is on: the clipboard gets a redacted placeholder instead, so pasting
   * into any other file or app cannot reproduce the signature.
   */
  const copyImage = (dataUrlPromise: Promise<string>, isSignature = false) => {
    const redact = isSignature && protectSignatures;
    const payload = redact ? dataUrlPromise.then(makeRedactedSignature) : dataUrlPromise;
    const blob = payload.then((u) => {
      imageClipboardRef.current = u;
      return toPngBlob(u);
    });
    const done = redact ? 'Signature copied as REDACTED (signature protection is on)' : 'Image copied to clipboard';
    try {
      const Item = (window as any).ClipboardItem;
      if (Item && navigator.clipboard?.write) {
        navigator.clipboard
          .write([new Item({ 'image/png': blob })])
          .then(() => onNotify?.(done))
          .catch(() => blob.then(() => onNotify?.(redact ? done : 'Image copied (paste inside AcrobatDesk with ⌘V)')));
        return;
      }
    } catch {
      /* fall through */
    }
    blob.then(() => onNotify?.(redact ? done : 'Image copied (paste inside AcrobatDesk with ⌘V)'));
  };

  const copySelectedImage = () => {
    if (selectedImage) copyImage(renderer.getImageDataUrl(selectedImage), isSignatureImage(selectedImage));
    else if (selectedImageAnn?.imageData) copyImage(Promise.resolve(selectedImageAnn.imageData), isSignatureAnn(selectedImageAnn));
  };

  const loadImageSize = (dataUrl: string) =>
    new Promise<{ w: number; h: number }>((resolve) => {
      const im = new Image();
      im.onload = () => resolve({ w: im.naturalWidth || 100, h: im.naturalHeight || 100 });
      im.onerror = () => resolve({ w: 100, h: 100 });
      im.src = dataUrl;
    });

  /** Place a new image on the current page: natural size at 96 dpi, capped to fit, centered. */
  const addImageFromDataUrl = async (dataUrl: string) => {
    const { w, h } = await loadImageSize(dataUrl);
    const ptW = w * 0.75 * scale;
    const ptH = h * 0.75 * scale;
    const fit = Math.min(1, (pageSize.width * 0.6) / ptW, (pageSize.height * 0.6) / ptH);
    const wPct = ((ptW * fit) / pageSize.width) * 100;
    const hPct = ((ptH * fit) / pageSize.height) * 100;
    const offset = (pasteCountRef.current++ % 5) * 2;
    const ann: AnnotationItem = {
      id: `image-${Date.now()}`,
      pageIndex: currentPage - 1,
      type: 'image',
      x: Math.min(100 - wPct, (100 - wPct) / 2 + offset),
      y: Math.min(100 - hPct, (100 - hPct) / 2 + offset),
      width: wPct,
      height: hPct,
      imageData: dataUrl,
      content: `Image (${w}×${h}px)`,
      createdAt: Date.now()
    };
    addAnnotations([ann]);
    setSelectedImageId(null);
    onSelectAnnotation(ann.id);
  };

  /** Fit a new picture inside an existing box, keeping its proportions. */
  const fitInto = async (dataUrl: string, box: { x: number; y: number; w: number; h: number }) => {
    const { w, h } = await loadImageSize(dataUrl);
    const boxPxW = (box.w / 100) * pageSize.width;
    const boxPxH = (box.h / 100) * pageSize.height;
    const k = Math.min(boxPxW / w, boxPxH / h);
    const wPct = ((w * k) / pageSize.width) * 100;
    const hPct = ((h * k) / pageSize.height) * 100;
    return { x: box.x + (box.w - wPct) / 2, y: box.y + (box.h - hPct) / 2, width: wPct, height: hPct, w, h };
  };

  const readFileAsDataUrl = (file: Blob) =>
    new Promise<string>((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => resolve(String(fr.result));
      fr.onerror = () => reject(fr.error);
      fr.readAsDataURL(file);
    });

  const handleImageFile = async (file: File | undefined) => {
    if (!file || !file.type.startsWith('image/')) return;
    let dataUrl = await readFileAsDataUrl(file);
    // pdf-lib embeds PNG and JPEG; convert anything else (WebP, GIF, …) to PNG
    if (!/^data:image\/(png|jpe?g)/.test(dataUrl)) {
      const blob = await toPngBlob(dataUrl);
      dataUrl = await readFileAsDataUrl(blob);
    }
    const target = replaceTargetRef.current;
    replaceTargetRef.current = null;
    if (target?.kind === 'existing') {
      const f = await fitInto(dataUrl, { x: target.img.xPct, y: target.img.yPct, w: target.img.widthPct, h: target.img.heightPct });
      const ann: AnnotationItem = {
        id: `image-${Date.now()}`,
        pageIndex: target.img.pageIndex,
        type: 'image',
        x: f.x,
        y: f.y,
        width: f.width,
        height: f.height,
        imageData: dataUrl,
        content: `Image (${f.w}×${f.h}px)`,
        createdAt: Date.now()
      };
      addAnnotations([removalFor(target.img), ann]);
      setSelectedImageId(null);
      onSelectAnnotation(ann.id);
    } else if (target?.kind === 'annotation') {
      const old = annotations.find((a) => a.id === target.id);
      if (old) {
        const f = await fitInto(dataUrl, { x: old.x, y: old.y, w: old.width || 10, h: old.height || 10 });
        onUpdateAnnotation({ ...old, type: old.type === 'signature' || old.type === 'stamp' ? 'image' : old.type, imageData: dataUrl, x: f.x, y: f.y, width: f.width, height: f.height, content: `Image (${f.w}×${f.h}px)`, updatedAt: Date.now() });
      }
    } else {
      await addImageFromDataUrl(dataUrl);
    }
  };

  const openImagePicker = (target: typeof replaceTargetRef.current) => {
    replaceTargetRef.current = target;
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
      fileInputRef.current.click();
    }
  };

  // "Insert image from file…" in the tools panel
  const lastInsertToken = useRef(insertImageToken);
  useEffect(() => {
    if (insertImageToken !== lastInsertToken.current) {
      lastInsertToken.current = insertImageToken;
      openImagePicker(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [insertImageToken]);

  const isTypingTarget = (t: EventTarget | null) => {
    const el = t as HTMLElement | null;
    return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);
  };

  // ⌘V / Ctrl+V: paste an image from the clipboard onto the current page
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      if (isTypingTarget(document.activeElement)) return;
      const item = Array.from(e.clipboardData?.items || []).find((i) => i.type.startsWith('image/'));
      if (item) {
        e.preventDefault();
        handleImageFile(item.getAsFile() || undefined);
      } else if (imageClipboardRef.current && !e.clipboardData?.getData('text/plain')) {
        e.preventDefault();
        addImageFromDataUrl(imageClipboardRef.current);
      }
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  });

  // ⌘C / ⌘X / Delete for selected images
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTypingTarget(e.target) || isTypingTarget(document.activeElement)) return;
      const mod = e.metaKey || e.ctrlKey;
      const hasImage = !!selectedImage || !!selectedImageAnn;
      if (!hasImage) return;
      if (mod && (e.key === 'c' || e.key === 'x')) {
        if (window.getSelection()?.toString()) return;
        e.preventDefault();
        copySelectedImage();
        if (e.key === 'x') {
          if (selectedImage) deleteExistingImage(selectedImage);
          else if (selectedImageAnn) {
            onDeleteAnnotation(selectedImageAnn.id);
            onSelectAnnotation(null);
          }
        }
      } else if ((e.key === 'Delete' || e.key === 'Backspace') && selectedImage) {
        e.preventDefault();
        deleteExistingImage(selectedImage);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  // Edit ▸ Copy / Cut from the desktop app's menu (and the browser's own menu) arrive as
  // copy/cut events rather than key presses; selected images go through the same protected copy.
  useEffect(() => {
    const handler = (kind: 'copy' | 'cut') => (e: ClipboardEvent) => {
      if (isTypingTarget(document.activeElement) || window.getSelection()?.toString()) return;
      if (!selectedImage && !selectedImageAnn) return;
      e.preventDefault();
      copySelectedImage();
      if (kind === 'cut') {
        if (selectedImage) deleteExistingImage(selectedImage);
        else if (selectedImageAnn) {
          onDeleteAnnotation(selectedImageAnn.id);
          onSelectAnnotation(null);
        }
      }
    };
    const onCopy = handler('copy');
    const onCut = handler('cut');
    window.addEventListener('copy', onCopy);
    window.addEventListener('cut', onCut);
    return () => {
      window.removeEventListener('copy', onCopy);
      window.removeEventListener('cut', onCut);
    };
  });

  const renderImageBoxes = () => {
    if (toolMode !== 'edit_image') return null;
    return visibleImages.map((img) => {
      const selected = img.id === selectedImageId;
      return (
        <div
          key={img.id}
          onMouseDown={(e) => {
            e.stopPropagation();
            onSelectAnnotation(null);
            setSelectedImageId(img.id);
            const { xPct, yPct } = getRelativeCoords(e as any);
            pendingLiftRef.current = { img, mode: 'move', x: xPct, y: yPct };
          }}
          title="Drag to move · corner to resize · Delete to remove"
          className={`absolute z-20 cursor-move ${selected ? 'ring-2 ring-pink-500' : 'hover:outline hover:outline-2 hover:outline-dashed hover:outline-pink-400'}`}
          style={{ left: `${img.xPct}%`, top: `${img.yPct}%`, width: `${img.widthPct}%`, height: `${img.heightPct}%` }}
        >
          {isSignatureImage(img) && protectSignatures && (
            <span
              className="absolute -top-2 -left-2 w-5 h-5 rounded-full bg-emerald-600 text-white flex items-center justify-center shadow"
              title="Signature: copies are redacted"
            >
              <ShieldCheck className="w-3 h-3" />
            </span>
          )}
          {selected && (
            <div
              onMouseDown={(e) => {
                e.stopPropagation();
                const { xPct, yPct } = getRelativeCoords(e as any);
                pendingLiftRef.current = { img, mode: 'resize', x: xPct, y: yPct };
              }}
              className="absolute -bottom-1.5 -right-1.5 w-3.5 h-3.5 bg-pink-600 border border-white rounded-full cursor-se-resize shadow"
              title="Drag to resize"
            />
          )}
        </div>
      );
    });
  };

  const renderImageToolbar = () => {
    if (activeEditingBlockId) return null;
    const ann = selectedImageAnn && (toolMode === 'edit_image' || toolMode === 'select' || toolMode === 'signature' || toolMode === 'hand') ? selectedImageAnn : null;
    if (!selectedImage && !ann) return null;
    const btn = 'px-2 py-1 rounded bg-neutral-800 hover:bg-neutral-700 flex items-center gap-1';
    return (
      <div
        className="absolute top-3 left-1/2 -translate-x-1/2 z-50 flex flex-wrap justify-center items-center gap-1.5 w-max max-w-[calc(100%-24px)] bg-neutral-900/95 text-white px-2 py-1.5 rounded-lg shadow-xl border border-neutral-700 text-[11px] select-none whitespace-nowrap"
        onMouseDown={(e) => {
          e.preventDefault();
          e.stopPropagation();
        }}
      >
        <span className="text-pink-300 font-medium pr-1 flex items-center gap-1">
          <ImageIcon className="w-3.5 h-3.5" />
          {selectedImage ? `PDF image · ${selectedImage.pixelWidth}×${selectedImage.pixelHeight}px` : ann!.content || 'Image'}
        </span>
        {(() => {
          const sig = selectedImage ? isSignatureImage(selectedImage) : isSignatureAnn(ann!);
          const auto = selectedImage && !imageFlagFor(selectedImage) && selectedImage.signatureLikely && !selectedImage.signatureMarked;
          return (
            <>
              {sig && (
                <span
                  className={`flex items-center gap-1 px-1.5 py-0.5 rounded ${protectSignatures ? 'bg-emerald-900/60 text-emerald-300' : 'bg-neutral-800 text-neutral-400'}`}
                  title={protectSignatures ? 'Copies of this signature are redacted' : 'Signature protection is off'}
                >
                  <ShieldCheck className="w-3 h-3" />
                  {protectSignatures ? 'Signature · copies redacted' : 'Signature · protection off'}
                  {auto ? ' (detected)' : ''}
                </span>
              )}
              {(selectedImage || ann!.type === 'image') && (
                <button
                  onClick={() => {
                    if (selectedImage) setImageSignatureFlag(selectedImage, !sig);
                    else onUpdateAnnotation({ ...ann!, isSignature: !sig, updatedAt: Date.now() });
                  }}
                  className={btn}
                  title={sig ? 'This is not a signature: allow normal copying' : 'Treat this image as a signature: copies will be redacted'}
                >
                  <PenLine className="w-3 h-3" /> {sig ? 'Not a signature' : 'Mark as signature'}
                </button>
              )}
            </>
          );
        })()}
        <button onClick={copySelectedImage} className={btn} title="Copy image (⌘/Ctrl+C)">
          <CopyIcon className="w-3 h-3" /> Copy
        </button>
        <button
          onClick={() => openImagePicker(selectedImage ? { kind: 'existing', img: selectedImage } : { kind: 'annotation', id: ann!.id })}
          className={btn}
          title="Replace with another image file"
        >
          <Replace className="w-3 h-3" /> Replace…
        </button>
        <button
          onClick={() => {
            if (selectedImage) deleteExistingImage(selectedImage);
            else if (ann) {
              onDeleteAnnotation(ann.id);
              onSelectAnnotation(null);
            }
          }}
          className={`${btn} text-rose-300`}
          title="Delete image (Delete)"
        >
          <Trash2 className="w-3 h-3" /> Delete
        </button>
        <span className="text-neutral-500 px-1">Drag to move · corner to resize (Shift = free) · ⌘V pastes</span>
      </div>
    );
  };

  // Filter annotations for current page
  const pageAnnotations = annotations
    .filter((a) => a.pageIndex === currentPage - 1)
    .map((a) => (livePatch && livePatch.id === a.id ? { ...a, ...livePatch } : a));

  // ---------------- Comments & text highlights ----------------

  useEffect(() => {
    let cancelled = false;
    setPageWords([]);
    if (renderer.getNumPages() === 0) return;
    renderer
      .getPageWords(currentPage)
      .then((w) => !cancelled && setPageWords(w))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [renderer, currentPage, documentBytes]);

  const wordAt = (x: number, y: number) =>
    pageWords.findIndex((w) => x >= w.x - 0.15 && x <= w.x + w.w + 0.15 && y >= w.y - 0.1 && y <= w.y + w.h + 0.1);

  const nearestWord = (x: number, y: number) => {
    let best = -1;
    let bestD = Infinity;
    pageWords.forEach((w, i) => {
      const dx = x < w.x ? w.x - x : x > w.x + w.w ? x - (w.x + w.w) : 0;
      const dy = y < w.y ? w.y - y : y > w.y + w.h ? y - (w.y + w.h) : 0;
      const d = dx + dy * 4; // prefer staying on the current line
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    });
    return best;
  };

  /** One rectangle per line for words a..b. */
  const selectionRects = (a: number, b: number) => {
    const [s, e] = a <= b ? [a, b] : [b, a];
    const ws = pageWords.slice(s, e + 1);
    const lines = new Map<number, { x: number; y: number; x2: number; y2: number }>();
    ws.forEach((w) => {
      const r = lines.get(w.line);
      if (!r) lines.set(w.line, { x: w.x, y: w.y, x2: w.x + w.w, y2: w.y + w.h });
      else {
        r.x = Math.min(r.x, w.x);
        r.y = Math.min(r.y, w.y);
        r.x2 = Math.max(r.x2, w.x + w.w);
        r.y2 = Math.max(r.y2, w.y + w.h);
      }
    });
    return { rects: [...lines.values()].map((r) => ({ x: r.x, y: r.y, w: r.x2 - r.x, h: r.y2 - r.y })), quote: ws.map((w) => w.text).join(' ') };
  };

  // Text selection follows the mouse across the whole window, so releasing over a popup or
  // outside the page still finishes the highlight instead of leaving the selection stuck.
  const textSelRef = useRef(textSel);
  textSelRef.current = textSel;
  const selecting = textSel !== null;
  useEffect(() => {
    if (!selecting) return;
    const onMove = (ev: MouseEvent) => {
      const rect = overlayRef.current?.getBoundingClientRect();
      if (!rect) return;
      const idx = nearestWord(((ev.clientX - rect.left) / rect.width) * 100, ((ev.clientY - rect.top) / rect.height) * 100);
      setTextSel((cur) => (cur && idx >= 0 && idx !== cur.b ? { ...cur, b: idx } : cur));
    };
    const onUp = () => {
      const sel = textSelRef.current;
      setTextSel(null);
      if (!sel) return;
      const hl = makeTextHighlight(sel.a, sel.b, sel.mode === 'note' ? '#FDE047' : activeColor);
      if (sel.mode === 'note') {
        // Comment tool: highlight the words and open a new comment on them right away
        const c = newComment({ kind: 'annotation', id: hl.id }, hl.x + (hl.width || 0), hl.y);
        pendingHighlightRef.current = hl.id;
        addAnnotations([hl, c]);
        setActiveNoteId(c.id);
      } else {
        addAnnotations([hl]);
        const last = hl.rects![hl.rects!.length - 1];
        setHlPrompt({ id: hl.id, x: last.x + last.w, y: last.y + last.h });
      }
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selecting]);

  const makeTextHighlight = (a: number, b: number, color: string): AnnotationItem => {
    const { rects, quote } = selectionRects(a, b);
    const x = Math.min(...rects.map((r) => r.x));
    const y = Math.min(...rects.map((r) => r.y));
    return {
      id: `highlight-${Date.now()}`,
      pageIndex: currentPage - 1,
      type: 'highlight',
      x,
      y,
      width: Math.max(...rects.map((r) => r.x + r.w)) - x,
      height: Math.max(...rects.map((r) => r.y + r.h)) - y,
      rects,
      quote,
      color,
      opacity: 0.35,
      author: authorName,
      createdAt: Date.now()
    };
  };

  const newComment = (anchor: NonNullable<AnnotationItem['anchor']>, x: number, y: number): AnnotationItem => ({
    id: `note-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    pageIndex: currentPage - 1,
    type: 'note',
    x: Math.min(97, Math.max(0, x)),
    y: Math.min(98, Math.max(0, y)),
    width: 3,
    height: 2,
    content: '',
    author: authorName,
    anchor,
    replies: [],
    color: '#F59E0B',
    createdAt: Date.now()
  });

  const commentFor = (annId: string) =>
    annotations.find((a) => a.type === 'note' && a.anchor?.kind === 'annotation' && a.anchor.id === annId);

  /** Open the existing thread on an item, or start a new one. */
  const commentOn = (anchor: NonNullable<AnnotationItem['anchor']>, x: number, y: number) => {
    if (anchor.kind === 'annotation') {
      const existing = commentFor(anchor.id);
      if (existing) {
        setActiveNoteId(existing.id);
        return;
      }
    }
    const c = newComment(anchor, x, y);
    addAnnotations([c]);
    setActiveNoteId(c.id);
  };

  // Where a comment's bubble sits: at the top-right of what it is attached to
  const commentAnchorBox = (c: AnnotationItem): { x: number; y: number; w: number; h: number } | null => {
    if (c.anchor?.kind === 'annotation') {
      const anchorId = c.anchor.id;
      const t = pageAnnotations.find((a) => a.id === anchorId);
      return t ? { x: t.x, y: t.y, w: t.width || 0, h: t.height || 0 } : null;
    }
    if (c.anchor?.kind === 'image') return c.anchor.rect;
    return null;
  };
  const commentPin = (c: AnnotationItem) => {
    const box = commentAnchorBox(c);
    return box ? { x: box.x + box.w, y: box.y } : { x: c.x, y: c.y };
  };

  // A new comment that was closed without writing anything is discarded
  // (together with the highlight the Comment tool made for it)
  const prevActiveRef = useRef<string | null>(null);
  useEffect(() => {
    const prev = prevActiveRef.current;
    prevActiveRef.current = activeNoteId;
    if (!prev || prev === activeNoteId) return;
    const c = annotations.find((a) => a.id === prev);
    if (c && c.type === 'note' && !c.content) {
      const hl = pendingHighlightRef.current;
      if (hl && c.anchor?.kind === 'annotation' && c.anchor.id === hl) onDeleteAnnotation(hl);
      else onDeleteAnnotation(prev);
    }
    pendingHighlightRef.current = null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeNoteId]);

  const handleContextMenu = (e: React.MouseEvent<HTMLDivElement>) => {
    if (activeEditingBlockId) return; // let the browser menu work while typing
    e.preventDefault();
    const { xPct, yPct } = getRelativeCoords(e);
    const annEl = (e.target as HTMLElement).closest('[data-ann-id]') as HTMLElement | null;
    const ann = annEl ? annotations.find((a) => a.id === annEl.dataset.annId) : undefined;
    let target: NonNullable<typeof ctxMenu>['target'] = { kind: 'point' };
    if (ann) target = { kind: 'ann', ann };
    else {
      const img = visibleImages.find((i) => xPct >= i.xPct && xPct <= i.xPct + i.widthPct && yPct >= i.yPct && yPct <= i.yPct + i.heightPct);
      const w = wordAt(xPct, yPct);
      if (img) target = { kind: 'image', img };
      else if (w >= 0) target = { kind: 'word', idx: w };
    }
    setHlPrompt(null);
    setCtxMenu({ clientX: e.clientX, clientY: e.clientY, xPct, yPct, target });
  };

  // Close the context menu on any outside click, Escape or scroll
  useEffect(() => {
    if (!ctxMenu) return;
    const close = () => setCtxMenu(null);
    const onKey = (ev: KeyboardEvent) => ev.key === 'Escape' && close();
    window.addEventListener('mousedown', close);
    window.addEventListener('keydown', onKey);
    containerRef.current?.addEventListener('scroll', close);
    const el = containerRef.current;
    return () => {
      window.removeEventListener('mousedown', close);
      window.removeEventListener('keydown', onKey);
      el?.removeEventListener('scroll', close);
    };
  }, [ctxMenu]);

  const labelFor = (a: AnnotationItem) =>
    a.type === 'highlight' ? 'highlight' : a.type === 'image' ? 'image' : a.type === 'signature' ? 'signature' : a.type === 'stamp' ? 'stamp' : a.type === 'shape' ? 'shape' : a.type === 'text' ? 'text box' : 'item';

  const renderContextMenu = () => {
    if (!ctxMenu) return null;
    const t = ctxMenu.target;
    const items: Array<{ label: string; icon: React.ElementType; run: () => void; danger?: boolean }> = [];
    if (t.kind === 'ann') {
      const has = commentFor(t.ann.id);
      items.push({
        label: has ? 'Open comment' : `Add comment to ${labelFor(t.ann)}`,
        icon: MessageSquare,
        run: () => commentOn({ kind: 'annotation', id: t.ann.id }, t.ann.x + (t.ann.width || 0), t.ann.y)
      });
      if (t.ann.imageData)
        items.push({
          label: isSignatureAnn(t.ann) && protectSignatures ? 'Copy signature (redacted)' : 'Copy image',
          icon: CopyIcon,
          run: () => copyImage(Promise.resolve(t.ann.imageData!), isSignatureAnn(t.ann))
        });
      items.push({ label: `Delete ${labelFor(t.ann)}`, icon: Trash2, danger: true, run: () => onDeleteAnnotation(t.ann.id) });
    } else if (t.kind === 'image') {
      items.push({
        label: 'Add comment to image',
        icon: MessageSquare,
        run: () =>
          commentOn({ kind: 'image', bboxUser: t.img.bboxUser, rect: { x: t.img.xPct, y: t.img.yPct, w: t.img.widthPct, h: t.img.heightPct } }, t.img.xPct + t.img.widthPct, t.img.yPct)
      });
      items.push({
        label: isSignatureImage(t.img) && protectSignatures ? 'Copy signature (redacted)' : 'Copy image',
        icon: CopyIcon,
        run: () => copyImage(renderer.getImageDataUrl(t.img), isSignatureImage(t.img))
      });
      items.push({ label: 'Delete image', icon: Trash2, danger: true, run: () => deleteExistingImage(t.img) });
    } else if (t.kind === 'word') {
      items.push({
        label: `Highlight & comment “${pageWords[t.idx]?.text}”`,
        icon: MessageSquare,
        run: () => {
          const hl = makeTextHighlight(t.idx, t.idx, '#FDE047');
          const c = newComment({ kind: 'annotation', id: hl.id }, hl.x + (hl.width || 0), hl.y);
          pendingHighlightRef.current = hl.id;
          addAnnotations([hl, c]);
          setActiveNoteId(c.id);
        }
      });
      items.push({ label: 'Highlight word', icon: Highlighter, run: () => addAnnotations([makeTextHighlight(t.idx, t.idx, activeColor)]) });
    }
    items.push({ label: 'Add comment here', icon: MessageSquarePlus, run: () => commentOn({ kind: 'point' }, ctxMenu.xPct, ctxMenu.yPct) });

    return (
      <div
        className="fixed z-[60] min-w-[210px] bg-neutral-900 border border-neutral-700 rounded-lg shadow-2xl py-1 text-[12px] text-neutral-200"
        style={{ left: Math.min(ctxMenu.clientX, window.innerWidth - 230), top: Math.min(ctxMenu.clientY, window.innerHeight - 40 * items.length - 10) }}
        onMouseDown={(e) => e.stopPropagation()}
        onContextMenu={(e) => e.preventDefault()}
      >
        {items.map((it) => {
          const Icon = it.icon;
          return (
            <button
              key={it.label}
              onClick={() => {
                setCtxMenu(null);
                it.run();
              }}
              className={`w-full flex items-center gap-2 px-3 py-1.5 text-left hover:bg-neutral-800 ${it.danger ? 'text-rose-300' : ''}`}
            >
              <Icon className="w-3.5 h-3.5 shrink-0" />
              <span className="truncate">{it.label}</span>
            </button>
          );
        })}
      </div>
    );
  };

  /** Bubbles for comments on this page, the outline of what the open one is about, and live text selection. */
  const renderComments = () => {
    const comments = pageAnnotations.filter((a) => a.type === 'note');
    const active = comments.find((c) => c.id === activeNoteId);
    const activeBox = active ? commentAnchorBox(active) : null;
    return (
      <>
        {textSel &&
          selectionRects(textSel.a, textSel.b).rects.map((r, i) => (
            <div
              key={`sel-${i}`}
              className="absolute pointer-events-none rounded-[1px]"
              style={{
                left: `${r.x}%`,
                top: `${r.y}%`,
                width: `${r.w}%`,
                height: `${r.h}%`,
                backgroundColor: textSel.mode === 'note' ? '#FDE047' : activeColor,
                opacity: 0.45,
                mixBlendMode: 'multiply',
                zIndex: 25
              }}
            />
          ))}
        {activeBox && (
          <div
            className="absolute pointer-events-none rounded-sm"
            style={{ left: `${activeBox.x}%`, top: `${activeBox.y}%`, width: `${activeBox.w}%`, height: `${activeBox.h}%`, outline: '2px solid rgba(245,158,11,0.9)', outlineOffset: 2, zIndex: 26 }}
          />
        )}
        {comments.map((c) => {
          const pin = commentPin(c);
          const isActive = c.id === activeNoteId;
          const count = (c.content ? 1 : 0) + (c.replies?.length || 0);
          return (
            <button
              key={c.id}
              onMouseDown={(e) => {
                e.stopPropagation();
                // Free-standing comments can be dragged to a new spot
                if (c.anchor?.kind !== 'annotation' && c.anchor?.kind !== 'image' && e.button === 0) {
                  const { xPct, yPct } = getRelativeCoords(e as any);
                  setDraggingElementId(c.id);
                  setElementDragOffset({ x: xPct - c.x, y: yPct - c.y });
                }
              }}
              onClick={(e) => {
                e.stopPropagation();
                setActiveNoteId(isActive ? null : c.id);
              }}
              title={c.content ? `${c.author}: ${c.content}` : 'New comment'}
              className={`absolute flex items-center gap-0.5 rounded-full rounded-bl-none shadow-md border transition-transform hover:scale-110 ${
                c.resolved ? 'bg-neutral-200 border-neutral-400 text-neutral-600' : 'bg-amber-400 border-amber-600 text-amber-950'
              } ${isActive ? 'ring-2 ring-blue-500 ring-offset-1 scale-110' : ''}`}
              style={{
                left: `${pin.x}%`,
                top: `${pin.y}%`,
                transform: `translate(-20%, -100%)`,
                padding: '3px 5px',
                zIndex: isActive ? 45 : 35
              }}
            >
              {c.resolved ? <Check className="w-3 h-3" /> : <MessageSquare className="w-3 h-3" />}
              {count > 1 && <span className="text-[9px] font-bold leading-none">{count}</span>}
            </button>
          );
        })}
      </>
    );
  };

  /** The open thread, floating next to its bubble (outside the clipped overlay). */
  const renderCommentPopover = () => {
    const c = pageAnnotations.find((a) => a.id === activeNoteId && a.type === 'note');
    if (!c) return null;
    const pin = commentPin(c);
    const toLeft = pin.x > 62;
    return (
      <div
        className="absolute z-50 bg-white rounded-lg shadow-2xl border border-neutral-200 p-3"
        style={{
          top: `${Math.max(0, pin.y)}%`,
          ...(toLeft ? { right: `${100 - pin.x + 2}%` } : { left: `${pin.x + 2.5}%` })
        }}
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
      >
        <CommentThread
          comment={c}
          allAnnotations={annotations}
          authorName={authorName}
          autoFocus
          onChange={(u) => {
            if (u.content && pendingHighlightRef.current) pendingHighlightRef.current = null;
            onUpdateAnnotation(u);
          }}
          onDelete={() => {
            const hl = pendingHighlightRef.current;
            pendingHighlightRef.current = null;
            if (hl && c.anchor?.kind === 'annotation' && c.anchor.id === hl && !c.content) onDeleteAnnotation(hl);
            else onDeleteAnnotation(c.id);
            setActiveNoteId(null);
          }}
          onClose={() => setActiveNoteId(null)}
        />
      </div>
    );
  };

  /** Small "Comment" button that appears after making a text highlight. */
  const renderHighlightPrompt = () => {
    if (!hlPrompt) return null;
    const hl = pageAnnotations.find((a) => a.id === hlPrompt.id);
    if (!hl) return null;
    return (
      <div
        className="absolute z-50 flex items-center gap-1 bg-neutral-900 text-white rounded-md shadow-xl px-1 py-1 text-[11px]"
        style={{ left: `${Math.min(hlPrompt.x, 88)}%`, top: `${hlPrompt.y}%`, transform: 'translate(-50%, 6px)' }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <button
          onClick={() => {
            setHlPrompt(null);
            commentOn({ kind: 'annotation', id: hl.id }, hl.x + (hl.width || 0), hl.y);
          }}
          className="flex items-center gap-1 px-2 py-0.5 rounded hover:bg-neutral-700"
        >
          <MessageSquarePlus className="w-3.5 h-3.5 text-amber-300" /> Comment
        </button>
        <button
          onClick={() => {
            setHlPrompt(null);
            onDeleteAnnotation(hl.id);
          }}
          className="p-1 rounded hover:bg-neutral-700 text-neutral-400"
          title="Remove highlight"
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>
    );
  };


  // Key listener for deleting selected annotation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.key === 'Backspace' || e.key === 'Delete') && selectedAnnotationId && !editingTextId) {
        onDeleteAnnotation(selectedAnnotationId);
        onSelectAnnotation(null);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedAnnotationId, editingTextId, onDeleteAnnotation, onSelectAnnotation]);

  return (
    <div className="flex-1 relative flex min-w-0 min-h-0">
    {renderEditToolbar()}
    {renderTextAnnToolbar()}
    {renderImageToolbar()}
    {renderContextMenu()}
    <input
      ref={fileInputRef}
      type="file"
      accept="image/png,image/jpeg,image/webp,image/gif"
      className="hidden"
      onChange={(e) => handleImageFile(e.target.files?.[0])}
    />
    <div
      ref={containerRef}
      className="flex-1 overflow-auto bg-neutral-950 flex items-start justify-center p-8 select-none relative"
      style={{
        cursor: toolMode === 'hand' ? 'grab' : toolMode === 'select' || toolMode === 'edit_image' ? 'default' : 'crosshair'
      }}
    >
      {/* PDF Page Wrapper with accurate drop shadow */}
      <div
        className="relative bg-white pdf-page-shadow rounded-sm transition-shadow"
        style={{
          width: `${pageSize.width}px`,
          height: `${pageSize.height}px`
        }}
      >
        {/* PDF.js Render Canvas */}
        <canvas
          ref={canvasRef}
          className="absolute inset-0 pointer-events-none block"
        />

        {/* Open comment thread and the post-highlight "Comment" prompt (not clipped by the overlay) */}
        {renderCommentPopover()}
        {renderHighlightPrompt()}

        {/* Interactive Annotation Overlay */}
        <div
          ref={overlayRef}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onContextMenu={handleContextMenu}
          className="absolute inset-0 w-full h-full overflow-hidden"
        >
          {/* Live drawing preview: Pen */}
          {isDrawing && toolMode === 'pen' && currentPath.length > 1 && (
            <svg className="absolute inset-0 w-full h-full pointer-events-none">
              <polyline
                fill="none"
                stroke={activeColor}
                strokeWidth={strokeWidth}
                strokeLinecap="round"
                strokeLinejoin="round"
                points={currentPath
                  .map(p => `${(p.x / 100) * pageSize.width},${(p.y / 100) * pageSize.height}`)
                  .join(' ')}
              />
            </svg>
          )}

          {/* Live drawing preview: Highlight, Redact, Shape */}
          {isDrawing && dragStart && dragCurrent && (
            <div
              className={`absolute pointer-events-none border ${
                toolMode === 'highlight'
                  ? 'bg-amber-400/30 border-amber-500'
                  : toolMode === 'redact'
                  ? 'bg-black border-red-500'
                  : 'bg-transparent border-2 border-indigo-500'
              }`}
              style={{
                left: `${Math.min(dragStart.x, dragCurrent.x)}%`,
                top: `${Math.min(dragStart.y, dragCurrent.y)}%`,
                width: `${Math.abs(dragCurrent.x - dragStart.x)}%`,
                height: `${Math.abs(dragCurrent.y - dragStart.y)}%`,
                borderRadius: shapeType === 'circle' && toolMode === 'shape' ? '50%' : '0px'
              }}
            />
          )}

          {/* Search Matches Highlight Layer */}
          {searchMatches && searchMatches.length > 0 && searchMatches
            .filter(m => m.pageIndex === currentPage - 1)
            .map((m) => {
              const matchIdx = searchMatches.indexOf(m);
              const isCurrent = matchIdx === currentSearchMatchIndex;
              return (
                <div
                  key={m.id}
                  className={`absolute pointer-events-none rounded transition-all ${
                    isCurrent
                      ? 'bg-amber-400/60 ring-2 ring-amber-500 ring-offset-1 z-30 animate-pulse'
                      : 'bg-yellow-300/40 border-b-2 border-yellow-500 z-20'
                  }`}
                  style={{
                    left: `${m.xPct}%`,
                    top: `${m.yPct}%`,
                    width: `${m.widthPct}%`,
                    height: `${m.heightPct}%`
                  }}
                />
              );
            })}

          {/* Detected PDF Text Blocks for "Edit PDF Text" mode */}
          {textBlocks.filter((b) => b.pageIndex === currentPage - 1).map(renderTextBlock)}

          {/* Original PDF images (Edit images mode) */}
          {renderImageBoxes()}

          {/* Comment bubbles, anchor outline and live text selection */}
          {renderComments()}

          {/* Render all saved annotations for this page */}
          {pageAnnotations.map((ann) => {
            const isSelected = selectedAnnotationId === ann.id;

            // Comments are drawn as bubbles in their own layer (see renderComments)
            if (ann.type === 'note' || ann.type === 'image_flag') return null;

            // Deleted original image: covered on screen, removed from the file on save
            if (ann.type === 'image_removal') {
              return (
                <div
                  key={ann.id}
                  className="absolute pointer-events-none"
                  style={{
                    left: `${ann.x}%`,
                    top: `${ann.y}%`,
                    width: `${ann.width}%`,
                    height: `${ann.height}%`,
                    backgroundColor: ann.color || '#FFFFFF',
                    boxShadow: `0 0 0 1.5px ${ann.color || '#FFFFFF'}`,
                    zIndex: 5
                  }}
                />
              );
            }

            // Render Pen Drawings
            if (ann.type === 'pen' && ann.drawingPath) {
              const { points, color, width } = ann.drawingPath;
              return (
                <svg
                  key={ann.id}
                  onClick={(e) => {
                    e.stopPropagation();
                    onSelectAnnotation(ann.id);
                  }}
                  className={`absolute inset-0 w-full h-full cursor-pointer ${
                    isSelected ? 'filter drop-shadow(0 0 4px rgba(59,130,246,0.8))' : ''
                  }`}
                >
                  <polyline
                    fill="none"
                    stroke={color}
                    strokeWidth={width}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    points={points
                      .map(p => `${(p.x / 100) * pageSize.width},${(p.y / 100) * pageSize.height}`)
                      .join(' ')}
                  />
                </svg>
              );
            }

            // Render Text, Highlight, Redact, Signatures, Shapes
            return (
              <div
                key={ann.id}
                data-ann-id={ann.id}
                onMouseDown={(e) => handleElementMouseDown(e, ann)}
                onDoubleClick={() => {
                  if (ann.type === 'text') {
                    setEditingTextId(ann.id);
                    setEditingTextValue(ann.content || '');
                  }
                }}
                className={`absolute group transition-shadow ${ann.type === 'highlight' && ann.rects?.length ? 'cursor-pointer' : 'cursor-move'} ${
                  isSelected ? (ann.type === 'highlight' ? 'outline outline-1 outline-blue-500/70' : 'ring-2 ring-blue-500 ring-offset-1 shadow-lg') : ''
                }`}
                style={{
                  left: `${ann.x}%`,
                  top: `${ann.y}%`,
                  width: ann.width ? `${ann.width}%` : 'auto',
                  height: ann.height ? `${ann.height}%` : 'auto',
                  zIndex: isSelected ? 30 : 10
                }}
              >
                {/* Element Type Renderers */}
                {ann.type === 'highlight' &&
                  (ann.rects?.length ? (
                    ann.rects.map((r, i) => (
                      <div
                        key={i}
                        className="absolute rounded-[1px]"
                        style={{
                          left: `${((r.x - ann.x) / (ann.width || 1)) * 100}%`,
                          top: `${((r.y - ann.y) / (ann.height || 1)) * 100}%`,
                          width: `${(r.w / (ann.width || 1)) * 100}%`,
                          height: `${(r.h / (ann.height || 1)) * 100}%`,
                          backgroundColor: ann.color || '#FBBF24',
                          opacity: ann.opacity ?? 0.35,
                          mixBlendMode: 'multiply'
                        }}
                      />
                    ))
                  ) : (
                    <div
                      className="w-full h-full rounded-sm"
                      style={{ backgroundColor: ann.color || '#FBBF24', opacity: ann.opacity ?? 0.35, mixBlendMode: 'multiply' }}
                    />
                  ))}

                {ann.type === 'redact' && (
                  <div
                    className="w-full h-full flex items-center justify-center font-mono text-[9px] text-white tracking-widest uppercase"
                    style={{
                      backgroundColor: ann.color || '#000000'
                    }}
                  >
                    <span className="opacity-40">REDACTED</span>
                  </div>
                )}

                {ann.type === 'text' && (
                  <div className="w-full h-full p-1 bg-white/70 hover:bg-white rounded border border-transparent hover:border-neutral-300">
                    {editingTextId === ann.id ? (
                      <textarea
                        ref={textAreaRef}
                        value={editingTextValue}
                        onChange={(e) => setEditingTextValue(e.target.value)}
                        onSelect={() => setTaSelTick((t) => t + 1)}
                        onBlur={() => handleTextSave(ann.id)}
                        autoFocus
                        style={{
                          ...annTextStyle(ann),
                          fontSize: `${ann.fontSize || fontSize}px`,
                          color: ann.color || activeColor
                        }}
                        className="w-full h-full bg-transparent resize-none outline-none border border-blue-400 p-0.5 rounded leading-tight"
                      />
                    ) : (
                      <div
                        style={{
                          fontSize: `${ann.fontSize || 12}px`,
                          color: ann.color || '#1F2937',
                          ...annTextStyle(ann)
                        }}
                        className="whitespace-pre-wrap select-text leading-tight"
                      >
                        {ann.content || 'Sample text'}
                      </div>
                    )}
                  </div>
                )}

                {ann.type === 'shape' && (
                  <div
                    className="w-full h-full"
                    style={{
                      borderColor: ann.color || '#3B82F6',
                      borderWidth: '2px',
                      borderStyle: 'solid',
                      borderRadius: ann.shapeType === 'circle' ? '50%' : '0px'
                    }}
                  />
                )}

                {ann.type === 'image' && ann.imageData && (
                  <img
                    src={ann.imageData}
                    alt="Image"
                    draggable={false}
                    className="w-full h-full block pointer-events-none select-none"
                    style={{ objectFit: 'fill' }}
                  />
                )}

                {ann.type === 'signature' && ann.imageData && (
                  <div className="w-full h-full flex items-center justify-center bg-transparent">
                    <img
                      src={ann.imageData}
                      alt="Signature"
                      className="w-full h-full object-contain pointer-events-none"
                    />
                  </div>
                )}

                {ann.type === 'stamp' && ann.imageData && (
                  <div className="w-full h-full flex items-center justify-center">
                    <img
                      src={ann.imageData}
                      alt="Stamp"
                      className="w-full h-full object-contain pointer-events-none"
                    />
                  </div>
                )}

                {/* Selection Controls (Delete & Resize Handles) */}
                {isSelected && (
                  <>
                    {/* Delete button */}
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onDeleteAnnotation(ann.id);
                      }}
                      className="absolute -top-3 -right-3 w-6 h-6 rounded-full bg-red-600 text-white flex items-center justify-center shadow hover:bg-red-700 transition-colors z-40"
                      title="Delete Element (Del)"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>

                    {/* Resize Handle (Bottom-Right) */}
                    {!(ann.type === 'highlight' && ann.rects?.length) && (
                      <div
                        onMouseDown={(e) => handleResizeMouseDown(e, ann)}
                        className="absolute -bottom-1.5 -right-1.5 w-3.5 h-3.5 bg-blue-600 border border-white rounded-full cursor-se-resize shadow z-40 hover:scale-125 transition-transform"
                        title="Drag to resize"
                      />
                    )}
                  </>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
    </div>
  );
};
