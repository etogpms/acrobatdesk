import React, { useState } from 'react';
import {
  FolderOpen,
  Save,
  Download,
  ZoomIn,
  ZoomOut,
  RotateCw,
  ChevronLeft,
  ChevronRight,
  HardDrive,
  FileText,
  Maximize2,
  Sparkles,
  Undo2,
  Redo2,
  MoreVertical,
  CheckCircle2,
  Search,
  ArrowLeftRight
} from 'lucide-react';
import { DocumentMetadata } from '../types/pdf';

interface TopNavProps {
  metadata: DocumentMetadata;
  currentPage: number;
  totalPages: number;
  scale: number;
  canUndo: boolean;
  canRedo: boolean;
  isDirty: boolean;
  isSearchOpen?: boolean;
  onToggleSearch?: () => void;
  onOpenConversionModal?: () => void;
  onPageChange: (newPage: number) => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onZoomReset: () => void;
  onRotatePage: () => void;
  onUndo: () => void;
  onRedo: () => void;
  onOpenFile: () => void;
  onSaveFile: () => void;
  onSaveAsFile: () => void;
  onDownloadCopy: () => void;
  onOpenSampleModal: () => void;
  onOpenStorageInfo: () => void;
  onTitleChange: (newTitle: string) => void;
}

