import React, { useEffect, useRef, useState } from 'react';
import {
  List,
  ListOrdered,
  ListTree,
  ListIndentDecrease,
  ListIndentIncrease,
  TextAlignStart,
  TextAlignCenter,
  TextAlignEnd,
  TextAlignJustify,
  ListChevronsUpDown,
  ChevronDown
} from 'lucide-react';
import { BULLET_CHARS, ListKind, NUMBER_FORMATS, formatNumber } from '../services/textFormatting';

export type TextAlign = 'left' | 'center' | 'right' | 'justify';

export const LINE_SPACINGS = [1, 1.15, 1.5, 2, 2.5, 3];

interface ParagraphControlsProps {
  align: TextAlign;
  onAlign: (a: TextAlign) => void;
  /** List type of the line under the caret, to highlight its button */
  activeList: 'bullet' | 'number' | null;
  onList: (kind: ListKind) => void;
  onIndent: (delta: 1 | -1) => void;
  /** Current spacing multiple, or null for "as in the PDF" */
  lineSpacing: number | null;
  onLineSpacing: (v: number | null) => void;
  /** Offer "Original" in the spacing menu (PDF text keeps its own line pitch) */
  hasOriginalSpacing?: boolean;
  lineSpacingDisabledReason?: string;
}

type Menu = 'bullet' | 'number' | 'multi' | 'spacing' | null;

const icon = 'w-3.5 h-3.5';
const base = 'h-[26px] px-1.5 rounded flex items-center justify-center';
const idle = 'bg-neutral-800 hover:bg-neutral-700';
const on = 'bg-blue-600';

