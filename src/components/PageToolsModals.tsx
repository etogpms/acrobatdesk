import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  X,
  Scissors,
  FileOutput,
  FilePlus2,
  Files,
  Hash,
  Upload,
  ArrowUp,
  ArrowDown,
  Trash2,
  Loader2,
  FileText
} from 'lucide-react';
import {
  parsePageRanges,
  formatPageRanges,
  getPageCount,
  range,
  formatPageNumber,
  PageNumberOptions,
  PageNumberPosition,
  PageNumberFormat
} from '../services/pageOperations';

// ---------- shared pieces ----------

const Shell: React.FC<{
  title: string;
  subtitle: string;
  icon: React.ElementType;
  onClose: () => void;
  children: React.ReactNode;
  footer: React.ReactNode;
  wide?: boolean;
}> = ({ title, subtitle, icon: Icon, onClose, children, footer, wide }) => (
  <div className="fixed inset-0 z-50 bg-black/75 flex items-center justify-center p-6" onMouseDown={onClose}>
    <div
      className={`bg-neutral-900 border border-neutral-800 rounded-xl w-full ${wide ? 'max-w-2xl' : 'max-w-lg'} max-h-[88vh] shadow-2xl flex flex-col text-neutral-200`}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <div className="px-5 py-3.5 border-b border-neutral-800 flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-blue-600/20 border border-blue-500/40 flex items-center justify-center text-blue-400">
            <Icon className="w-4 h-4" />
          </div>
          <div>
            <h2 className="text-sm font-semibold text-white">{title}</h2>
            <p className="text-[11px] text-neutral-400">{subtitle}</p>
          </div>
        </div>
        <button onClick={onClose} className="p-1.5 text-neutral-400 hover:text-white rounded" title="Close">
          <X className="w-4 h-4" />
        </button>
      </div>
      <div className="p-5 overflow-y-auto space-y-4 text-xs">{children}</div>
      <div className="px-5 py-3 border-t border-neutral-800 flex items-center justify-end gap-2">{footer}</div>
    </div>
  </div>
);

const Label: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="text-[11px] font-medium text-neutral-400 mb-1.5">{children}</div>
);

const inputCls =
  'w-full bg-neutral-800 border border-neutral-700 rounded-md px-2.5 py-1.5 text-xs text-neutral-100 outline-none focus:border-blue-500 placeholder:text-neutral-500';

const PrimaryBtn: React.FC<{ onClick: () => void; disabled?: boolean; busy?: boolean; children: React.ReactNode }> = ({
  onClick,
  disabled,
  busy,
  children
}) => (
  <button
    onClick={onClick}
    disabled={disabled || busy}
    className="px-4 py-1.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-40 disabled:hover:bg-blue-600 text-white rounded-md text-xs font-medium flex items-center gap-1.5"
  >
    {busy && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
    {children}
  </button>
);

const SecondaryBtn: React.FC<{ onClick: () => void; children: React.ReactNode; disabled?: boolean }> = ({ onClick, children, disabled }) => (
  <button
    onClick={onClick}
    disabled={disabled}
    className="px-3 py-1.5 bg-neutral-800 hover:bg-neutral-700 border border-neutral-700 rounded-md text-xs disabled:opacity-40"
  >
    {children}
  </button>
);

const Radio: React.FC<{ checked: boolean; onChange: () => void; children: React.ReactNode }> = ({ checked, onChange, children }) => (
  <label className="flex items-center gap-2 cursor-pointer py-0.5">
    <input type="radio" checked={checked} onChange={onChange} className="accent-blue-500" />
    <span>{children}</span>
  </label>
);

const ErrorText: React.FC<{ msg: string | null }> = ({ msg }) =>
  msg ? <p className="text-[11px] text-rose-400">{msg}</p> : null;

async function readPdfFile(file: File): Promise<{ name: string; bytes: Uint8Array; pageCount: number }> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const pageCount = await getPageCount(bytes);
  return { name: file.name, bytes, pageCount };
}

const stripPdf = (name: string) => name.replace(/\.pdf$/i, '');

// ---------- Split ----------

