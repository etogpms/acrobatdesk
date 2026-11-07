import React, { useState } from 'react';
import {
  MousePointer,
  Hand,
  Highlighter,
  PenTool,
  Type,
  FileSignature,
  Square,
  Circle,
  ArrowUpRight,
  EyeOff,
  MessageSquare,
  ScanText,
  Layers,
  Check,
  X,
  Calendar,
  Edit3,
  ArrowLeftRight,
  ChevronDown,
  ChevronRight,
  PanelLeftClose,
  PanelLeftOpen,
  Scissors,
  FileOutput,
  FilePlus2,
  Files,
  Hash,
  Stamp,
  Search,
  Image as ImageIcon,
  ShieldCheck,
  ShieldOff
} from 'lucide-react';
import { ToolMode, ShapeType, PageTool, TextToolStyle } from '../types/pdf';
import { FONT_FAMILIES, FontFamilyId, cssStack, registerFontFaces } from '../services/fontLibrary';

interface ToolsPanelProps {
  currentMode: ToolMode;
  onModeChange: (mode: ToolMode) => void;
  activeColor: string;
  onColorChange: (color: string) => void;
  strokeWidth: number;
  onStrokeWidthChange: (w: number) => void;
  fontSize: number;
  onFontSizeChange: (size: number) => void;
  textStyle: TextToolStyle;
  onTextStyleChange: (style: TextToolStyle) => void;
  shapeType: ShapeType;
  onShapeTypeChange: (shape: ShapeType) => void;
  onOpenSignatureModal: () => void;
  onOpenPageTool: (tool: PageTool) => void;
  onOpenSearch: () => void;
  onInsertImage: () => void;
  protectSignatures: boolean;
  onToggleProtectSignatures: () => void;
  onOpenConversionModal: () => void;
  onTriggerOcr: () => void;
  onPlaceQuickElement: (type: 'check' | 'cross' | 'date' | 'stamp', stampText?: string) => void;
}

const COLOR_PRESETS = ['#FBBF24', '#34D399', '#38BDF8', '#F472B6', '#A78BFA', '#EF4444', '#1E293B', '#000000'];

const STAMP_PRESETS = [
  { label: 'APPROVED', color: '#16A34A' },
  { label: 'CONFIDENTIAL', color: '#DC2626' },
  { label: 'COMPLETED', color: '#2563EB' },
  { label: 'RECEIVED', color: '#D97706' },
  { label: 'DRAFT', color: '#6B7280' }
];

type GroupId = 'basic' | 'edit' | 'comment' | 'sign' | 'pages' | 'convert';

const STORAGE_KEY = 'acrobatdesk.toolsPanel';

function readPrefs(): { collapsed: boolean; closedGroups: GroupId[] } {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch {
    /* storage unavailable */
  }
  return { collapsed: false, closedGroups: [] };
}

function writePrefs(p: { collapsed: boolean; closedGroups: GroupId[] }) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(p));
  } catch {
    /* storage unavailable */
  }
}

