import React, { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useRef } from 'react';
import { TextRun } from '../types/pdf';

export type RunAttr = 'bold' | 'italic' | 'underline';

export interface RichTextEditorApi {
  /** Toggle a style on the selection (or the word under the caret). */
  toggle: (attr: RunAttr) => void;
  /** Current content as styled runs. */
  getRuns: () => TextRun[];
  /** Which styles are fully on for the current selection. */
  activeAttrs: () => Record<RunAttr, boolean>;
  commit: () => void;
  /** Rewrite the content (e.g. add bullets) and put the selection where `fn` says. */
  transform: (fn: (runs: TextRun[], sel: [number, number] | null) => { runs: TextRun[]; sel: [number, number] | null } | null) => void;
  /** Plain text and selection offsets (for showing which list the caret is in). */
  snapshot: () => { text: string; sel: [number, number] | null };
  /** Close without saving (no commit on the following blur). */
  discard: () => void;
}

interface RichTextEditorProps {
  initialRuns: TextRun[];
  multiline: boolean;
  /** Container typography (size, line height, alignment, indent...). */
  baseStyle: React.CSSProperties;
  /** Per-run typography (family, weight, slant, underline). */
  runStyle: (run: TextRun) => React.CSSProperties;
  /** Changes whenever runStyle's output would change (e.g. font family switched) */
  styleKey: string;
  onCommit: (runs: TextRun[]) => void;
  onCancel: () => void;
  onSelectionChange?: () => void;
}

// ---------- run helpers ----------

export const runsText = (runs: TextRun[]) => runs.map((r) => r.text).join('');

const sameAttrs = (a: TextRun, b: TextRun) => !!a.bold === !!b.bold && !!a.italic === !!b.italic && !!a.underline === !!b.underline;

export function normalizeRuns(runs: TextRun[]): TextRun[] {
  const out: TextRun[] = [];
  for (const r of runs) {
    if (!r.text) continue;
    const last = out[out.length - 1];
    if (last && sameAttrs(last, r)) last.text += r.text;
    else out.push({ text: r.text, bold: !!r.bold, italic: !!r.italic, underline: !!r.underline });
  }
  return out;
}

/** Apply (or remove) an attribute on characters [start, end). */
function applyAttr(runs: TextRun[], start: number, end: number, attr: RunAttr, value: boolean): TextRun[] {
  const out: TextRun[] = [];
  let pos = 0;
  for (const r of runs) {
    const a = pos;
    const b = pos + r.text.length;
    pos = b;
    if (b <= start || a >= end) {
      out.push({ ...r });
      continue;
    }
    const s = Math.max(start, a) - a;
    const e = Math.min(end, b) - a;
    if (s > 0) out.push({ ...r, text: r.text.slice(0, s) });
    out.push({ ...r, text: r.text.slice(s, e), [attr]: value });
    if (e < r.text.length) out.push({ ...r, text: r.text.slice(e) });
  }
  return normalizeRuns(out);
}

function attrFullyOn(runs: TextRun[], start: number, end: number, attr: RunAttr): boolean {
  let pos = 0;
  let any = false;
  for (const r of runs) {
    const a = pos;
    const b = pos + r.text.length;
    pos = b;
    if (b <= start || a >= end) continue;
    any = true;
    if (!r[attr]) return false;
  }
  return any;
}

const escapeHtml = (t: string) =>
  t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const cssText = (st: React.CSSProperties) =>
  Object.entries(st)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `${k.replace(/[A-Z]/g, (m) => '-' + m.toLowerCase())}:${v}`)
    .join(';');

// ---------- component ----------