export const SplitModal: React.FC<{
  totalPages: number;
  fileName: string;
  busy: boolean;
  onClose: () => void;
  onSplit: (groups: number[][], baseName: string) => void;
}> = ({ totalPages, fileName, busy, onClose, onSplit }) => {
  const [mode, setMode] = useState<'every' | 'ranges'>('every');
  const [every, setEvery] = useState(1);
  const [ranges, setRanges] = useState(totalPages > 1 ? `1-${Math.ceil(totalPages / 2)}, ${Math.ceil(totalPages / 2) + 1}-${totalPages}` : '1');
  const [baseName, setBaseName] = useState(stripPdf(fileName));

  const groups = useMemo<number[][] | null>(() => {
    if (mode === 'every') {
      const n = Math.max(1, Math.floor(every) || 1);
      const out: number[][] = [];
      for (let i = 0; i < totalPages; i += n) out.push(range(Math.min(n, totalPages - i)).map((k) => i + k));
      return out;
    }
    const out: number[][] = [];
    for (const part of ranges.split(',').map((s) => s.trim()).filter(Boolean)) {
      const g = parsePageRanges(part, totalPages);
      if (!g) return null;
      out.push(g);
    }
    return out.length ? out : null;
  }, [mode, every, ranges, totalPages]);

  return (
    <Shell
      title="Split document"
      subtitle={`Break this ${totalPages}-page PDF into separate files`}
      icon={Scissors}
      onClose={onClose}
      footer={
        <>
          <SecondaryBtn onClick={onClose}>Cancel</SecondaryBtn>
          <PrimaryBtn busy={busy} disabled={!groups || groups.length < 1} onClick={() => groups && onSplit(groups, baseName || 'split')}>
            Split into {groups?.length ?? 0} files
          </PrimaryBtn>
        </>
      }
    >
      <div>
        <Label>Split method</Label>
        <Radio checked={mode === 'every'} onChange={() => setMode('every')}>
          Every
          <input
            type="number"
            min={1}
            max={totalPages}
            value={every}
            onChange={(e) => setEvery(parseInt(e.target.value, 10) || 1)}
            onFocus={() => setMode('every')}
            className="mx-2 w-14 bg-neutral-800 border border-neutral-700 rounded px-1.5 py-0.5 text-xs"
          />
          page(s)
        </Radio>
        <Radio checked={mode === 'ranges'} onChange={() => setMode('ranges')}>
          Custom ranges (one file per comma-separated range)
        </Radio>
        {mode === 'ranges' && (
          <input value={ranges} onChange={(e) => setRanges(e.target.value)} placeholder="e.g. 1-3, 4-6, 7-" className={`${inputCls} mt-1.5`} />
        )}
        <ErrorText msg={mode === 'ranges' && !groups ? `Use page numbers between 1 and ${totalPages}, e.g. 1-3, 4, 5-` : null} />
      </div>
      <div>
        <Label>File name prefix</Label>
        <input value={baseName} onChange={(e) => setBaseName(e.target.value)} className={inputCls} />
      </div>
      {groups && (
        <div>
          <Label>Output ({groups.length} files)</Label>
          <ul className="max-h-40 overflow-y-auto rounded-md border border-neutral-800 divide-y divide-neutral-800">
            {groups.map((g, i) => (
              <li key={i} className="px-2.5 py-1.5 flex items-center justify-between">
                <span className="flex items-center gap-1.5 text-neutral-300">
                  <FileText className="w-3.5 h-3.5 text-neutral-500" />
                  {baseName || 'split'}_part{i + 1}.pdf
                </span>
                <span className="text-neutral-500 font-mono">pages {formatPageRanges(g)}</span>
              </li>
            ))}
          </ul>
          <p className="text-[10px] text-neutral-500 mt-1.5">
            Your edits and annotations are included. You'll be asked for a folder if your browser supports it; otherwise each file downloads.
          </p>
        </div>
      )}
    </Shell>
  );
};

// ---------- Extract ----------

