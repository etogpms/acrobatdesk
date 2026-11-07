import React, { useEffect, useRef, useState } from 'react';
import {
  RotateCw,
  RotateCcw,
  Trash2,
  Copy,
  Plus,
  ChevronLeft,
  ChevronUp,
  ChevronDown,
  Layers,
  FileText,
  FileOutput,
  Search,
  X,
  CaseSensitive,
  WholeWord,
  Loader2
} from 'lucide-react';
import { PageInfo, SearchMatch, SearchOptions } from '../types/pdf';
import { computeMoveOrder, formatPageRanges } from '../services/pageOperations';

export type SidebarTab = 'pages' | 'search';

interface PageSidebarProps {
  pages: PageInfo[];
  currentPage: number;
  isOpen: boolean;
  onToggle: () => void;
  activeTab: SidebarTab;
  onTabChange: (tab: SidebarTab) => void;
  onSelectPage: (pageNumber: number) => void;
  selection: number[];
  onSelectionChange: (sel: number[]) => void;
  onRotatePages: (indices: number[], delta: number) => void;
  onDeletePages: (indices: number[]) => void;
  onDuplicatePages: (indices: number[]) => void;
  onReorderPages: (order: number[]) => void;
  onInsertBlankPage: (atIndex: number) => void;
  onExtractPages: (indices: number[]) => void;
  annotationsCountByPage: Record<number, number>;
  isBusy: boolean;
  // Search
  searchQuery: string;
  onSearchQueryChange: (q: string) => void;
  searchOptions: SearchOptions;
  onSearchOptionsChange: (o: SearchOptions) => void;
  searchMatches: SearchMatch[];
  currentMatchIndex: number;
  onSelectMatch: (index: number) => void;
  onNextMatch: () => void;
  onPrevMatch: () => void;
  isSearching: boolean;
  searchFocusToken: number;
}