export const RichTextEditor = forwardRef<RichTextEditorApi, RichTextEditorProps>(function RichTextEditor(
  { initialRuns, multiline, baseStyle, runStyle, styleKey, onCommit, onCancel, onSelectionChange },
  ref
) {
  const elRef = useRef<HTMLDivElement | null>(null);
  const runsRef = useRef<TextRun[]>(normalizeRuns(initialRuns));
  const committedRef = useRef(false);

  const render = (runs: TextRun[]) => {
    const el = elRef.current;
    if (!el) return;
    el.innerHTML =
      runs
        .map(
          (r) =>
            `<span data-run="1"${r.bold ? ' data-b="1"' : ''}${r.italic ? ' data-i="1"' : ''}${r.underline ? ' data-u="1"' : ''} style="${escapeHtml(
              cssText(runStyle(r))
            )}">${escapeHtml(r.text)}</span>`
        )
        .join('') || '<span data-run="1"></span>';
  };

  /** Read the DOM back into runs (the browser edits text inside our spans). */
  const parse = (): TextRun[] => {
    const el = elRef.current;
    if (!el) return runsRef.current;
    const out: TextRun[] = [];
    const walk = (node: Node, attrs: Omit<TextRun, 'text'>) => {
      node.childNodes.forEach((child) => {
        if (child.nodeType === Node.TEXT_NODE) {
          out.push({ ...attrs, text: (child.textContent || '').replace(/​/g, '') });
        } else if (child instanceof HTMLElement) {
          if (child.tagName === 'BR') {
            out.push({ ...attrs, text: '\n' });
            return;
          }
          const isBlock = /^(DIV|P)$/.test(child.tagName);
          if (isBlock && out.length) out.push({ ...attrs, text: '\n' });
          const next = child.dataset.run
            ? { bold: !!child.dataset.b, italic: !!child.dataset.i, underline: !!child.dataset.u }
            : attrs;
          walk(child, next);
        }
      });
    };
    const first = runsRef.current[0] || {};
    walk(el, { bold: !!first.bold, italic: !!first.italic, underline: !!first.underline });
    let runs = normalizeRuns(out);
    if (!multiline) runs = runs.map((r) => ({ ...r, text: r.text.replace(/\n/g, ' ') }));
    return runs;
  };

  const getOffsets = (): [number, number] | null => {
    const el = elRef.current;
    const sel = window.getSelection();
    if (!el || !sel || sel.rangeCount === 0) return null;
    const range = sel.getRangeAt(0);
    if (!el.contains(range.startContainer) || !el.contains(range.endContainer)) return null;
    const pre = document.createRange();
    pre.selectNodeContents(el);
    pre.setEnd(range.startContainer, range.startOffset);
    const start = pre.toString().length;
    pre.setEnd(range.endContainer, range.endOffset);
    return [start, pre.toString().length];
  };

  const setOffsets = (start: number, end: number) => {
    const el = elRef.current;
    const sel = window.getSelection();
    if (!el || !sel) return;
    const locate = (target: number): [Node, number] => {
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      let pos = 0;
      let node: Node | null = walker.nextNode();
      let last: Node | null = null;
      while (node) {
        const len = node.textContent?.length || 0;
        if (target <= pos + len) return [node, target - pos];
        pos += len;
        last = node;
        node = walker.nextNode();
      }
      return last ? [last, last.textContent?.length || 0] : [el, 0];
    };
    const [sn, so] = locate(start);
    const [en, eo] = locate(end);
    const range = document.createRange();
    range.setStart(sn, so);
    range.setEnd(en, eo);
    sel.removeAllRanges();
    sel.addRange(range);
  };

  const toggle = (attr: RunAttr) => {
    const runs = parse();
    const offs = getOffsets();
    if (!offs) return;
    let [s, e] = offs;
    if (s === e) {
      // No selection: style the word under the caret
      const text = runsText(runs);
      while (s > 0 && /\S/.test(text[s - 1])) s--;
      while (e < text.length && /\S/.test(text[e])) e++;
      if (s === e) return;
    }
    const next = applyAttr(runs, s, e, attr, !attrFullyOn(runs, s, e, attr));
    runsRef.current = next;
    render(next);
    setOffsets(offs[0], offs[1]);
    onSelectionChange?.();
  };

  const commit = () => {
    if (committedRef.current) return;
    committedRef.current = true;
    onCommit(parse());
  };

  const transform: RichTextEditorApi['transform'] = (fn) => {
    const runs = parse();
    const offs = getOffsets();
    const res = fn(runs, offs);
    if (!res) return;
    const next = normalizeRuns(res.runs);
    runsRef.current = next;
    render(next);
    elRef.current?.focus();
    const len = runsText(next).length;
    const sel = res.sel || [len, len];
    setOffsets(Math.min(sel[0], len), Math.min(sel[1], len));
    onSelectionChange?.();
  };

  useImperativeHandle(ref, () => ({
    toggle,
    getRuns: parse,
    commit,
    transform,
    snapshot: () => ({ text: runsText(parse()), sel: getOffsets() }),
    discard: () => {
      committedRef.current = true;
    },
    activeAttrs: () => {
      const runs = parse();
      const offs = getOffsets();
      if (!offs) return { bold: false, italic: false, underline: false };
      let [s, e] = offs;
      if (s === e) {
        s = Math.max(0, s - 1);
        e = Math.max(e, s + 1);
      }
      return {
        bold: attrFullyOn(runs, s, e, 'bold'),
        italic: attrFullyOn(runs, s, e, 'italic'),
        underline: attrFullyOn(runs, s, e, 'underline')
      };
    }
  }));

  // Initial content + caret at the end
  useLayoutEffect(() => {
    render(runsRef.current);
    const el = elRef.current;
    if (el) {
      el.focus();
      const len = runsText(runsRef.current).length;
      setOffsets(len, len);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Re-style (font family / size switched) while keeping text and selection
  const firstStyleRun = useRef(true);
  useLayoutEffect(() => {
    if (firstStyleRun.current) {
      firstStyleRun.current = false;
      return;
    }
    const offs = getOffsets();
    const runs = parse();
    runsRef.current = runs;
    render(runs);
    if (offs) setOffsets(offs[0], offs[1]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [styleKey]);

  useEffect(() => {
    const handler = () => onSelectionChange?.();
    document.addEventListener('selectionchange', handler);
    return () => document.removeEventListener('selectionchange', handler);
  }, [onSelectionChange]);

  const insertPlain = (text: string) => {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return;
    const range = sel.getRangeAt(0);
    range.deleteContents();
    const node = document.createTextNode(text);
    range.insertNode(node);
    range.setStartAfter(node);
    range.collapse(true);
    sel.removeAllRanges();
    sel.addRange(range);
  };

  return (
    <div
      ref={elRef}
      contentEditable
      suppressContentEditableWarning
      spellCheck={false}
      style={{ ...baseStyle, outline: 'none', cursor: 'text' }}
      onKeyDown={(e) => {
        e.stopPropagation();
        const mod = e.metaKey || e.ctrlKey;
        if (mod && ['b', 'i', 'u'].includes(e.key.toLowerCase())) {
          e.preventDefault();
          toggle(e.key.toLowerCase() === 'b' ? 'bold' : e.key.toLowerCase() === 'i' ? 'italic' : 'underline');
        } else if (e.key === 'Enter') {
          e.preventDefault();
          if (multiline && e.shiftKey) insertPlain('\n');
          else commit();
        } else if (e.key === 'Escape') {
          e.preventDefault();
          committedRef.current = true;
          onCancel();
        }
      }}
      onPaste={(e) => {
        e.preventDefault();
        const text = e.clipboardData.getData('text/plain');
        insertPlain(multiline ? text : text.replace(/\s*\n\s*/g, ' '));
      }}
      onDrop={(e) => e.preventDefault()}
      onBlur={commit}
    />
  );
});