export const ExtractModal: React.FC<{
  totalPages: number;
  initialPages: number[];
  busy: boolean;
  onClose: () => void;
  onExtract: (indices: number[], opts: { removeFromDocument: boolean; openInEditor: boolean }) => void;
}> = ({ totalPages, initialPages, busy, onClose, onExtract }) => {
  const [value, setValue] = useState(formatPageRanges(initialPages));
  const [remove, setRemove] = useState(false);
  const [open, setOpen] = useState(false);
  const indices = parsePageRanges(value, totalPages);
  const tooMany = remove && indices && new Set(indices).size >= totalPages;

  return (
    <Shell
      title="Extract pages"
      subtitle="Save chosen pages as a new PDF"
      icon={FileOutput}
      onClose={onClose}
      footer={
        <>
          <SecondaryBtn onClick={onClose}>Cancel</SecondaryBtn>
          <PrimaryBtn
            busy={busy}
            disabled={!indices || !!tooMany}
            onClick={() => indices && onExtract([...new Set(indices)].sort((a, b) => a - b), { removeFromDocument: remove, openInEditor: open })}
          >
            Extract {indices ? new Set(indices).size : 0} page(s)
          </PrimaryBtn>
        </>
      }
    >
      <div>
        <Label>Pages (1–{totalPages})</Label>
        <input value={value} onChange={(e) => setValue(e.target.value)} placeholder="e.g. 1-3, 5" className={inputCls} autoFocus />
        <ErrorText msg={!indices ? `Enter pages between 1 and ${totalPages}, e.g. 1-3, 5` : null} />
      </div>
      <label className="flex items-center gap-2 cursor-pointer">
        <input type="checkbox" checked={remove} onChange={(e) => setRemove(e.target.checked)} className="accent-blue-500" />
        Delete these pages from the current document after extracting
      </label>
      <ErrorText msg={tooMany ? 'At least one page must stay in the current document.' : null} />
      <label className="flex items-center gap-2 cursor-pointer">
        <input type="checkbox" checked={open} onChange={(e) => setOpen(e.target.checked)} className="accent-blue-500" />
        Open the extracted PDF in the editor instead of downloading
      </label>
    </Shell>
  );
};

// ---------- Insert / merge ----------

export const InsertPdfModal: React.FC<{
  totalPages: number;
  currentPage: number;
  busy: boolean;
  onClose: () => void;
  onInsert: (bytes: Uint8Array, atIndex: number, pages: number[] | undefined, name: string) => void;
}> = ({ totalPages, currentPage, busy, onClose, onInsert }) => {
  const [file, setFile] = useState<{ name: string; bytes: Uint8Array; pageCount: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pagesValue, setPagesValue] = useState('');
  const [where, setWhere] = useState<'start' | 'end' | 'after'>('after');
  const [afterPage, setAfterPage] = useState(currentPage);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const pick = async (f: File | undefined) => {
    if (!f) return;
    setError(null);
    try {
      const info = await readPdfFile(f);
      setFile(info);
      setPagesValue(`1-${info.pageCount}`);
    } catch {
      setError(`"${f.name}" could not be read as a PDF.`);
    }
  };

  const otherPages = file ? parsePageRanges(pagesValue, file.pageCount) : null;
  const at = where === 'start' ? 0 : where === 'end' ? totalPages : Math.min(Math.max(afterPage, 0), totalPages);

  return (
    <Shell
      title="Insert / merge PDF"
      subtitle="Merge pages from another PDF into this document"
      icon={FilePlus2}
      onClose={onClose}
      footer={
        <>
          <SecondaryBtn onClick={onClose}>Cancel</SecondaryBtn>
          <PrimaryBtn busy={busy} disabled={!file || !otherPages} onClick={() => file && otherPages && onInsert(file.bytes, at, otherPages, file.name)}>
            Insert {otherPages?.length ?? 0} page(s)
          </PrimaryBtn>
        </>
      }
    >
      <input ref={inputRef} type="file" accept="application/pdf,.pdf" className="hidden" onChange={(e) => pick(e.target.files?.[0])} />
      <div
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          pick(e.dataTransfer.files?.[0]);
        }}
        className="border border-dashed border-neutral-700 hover:border-blue-500 rounded-lg p-4 flex flex-col items-center gap-1.5 cursor-pointer text-neutral-400"
      >
        <Upload className="w-5 h-5" />
        {file ? (
          <span className="text-neutral-200">
            {file.name} · {file.pageCount} pages
          </span>
        ) : (
          <span>Choose or drop a PDF file</span>
        )}
      </div>
      <ErrorText msg={error} />
      {file && (
        <>
          <div>
            <Label>Pages to insert from {file.name}</Label>
            <input value={pagesValue} onChange={(e) => setPagesValue(e.target.value)} className={inputCls} />
            <ErrorText msg={!otherPages ? `Enter pages between 1 and ${file.pageCount}` : null} />
          </div>
          <div>
            <Label>Insert position</Label>
            <Radio checked={where === 'start'} onChange={() => setWhere('start')}>
              Before first page
            </Radio>
            <Radio checked={where === 'after'} onChange={() => setWhere('after')}>
              After page
              <input
                type="number"
                min={1}
                max={totalPages}
                value={afterPage}
                onFocus={() => setWhere('after')}
                onChange={(e) => setAfterPage(parseInt(e.target.value, 10) || 1)}
                className="ml-2 w-14 bg-neutral-800 border border-neutral-700 rounded px-1.5 py-0.5 text-xs"
              />
            </Radio>
            <Radio checked={where === 'end'} onChange={() => setWhere('end')}>
              After last page
            </Radio>
          </div>
        </>
      )}
    </Shell>
  );
};