export const TopNav: React.FC<TopNavProps> = ({
  metadata,
  currentPage,
  totalPages,
  scale,
  canUndo,
  canRedo,
  isDirty,
  isSearchOpen = false,
  onToggleSearch = () => {},
  onOpenConversionModal = () => {},
  onPageChange,
  onZoomIn,
  onZoomOut,
  onZoomReset,
  onRotatePage,
  onUndo,
  onRedo,
  onOpenFile,
  onSaveFile,
  onSaveAsFile,
  onDownloadCopy,
  onOpenSampleModal,
  onOpenStorageInfo,
  onTitleChange
}) => {
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [tempTitle, setTempTitle] = useState(metadata.title);
  const [showFileMenu, setShowFileMenu] = useState(false);

  const handleTitleSubmit = () => {
    setIsEditingTitle(false);
    if (tempTitle.trim()) {
      onTitleChange(tempTitle.trim());
    } else {
      setTempTitle(metadata.title);
    }
  };

  return (
    <header className="h-14 bg-neutral-900 border-b border-neutral-800 flex items-center justify-between px-4 text-neutral-200 select-none shrink-0 relative z-30">
      {/* Zone 1: Brand & Document Title */}
      <div className="flex items-center gap-4 min-w-0">
        <div className="flex items-center gap-2 shrink-0">
          <div className="w-8 h-8 rounded bg-red-600 flex items-center justify-center font-bold text-white text-base shadow-sm">
            A
          </div>
          <span className="font-semibold text-white text-sm tracking-tight hidden sm:inline">
            AcrobatDesk
          </span>
        </div>

        <div className="h-4 w-px bg-neutral-800 hidden sm:block" />

        {/* Document Title & Dirty Indicator */}
        <div className="flex items-center gap-2 min-w-0 max-w-xs md:max-w-md">
          {isEditingTitle ? (
            <input
              type="text"
              value={tempTitle}
              onChange={(e) => setTempTitle(e.target.value)}
              onBlur={handleTitleSubmit}
              onKeyDown={(e) => e.key === 'Enter' && handleTitleSubmit()}
              autoFocus
              className="bg-neutral-800 text-neutral-100 text-xs px-2 py-1 rounded border border-neutral-700 outline-none w-full"
            />
          ) : (
            <div
              onClick={() => {
                setTempTitle(metadata.title);
                setIsEditingTitle(true);
              }}
              title="Click to rename document"
              className="text-xs text-neutral-300 font-medium truncate cursor-pointer hover:text-white hover:bg-neutral-800/80 px-2 py-1 rounded transition-colors flex items-center gap-1.5"
            >
              <span className="truncate">{metadata.title || 'Untitled Document.pdf'}</span>
              {isDirty && (
                <span className="w-2 h-2 rounded-full bg-amber-400 shrink-0" title="Unsaved changes on desktop" />
              )}
            </div>
          )}

          {/* Desktop Storage Status Indicator */}
          <button
            onClick={onOpenStorageInfo}
            title="All files and edits are stored 100% locally on your personal desktop"
            className="hidden lg:flex items-center gap-1.5 text-[11px] text-emerald-400/90 bg-emerald-950/40 border border-emerald-800/50 px-2 py-0.5 rounded hover:bg-emerald-900/50 transition-colors shrink-0"
          >
            <HardDrive className="w-3 h-3 text-emerald-400" />
            <span>Desktop Storage</span>
          </button>
        </div>
      </div>

      {/* Zone 2: Navigation & Viewport Controls */}
      <div className="hidden md:flex items-center gap-3">
        {/* Undo / Redo */}
        <div className="flex items-center gap-0.5 bg-neutral-800/70 p-0.5 rounded border border-neutral-700/60">
          <button
            onClick={onUndo}
            disabled={!canUndo}
            title="Undo (Ctrl+Z)"
            className="p-1.5 text-neutral-400 hover:text-neutral-100 disabled:opacity-30 disabled:hover:text-neutral-400 transition-colors rounded"
          >
            <Undo2 className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={onRedo}
            disabled={!canRedo}
            title="Redo (Ctrl+Y)"
            className="p-1.5 text-neutral-400 hover:text-neutral-100 disabled:opacity-30 disabled:hover:text-neutral-400 transition-colors rounded"
          >
            <Redo2 className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Page Switcher */}
        <div className="flex items-center gap-1 bg-neutral-800/70 px-2 py-1 rounded border border-neutral-700/60 text-xs">
          <button
            onClick={() => onPageChange(currentPage - 1)}
            disabled={currentPage <= 1}
            className="p-0.5 text-neutral-400 hover:text-neutral-100 disabled:opacity-30 transition-colors"
            title="Previous Page"
          >
            <ChevronLeft className="w-3.5 h-3.5" />
          </button>
          <span className="font-mono text-neutral-300 px-1">
            {currentPage} / {totalPages || 1}
          </span>
          <button
            onClick={() => onPageChange(currentPage + 1)}
            disabled={currentPage >= totalPages}
            className="p-0.5 text-neutral-400 hover:text-neutral-100 disabled:opacity-30 transition-colors"
            title="Next Page"
          >
            <ChevronRight className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Zoom Controls */}
        <div className="flex items-center gap-1 bg-neutral-800/70 p-0.5 rounded border border-neutral-700/60 text-xs">
          <button
            onClick={onZoomOut}
            title="Zoom Out"
            className="p-1.5 text-neutral-400 hover:text-neutral-100 transition-colors rounded"
          >
            <ZoomOut className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={onZoomReset}
            title="Reset Zoom to 100%"
            className="px-1.5 font-mono text-[11px] text-neutral-300 hover:text-white"
          >
            {Math.round(scale * 100)}%
          </button>
          <button
            onClick={onZoomIn}
            title="Zoom In"
            className="p-1.5 text-neutral-400 hover:text-neutral-100 transition-colors rounded"
          >
            <ZoomIn className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Rotate Page */}
        <button
          onClick={onRotatePage}
          title="Rotate Page 90° Clockwise"
          className="p-1.5 text-neutral-400 hover:text-neutral-100 bg-neutral-800/70 rounded border border-neutral-700/60 transition-colors"
        >
          <RotateCw className="w-3.5 h-3.5" />
        </button>

        {/* Find / Search in Document Tool */}
        <button
          onClick={onToggleSearch}
          title="Find text in PDF (Ctrl+F)"
          className={`p-1.5 rounded border transition-colors flex items-center gap-1.5 ${
            isSearchOpen
              ? 'bg-amber-500/20 text-amber-300 border-amber-500/50 shadow-sm'
              : 'text-neutral-400 hover:text-neutral-100 bg-neutral-800/70 border-neutral-700/60'
          }`}
        >
          <Search className="w-3.5 h-3.5 text-amber-400" />
          <span className="hidden xl:inline text-xs font-medium">Find</span>
        </button>
      </div>

      {/* Zone 3: Primary Desktop Actions */}
      <div className="flex items-center gap-2 shrink-0">
        <button
          onClick={onOpenConversionModal}
          className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-emerald-400 hover:text-emerald-300 bg-emerald-950/40 hover:bg-emerald-900/50 rounded border border-emerald-800/60 transition-colors"
          title="Convert between PDF, Excel (.xlsx), and Word (.docx)"
        >
          <ArrowLeftRight className="w-3.5 h-3.5" />
          <span className="hidden sm:inline">Convert</span>
        </button>

        <button
          onClick={onOpenFile}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-neutral-300 hover:text-white bg-neutral-800 hover:bg-neutral-700/80 rounded border border-neutral-700/80 transition-colors"
          title="Open a PDF file from your desktop"
        >
          <FolderOpen className="w-3.5 h-3.5 text-amber-400" />
          <span className="hidden sm:inline">Open Desktop PDF</span>
        </button>

        {/* Primary Save Action */}
        <button
          onClick={onSaveFile}
          className="flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-medium text-white bg-red-600 hover:bg-red-500 rounded shadow transition-colors active:scale-95"
          title="Save changes to your desktop file (Ctrl+S)"
        >
          <Save className="w-3.5 h-3.5" />
          <span>Save</span>
        </button>

        {/* Secondary dropdown menu */}
        <div className="relative">
          <button
            onClick={() => setShowFileMenu(!showFileMenu)}
            className="p-1.5 text-neutral-400 hover:text-white bg-neutral-800 hover:bg-neutral-700 rounded border border-neutral-700 transition-colors"
            title="More File Actions"
          >
            <MoreVertical className="w-3.5 h-3.5" />
          </button>

          {showFileMenu && (
            <div
              className="absolute right-0 top-full mt-1.5 w-56 bg-neutral-800 border border-neutral-700 rounded-lg shadow-2xl py-1 text-xs text-neutral-200 z-50 divide-y divide-neutral-700/60"
              onMouseLeave={() => setShowFileMenu(false)}
            >
              <div className="py-1">
                <button
                  onClick={() => {
                    setShowFileMenu(false);
                    onSaveAsFile();
                  }}
                  className="w-full text-left px-3 py-2 hover:bg-neutral-700 flex items-center gap-2"
                >
                  <Save className="w-3.5 h-3.5 text-neutral-400" />
                  <span>Save As to Desktop Folder...</span>
                </button>
                <button
                  onClick={() => {
                    setShowFileMenu(false);
                    onDownloadCopy();
                  }}
                  className="w-full text-left px-3 py-2 hover:bg-neutral-700 flex items-center gap-2"
                >
                  <Download className="w-3.5 h-3.5 text-neutral-400" />
                  <span>Download Local Copy</span>
                </button>
                <button
                  onClick={() => {
                    setShowFileMenu(false);
                    onOpenConversionModal?.();
                  }}
                  className="w-full text-left px-3 py-2 hover:bg-neutral-700 flex items-center gap-2 text-emerald-400 font-medium"
                >
                  <ArrowLeftRight className="w-3.5 h-3.5 text-emerald-400" />
                  <span>Convert (Word / Excel / PDF)...</span>
                </button>
              </div>

              <div className="py-1">
                <button
                  onClick={() => {
                    setShowFileMenu(false);
                    onOpenSampleModal();
                  }}
                  className="w-full text-left px-3 py-2 hover:bg-neutral-700 flex items-center gap-2 text-cyan-400 font-medium"
                >
                  <FileText className="w-3.5 h-3.5" />
                  <span>Load Sample Documents (OCR/Contract)...</span>
                </button>
                <button
                  onClick={() => {
                    setShowFileMenu(false);
                    onOpenStorageInfo();
                  }}
                  className="w-full text-left px-3 py-2 hover:bg-neutral-700 flex items-center gap-2 text-neutral-300"
                >
                  <HardDrive className="w-3.5 h-3.5 text-emerald-400" />
                  <span>Desktop Privacy & Storage Details</span>
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </header>
  );
};
