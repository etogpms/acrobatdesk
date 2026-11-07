import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  ToolMode,
  AnnotationItem,
  DocumentMetadata,
  PageInfo,
  SavedSignature,
  ShapeType,
  OcrPageResult,
  PdfTextBlock,
  SearchMatch,
  SearchOptions,
  PageTool,
  PdfImageItem,
  TextToolStyle
} from './types/pdf';
import { PdfRendererService } from './services/pdfRenderer';
import { StorageService } from './services/storageService';
import { createSamplePdf } from './services/samplePdfs';
import { ocrService, OcrProgressState } from './services/ocrService';
import { PdfExportService } from './services/pdfExportService';

import * as PageOps from './services/pageOperations';
import { TopNav } from './components/TopNav';
import { ToolsPanel } from './components/ToolsPanel';
import { PageSidebar, SidebarTab } from './components/PageSidebar';
import { SplitModal, ExtractModal, InsertPdfModal, CombineModal, PageNumbersModal } from './components/PageToolsModals';
import { PdfCanvas } from './components/PdfCanvas';
import { SignatureModal } from './components/SignatureModal';
import { OcrPanel } from './components/OcrPanel';
import { AnnotationsPanel } from './components/AnnotationsPanel';
import { SampleDocsModal } from './components/SampleDocsModal';
import { DesktopStorageBanner } from './components/DesktopStorageBanner';
import { PageOrganizeModal } from './components/PageOrganizeModal';
import { ConversionModal } from './components/ConversionModal';
import { CommentsPanel } from './components/CommentsPanel';
import { importComments } from './services/commentsIO';
import { desktop, DesktopFile } from './services/desktop';
import { looksLikeSignature, readProtectSetting, writeProtectSetting } from './services/signatureProtection';
import { bboxClose, findMarkedSignatures } from './services/contentStreamEditor';

interface DocSnapshot {
  bytes: Uint8Array;
  pages: PageInfo[];
  annotations: AnnotationItem[];
  editedTextBlocks: PdfTextBlock[];
  ocrResultsByPage: Record<number, OcrPageResult>;
  currentPage: number;
}

