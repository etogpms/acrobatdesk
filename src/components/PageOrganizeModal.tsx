import React, { useRef, useState } from 'react';
import {
  X,
  RotateCw,
  RotateCcw,
  Trash2,
  Copy,
  Plus,
  Layers,
  FileText,
  FileOutput,
  FilePlus2,
  ArrowDownUp,
  Loader2
} from 'lucide-react';
import { PageInfo } from '../types/pdf';
import { computeMoveOrder, formatPageRanges, range } from '../services/pageOperations';

interface PageOrganizeModalProps {
  isOpen: boolean;
  onClose: () => void;
  pages: PageInfo[];
  isBusy: boolean;
  onRotatePages: (indices: number[], delta: number) => void;
  onDeletePages: (indices: number[]) => void;
  onDuplicatePages: (indices: number[]) => void;
  onReorderPages: (order: number[]) => void;
  onInsertBlankPage: (atIndex: number) => void;
  onExtractPages: (indices: number[]) => void;
  onInsertPdf: () => void;
  onSelectAndClose: (pageNumber: number) => void;
}

export const PageOrganizeModal: React.FC<PageOrganizeModalProps> = ({
  isOpen,
  onClose,
  pages,
  isBusy,
  onRotatePages,
  onDeletePages,
  onDuplicatePages,
  onReorderPages,
  onInsertBlankPage,
  onExtractPages,
  onInsertPdf,
  onSelectAndClose
}) => {
  const [selection, setSelection] = useState<number[]>([]);
  const [dragging, setDragging] = useState<number[] | null>(null);
  const [dropBefore, setDropBefore] = useState<number | null>(null);
  const lastClicked = useRef(0);

  if (!isOpen) return null;

  const validSel = selection.filter((i) => i < pages.length);
  const hasSel = validSel.length > 0;

  const run = (fn: () => void, clear = true) => {
    fn();
    if (clear) setSelection([]);
  };

  const toggle = (e: React.MouseEvent, idx: number) => {
    if (e.shiftKey) {
      const a = Math.min(lastClicked.current, idx);
      const b = Math.max(lastClicked.current, idx);
      setSelection(range(b - a + 1).map((i) => a + i));
      return;
    }
    lastClicked.current = idx;
    setSelection((s) => (s.includes(idx) ? s.filter((i) => i !== idx) : [...s, idx].sort((x, y) => x - y)));
  };

  const handleDrop = () => {
    if (dragging && dropBefore !== null) {
      const order = computeMoveOrder(pages.length, dragging, dropBefore);
      if (order.some((v, i) => v !== i)) {
        onReorderPages(order);
        setSelection([]);
      }
    }
    setDragging(null);
    setDropBefore(null);
  };

  const ActionBtn: React.FC<{ icon: React.ElementType; label: string; onClick: () => void; disabled?: boolean; danger?: boolean }> = ({
    icon: Icon,
    label,
    onClick,
    disabled,
    danger
  }) => (
    <button
      onClick={onClick}
      disabled={disabled || isBusy}
      className={`px-2.5 py-1.5 rounded-md text-xs flex items-center gap-1.5 border border-neutral-700/70 bg-neutral-800 disabled:opacity-40 ${
        danger ? 'hover:bg-rose-950 hover:border-rose-700 hover:text-rose-200' : 'hover:bg-neutral-700 text-neutral-200'
      }`}
    >
      <Icon className="w-3.5 h-3.5" />
      <span>{label}</span>
    </button>
  );

  return (
    <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-6">
      <div className="bg-neutral-900 border border-neutral-800 rounded-xl max-w-6xl w-full h-[88vh] shadow-2xl overflow-hidden flex flex-col">
        {/* Header */}
        <div className="px-5 py-3.5 border-b border-neutral-800 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-blue-600/20 border border-blue-500/40 flex items-center justify-center text-blue-400">
              <Layers className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-white">Organize pages</h2>
              <p className="text-[11px] text-neutral-400">
                Drag pages to reorder. Click to select, Shift-click for a range. {pages.length} pages.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {isBusy && <Loader2 className="w-4 h-4 animate-spin text-blue-400" />}
            <button onClick={onClose} className="p-1.5 text-neutral-400 hover:text-white rounded" title="Close">
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Toolbar */}
        <div className="px-5 py-2 border-b border-neutral-800 flex flex-wrap items-center gap-1.5 bg-neutral-900/80">
          <span className="text-[11px] text-neutral-400 mr-2 min-w-[120px]">
            {hasSel ? `Selected: ${formatPageRanges(validSel)}` : 'No pages selected'}
          </span>
          <ActionBtn icon={RotateCcw} label="Rotate left" disabled={!hasSel} onClick={() => run(() => onRotatePages(validSel, -90), false)} />
          <ActionBtn icon={RotateCw} label="Rotate right" disabled={!hasSel} onClick={() => run(() => onRotatePages(validSel, 90), false)} />
          <ActionBtn icon={Copy} label="Duplicate" disabled={!hasSel} onClick={() => run(() => onDuplicatePages(validSel))} />
          <ActionBtn icon={FileOutput} label="Extract" disabled={!hasSel} onClick={() => onExtractPages(validSel)} />
          <ActionBtn
            icon={Trash2}
            label="Delete"
            danger
            disabled={!hasSel || validSel.length >= pages.length}
            onClick={() => run(() => onDeletePages(validSel))}
          />
          <div className="w-px h-5 bg-neutral-800 mx-1" />
          <ActionBtn icon={Plus} label="Blank page" onClick={() => onInsertBlankPage(hasSel ? Math.max(...validSel) + 1 : pages.length)} />
          <ActionBtn icon={FilePlus2} label="Insert PDF…" onClick={onInsertPdf} />
          <ActionBtn icon={ArrowDownUp} label="Reverse order" onClick={() => run(() => onReorderPages(range(pages.length).reverse()))} />
          <div className="flex-1" />
          <button onClick={() => setSelection(range(pages.length))} className="text-[11px] text-neutral-400 hover:text-white px-1">
            Select all
          </button>
          {hasSel && (
            <button onClick={() => setSelection([])} className="text-[11px] text-neutral-400 hover:text-white px-1">
              Clear
            </button>
          )}
        </div>

        {/* Grid */}
        <div
          className="p-5 flex-1 overflow-y-auto bg-neutral-950/40"
          onDragOver={(e) => e.preventDefault()}
          onDrop={handleDrop}
        >
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 lg:grid-cols-6 gap-x-3 gap-y-5">
            {pages.map((page, idx) => {
              const isSelected = validSel.includes(idx);
              return (
                <div
                  key={`${idx}-${page.thumbnailUrl ? 't' : 'n'}`}
                  draggable={!isBusy}
                  onDragStart={(e) => {
                    e.dataTransfer.effectAllowed = 'move';
                    setDragging(isSelected && validSel.length > 1 ? validSel : [idx]);
                  }}
                  onDragOver={(e) => {
                    e.preventDefault();
                    const rect = (e.currentTarget as HTMLDivElement).getBoundingClientRect();
                    setDropBefore(e.clientX < rect.left + rect.width / 2 ? idx : idx + 1);
                  }}
                  onDragEnd={() => {
                    setDragging(null);
                    setDropBefore(null);
                  }}
                  onClick={(e) => toggle(e, idx)}
                  onDoubleClick={() => onSelectAndClose(idx + 1)}
                  className={`relative group rounded-lg p-2 cursor-pointer ${dragging?.includes(idx) ? 'opacity-40' : ''} ${
                    isSelected ? 'bg-blue-600/15 ring-2 ring-blue-500' : 'hover:bg-neutral-800/70'
                  }`}
                >
                  {/* Drop indicators */}
                  {dragging && dropBefore === idx && <div className="absolute -left-2 top-2 bottom-8 w-1 rounded-full bg-blue-500" />}
                  {dragging && dropBefore === idx + 1 && idx === pages.length - 1 && (
                    <div className="absolute -right-2 top-2 bottom-8 w-1 rounded-full bg-blue-500" />
                  )}

                  <div className="bg-white rounded shadow border border-neutral-700 overflow-hidden flex items-center justify-center aspect-[1/1.3]">
                    {page.thumbnailUrl ? (
                      <img src={page.thumbnailUrl} alt={`Page ${idx + 1}`} draggable={false} className="max-w-full max-h-full object-contain pointer-events-none" />
                    ) : (
                      <FileText className="w-8 h-8 stroke-1 text-neutral-400" />
                    )}
                  </div>
                  <div className="mt-1.5 flex items-center justify-between text-[11px] font-mono text-neutral-300">
                    <span>{idx + 1}</span>
                    <div className="hidden group-hover:flex items-center gap-0.5 text-neutral-400">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          onRotatePages([idx], 90);
                        }}
                        className="p-0.5 hover:text-white"
                        title="Rotate"
                      >
                        <RotateCw className="w-3 h-3" />
                      </button>
                      {pages.length > 1 && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            onDeletePages([idx]);
                            setSelection([]);
                          }}
                          className="p-0.5 hover:text-rose-400"
                          title="Delete"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="px-5 py-2.5 border-t border-neutral-800 flex items-center justify-between">
          <span className="text-[11px] text-neutral-500">Double-click a page to open it. Changes apply to the document right away.</span>
          <button onClick={onClose} className="px-4 py-1.5 bg-blue-600 hover:bg-blue-500 text-white rounded text-xs font-medium">
            Done
          </button>
        </div>
      </div>
    </div>
  );
};