export const ToolsPanel: React.FC<ToolsPanelProps> = (props) => {
  const {
    currentMode,
    onModeChange,
    activeColor,
    onColorChange,
    strokeWidth,
    onStrokeWidthChange,
    fontSize,
    onFontSizeChange,
    textStyle,
    onTextStyleChange,
    shapeType,
    onShapeTypeChange,
    onOpenSignatureModal,
    onOpenPageTool,
    onOpenSearch,
    onInsertImage,
    protectSignatures,
    onToggleProtectSignatures,
    onOpenConversionModal,
    onTriggerOcr,
    onPlaceQuickElement
  } = props;

  const [prefs, setPrefs] = useState(readPrefs);
  const collapsed = prefs.collapsed;
  const updatePrefs = (next: typeof prefs) => {
    setPrefs(next);
    writePrefs(next);
  };
  const toggleGroup = (g: GroupId) => {
    const closed = prefs.closedGroups.includes(g)
      ? prefs.closedGroups.filter((x) => x !== g)
      : [...prefs.closedGroups, g];
    updatePrefs({ ...prefs, closedGroups: closed });
  };

  // ---------- building blocks ----------

  const ToolButton: React.FC<{
    icon: React.ElementType;
    label: string;
    hint?: string;
    active?: boolean;
    accent?: string;
    onClick: () => void;
  }> = ({ icon: Icon, label, hint, active, accent = 'text-neutral-400', onClick }) => (
    <button
      onClick={onClick}
      title={hint || label}
      className={`w-full flex items-center gap-2.5 rounded-md text-[12px] transition-colors ${
        collapsed ? 'justify-center p-2' : 'px-2.5 py-1.5'
      } ${
        active
          ? 'bg-blue-600/20 text-white ring-1 ring-inset ring-blue-500/50'
          : 'text-neutral-300 hover:bg-neutral-800 hover:text-white'
      }`}
    >
      <Icon className={`w-4 h-4 shrink-0 ${active ? 'text-blue-300' : accent}`} />
      {!collapsed && <span className="truncate">{label}</span>}
    </button>
  );

  const Group: React.FC<{ id: GroupId; title: string; children: React.ReactNode }> = ({ id, title, children }) => {
    const isClosed = !collapsed && prefs.closedGroups.includes(id);
    return (
      <section className={collapsed ? 'py-1.5 border-b border-neutral-800/80 last:border-0' : 'pb-1'}>
        {!collapsed && (
          <button
            onClick={() => toggleGroup(id)}
            className="w-full flex items-center justify-between px-2.5 pt-3 pb-1 text-[10px] font-semibold uppercase tracking-wider text-neutral-500 hover:text-neutral-300"
          >
            <span>{title}</span>
            {isClosed ? <ChevronRight className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
          </button>
        )}
        {!isClosed && <div className="space-y-0.5 px-1.5">{children}</div>}
      </section>
    );
  };

  const OptionRow: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
    <div className="flex items-center gap-2">
      <span className="text-[10px] text-neutral-500 w-12 shrink-0">{label}</span>
      <div className="flex flex-wrap items-center gap-1">{children}</div>
    </div>
  );

  const Chip: React.FC<{ active: boolean; onClick: () => void; children: React.ReactNode; title?: string }> = ({
    active,
    onClick,
    children,
    title
  }) => (
    <button
      onClick={onClick}
      title={title}
      className={`px-1.5 py-0.5 rounded text-[10px] font-mono ${
        active ? 'bg-neutral-600 text-white' : 'bg-neutral-800 text-neutral-400 hover:text-neutral-200'
      }`}
    >
      {children}
    </button>
  );

  const ColorRow = () => (
    <OptionRow label="Color">
      {COLOR_PRESETS.map((c) => (
        <button
          key={c}
          onClick={() => onColorChange(c)}
          style={{ backgroundColor: c }}
          aria-label={`Color ${c}`}
          className={`w-3.5 h-3.5 rounded-full border border-white/10 ${
            activeColor.toLowerCase() === c.toLowerCase() ? 'ring-2 ring-white/70 ring-offset-1 ring-offset-neutral-900' : ''
          }`}
        />
      ))}
    </OptionRow>
  );

  // Options shown directly under the active tool (expanded panel only)
  const Options: React.FC<{ mode: ToolMode }> = ({ mode }) => {
    if (collapsed || currentMode !== mode) return null;
    return (
      <div className="ml-3 mr-1 mb-1.5 mt-0.5 pl-3 border-l border-blue-500/40 space-y-1.5 py-1">
        {mode === 'edit_text' && (
          <p className="text-[10px] leading-snug text-neutral-400">
            Click any text to edit it in place. Use the B / I / U buttons in the top bar (or ⌘B / ⌘I) to bold or italicize selected words; pick a font in the top bar (Auto keeps the PDF's own). Enter saves, Esc cancels.
          </p>
        )}
        {mode === 'text' && (
          <>
            <OptionRow label="Font">
              <select
                value={textStyle.fontChoice}
                onFocus={() => registerFontFaces()}
                onChange={(e) => onTextStyleChange({ ...textStyle, fontChoice: e.target.value as TextToolStyle['fontChoice'] })}
                className="bg-neutral-800 text-neutral-200 text-[11px] rounded px-1.5 py-0.5 border border-neutral-700 outline-none focus:border-blue-500 max-w-[150px]"
                title="Font for new text. Auto detect matches the PDF text nearest to where you click."
              >
                <option value="auto">Auto detect</option>
                {FONT_FAMILIES.map((f) => (
                  <option key={f.id} value={f.id} style={{ fontFamily: cssStack(f.id as FontFamilyId) }}>
                    {f.label}
                  </option>
                ))}
              </select>
            </OptionRow>
            <OptionRow label="Style">
              <Chip active={textStyle.bold} onClick={() => onTextStyleChange({ ...textStyle, bold: !textStyle.bold })} title="Bold">
                <span className="font-bold">B</span>
              </Chip>
              <Chip active={textStyle.italic} onClick={() => onTextStyleChange({ ...textStyle, italic: !textStyle.italic })} title="Italic">
                <span className="italic font-serif">I</span>
              </Chip>
            </OptionRow>
            <OptionRow label="Size">
              {[10, 12, 14, 18, 24].map((s) => (
                <Chip key={s} active={fontSize === s} onClick={() => onFontSizeChange(s)}>
                  {s}
                </Chip>
              ))}
            </OptionRow>
            <ColorRow />
          </>
        )}
        {(mode === 'highlight' || mode === 'shape') && <ColorRow />}
        {mode === 'pen' && (
          <>
            <OptionRow label="Width">
              {[1, 2, 4, 8].map((w) => (
                <Chip key={w} active={strokeWidth === w} onClick={() => onStrokeWidthChange(w)}>
                  {w}px
                </Chip>
              ))}
            </OptionRow>
            <ColorRow />
          </>
        )}
        {mode === 'shape' && (
          <OptionRow label="Shape">
            <Chip active={shapeType === 'rectangle'} onClick={() => onShapeTypeChange('rectangle')} title="Rectangle">
              <Square className="w-3 h-3" />
            </Chip>
            <Chip active={shapeType === 'circle'} onClick={() => onShapeTypeChange('circle')} title="Ellipse">
              <Circle className="w-3 h-3" />
            </Chip>
            <Chip active={shapeType === 'arrow'} onClick={() => onShapeTypeChange('arrow')} title="Arrow">
              <ArrowUpRight className="w-3 h-3" />
            </Chip>
          </OptionRow>
        )}
        {mode === 'edit_image' && (
          <>
            <p className="text-[10px] leading-snug text-neutral-400">
              Click an image to select it. Drag to move, corner to resize. ⌘C copy · ⌘V paste · Delete removes it from the PDF.
            </p>
            <button onClick={onInsertImage} className="text-[10px] px-2 py-1 rounded bg-pink-600 hover:bg-pink-500 text-white">
              Insert image from file…
            </button>
          </>
        )}
        {mode === 'note' && (
          <p className="text-[10px] leading-snug text-neutral-400">
            Drag across words to highlight them and comment. Click anywhere to pin a comment. Tip: right-click any text, image or signature to comment on it.
          </p>
        )}
        {mode === 'highlight' && (
          <p className="text-[10px] leading-snug text-neutral-400">Drag across words to highlight them, or drag on empty space for an area.</p>
        )}
        {mode === 'redact' && (
          <p className="text-[10px] leading-snug text-neutral-400">Drag over the area to black out.</p>
        )}
        {mode === 'signature' && (
          <button
            onClick={onOpenSignatureModal}
            className="text-[10px] px-2 py-1 rounded bg-purple-600 hover:bg-purple-500 text-white"
          >
            Create / choose signature
          </button>
        )}
      </div>
    );
  };

  return (
    <aside
      className={`${collapsed ? 'w-12' : 'w-56'} bg-neutral-900 border-r border-neutral-800 flex flex-col shrink-0 h-full select-none z-10 transition-[width] duration-150`}
    >
      <div className={`h-10 border-b border-neutral-800 flex items-center ${collapsed ? 'justify-center' : 'justify-between px-3'}`}>
        {!collapsed && <span className="text-xs font-medium text-neutral-300">Tools</span>}
        <button
          onClick={() => updatePrefs({ ...prefs, collapsed: !collapsed })}
          className="p-1 text-neutral-400 hover:text-white hover:bg-neutral-800 rounded"
          title={collapsed ? 'Expand tools panel' : 'Collapse to icons'}
        >
          {collapsed ? <PanelLeftOpen className="w-4 h-4" /> : <PanelLeftClose className="w-4 h-4" />}
        </button>
      </div>

      <div className="flex-1 overflow-y-auto overflow-x-hidden pb-4">
        <Group id="basic" title="Navigate">
          <ToolButton icon={MousePointer} label="Select" hint="Select & move objects" active={currentMode === 'select'} onClick={() => onModeChange('select')} />
          <ToolButton icon={Hand} label="Pan" hint="Hand tool" active={currentMode === 'hand'} onClick={() => onModeChange('hand')} />
          <ToolButton icon={Search} label="Find text" hint="Search text in the PDF (Ctrl+F)" accent="text-amber-400" onClick={onOpenSearch} />
        </Group>

        <Group id="edit" title="Edit">
          <ToolButton icon={Edit3} label="Edit PDF text" accent="text-blue-400" active={currentMode === 'edit_text'} onClick={() => onModeChange('edit_text')} />
          <Options mode="edit_text" />
          <ToolButton icon={ImageIcon} label="Edit images" hint="Select, move, resize, copy, replace or delete images" accent="text-pink-400" active={currentMode === 'edit_image'} onClick={() => onModeChange('edit_image')} />
          <Options mode="edit_image" />
          <ToolButton icon={Type} label="Add text" accent="text-emerald-400" active={currentMode === 'text'} onClick={() => onModeChange('text')} />
          <Options mode="text" />
          <ToolButton icon={EyeOff} label="Redact" accent="text-rose-400" active={currentMode === 'redact'} onClick={() => onModeChange('redact')} />
          <Options mode="redact" />
        </Group>

        <Group id="comment" title="Comment & markup">
          <ToolButton icon={Highlighter} label="Highlight" accent="text-amber-400" active={currentMode === 'highlight'} onClick={() => onModeChange('highlight')} />
          <Options mode="highlight" />
          <ToolButton icon={PenTool} label="Draw" accent="text-sky-400" active={currentMode === 'pen'} onClick={() => onModeChange('pen')} />
          <Options mode="pen" />
          <ToolButton icon={Square} label="Shapes" accent="text-indigo-400" active={currentMode === 'shape'} onClick={() => onModeChange('shape')} />
          <Options mode="shape" />
          <ToolButton icon={MessageSquare} label="Comment" hint="Drag across text to highlight & comment, or click to pin a comment" accent="text-amber-300" active={currentMode === 'note'} onClick={() => onModeChange('note')} />
          <Options mode="note" />
        </Group>

        <Group id="sign" title="Fill & sign">
          <ToolButton
            icon={FileSignature}
            label="Signature"
            accent="text-purple-400"
            active={currentMode === 'signature'}
            onClick={() => {
              onModeChange('signature');
              onOpenSignatureModal();
            }}
          />
          <Options mode="signature" />
          {collapsed ? (
            <ToolButton
              icon={protectSignatures ? ShieldCheck : ShieldOff}
              label="Signature protection"
              hint={protectSignatures ? 'Copied signatures are redacted (click to turn off)' : 'Signature protection is off (click to turn on)'}
              accent={protectSignatures ? 'text-emerald-400' : 'text-neutral-500'}
              onClick={onToggleProtectSignatures}
            />
          ) : (
            <button
              onClick={onToggleProtectSignatures}
              title="When on, copying a signature puts a redacted placeholder on the clipboard instead of the real signature"
              className="w-full flex items-start gap-2 px-2.5 py-1.5 rounded-md text-left hover:bg-neutral-800"
            >
              {protectSignatures ? <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" /> : <ShieldOff className="w-4 h-4 text-neutral-500 shrink-0 mt-0.5" />}
              <span className="text-[11px] leading-snug">
                <span className={protectSignatures ? 'text-emerald-300' : 'text-neutral-400'}>
                  Signature protection {protectSignatures ? 'on' : 'off'}
                </span>
                <span className="block text-[10px] text-neutral-500">Copied signatures paste as redacted</span>
              </span>
            </button>
          )}
          <ToolButton icon={Check} label="Checkmark" accent="text-emerald-400" onClick={() => onPlaceQuickElement('check')} />
          <ToolButton icon={X} label="Cross" accent="text-rose-400" onClick={() => onPlaceQuickElement('cross')} />
          <ToolButton icon={Calendar} label="Today's date" accent="text-sky-400" onClick={() => onPlaceQuickElement('date')} />
          {collapsed ? (
            <ToolButton icon={Stamp} label="Stamp" hint="Approved stamp" accent="text-green-500" onClick={() => onPlaceQuickElement('stamp', 'APPROVED')} />
          ) : (
            <div className="flex flex-wrap gap-1 px-1 pt-1">
              {STAMP_PRESETS.map((st) => (
                <button
                  key={st.label}
                  onClick={() => onPlaceQuickElement('stamp', st.label)}
                  style={{ color: st.color }}
                  className="px-1.5 py-0.5 rounded text-[9px] font-bold border border-current hover:bg-neutral-800"
                >
                  {st.label}
                </button>
              ))}
            </div>
          )}
        </Group>

        <Group id="pages" title="Pages">
          <ToolButton icon={Layers} label="Organize pages" hint="Reorder, rotate, duplicate & delete" onClick={() => onOpenPageTool('organize')} />
          <ToolButton icon={FilePlus2} label="Insert / merge PDF" hint="Merge pages from another PDF into this one" onClick={() => onOpenPageTool('insert')} />
          <ToolButton icon={Files} label="Combine files" hint="Combine several PDFs into one document" onClick={() => onOpenPageTool('combine')} />
          <ToolButton icon={FileOutput} label="Extract pages" hint="Save selected pages as a new PDF" onClick={() => onOpenPageTool('extract')} />
          <ToolButton icon={Scissors} label="Split document" hint="Split into several PDFs" onClick={() => onOpenPageTool('split')} />
          <ToolButton icon={Hash} label="Page numbers" hint="Add page numbers" onClick={() => onOpenPageTool('page_numbers')} />
        </Group>

        <Group id="convert" title="Recognize & convert">
          <ToolButton
            icon={ScanText}
            label="OCR"
            accent="text-cyan-400"
            active={currentMode === 'ocr'}
            onClick={() => {
              onModeChange('ocr');
              onTriggerOcr();
            }}
          />
          <ToolButton icon={ArrowLeftRight} label="Convert (Excel/Word)" accent="text-emerald-400" onClick={onOpenConversionModal} />
        </Group>
      </div>
    </aside>
  );
};