export const PageSidebar: React.FC<PageSidebarProps> = (props) => {
  const {
    pages,
    currentPage,
    isOpen,
    onToggle,
    activeTab,
    onTabChange,
    onSelectPage,
    selection,
    onSelectionChange,
    onRotatePages,
    onDeletePages,
    onDuplicatePages,
    onReorderPages,
    onInsertBlankPage,
    onExtractPages,
    annotationsCountByPage,
    isBusy
  } = props;

  const [dragging, setDragging] = useState<number[] | null>(null);
  const [dropBefore, setDropBefore] = useState<number | null>(null);
  const lastClicked = useRef<number>(0);
  const thumbRefs = useRef<Array<HTMLDivElement | null>>([]);

  // Keep the current page thumbnail in view
  useEffect(() => {
    if (activeTab === 'pages') {
      thumbRefs.current[currentPage - 1]?.scrollIntoView({ block: 'nearest' });
    }
  }, [currentPage, activeTab]);

  if (!isOpen) {
    return (
      <div className="w-10 bg-neutral-900 border-r border-neutral-800 flex flex-col items-center py-2 gap-1 shrink-0 z-10">
        <button
          onClick={() => {
            onTabChange('pages');
            onToggle();
          }}
          title="Page thumbnails"
          className="p-1.5 text-neutral-400 hover:text-white hover:bg-neutral-800 rounded"
        >
          <Layers className="w-4 h-4" />
        </button>
        <button
          onClick={() => {
            onTabChange('search');
            onToggle();
          }}
          title="Search text"
          className="p-1.5 text-neutral-400 hover:text-white hover:bg-neutral-800 rounded"
        >
          <Search className="w-4 h-4" />
        </button>
      </div>
    );
  }

  const selected = selection.length > 0 ? selection : [currentPage - 1];

  const handleThumbClick = (e: React.MouseEvent, idx: number) => {
    if (e.shiftKey) {
      const a = Math.min(lastClicked.current, idx);
      const b = Math.max(lastClicked.current, idx);
      onSelectionChange(Array.from({ length: b - a + 1 }, (_, i) => a + i));
    } else if (e.metaKey || e.ctrlKey) {
      const base = selection.length ? selection : [currentPage - 1];
      onSelectionChange(base.includes(idx) ? base.filter((i) => i !== idx) : [...base, idx].sort((x, y) => x - y));
      lastClicked.current = idx;
    } else {
      onSelectionChange([]);
      lastClicked.current = idx;
      onSelectPage(idx + 1);
    }
  };

  const handleDrop = () => {
    if (dragging && dropBefore !== null) {
      const order = computeMoveOrder(pages.length, dragging, dropBefore);
      if (order.some((v, i) => v !== i)) onReorderPages(order);
    }
    setDragging(null);
    setDropBefore(null);
  };

  return (
    <aside className="w-52 bg-neutral-900 border-r border-neutral-800 flex flex-col shrink-0 z-10 h-full select-none">
      {/* Tabs */}
      <div className="h-10 px-2 border-b border-neutral-800 flex items-center justify-between">
        <div className="flex items-center gap-0.5 bg-neutral-850 rounded-md p-0.5">
          {(['pages', 'search'] as SidebarTab[]).map((t) => (
            <button
              key={t}
              onClick={() => onTabChange(t)}
              className={`px-2.5 py-1 rounded text-[11px] font-medium flex items-center gap-1 ${
                activeTab === t ? 'bg-neutral-700 text-white' : 'text-neutral-400 hover:text-neutral-200'
              }`}
            >
              {t === 'pages' ? <Layers className="w-3 h-3" /> : <Search className="w-3 h-3" />}
              {t === 'pages' ? `Pages (${pages.length})` : 'Search'}
            </button>
          ))}
        </div>
        <button onClick={onToggle} className="p-1 text-neutral-400 hover:text-white hover:bg-neutral-800 rounded" title="Collapse sidebar">
          <ChevronLeft className="w-3.5 h-3.5" />
        </button>
      </div>

      {activeTab === 'search' ? (
        <SearchTab {...props} />
      ) : (
        <>
          {/* Selection actions */}
          <div className="px-2 py-1.5 border-b border-neutral-800 flex items-center justify-between text-neutral-400">
            <span className="text-[10px] truncate" title="Ctrl/Cmd-click or Shift-click to select several pages">
              {selection.length > 1 ? `${selection.length} selected · ${formatPageRanges(selection)}` : `Page ${currentPage}`}
            </span>
            <div className="flex items-center">
              {[
                { icon: RotateCcw, title: 'Rotate left', fn: () => onRotatePages(selected, -90) },
                { icon: RotateCw, title: 'Rotate right', fn: () => onRotatePages(selected, 90) },
                { icon: Copy, title: 'Duplicate', fn: () => onDuplicatePages(selected) },
                { icon: FileOutput, title: 'Extract to new PDF', fn: () => onExtractPages(selected) }
              ].map(({ icon: Icon, title, fn }) => (
                <button key={title} disabled={isBusy} onClick={fn} title={title} className="p-1 rounded hover:text-white hover:bg-neutral-800 disabled:opacity-40">
                  <Icon className="w-3.5 h-3.5" />
                </button>
              ))}
              <button
                disabled={isBusy || selected.length >= pages.length}
                onClick={() => onDeletePages(selected)}
                title="Delete"
                className="p-1 rounded hover:text-rose-400 hover:bg-neutral-800 disabled:opacity-40"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          {/* Thumbnails */}
          <div
            className="flex-1 overflow-y-auto px-3 py-2"
            onDragOver={(e) => e.preventDefault()}
            onDrop={handleDrop}
          >
            {pages.map((page, idx) => {
              const isCurrent = currentPage === idx + 1;
              const isSelected = selection.includes(idx);
              const annCount = annotationsCountByPage[idx] || 0;
              return (
                <div key={`${idx}-${page.thumbnailUrl ? 't' : 'n'}`} ref={(el) => { thumbRefs.current[idx] = el; }}>
                  {/* Drop indicator */}
                  <div className={`h-1 my-0.5 rounded-full transition-colors ${dragging && dropBefore === idx ? 'bg-blue-500' : 'bg-transparent'}`} />
                  <div
                    draggable={!isBusy}
                    onDragStart={(e) => {
                      e.dataTransfer.effectAllowed = 'move';
                      setDragging(isSelected && selection.length > 1 ? selection : [idx]);
                    }}
                    onDragOver={(e) => {
                      e.preventDefault();
                      const rect = (e.currentTarget as HTMLDivElement).getBoundingClientRect();
                      setDropBefore(e.clientY < rect.top + rect.height / 2 ? idx : idx + 1);
                    }}
                    onDragEnd={() => {
                      setDragging(null);
                      setDropBefore(null);
                    }}
                    onClick={(e) => handleThumbClick(e, idx)}
                    className={`group relative rounded-md p-1.5 cursor-pointer ${
                      dragging?.includes(idx) ? 'opacity-40' : ''
                    } ${
                      isSelected
                        ? 'bg-blue-600/15 ring-1 ring-blue-500/70'
                        : isCurrent
                        ? 'bg-neutral-800 ring-1 ring-red-500/70'
                        : 'hover:bg-neutral-800/60'
                    }`}
                  >
                    <div className="bg-white rounded-sm overflow-hidden shadow border border-neutral-700/60 min-h-[60px] flex items-center justify-center">
                      {page.thumbnailUrl ? (
                        <img src={page.thumbnailUrl} alt={`Page ${idx + 1}`} draggable={false} className="w-full h-auto block" />
                      ) : (
                        <div className="aspect-[1/1.414] w-full flex flex-col items-center justify-center text-neutral-400 gap-1">
                          <FileText className="w-6 h-6 stroke-1" />
                        </div>
                      )}
                    </div>
                    <div className="flex items-center justify-between mt-1 text-[10px] text-neutral-400">
                      <span className={`font-mono ${isCurrent ? 'text-white font-semibold' : ''}`}>{idx + 1}</span>
                      {annCount > 0 && (
                        <span className="text-cyan-400 bg-cyan-950/60 px-1 rounded font-mono">
                          {annCount} {annCount === 1 ? 'edit' : 'edits'}
                        </span>
                      )}
                    </div>
                    {/* Hover quick actions */}
                    <div className="absolute top-2.5 right-2.5 hidden group-hover:flex items-center gap-0.5 bg-neutral-900/90 rounded px-0.5 py-0.5 text-neutral-300">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          onRotatePages([idx], 90);
                        }}
                        className="p-0.5 hover:text-white"
                        title="Rotate 90°"
                      >
                        <RotateCw className="w-3 h-3" />
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          onInsertBlankPage(idx + 1);
                        }}
                        className="p-0.5 hover:text-white"
                        title="Insert blank page after"
                      >
                        <Plus className="w-3 h-3" />
                      </button>
                      {pages.length > 1 && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            onDeletePages([idx]);
                          }}
                          className="p-0.5 hover:text-rose-400"
                          title="Delete page"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
            <div className={`h-1 my-0.5 rounded-full ${dragging && dropBefore === pages.length ? 'bg-blue-500' : 'bg-transparent'}`} />
          </div>

          <div className="p-2 border-t border-neutral-800 text-[10px] text-neutral-500 text-center">
            Drag to reorder · Ctrl/⌘ or Shift-click to multi-select
          </div>
        </>
      )}
    </aside>
  );
};