// ---------- Combine files ----------

interface CombineItem {
  id: string;
  name: string;
  bytes: Uint8Array | null; // null = the current (edited) document
  pageCount: number;
}

export const CombineModal: React.FC<{
  currentName: string;
  currentPageCount: number;
  busy: boolean;
  onClose: () => void;
  onCombine: (items: Array<{ bytes: Uint8Array | null }>, name: string, openInEditor: boolean) => void;
}> = ({ currentName, currentPageCount, busy, onClose, onCombine }) => {
  const [items, setItems] = useState<CombineItem[]>([
    { id: 'current', name: `${currentName} (current)`, bytes: null, pageCount: currentPageCount }
  ]);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState('Combined.pdf');
  const [open, setOpen] = useState(true);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const addFiles = async (files: FileList | null) => {
    if (!files) return;
    setError(null);
    const added: CombineItem[] = [];
    const failed: string[] = [];
    for (const f of Array.from(files)) {
      try {
        const info = await readPdfFile(f);
        added.push({ id: `${f.name}-${Date.now()}-${Math.random()}`, ...info });
      } catch {
        failed.push(f.name);
      }
    }
    setItems((prev) => [...prev, ...added]);
    if (failed.length) setError(`Skipped (not a readable PDF): ${failed.join(', ')}`);
  };

  const move = (i: number, d: number) =>
    setItems((prev) => {
      const next = [...prev];
      const j = i + d;
      if (j < 0 || j >= next.length) return prev;
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });

  const totalPages = items.reduce((s, it) => s + it.pageCount, 0);

  return (
    <Shell
      title="Combine files"
      subtitle="Join several PDFs into one document, in the order listed"
      icon={Files}
      wide
      onClose={onClose}
      footer={
        <>
          <SecondaryBtn onClick={onClose}>Cancel</SecondaryBtn>
          <PrimaryBtn
            busy={busy}
            disabled={items.length < 2}
            onClick={() => onCombine(items.map((it) => ({ bytes: it.bytes })), name.toLowerCase().endsWith('.pdf') ? name : `${name}.pdf`, open)}
          >
            Combine {items.length} files ({totalPages} pages)
          </PrimaryBtn>
        </>
      }
    >
      <input ref={inputRef} type="file" accept="application/pdf,.pdf" multiple className="hidden" onChange={(e) => addFiles(e.target.files)} />
      <div
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          addFiles(e.dataTransfer.files);
        }}
      >
        <ul className="rounded-lg border border-neutral-800 divide-y divide-neutral-800">
          {items.map((it, i) => (
            <li key={it.id} className="px-3 py-2 flex items-center gap-2">
              <span className="w-5 text-neutral-500 font-mono">{i + 1}</span>
              <FileText className="w-4 h-4 text-neutral-500 shrink-0" />
              <span className="flex-1 truncate text-neutral-200">{it.name}</span>
              <span className="text-neutral-500 font-mono">{it.pageCount}p</span>
              <button onClick={() => move(i, -1)} disabled={i === 0} className="p-1 text-neutral-400 hover:text-white disabled:opacity-30" title="Move up">
                <ArrowUp className="w-3.5 h-3.5" />
              </button>
              <button onClick={() => move(i, 1)} disabled={i === items.length - 1} className="p-1 text-neutral-400 hover:text-white disabled:opacity-30" title="Move down">
                <ArrowDown className="w-3.5 h-3.5" />
              </button>
              <button onClick={() => setItems((p) => p.filter((x) => x.id !== it.id))} className="p-1 text-neutral-400 hover:text-rose-400" title="Remove">
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </li>
          ))}
        </ul>
        <button
          onClick={() => inputRef.current?.click()}
          className="mt-2 w-full border border-dashed border-neutral-700 hover:border-blue-500 rounded-lg py-3 flex items-center justify-center gap-1.5 text-neutral-400 hover:text-neutral-200"
        >
          <Upload className="w-4 h-4" /> Add PDF files (or drop them here)
        </button>
      </div>
      <ErrorText msg={error} />
      <div className="grid grid-cols-2 gap-3 items-end">
        <div>
          <Label>Output file name</Label>
          <input value={name} onChange={(e) => setName(e.target.value)} className={inputCls} />
        </div>
        <label className="flex items-center gap-2 cursor-pointer pb-1.5">
          <input type="checkbox" checked={open} onChange={(e) => setOpen(e.target.checked)} className="accent-blue-500" />
          Open result in the editor
        </label>
      </div>
    </Shell>
  );
};