/** Word-style paragraph buttons: lists, indent, alignment and line spacing. */
export const ParagraphControls: React.FC<ParagraphControlsProps> = ({
  align,
  onAlign,
  activeList,
  onList,
  onIndent,
  lineSpacing,
  onLineSpacing,
  hasOriginalSpacing,
  lineSpacingDisabledReason
}) => {
  const [menu, setMenu] = useState<Menu>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!menu) return;
    const close = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setMenu(null);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [menu]);

  const pick = (fn: () => void) => () => {
    setMenu(null);
    fn();
  };

  const split = (
    id: Exclude<Menu, null | 'spacing'>,
    Icon: React.ComponentType<{ className?: string }>,
    title: string,
    active: boolean,
    onMain: () => void,
    items: Array<{ key: string; label: React.ReactNode; title: string; kind: ListKind }>,
    columns = 4
  ) => (
    <div className="relative flex">
      <button onClick={onMain} className={`${base} rounded-r-none ${active ? on : idle}`} title={title}>
        <Icon className={icon} />
      </button>
      <button
        onClick={() => setMenu((m) => (m === id ? null : id))}
        className={`${base} rounded-l-none px-0.5 border-l border-neutral-900/60 ${menu === id ? 'bg-neutral-700' : idle}`}
        title={`${title} styles`}
      >
        <ChevronDown className="w-3 h-3" />
      </button>
      {menu === id && (
        <div
          className="absolute top-full left-0 mt-1 p-1.5 bg-neutral-900 border border-neutral-700 rounded-md shadow-2xl z-50 grid gap-1"
          style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
        >
          {items.map((it) => (
            <button
              key={it.key}
              onClick={pick(() => onList(it.kind))}
              title={it.title}
              className="min-w-[52px] px-2 py-1.5 rounded bg-white text-neutral-900 hover:ring-2 hover:ring-blue-500 text-left text-[11px] leading-tight font-serif"
            >
              {it.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );

  const sample = (marks: string[]) => (
    <span className="block">
      {marks.map((m, i) => (
        <span key={i} className="flex items-center gap-1">
          <span className="w-4 shrink-0">{m}</span>
          <span className="h-[2px] w-5 bg-neutral-400 inline-block" />
        </span>
      ))}
    </span>
  );

  const alignBtn = (a: TextAlign, Icon: React.ComponentType<{ className?: string }>, title: string) => (
    <button onClick={() => onAlign(a)} className={`${base} ${align === a ? on : idle}`} title={title}>
      <Icon className={icon} />
    </button>
  );

  const fmtSpacing = (v: number) => (Number.isInteger(v) ? v.toFixed(1) : String(v));

  return (
    <div ref={rootRef} className="flex items-center gap-1">
      {split(
        'bullet',
        List,
        'Bullets',
        activeList === 'bullet',
        () => onList({ type: 'bullet', char: '•' }),
        BULLET_CHARS.map((c) => ({ key: c, label: sample([c, c, c]), title: `Bullet ${c}`, kind: { type: 'bullet', char: c } }))
      )}
      {split(
        'number',
        ListOrdered,
        'Numbering',
        activeList === 'number',
        () => onList({ type: 'number', format: '1.' }),
        NUMBER_FORMATS.map((f) => ({
          key: f,
          label: sample([1, 2, 3].map((n) => formatNumber(n, f))),
          title: `Numbering ${formatNumber(1, f)} ${formatNumber(2, f)} ${formatNumber(3, f)}`,
          kind: { type: 'number', format: f }
        }))
      )}
      {split(
        'multi',
        ListTree,
        'Multilevel list (use the indent buttons to change an item’s level)',
        false,
        () => onList({ type: 'multi' }),
        [
          {
            key: 'multi',
            label: (
              <span className="block">
                <span className="flex gap-1"><span className="w-4">1.</span><span className="h-[2px] w-6 bg-neutral-400 self-center" /></span>
                <span className="flex gap-1 pl-2"><span className="w-4">a.</span><span className="h-[2px] w-5 bg-neutral-400 self-center" /></span>
                <span className="flex gap-1 pl-4"><span className="w-4">i.</span><span className="h-[2px] w-4 bg-neutral-400 self-center" /></span>
              </span>
            ),
            title: '1. / a. / i.',
            kind: { type: 'multi' }
          }
        ],
        1
      )}

      <span className="w-px h-5 bg-neutral-700 mx-0.5" />
      <button onClick={() => onIndent(-1)} className={`${base} ${idle}`} title="Decrease indent (or list level)">
        <ListIndentDecrease className={icon} />
      </button>
      <button onClick={() => onIndent(1)} className={`${base} ${idle}`} title="Increase indent (or list level)">
        <ListIndentIncrease className={icon} />
      </button>

      <span className="w-px h-5 bg-neutral-700 mx-0.5" />
      {alignBtn('left', TextAlignStart, 'Align left')}
      {alignBtn('center', TextAlignCenter, 'Center')}
      {alignBtn('right', TextAlignEnd, 'Align right')}
      {alignBtn('justify', TextAlignJustify, 'Justify')}

      <span className="w-px h-5 bg-neutral-700 mx-0.5" />
      <div className="relative">
        <button
          onClick={() => !lineSpacingDisabledReason && setMenu((m) => (m === 'spacing' ? null : 'spacing'))}
          className={`${base} gap-0.5 ${lineSpacingDisabledReason ? 'bg-neutral-800 opacity-40 cursor-not-allowed' : menu === 'spacing' ? 'bg-neutral-700' : idle}`}
          title={lineSpacingDisabledReason || 'Line spacing'}
        >
          <ListChevronsUpDown className={icon} />
          <ChevronDown className="w-3 h-3" />
        </button>
        {menu === 'spacing' && (
          <div className="absolute top-full right-0 mt-1 w-32 bg-neutral-900 border border-neutral-700 rounded-md shadow-2xl py-1 z-50">
            {hasOriginalSpacing && (
              <button
                onClick={pick(() => onLineSpacing(null))}
                className={`block w-full text-left px-3 py-1 hover:bg-neutral-800 ${lineSpacing === null ? 'text-blue-300' : 'text-neutral-200'}`}
              >
                {lineSpacing === null ? '✓ ' : ''}As in PDF
              </button>
            )}
            {LINE_SPACINGS.map((v) => (
              <button
                key={v}
                onClick={pick(() => onLineSpacing(v))}
                className={`block w-full text-left px-3 py-1 hover:bg-neutral-800 font-mono ${lineSpacing === v ? 'text-blue-300' : 'text-neutral-200'}`}
              >
                {lineSpacing === v ? '✓ ' : ''}
                {fmtSpacing(v)}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