const SearchTab: React.FC<PageSidebarProps> = ({
  searchQuery,
  onSearchQueryChange,
  searchOptions,
  onSearchOptionsChange,
  searchMatches,
  currentMatchIndex,
  onSelectMatch,
  onNextMatch,
  onPrevMatch,
  isSearching,
  searchFocusToken
}) => {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const activeRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [searchFocusToken]);

  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: 'nearest' });
  }, [currentMatchIndex]);

  // Group results by page
  const byPage = new Map<number, Array<{ m: SearchMatch; i: number }>>();
  searchMatches.forEach((m, i) => {
    const list = byPage.get(m.pageIndex) || [];
    list.push({ m, i });
    byPage.set(m.pageIndex, list);
  });

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div className="p-2 space-y-1.5 border-b border-neutral-800">
        <div className="relative">
          <Search className="w-3.5 h-3.5 absolute left-2 top-1/2 -translate-y-1/2 text-neutral-500 pointer-events-none" />
          <input
            ref={inputRef}
            value={searchQuery}
            onChange={(e) => onSearchQueryChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                e.shiftKey ? onPrevMatch() : onNextMatch();
              } else if (e.key === 'Escape') {
                onSearchQueryChange('');
              }
            }}
            placeholder="Search text in PDF…"
            className="w-full bg-neutral-800 border border-neutral-700 rounded-md pl-7 pr-6 py-1.5 text-xs text-neutral-100 placeholder:text-neutral-500 outline-none focus:border-amber-500"
          />
          {searchQuery && (
            <button onClick={() => onSearchQueryChange('')} className="absolute right-1.5 top-1/2 -translate-y-1/2 p-0.5 text-neutral-400 hover:text-white" title="Clear">
              <X className="w-3 h-3" />
            </button>
          )}
        </div>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1">
            <button
              onClick={() => onSearchOptionsChange({ ...searchOptions, matchCase: !searchOptions.matchCase })}
              className={`p-1 rounded ${searchOptions.matchCase ? 'bg-amber-500/20 text-amber-300' : 'text-neutral-400 hover:text-white'}`}
              title="Match case"
            >
              <CaseSensitive className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => onSearchOptionsChange({ ...searchOptions, wholeWord: !searchOptions.wholeWord })}
              className={`p-1 rounded ${searchOptions.wholeWord ? 'bg-amber-500/20 text-amber-300' : 'text-neutral-400 hover:text-white'}`}
              title="Whole word"
            >
              <WholeWord className="w-3.5 h-3.5" />
            </button>
          </div>
          <div className="flex items-center gap-1 text-[10px] font-mono text-neutral-400">
            {isSearching ? (
              <Loader2 className="w-3 h-3 animate-spin" />
            ) : searchQuery.trim() ? (
              <span className={searchMatches.length ? 'text-amber-400' : ''}>
                {searchMatches.length ? `${currentMatchIndex + 1} / ${searchMatches.length}` : 'No matches'}
              </span>
            ) : null}
            <button onClick={onPrevMatch} disabled={!searchMatches.length} className="p-0.5 hover:text-white disabled:opacity-30" title="Previous (Shift+Enter)">
              <ChevronUp className="w-3.5 h-3.5" />
            </button>
            <button onClick={onNextMatch} disabled={!searchMatches.length} className="p-0.5 hover:text-white disabled:opacity-30" title="Next (Enter)">
              <ChevronDown className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto py-1">
        {!searchQuery.trim() && (
          <p className="text-[11px] text-neutral-500 px-3 py-4 leading-relaxed">
            Type a word or phrase to find it across every page. Scanned pages need OCR first.
          </p>
        )}
        {[...byPage.entries()].map(([pageIdx, list]) => (
          <div key={pageIdx} className="mb-1">
            <div className="px-3 pt-2 pb-1 text-[10px] uppercase tracking-wider text-neutral-500 font-semibold">
              Page {pageIdx + 1} · {list.length}
            </div>
            {list.map(({ m, i }) => {
              const active = i === currentMatchIndex;
              const s = m.snippet || m.text;
              const a = m.snippetMatchStart ?? s.toLowerCase().indexOf(m.text.toLowerCase());
              const len = m.snippetMatchLength ?? m.text.length;
              return (
                <button
                  key={m.id}
                  ref={active ? activeRef : undefined}
                  onClick={() => onSelectMatch(i)}
                  className={`w-full text-left px-3 py-1.5 text-[11px] leading-snug ${
                    active ? 'bg-amber-500/15 text-neutral-100' : 'text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200'
                  }`}
                >
                  {a >= 0 ? (
                    <>
                      {s.slice(0, a)}
                      <mark className="bg-amber-400/80 text-neutral-950 rounded-sm px-0.5">{s.slice(a, a + len)}</mark>
                      {s.slice(a + len)}
                    </>
                  ) : (
                    s
                  )}
                </button>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
};