// ---------- Page numbers ----------

const POSITIONS: Array<{ id: PageNumberPosition; label: string }> = [
  { id: 'top-left', label: 'Top left' },
  { id: 'top-center', label: 'Top center' },
  { id: 'top-right', label: 'Top right' },
  { id: 'bottom-left', label: 'Bottom left' },
  { id: 'bottom-center', label: 'Bottom center' },
  { id: 'bottom-right', label: 'Bottom right' }
];

const FORMATS: Array<{ id: PageNumberFormat }> = [
  { id: 'n' },
  { id: 'page-n' },
  { id: 'page-n-of-total' },
  { id: 'n-of-total' },
  { id: 'dash-n' }
];

export const PageNumbersModal: React.FC<{
  totalPages: number;
  busy: boolean;
  onClose: () => void;
  onApply: (opts: PageNumberOptions) => void;
}> = ({ totalPages, busy, onClose, onApply }) => {
  const [position, setPosition] = useState<PageNumberPosition>('bottom-center');
  const [format, setFormat] = useState<PageNumberFormat>('page-n-of-total');
  const [startAt, setStartAt] = useState(1);
  const [fontSize, setFontSize] = useState(10);
  const [margin, setMargin] = useState(24);
  const [color, setColor] = useState('#333333');
  const [bold, setBold] = useState(false);
  const [scope, setScope] = useState<'all' | 'skip-first' | 'custom'>('all');
  const [custom, setCustom] = useState(`1-${totalPages}`);

  const pages =
    scope === 'all' ? range(totalPages) : scope === 'skip-first' ? range(totalPages).slice(1) : parsePageRanges(custom, totalPages);
  const lastNumber = startAt + (pages?.length ?? 1) - 1;
  const sample = formatPageNumber(format, startAt, lastNumber);

  useEffect(() => {
    if (scope === 'skip-first' && startAt === 1) setStartAt(2);
    if (scope !== 'skip-first' && startAt === 2) setStartAt(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope]);

  const [vert, horiz] = position.split('-');

  return (
    <Shell
      title="Add page numbers"
      subtitle="Stamp page numbers onto the pages"
      icon={Hash}
      wide
      onClose={onClose}
      footer={
        <>
          <SecondaryBtn onClick={onClose}>Cancel</SecondaryBtn>
          <PrimaryBtn
            busy={busy}
            disabled={!pages || pages.length === 0}
            onClick={() =>
              pages && onApply({ position, format, startAt, fontSize, marginPt: margin, color, bold, pages })
            }
          >
            Add numbers to {pages?.length ?? 0} page(s)
          </PrimaryBtn>
        </>
      }
    >
      <div className="grid grid-cols-[1fr_150px] gap-5">
        <div className="space-y-4">
          <div>
            <Label>Position</Label>
            <div className="grid grid-cols-3 gap-1">
              {POSITIONS.map((p) => (
                <button
                  key={p.id}
                  onClick={() => setPosition(p.id)}
                  className={`px-2 py-1.5 rounded-md border text-[11px] ${
                    position === p.id ? 'border-blue-500 bg-blue-600/20 text-white' : 'border-neutral-700 bg-neutral-800 text-neutral-400 hover:text-neutral-200'
                  }`}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>
          <div>
            <Label>Format</Label>
            <div className="flex flex-wrap gap-1">
              {FORMATS.map((f) => (
                <button
                  key={f.id}
                  onClick={() => setFormat(f.id)}
                  className={`px-2 py-1 rounded-md border text-[11px] font-mono ${
                    format === f.id ? 'border-blue-500 bg-blue-600/20 text-white' : 'border-neutral-700 bg-neutral-800 text-neutral-400 hover:text-neutral-200'
                  }`}
                >
                  {formatPageNumber(f.id, 1, totalPages)}
                </button>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-4 gap-2">
            <div>
              <Label>Start at</Label>
              <input type="number" min={0} value={startAt} onChange={(e) => setStartAt(parseInt(e.target.value, 10) || 0)} className={inputCls} />
            </div>
            <div>
              <Label>Size (pt)</Label>
              <input type="number" min={6} max={36} value={fontSize} onChange={(e) => setFontSize(parseInt(e.target.value, 10) || 10)} className={inputCls} />
            </div>
            <div>
              <Label>Margin (pt)</Label>
              <input type="number" min={4} max={120} value={margin} onChange={(e) => setMargin(parseInt(e.target.value, 10) || 24)} className={inputCls} />
            </div>
            <div>
              <Label>Color</Label>
              <input type="color" value={color} onChange={(e) => setColor(e.target.value)} className="w-full h-[30px] bg-neutral-800 border border-neutral-700 rounded-md" />
            </div>
          </div>
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={bold} onChange={(e) => setBold(e.target.checked)} className="accent-blue-500" />
            Bold
          </label>
          <div>
            <Label>Pages</Label>
            <Radio checked={scope === 'all'} onChange={() => setScope('all')}>
              All pages
            </Radio>
            <Radio checked={scope === 'skip-first'} onChange={() => setScope('skip-first')}>
              All except the first page (cover)
            </Radio>
            <Radio checked={scope === 'custom'} onChange={() => setScope('custom')}>
              Custom range
            </Radio>
            {scope === 'custom' && <input value={custom} onChange={(e) => setCustom(e.target.value)} className={`${inputCls} mt-1`} />}
            <ErrorText msg={!pages ? `Enter pages between 1 and ${totalPages}` : null} />
          </div>
        </div>

        {/* Live preview */}
        <div>
          <Label>Preview</Label>
          <div
            className="relative bg-white rounded shadow-inner aspect-[1/1.414] w-full overflow-hidden"
            style={{ padding: `${(margin / 842) * 100}%` }}
          >
            <div className="space-y-1.5 pt-4 px-1 opacity-60">
              {range(9).map((i) => (
                <div key={i} className="h-1 bg-neutral-300 rounded" style={{ width: `${60 + ((i * 37) % 40)}%` }} />
              ))}
            </div>
            <div
              className="absolute whitespace-nowrap"
              style={{
                color,
                fontWeight: bold ? 700 : 400,
                fontFamily: 'Helvetica, Arial, sans-serif',
                fontSize: `${Math.max(6, fontSize * 0.42)}px`,
                [vert === 'top' ? 'top' : 'bottom']: `${(margin / 842) * 100}%`,
                ...(horiz === 'left'
                  ? { left: `${(margin / 595) * 100}%` }
                  : horiz === 'right'
                  ? { right: `${(margin / 595) * 100}%` }
                  : { left: '50%', transform: 'translateX(-50%)' })
              }}
            >
              {sample}
            </div>
          </div>
        </div>
      </div>
    </Shell>
  );
};