export default function App() {
  // Document state
  const [currentPdfBytes, setCurrentPdfBytes] = useState<Uint8Array | null>(null);
  const [metadata, setMetadata] = useState<DocumentMetadata>({
    title: 'Master Services Agreement & NDA.pdf',
    fileName: 'Master Services Agreement & NDA.pdf',
    pageCount: 3,
    fileSizeBytes: 0,
    lastModified: Date.now(),
    isLocalDesktopFile: false,
    fileHandle: null
  });

  const [pages, setPages] = useState<PageInfo[]>([]);
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [scale, setScale] = useState<number>(1.0);
  const [isDirty, setIsDirty] = useState<boolean>(false);

  // Active Tooling
  const [toolMode, setToolMode] = useState<ToolMode>('select');
  const [activeColor, setActiveColor] = useState<string>('#FBBF24');
  const [strokeWidth, setStrokeWidth] = useState<number>(2);
  const [fontSize, setFontSize] = useState<number>(14);
  const [textStyle, setTextStyle] = useState<TextToolStyle>({ fontChoice: 'auto', bold: false, italic: false });
  const [shapeType, setShapeType] = useState<ShapeType>('rectangle');

  // Annotations & History (Undo/Redo)
  const [annotations, setAnnotations] = useState<AnnotationItem[]>([]);
  const [history, setHistory] = useState<AnnotationItem[][]>([]);
  const [historyIndex, setHistoryIndex] = useState<number>(-1);
  const [selectedAnnotationId, setSelectedAnnotationId] = useState<string | null>(null);

  // Signatures
  const [savedSignatures, setSavedSignatures] = useState<SavedSignature[]>([]);
  const [activeSignatureDataUrl, setActiveSignatureDataUrl] = useState<string | null>(null);

  // OCR state
  const [ocrResultsByPage, setOcrResultsByPage] = useState<Record<number, OcrPageResult>>({});
  const [isRunningOcr, setIsRunningOcr] = useState<boolean>(false);
  const [ocrProgress, setOcrProgress] = useState<OcrProgressState | null>(null);

  // Sidebar & Modals
  const [isSidebarOpen, setIsSidebarOpen] = useState<boolean>(true);
  const [activeRightPanel, setActiveRightPanel] = useState<'none' | 'ocr' | 'annotations' | 'comments'>('none');

  // Signature copy protection (on unless the user turns it off)
  const [protectSignatures, setProtectSignatures] = useState<boolean>(readProtectSetting);
  const toggleProtectSignatures = () => {
    setProtectSignatures((on) => {
      writeProtectSetting(!on);
      return !on;
    });
  };

  // Comments
  const [activeCommentId, setActiveCommentId] = useState<string | null>(null);
  const [authorName, setAuthorName] = useState<string>(() => {
    try {
      return localStorage.getItem('acrobatdesk.author') || 'Me';
    } catch {
      return 'Me';
    }
  });
  const updateAuthorName = (name: string) => {
    setAuthorName(name);
    try {
      localStorage.setItem('acrobatdesk.author', name);
    } catch {
      /* storage unavailable */
    }
  };
  const [isSignatureModalOpen, setIsSignatureModalOpen] = useState<boolean>(false);
  const [isSampleModalOpen, setIsSampleModalOpen] = useState<boolean>(false);
  const [isStorageInfoOpen, setIsStorageInfoOpen] = useState<boolean>(false);
  const [isConversionModalOpen, setIsConversionModalOpen] = useState<boolean>(false);
  const [saveSuccessNotification, setSaveSuccessNotification] = useState<string | null>(null);

  // Search in Document state
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [searchOptions, setSearchOptions] = useState<SearchOptions>({ matchCase: false, wholeWord: false });
  const [searchMatches, setSearchMatches] = useState<SearchMatch[]>([]);
  const [currentSearchMatchIndex, setCurrentSearchMatchIndex] = useState<number>(-1);
  const [isSearching, setIsSearching] = useState<boolean>(false);

  // Original PDF Text Blocks for "Edit PDF Text" mode
  const [editedTextBlocks, setEditedTextBlocks] = useState<PdfTextBlock[]>([]);

  // Images found on each page (re-detected whenever the document bytes change)
  const [pageImages, setPageImages] = useState<{ bytes: Uint8Array | null; byPage: Record<number, PdfImageItem[]> }>({ bytes: null, byPage: {} });
  const [insertImageToken, setInsertImageToken] = useState(0);

  // Page tools
  const [sidebarTab, setSidebarTab] = useState<SidebarTab>('pages');
  const [searchFocusToken, setSearchFocusToken] = useState(0);
  const [pageSelection, setPageSelection] = useState<number[]>([]);
  const [activePageTool, setActivePageTool] = useState<PageTool | null>(null);
  const [extractInitialPages, setExtractInitialPages] = useState<number[]>([]);
  const [isPageOpBusy, setIsPageOpBusy] = useState(false);
  const [pageUndo, setPageUndo] = useState<{ label: string; snapshot: DocSnapshot } | null>(null);
  const docGenerationRef = useRef(0);

  // PDF Renderer Instance
  const rendererRef = useRef<PdfRendererService>(new PdfRendererService());

  // Push state to Undo History
  const pushHistory = useCallback((newAnnotations: AnnotationItem[]) => {
    setHistory((prev) => {
      const upToCurrent = prev.slice(0, historyIndex + 1);
      return [...upToCurrent, newAnnotations];
    });
    setHistoryIndex((prev) => prev + 1);
    setIsDirty(true);
  }, [historyIndex]);

  // Undo
  const handleUndo = useCallback(() => {
    if (historyIndex > 0) {
      const newIndex = historyIndex - 1;
      setHistoryIndex(newIndex);
      setAnnotations(history[newIndex]);
    } else if (historyIndex === 0) {
      setHistoryIndex(-1);
      setAnnotations([]);
    }
  }, [history, historyIndex]);

  // Redo
  const handleRedo = useCallback(() => {
    if (historyIndex < history.length - 1) {
      const newIndex = historyIndex + 1;
      setHistoryIndex(newIndex);
      setAnnotations(history[newIndex]);
    }
  }, [history, historyIndex]);

  // Load Saved Signatures on Mount
  useEffect(() => {
    setSavedSignatures(StorageService.getSavedSignatures());
  }, []);

  // Initialize or Load Default Sample PDF
  const loadPdfData = async (
    bytes: Uint8Array,
    fileName: string,
    handle: FileSystemFileHandle | null = null,
    isLocal: boolean = false
  ) => {
    try {
      // Existing comments/highlights in the PDF become editable threads (and leave the working copy,
      // so they are not drawn twice). They are written back as PDF annotations on save.
      let imported: AnnotationItem[] = [];
      try {
        const res = await importComments(bytes);
        if (res) {
          bytes = res.bytes;
          imported = res.annotations;
        }
      } catch (err) {
        console.warn('Could not read comments from PDF:', err);
      }
      const numPages = await rendererRef.current.loadDocument(bytes);
      docGenerationRef.current++;
      setCurrentPdfBytes(bytes);

      // Generate initial PageInfo array
      const pageList: PageInfo[] = [];
      for (let i = 0; i < numPages; i++) {
        pageList.push({
          pageIndex: i,
          rotation: 0,
          width: 595,
          height: 842
        });
      }
      setPages(pageList);
      setCurrentPage(1);

      // Update metadata
      const newMeta: DocumentMetadata = {
        title: fileName,
        fileName,
        pageCount: numPages,
        fileSizeBytes: bytes.byteLength,
        lastModified: Date.now(),
        isLocalDesktopFile: isLocal,
        fileHandle: handle
      };
      setMetadata(newMeta);
      setAnnotations(imported);
      setHistory(imported.length ? [imported] : []);
      setHistoryIndex(imported.length ? 0 : -1);
      setActiveCommentId(null);
      setOcrResultsByPage({});
      setEditedTextBlocks([]);
      setSearchMatches([]);
      setCurrentSearchMatchIndex(-1);
      setIsDirty(false);

      // Record in local recent files
      StorageService.addRecentFile({
        id: `file-${Date.now()}`,
        fileName,
        pageCount: numPages,
        fileSizeBytes: bytes.byteLength,
        lastOpened: Date.now()
      });

      setPageSelection([]);
      setPageUndo(null);
      refreshThumbnails(PageOps.range(numPages));
    } catch (err) {
      console.error('Failed to load PDF document:', err);
      alert('Could not render PDF document. Please verify it is a valid PDF.');
    }
  };

  // Search in Document Runner
  useEffect(() => {
    let isCancelled = false;
    const runSearch = async () => {
      if (!searchQuery.trim()) {
        setSearchMatches([]);
        setCurrentSearchMatchIndex(-1);
        return;
      }
      setIsSearching(true);
      try {
        const results = await rendererRef.current.searchDocument(searchQuery, searchOptions);
        if (!isCancelled) {
          setSearchMatches(results);
          if (results.length > 0) {
            setCurrentSearchMatchIndex(0);
            setCurrentPage(results[0].pageIndex + 1);
          } else {
            setCurrentSearchMatchIndex(-1);
          }
        }
      } catch (err) {
        console.warn('Search error:', err);
      } finally {
        if (!isCancelled) setIsSearching(false);
      }
    };

    const timer = setTimeout(runSearch, 150);
    return () => {
      isCancelled = true;
      clearTimeout(timer);
    };
  }, [searchQuery, searchOptions, currentPdfBytes]);

  const handleNextMatch = () => {
    if (searchMatches.length === 0) return;
    const nextIdx = (currentSearchMatchIndex + 1) % searchMatches.length;
    setCurrentSearchMatchIndex(nextIdx);
    setCurrentPage(searchMatches[nextIdx].pageIndex + 1);
  };

  const handleSelectMatch = (idx: number) => {
    if (!searchMatches[idx]) return;
    setCurrentSearchMatchIndex(idx);
    setCurrentPage(searchMatches[idx].pageIndex + 1);
  };

  const openSearch = () => {
    setIsSidebarOpen(true);
    setSidebarTab('search');
    setSearchFocusToken((t) => t + 1);
  };

  const handlePrevMatch = () => {
    if (searchMatches.length === 0) return;
    const prevIdx = (currentSearchMatchIndex - 1 + searchMatches.length) % searchMatches.length;
    setCurrentSearchMatchIndex(prevIdx);
    setCurrentPage(searchMatches[prevIdx].pageIndex + 1);
  };

  // Text Blocks Extraction for "Edit PDF Text" mode
  useEffect(() => {
    const fetchBlocks = async () => {
      if (rendererRef.current.getNumPages() === 0) return;
      const hasBlocks = editedTextBlocks.some((b) => b.pageIndex === currentPage - 1);
      if (!hasBlocks) {
        try {
          const blocks = await rendererRef.current.extractPageTextBlocks(currentPage);
          setEditedTextBlocks((prev) => [...prev, ...blocks]);
        } catch (e) {
          console.warn('Could not extract text blocks for page:', e);
        }
      }
    };
    fetchBlocks();
  }, [currentPage, currentPdfBytes]);

  // Image detection for "Edit images"
  useEffect(() => {
    let cancelled = false;
    const bytes = currentPdfBytes;
    const idx = currentPage - 1;
    if (!bytes || rendererRef.current.getNumPages() === 0) return;
    if (pageImages.bytes === bytes && pageImages.byPage[idx]) return;
    rendererRef.current
      .extractPageImages(currentPage)
      .then(async (items) => {
        if (cancelled) return;
        const publish = (list: PdfImageItem[]) =>
          setPageImages((prev) => ({
            bytes,
            byPage: { ...(prev.bytes === bytes ? prev.byPage : {}), [idx]: list }
          }));
        publish(items);
        // Which of these are signatures? Tagged in the file, or looking like handwritten ink
        const marked = await findMarkedSignatures(bytes, idx);
        let flagged = items.map((it) => ({ ...it, signatureMarked: marked.some((m) => bboxClose(m, it.bboxUser)) }));
        flagged = await Promise.all(
          flagged.map(async (it) => {
            if (it.signatureMarked) return it;
            try {
              const url = await rendererRef.current.getImageDataUrl(it);
              return { ...it, signatureLikely: await looksLikeSignature(url, it) };
            } catch {
              return it;
            }
          })
        );
        if (!cancelled) publish(flagged);
      })
      .catch((e) => console.warn('Could not detect images on page:', e));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentPage, currentPdfBytes]);

  const handleUpdateTextBlock = (updatedBlock: PdfTextBlock) => {
    setEditedTextBlocks((prev) =>
      prev.map((b) => (b.id === updatedBlock.id ? updatedBlock : b))
    );
    setIsDirty(true);
  };

  // Mount: Initial document load
  useEffect(() => {
    const init = async () => {
      // Desktop app launched by opening a PDF (double-click / "Open with")
      if (desktop) {
        const [file] = await desktop.takePendingFiles();
        if (file) {
          await loadPdfData(new Uint8Array(file.bytes), file.name, { kind: 'desktop', path: file.path, name: file.name } as unknown as FileSystemFileHandle, true);
          return;
        }
      }
      // Check for saved local draft
      const draft = await StorageService.loadDraft('current_session');
      if (draft && draft.bytes) {
        await loadPdfData(draft.bytes, draft.fileName);
        if (draft.annotations && draft.annotations.length > 0) {
          setAnnotations(draft.annotations);
          setHistory([draft.annotations]);
          setHistoryIndex(0);
        }
      } else {
        // Generate default sample contract
        const { bytes, fileName } = await createSamplePdf('contract');
        await loadPdfData(bytes, fileName);
      }
    };
    init();

    return () => {
      rendererRef.current.destroy();
      ocrService.terminate();
    };
  }, []);

  // Autosave Draft to Local IndexedDB (Zero Cloud)
  useEffect(() => {
    if (currentPdfBytes && isDirty) {
      StorageService.saveDraft('current_session', metadata.fileName, currentPdfBytes, annotations);
    }
  }, [annotations, currentPdfBytes, isDirty, metadata.fileName]);

  // Open PDF from User's Desktop
  const handleOpenDesktopPdf = async () => {
    try {
      const { file, handle, bytes } = await StorageService.openDesktopFile();
      await loadPdfData(bytes, file.name, handle, true);
    } catch (err: any) {
      if (err.name !== 'AbortError') {
        console.error('Open file error:', err);
      }
    }
  };

  // Save changes directly back to Desktop File Handle (Ctrl+S)
  const handleSaveFile = async () => {
    if (!currentPdfBytes) return;

    try {
      // Bake all current annotations, signatures, page rotations, and edited text blocks into new PDF bytes
      // Keep the editable source bytes as the working copy; only the saved file gets the baked result
      const bakedBytes = await PdfExportService.bakeAndExportPdf(currentPdfBytes, annotations, pages, editedTextBlocks);

      if (metadata.fileHandle) {
        // Direct desktop write
        const ok = await StorageService.saveToOriginalDesktopFile(metadata.fileHandle, bakedBytes);
        if (ok) {
          setIsDirty(false);
          triggerSaveNotice(`Saved directly to desktop file "${metadata.fileName}"!`);
          return;
        }
      }

      // If no file handle (e.g. sample or browser input), prompt Save As
      const handle = await StorageService.saveAsDesktopFile(bakedBytes, metadata.fileName);
      if (handle) {
        setMetadata((prev) => ({ ...prev, fileHandle: handle, isLocalDesktopFile: true, fileName: handle.name || prev.fileName, title: handle.name || prev.title }));
        setIsDirty(false);
        triggerSaveNotice(`Saved to desktop: "${metadata.fileName}"`);
      }
    } catch (err) {
      console.error('Save failed:', err);
      alert('Could not save PDF to desktop.');
    }
  };

  // Save As to selected desktop folder
  const handleSaveAsFile = async () => {
    if (!currentPdfBytes) return;
    try {
      const bakedBytes = await PdfExportService.bakeAndExportPdf(currentPdfBytes, annotations, pages, editedTextBlocks);
      const handle = await StorageService.saveAsDesktopFile(bakedBytes, metadata.fileName);
      if (handle) {
        setMetadata((prev) => ({ ...prev, fileHandle: handle, isLocalDesktopFile: true, fileName: handle.name || prev.fileName, title: handle.name || prev.title }));
        setIsDirty(false);
        triggerSaveNotice(`Saved to desktop: "${metadata.fileName}"`);
      }
    } catch (err) {
      console.error('Save As error:', err);
    }
  };

  // Direct Local Download
  const handleDownloadCopy = async () => {
    if (!currentPdfBytes) return;
    const bakedBytes = await PdfExportService.bakeAndExportPdf(currentPdfBytes, annotations, pages, editedTextBlocks);
    StorageService.downloadLocally(bakedBytes, metadata.fileName);
    triggerSaveNotice(`Downloaded local copy of "${metadata.fileName}"`);
  };

  const triggerSaveNotice = (msg: string) => {
    setSaveSuccessNotification(msg);
    setTimeout(() => setSaveSuccessNotification(null), 3500);
  };

  // Load a Pre-Built Sample
  const handleSelectSample = async (sampleId: string) => {
    const { bytes, fileName } = await createSamplePdf(sampleId);
    await loadPdfData(bytes, fileName, null, false);
    if (sampleId === 'scanned_ocr') {
      setActiveRightPanel('ocr');
    }
  };

  // Annotation Handlers
  const handleAddAnnotation = (ann: AnnotationItem) => {
    const updated = [...annotations, ann];
    setAnnotations(updated);
    pushHistory(updated);
  };

  const handleAddAnnotations = (list: AnnotationItem[]) => {
    const updated = [...annotations, ...list];
    setAnnotations(updated);
    pushHistory(updated);
  };

  const handleUpdateAnnotation = (ann: AnnotationItem) => {
    const updated = annotations.map((a) => (a.id === ann.id ? ann : a));
    setAnnotations(updated);
    pushHistory(updated);
  };

  const handleDeleteAnnotation = (id: string) => {
    // Comments attached to the deleted item go with it
    const updated = annotations.filter((a) => a.id !== id && !(a.type === 'note' && a.anchor?.kind === 'annotation' && a.anchor.id === id));
    if (activeCommentId === id) setActiveCommentId(null);
    setAnnotations(updated);
    pushHistory(updated);
    if (selectedAnnotationId === id) setSelectedAnnotationId(null);
  };

  // Quick Stamp/Sign elements (Check, Cross, Date, Stamp)
  const handlePlaceQuickElement = (type: 'check' | 'cross' | 'date' | 'stamp', stampText?: string) => {
    if (type === 'check') {
      handleAddAnnotation({
        id: `check-${Date.now()}`,
        pageIndex: currentPage - 1,
        type: 'text',
        x: 45,
        y: 45,
        width: 6,
        height: 4,
        content: '✓',
        fontSize: 24,
        color: '#10B981',
        isBold: true,
        createdAt: Date.now()
      });
    } else if (type === 'cross') {
      handleAddAnnotation({
        id: `cross-${Date.now()}`,
        pageIndex: currentPage - 1,
        type: 'text',
        x: 45,
        y: 45,
        width: 6,
        height: 4,
        content: '✗',
        fontSize: 24,
        color: '#EF4444',
        isBold: true,
        createdAt: Date.now()
      });
    } else if (type === 'date') {
      const todayStr = new Date().toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric'
      });
      handleAddAnnotation({
        id: `date-${Date.now()}`,
        pageIndex: currentPage - 1,
        type: 'text',
        x: 40,
        y: 45,
        width: 18,
        height: 4,
        content: todayStr,
        fontSize: 12,
        color: '#1E293B',
        createdAt: Date.now()
      });
    } else if (type === 'stamp' && stampText) {
      // Create SVG stamp canvas
      const canvas = document.createElement('canvas');
      canvas.width = 240;
      canvas.height = 80;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.strokeStyle = stampText === 'APPROVED' ? '#16A34A' : stampText === 'CONFIDENTIAL' ? '#DC2626' : '#2563EB';
        ctx.lineWidth = 4;
        ctx.strokeRect(6, 6, 228, 68);
        ctx.fillStyle = ctx.strokeStyle;
        ctx.font = 'bold 22px Helvetica, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(stampText, 120, 40);

        handleAddAnnotation({
          id: `stamp-${Date.now()}`,
          pageIndex: currentPage - 1,
          type: 'stamp',
          x: 35,
          y: 40,
          width: 25,
          height: 8,
          imageData: canvas.toDataURL('image/png'),
          createdAt: Date.now()
        });
      }
    }
  };

  // OCR Recognition Runner
  const handleRunOcrCurrentPage = async () => {
    setIsRunningOcr(true);
    setOcrProgress({ status: 'Rendering high-resolution page image...', progress: 0.1, pageIndex: currentPage - 1 });
    try {
      const currentRotation = pages[currentPage - 1]?.rotation || 0;
      const pageImageDataUrl = await rendererRef.current.getPageImageForOcr(currentPage, currentRotation);

      const result = await ocrService.recognizeImage(
        pageImageDataUrl,
        currentPage - 1,
        (progressState) => setOcrProgress(progressState)
      );

      setOcrResultsByPage((prev) => ({
        ...prev,
        [currentPage - 1]: result
      }));
    } catch (err: any) {
      console.error('OCR Error:', err);
      alert(`OCR Recognition note: ${err.message || 'Error executing OCR'}`);
    } finally {
      setIsRunningOcr(false);
      setOcrProgress(null);
    }
  };

  const handleRunOcrAllPages = async () => {
    setIsRunningOcr(true);
    try {
      for (let p = 1; p <= pages.length; p++) {
        setOcrProgress({ status: `Processing Page ${p} of ${pages.length}...`, progress: (p - 1) / pages.length, pageIndex: p - 1 });
        const rot = pages[p - 1]?.rotation || 0;
        const pageImg = await rendererRef.current.getPageImageForOcr(p, rot);
        const res = await ocrService.recognizeImage(pageImg, p - 1, (prog) => {
          setOcrProgress({
            ...prog,
            progress: (p - 1) / pages.length + (prog.progress / pages.length)
          });
        });
        setOcrResultsByPage((prev) => ({ ...prev, [p - 1]: res }));
      }
    } catch (err: any) {
      console.error('OCR All error:', err);
    } finally {
      setIsRunningOcr(false);
      setOcrProgress(null);
    }
  };

  // ---------------- Page operations (applied to the real PDF bytes) ----------------

  const refreshThumbnails = (indices: number[]) => {
    const gen = docGenerationRef.current;
    setTimeout(async () => {
      for (const idx of indices) {
        if (gen !== docGenerationRef.current) return; // a newer document replaced this one
        const thumb = await rendererRef.current.renderThumbnail(idx + 1, 180, 0);
        if (gen !== docGenerationRef.current) return;
        setPages((curr) => curr.map((p, i) => (i === idx ? { ...p, thumbnailUrl: thumb } : p)));
      }
    }, 30);
  };

  const takeSnapshot = (): DocSnapshot | null =>
    currentPdfBytes
      ? { bytes: currentPdfBytes, pages, annotations, editedTextBlocks, ocrResultsByPage, currentPage }
      : null;

  const restoreSnapshot = async (snap: DocSnapshot) => {
    await rendererRef.current.loadDocument(snap.bytes);
    docGenerationRef.current++;
    setCurrentPdfBytes(snap.bytes);
    setPages(snap.pages);
    setAnnotations(snap.annotations);
    setHistory(snap.annotations.length ? [snap.annotations] : []);
    setHistoryIndex(snap.annotations.length ? 0 : -1);
    setEditedTextBlocks(snap.editedTextBlocks);
    setOcrResultsByPage(snap.ocrResultsByPage);
    setMetadata((prev) => ({ ...prev, pageCount: snap.pages.length }));
    setCurrentPage(Math.min(snap.currentPage, snap.pages.length));
    setPageSelection([]);
    setIsDirty(true);
  };

  /**
   * Load restructured bytes and carry annotations, edited text and OCR along with their pages.
   * `changed` lists new-page indices whose content changed and need fresh thumbnails.
   */
  const applyStructural = async (
    result: PageOps.StructuralResult,
    opts: { label: string; nextPage?: number; changed?: number[] }
  ) => {
    const snapshot = takeSnapshot();
    const { bytes, mapping } = result;

    const remap = <T extends { pageIndex: number; id: string }>(items: T[]): T[] => {
      const out: T[] = [];
      const used = new Map<number, number>();
      mapping.forEach((oldIdx, newIdx) => {
        if (oldIdx === null) return;
        const n = used.get(oldIdx) || 0;
        used.set(oldIdx, n + 1);
        items
          .filter((a) => a.pageIndex === oldIdx)
          .forEach((a) => out.push({ ...a, pageIndex: newIdx, id: n === 0 ? a.id : `${a.id}-copy${newIdx}` }));
      });
      return out;
    };

    const remapped = remap(annotations);
    const newAnnotations = remapped.map((a) => {
      if (a.type !== 'note' || a.anchor?.kind !== 'annotation') return a;
      const anchorId = a.anchor.id;
      if (remapped.some((t) => t.id === anchorId && t.pageIndex === a.pageIndex)) return a;
      const copy = remapped.find((t) => t.pageIndex === a.pageIndex && t.id.startsWith(anchorId + '-copy'));
      return copy ? { ...a, anchor: { kind: 'annotation' as const, id: copy.id } } : a;
    });
    const newBlocks = remap(editedTextBlocks);
    const newOcr: Record<number, OcrPageResult> = {};
    mapping.forEach((oldIdx, newIdx) => {
      if (oldIdx !== null && ocrResultsByPage[oldIdx]) newOcr[newIdx] = { ...ocrResultsByPage[oldIdx], pageIndex: newIdx };
    });
    const changed = new Set(opts.changed || []);
    const newPages: PageInfo[] = mapping.map((oldIdx, newIdx) => ({
      pageIndex: newIdx,
      rotation: 0,
      width: 595,
      height: 842,
      thumbnailUrl: oldIdx !== null && !changed.has(newIdx) ? pages[oldIdx]?.thumbnailUrl : undefined
    }));

    await rendererRef.current.loadDocument(bytes);
    docGenerationRef.current++;
    setCurrentPdfBytes(bytes);
    setPages(newPages);
    setAnnotations(newAnnotations);
    setHistory(newAnnotations.length ? [newAnnotations] : []);
    setHistoryIndex(newAnnotations.length ? 0 : -1);
    setEditedTextBlocks(newBlocks);
    setOcrResultsByPage(newOcr);
    setSelectedAnnotationId(null);
    setMetadata((prev) => ({ ...prev, pageCount: newPages.length, fileSizeBytes: bytes.byteLength }));
    setCurrentPage(Math.min(Math.max(opts.nextPage ?? currentPage, 1), newPages.length));
    setIsDirty(true);
    refreshThumbnails(newPages.map((p, i) => i).filter((i) => !newPages[i].thumbnailUrl));
    if (snapshot) setPageUndo({ label: opts.label, snapshot });
  };

  const runPageOp = async (fn: () => Promise<void>) => {
    if (!currentPdfBytes || isPageOpBusy) return;
    setIsPageOpBusy(true);
    try {
      await fn();
    } catch (err: any) {
      console.error('Page operation failed:', err);
      alert(err?.message || 'The page operation could not be completed.');
    } finally {
      setIsPageOpBusy(false);
    }
  };

  /** The current document with all edits baked in (for extract / split / combine outputs). */
  const getBakedBytes = () => PdfExportService.bakeAndExportPdf(currentPdfBytes!, annotations, pages, editedTextBlocks);

  const confirmReplaceDocument = () =>
    !isDirty || window.confirm('Opening the result replaces the current document in the editor. Unsaved changes stay in your autosaved draft only until another document is opened. Continue?');

  const baseName = metadata.fileName.replace(/\.pdf$/i, '');

  const handleRotatePages = (indices: number[], delta: number) =>
    runPageOp(async () => {
      const res = await PageOps.rotatePages(currentPdfBytes!, indices, delta);
      await applyStructural(res, { label: `Rotated ${indices.length} page(s)`, changed: indices });
    });

  const handleDeletePages = (indices: number[]) =>
    runPageOp(async () => {
      const res = await PageOps.deletePages(currentPdfBytes!, indices);
      const before = indices.filter((i) => i < currentPage - 1).length;
      await applyStructural(res, { label: `Deleted ${indices.length} page(s)`, nextPage: currentPage - before });
      setPageSelection([]);
    });

  const handleDuplicatePages = (indices: number[]) =>
    runPageOp(async () => {
      const res = await PageOps.duplicatePages(currentPdfBytes!, indices);
      await applyStructural(res, { label: `Duplicated ${indices.length} page(s)` });
      setPageSelection([]);
    });

  const handleReorderPages = (order: number[]) =>
    runPageOp(async () => {
      const res = await PageOps.reorderPages(currentPdfBytes!, order);
      const newCurrent = order.indexOf(currentPage - 1) + 1;
      await applyStructural(res, { label: 'Reordered pages', nextPage: newCurrent || 1 });
      setPageSelection([]);
    });

  const handleInsertBlankPage = (atIndex: number = pages.length) =>
    runPageOp(async () => {
      const res = await PageOps.insertBlankPage(currentPdfBytes!, atIndex);
      await applyStructural(res, { label: 'Inserted blank page', nextPage: atIndex + 1 });
    });

  const handleInsertPdf = (other: Uint8Array, atIndex: number, otherPages: number[] | undefined, name: string) =>
    runPageOp(async () => {
      const res = await PageOps.insertPdf(currentPdfBytes!, other, atIndex, otherPages);
      await applyStructural(res, { label: `Merged pages from "${name}"`, nextPage: atIndex + 1 });
      setActivePageTool(null);
    });

  const handleAddPageNumbers = (opts: PageOps.PageNumberOptions) =>
    runPageOp(async () => {
      const res = await PageOps.addPageNumbers(currentPdfBytes!, opts);
      await applyStructural(res, { label: 'Added page numbers', changed: opts.pages });
      setActivePageTool(null);
    });

  const openExtract = (indices: number[]) => {
    setExtractInitialPages(indices.length ? indices : [currentPage - 1]);
    setActivePageTool('extract');
  };

  const handleExtract = (indices: number[], opts: { removeFromDocument: boolean; openInEditor: boolean }) =>
    runPageOp(async () => {
      const baked = await getBakedBytes();
      const out = await PageOps.extractPages(baked, indices);
      const name = `${baseName}_pages_${PageOps.formatPageRanges(indices).replace(/\s/g, '')}.pdf`;
      setActivePageTool(null);
      if (opts.openInEditor) {
        if (!confirmReplaceDocument()) return;
        await loadPdfData(out, name, null, false);
        triggerSaveNotice(`Opened extracted pages as "${name}"`);
        return;
      }
      StorageService.downloadLocally(out, name);
      if (opts.removeFromDocument) {
        const res = await PageOps.deletePages(currentPdfBytes!, indices);
        await applyStructural(res, { label: `Extracted & removed ${indices.length} page(s)`, nextPage: 1 });
      }
      triggerSaveNotice(`Extracted ${indices.length} page(s) to "${name}"`);
    });

  const handleSplit = (groups: number[][], prefix: string) =>
    runPageOp(async () => {
      const baked = await getBakedBytes();
      const parts = await PageOps.splitPdf(baked, groups);
      const files = parts.map((bytes, i) => ({ name: `${prefix}_part${i + 1}.pdf`, bytes }));
      const saved = await saveManyFiles(files);
      setActivePageTool(null);
      if (saved) triggerSaveNotice(`Split into ${files.length} files`);
    });

  const handleCombine = (items: Array<{ bytes: Uint8Array | null }>, name: string, openInEditor: boolean) =>
    runPageOp(async () => {
      const needsCurrent = items.some((it) => it.bytes === null);
      const current = needsCurrent ? await getBakedBytes() : null;
      const out = await PageOps.combinePdfs(items.map((it) => ({ bytes: it.bytes ?? current! })));
      setActivePageTool(null);
      if (openInEditor) {
        if (!confirmReplaceDocument()) return;
        await loadPdfData(out, name, null, false);
        triggerSaveNotice(`Combined ${items.length} files into "${name}"`);
      } else {
        StorageService.downloadLocally(out, name);
        triggerSaveNotice(`Downloaded "${name}"`);
      }
    });

  /** Save several files: into a folder the user picks when supported, otherwise as downloads. */
  const saveManyFiles = async (files: Array<{ name: string; bytes: Uint8Array }>): Promise<boolean> => {
    if (desktop) return desktop.saveToFolder(files);
    const picker = (window as any).showDirectoryPicker;
    if (typeof picker === 'function') {
      try {
        const dir = await picker({ mode: 'readwrite' });
        for (const f of files) {
          const handle = await dir.getFileHandle(f.name, { create: true });
          const writable = await handle.createWritable();
          await writable.write(f.bytes);
          await writable.close();
        }
        return true;
      } catch (err: any) {
        if (err?.name === 'AbortError') return false;
        console.warn('Folder save unavailable, falling back to downloads', err);
      }
    }
    for (const f of files) {
      StorageService.downloadLocally(f.bytes, f.name);
      await new Promise((r) => setTimeout(r, 350));
    }
    return true;
  };

  const handleOpenPageTool = (tool: PageTool) => {
    if (tool === 'extract') openExtract(pageSelection);
    else setActivePageTool(tool);
  };

  // Keyboard Shortcuts (Ctrl+S, Ctrl+Z, Ctrl+Y, Zoom)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      const typing = !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
      // While typing, undo/redo belong to the text box, not to the document
      if (typing && (e.ctrlKey || e.metaKey) && (e.key === 'z' || e.key === 'y')) return;
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        handleSaveFile();
      } else if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
        e.preventDefault();
        if (e.shiftKey) {
          handleRedo();
        } else {
          handleUndo();
        }
      } else if ((e.ctrlKey || e.metaKey) && e.key === 'y') {
        e.preventDefault();
        handleRedo();
      } else if ((e.ctrlKey || e.metaKey) && e.key === 'o') {
        e.preventDefault();
        handleOpenDesktopPdf();
      } else if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
        e.preventDefault();
        openSearch();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleSaveFile, handleUndo, handleRedo]);

  // ---------------- Desktop app integration ----------------

  // Latest handlers for menu commands (the listener is registered once)
  const menuActionsRef = useRef<Record<string, () => void>>({});
  menuActionsRef.current = {
    open: handleOpenDesktopPdf,
    save: handleSaveFile,
    saveAs: handleSaveAsFile,
    find: openSearch,
    zoomIn: () => setScale((s) => Math.min(s + 0.15, 3.0)),
    zoomOut: () => setScale((s) => Math.max(s - 0.15, 0.4)),
    zoomReset: () => setScale(1.0),
    undo: () => {
      const el = document.activeElement as HTMLElement | null;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) document.execCommand('undo');
      else handleUndo();
    },
    redo: () => {
      const el = document.activeElement as HTMLElement | null;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) document.execCommand('redo');
      else handleRedo();
    }
  };
  const openDesktopFileRef = useRef<(f: DesktopFile) => void>(() => {});
  openDesktopFileRef.current = (f: DesktopFile) => {
    if (isDirty && !window.confirm(`Open "${f.name}"? Unsaved changes in the current document will be replaced (they remain in the autosaved draft).`)) return;
    loadPdfData(new Uint8Array(f.bytes), f.name, { kind: 'desktop', path: f.path, name: f.name } as unknown as FileSystemFileHandle, true);
  };

  useEffect(() => {
    if (!desktop) return;
    const offMenu = desktop.onMenu((cmd) => menuActionsRef.current[cmd]?.());
    const offOpen = desktop.onOpenFile((f) => openDesktopFileRef.current(f));
    return () => {
      offMenu();
      offOpen();
    };
  }, []);

  // Window title (and the unsaved-changes dot / close warning in the desktop app)
  useEffect(() => {
    document.title = `${metadata.fileName}${isDirty ? ' •' : ''} — AcrobatDesk`;
    desktop?.setDocumentState({ dirty: isDirty });
  }, [metadata.fileName, isDirty]);

  // Aggregate annotations count per page
  const annotationsCountByPage = annotations.reduce<Record<number, number>>((acc, ann) => {
    acc[ann.pageIndex] = (acc[ann.pageIndex] || 0) + 1;
    return acc;
  }, {});

  // Rotation is written into the PDF itself, so the canvas needs no extra rotation
  const currentPageRotation = 0;

  // Active OCR result for current page
  const currentOcrResult = ocrResultsByPage[currentPage - 1] || null;

  return (
    <div className="flex flex-col h-screen w-screen overflow-hidden bg-neutral-900 text-neutral-100 select-none">
      {/* Top Application Bar (3-zone Acrobat Contract) */}
      <TopNav
        metadata={metadata}
        currentPage={currentPage}
        totalPages={pages.length}
        scale={scale}
        canUndo={historyIndex >= 0}
        canRedo={historyIndex < history.length - 1}
        isDirty={isDirty}
        isSearchOpen={isSidebarOpen && sidebarTab === 'search'}
        onToggleSearch={() => (isSidebarOpen && sidebarTab === 'search' ? setSidebarTab('pages') : openSearch())}
        onPageChange={(p) => setCurrentPage(Math.min(Math.max(p, 1), pages.length))}
        onZoomIn={() => setScale((s) => Math.min(s + 0.15, 3.0))}
        onZoomOut={() => setScale((s) => Math.max(s - 0.15, 0.4))}
        onZoomReset={() => setScale(1.0)}
        onRotatePage={() => handleRotatePages([currentPage - 1], 90)}
        onUndo={handleUndo}
        onRedo={handleRedo}
        onOpenFile={handleOpenDesktopPdf}
        onSaveFile={handleSaveFile}
        onSaveAsFile={handleSaveAsFile}
        onDownloadCopy={handleDownloadCopy}
        onOpenSampleModal={() => setIsSampleModalOpen(true)}
        onOpenStorageInfo={() => setIsStorageInfoOpen(true)}
        onOpenConversionModal={() => setIsConversionModalOpen(true)}
        onTitleChange={(title) => {
          setMetadata((prev) => ({ ...prev, title, fileName: title }));
          setIsDirty(true);
        }}
      />

      {/* Main Workstation Body */}
      <div className="flex-1 flex overflow-hidden relative">
        {/* Left: grouped tools */}
        <ToolsPanel
          currentMode={toolMode}
          onModeChange={(mode) => {
            setToolMode(mode);
            if (mode === 'ocr') setActiveRightPanel('ocr');
          }}
          activeColor={activeColor}
          onColorChange={setActiveColor}
          strokeWidth={strokeWidth}
          onStrokeWidthChange={setStrokeWidth}
          fontSize={fontSize}
          onFontSizeChange={setFontSize}
          textStyle={textStyle}
          onTextStyleChange={setTextStyle}
          shapeType={shapeType}
          onShapeTypeChange={setShapeType}
          onOpenSignatureModal={() => setIsSignatureModalOpen(true)}
          onOpenPageTool={handleOpenPageTool}
          onOpenSearch={openSearch}
          protectSignatures={protectSignatures}
          onToggleProtectSignatures={toggleProtectSignatures}
          onInsertImage={() => {
            setToolMode('edit_image');
            setInsertImageToken((t) => t + 1);
          }}
          onOpenConversionModal={() => setIsConversionModalOpen(true)}
          onTriggerOcr={() => {
            setActiveRightPanel('ocr');
            handleRunOcrCurrentPage();
          }}
          onPlaceQuickElement={handlePlaceQuickElement}
        />

        {/* Left: page thumbnails & search */}
        <PageSidebar
          pages={pages}
          currentPage={currentPage}
          isOpen={isSidebarOpen}
          onToggle={() => setIsSidebarOpen(!isSidebarOpen)}
          activeTab={sidebarTab}
          onTabChange={setSidebarTab}
          onSelectPage={(p) => setCurrentPage(p)}
          selection={pageSelection}
          onSelectionChange={setPageSelection}
          onRotatePages={handleRotatePages}
          onDeletePages={handleDeletePages}
          onDuplicatePages={handleDuplicatePages}
          onReorderPages={handleReorderPages}
          onInsertBlankPage={handleInsertBlankPage}
          onExtractPages={openExtract}
          annotationsCountByPage={annotationsCountByPage}
          isBusy={isPageOpBusy}
          searchQuery={searchQuery}
          onSearchQueryChange={setSearchQuery}
          searchOptions={searchOptions}
          onSearchOptionsChange={setSearchOptions}
          searchMatches={searchMatches}
          currentMatchIndex={currentSearchMatchIndex}
          onSelectMatch={handleSelectMatch}
          onNextMatch={handleNextMatch}
          onPrevMatch={handlePrevMatch}
          isSearching={isSearching}
          searchFocusToken={searchFocusToken}
        />

        {/* Center Interactive Document Canvas */}
        <PdfCanvas
          renderer={rendererRef.current}
          documentBytes={currentPdfBytes}
          currentPage={currentPage}
          scale={scale}
          rotation={currentPageRotation}
          toolMode={toolMode}
          activeColor={activeColor}
          strokeWidth={strokeWidth}
          fontSize={fontSize}
          textStyle={textStyle}
          shapeType={shapeType}
          annotations={annotations}
          selectedAnnotationId={selectedAnnotationId}
          onSelectAnnotation={setSelectedAnnotationId}
          onAddAnnotation={handleAddAnnotation}
          onUpdateAnnotation={handleUpdateAnnotation}
          onDeleteAnnotation={handleDeleteAnnotation}
          activeSignatureDataUrl={activeSignatureDataUrl}
          onOpenSignatureModal={() => setIsSignatureModalOpen(true)}
          searchMatches={searchMatches}
          currentSearchMatchIndex={currentSearchMatchIndex}
          textBlocks={editedTextBlocks}
          onUpdateTextBlock={handleUpdateTextBlock}
          images={pageImages.bytes === currentPdfBytes ? pageImages.byPage[currentPage - 1] || [] : []}
          onAddAnnotations={handleAddAnnotations}
          insertImageToken={insertImageToken}
          onNotify={triggerSaveNotice}
          activeCommentId={activeCommentId}
          onActiveCommentChange={setActiveCommentId}
          authorName={authorName}
          protectSignatures={protectSignatures}
        />

        {/* Right Inspector Panel (OCR Studio or Annotations Audit) */}
        {activeRightPanel === 'ocr' && (
          <OcrPanel
            currentPage={currentPage}
            totalPages={pages.length}
            ocrResult={currentOcrResult}
            isRunningOcr={isRunningOcr}
            ocrProgress={ocrProgress}
            onRunOcrCurrentPage={handleRunOcrCurrentPage}
            onRunOcrAllPages={handleRunOcrAllPages}
            onClose={() => setActiveRightPanel('none')}
          />
        )}

        {activeRightPanel === 'comments' && (
          <CommentsPanel
            annotations={annotations}
            activeCommentId={activeCommentId}
            authorName={authorName}
            onAuthorNameChange={updateAuthorName}
            onOpenComment={(c) => {
              setCurrentPage(c.pageIndex + 1);
              setActiveCommentId(c.id);
            }}
            onUpdate={handleUpdateAnnotation}
            onDelete={(id) => {
              handleDeleteAnnotation(id);
              setActiveCommentId(null);
            }}
            onClose={() => setActiveRightPanel('none')}
          />
        )}

        {activeRightPanel === 'annotations' && (
          <AnnotationsPanel
            annotations={annotations}
            selectedAnnotationId={selectedAnnotationId}
            onSelectAnnotation={(id, pageIdx) => {
              setSelectedAnnotationId(id);
              setCurrentPage(pageIdx + 1);
            }}
            onDeleteAnnotation={handleDeleteAnnotation}
            onClose={() => setActiveRightPanel('none')}
          />
        )}

        {/* Quick Inspector Toggle Tab on Right Edge */}
        {activeRightPanel === 'none' && (
          <div className="absolute right-3 top-3 flex flex-col gap-1.5 z-20">
            <button
              onClick={() => setActiveRightPanel('ocr')}
              className="px-2.5 py-1.5 bg-neutral-850 hover:bg-neutral-800 border border-neutral-700/80 rounded shadow-md text-cyan-400 text-xs font-semibold flex items-center gap-1.5 transition-transform active:scale-95"
              title="Open OCR Text Recognition Panel"
            >
              <span>OCR Studio</span>
            </button>
            <button
              onClick={() => setActiveRightPanel('comments')}
              className="px-2.5 py-1.5 bg-neutral-850 hover:bg-neutral-800 border border-neutral-700/80 rounded shadow-md text-amber-300 text-xs font-medium flex items-center gap-1.5 transition-transform active:scale-95"
              title="Comments on this document"
            >
              <span>Comments ({annotations.filter((a) => a.type === 'note' && a.content && !a.resolved).length})</span>
            </button>
            <button
              onClick={() => setActiveRightPanel('annotations')}
              className="px-2.5 py-1.5 bg-neutral-850 hover:bg-neutral-800 border border-neutral-700/80 rounded shadow-md text-neutral-300 text-xs font-medium flex items-center gap-1.5 transition-transform active:scale-95"
              title="View Annotations List"
            >
              <span>Annotations ({annotations.length})</span>
            </button>
          </div>
        )}
      </div>

      {/* Save Success Notification Pill */}
      {saveSuccessNotification && (
        <div className="fixed bottom-6 right-6 z-50 bg-emerald-950 border border-emerald-600 text-emerald-200 px-4 py-2.5 rounded-lg shadow-2xl text-xs font-medium flex items-center gap-2 animate-bounce">
          <span className="w-2 h-2 rounded-full bg-emerald-400" />
          <span>{saveSuccessNotification}</span>
        </div>
      )}

      {/* Signature & Initials Studio Modal */}
      <SignatureModal
        isOpen={isSignatureModalOpen}
        onClose={() => setIsSignatureModalOpen(false)}
        onApplySignature={(dataUrl) => {
          setActiveSignatureDataUrl(dataUrl);
          setToolMode('signature');
        }}
        savedSignatures={savedSignatures}
        onRefreshSavedSignatures={() => setSavedSignatures(StorageService.getSavedSignatures())}
      />

      {/* Sample Documents Modal */}
      <SampleDocsModal
        isOpen={isSampleModalOpen}
        onClose={() => setIsSampleModalOpen(false)}
        onSelectSample={handleSelectSample}
      />

      {/* Desktop Storage Architecture & Privacy Modal */}
      <DesktopStorageBanner
        isOpen={isStorageInfoOpen}
        onClose={() => setIsStorageInfoOpen(false)}
        metadata={metadata}
        savedSignaturesCount={savedSignatures.length}
      />

      {/* Page Organize Grid Modal */}
      <PageOrganizeModal
        isOpen={activePageTool === 'organize'}
        onClose={() => setActivePageTool(null)}
        pages={pages}
        isBusy={isPageOpBusy}
        onRotatePages={handleRotatePages}
        onDeletePages={handleDeletePages}
        onDuplicatePages={handleDuplicatePages}
        onReorderPages={handleReorderPages}
        onInsertBlankPage={handleInsertBlankPage}
        onExtractPages={openExtract}
        onInsertPdf={() => setActivePageTool('insert')}
        onSelectAndClose={(p) => {
          setCurrentPage(p);
          setActivePageTool(null);
        }}
      />

      {/* Page tools */}
      {activePageTool === 'split' && (
        <SplitModal totalPages={pages.length} fileName={metadata.fileName} busy={isPageOpBusy} onClose={() => setActivePageTool(null)} onSplit={handleSplit} />
      )}
      {activePageTool === 'extract' && (
        <ExtractModal
          totalPages={pages.length}
          initialPages={extractInitialPages}
          busy={isPageOpBusy}
          onClose={() => setActivePageTool(null)}
          onExtract={handleExtract}
        />
      )}
      {activePageTool === 'insert' && (
        <InsertPdfModal totalPages={pages.length} currentPage={currentPage} busy={isPageOpBusy} onClose={() => setActivePageTool(null)} onInsert={handleInsertPdf} />
      )}
      {activePageTool === 'combine' && (
        <CombineModal
          currentName={metadata.fileName}
          currentPageCount={pages.length}
          busy={isPageOpBusy}
          onClose={() => setActivePageTool(null)}
          onCombine={handleCombine}
        />
      )}
      {activePageTool === 'page_numbers' && (
        <PageNumbersModal totalPages={pages.length} busy={isPageOpBusy} onClose={() => setActivePageTool(null)} onApply={handleAddPageNumbers} />
      )}

      {/* Undo for the last page operation */}
      {pageUndo && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 bg-neutral-800 border border-neutral-700 text-neutral-100 pl-4 pr-2 py-2 rounded-lg shadow-2xl text-xs flex items-center gap-3">
          <span>{pageUndo.label}</span>
          <button
            onClick={async () => {
              const snap = pageUndo.snapshot;
              setPageUndo(null);
              await restoreSnapshot(snap);
            }}
            className="px-2.5 py-1 rounded bg-blue-600 hover:bg-blue-500 font-medium"
          >
            Undo
          </button>
          <button onClick={() => setPageUndo(null)} className="p-1 text-neutral-400 hover:text-white" title="Dismiss">
            ✕
          </button>
        </div>
      )}

      {/* Two-Way Conversion Studio Modal (PDF <-> Word / Excel) */}
      <ConversionModal
        isOpen={isConversionModalOpen}
        onClose={() => setIsConversionModalOpen(false)}
        renderer={rendererRef.current}
        numPages={pages.length}
        ocrResults={ocrResultsByPage}
        documentTitle={metadata.title}
        onPdfLoaded={(bytes, name) => {
          loadPdfData(bytes, name, null, true);
          triggerSaveNotice(`Converted "${name}" & opened in AcrobatDesk!`);
        }}
      />
    </div>
  );
}
