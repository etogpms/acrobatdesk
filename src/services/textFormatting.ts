import { TextRun } from '../types/pdf';

/**
 * Paragraph formatting on styled text: bullets, numbering, multilevel lists and list levels.
 * Lists are plain text markers ("• ", "1. ", "a. ") at the start of each line, with four spaces
 * per list level, so they look and save the same everywhere and stay editable as text.
 */

export type NumberFormat = '1.' | '1)' | 'a.' | 'a)' | 'A.' | 'i.' | 'I.';
export type ListKind = { type: 'bullet'; char: string } | { type: 'number'; format: NumberFormat } | { type: 'multi' };

export const BULLET_CHARS = ['•', '◦', '▪', '–'];
export const NUMBER_FORMATS: NumberFormat[] = ['1.', '1)', 'a.', 'a)', 'A.', 'i.', 'I.'];
/** Marker used at each level of a multilevel list (and for bullets moved to a deeper level). */
const MULTI_FORMATS: NumberFormat[] = ['1.', 'a.', 'i.'];
const LEVEL_BULLETS = ['•', '◦', '▪'];
const INDENT = '    ';

/** Offsets [start, end) of the selection in the plain text, or null for "whole text". */
export type Sel = [number, number] | null;

// ---------- number formatting ----------

const toAlpha = (n: number) => {
  let s = '';
  while (n > 0) {
    n--;
    s = String.fromCharCode(97 + (n % 26)) + s;
    n = Math.floor(n / 26);
  }
  return s;
};

const toRoman = (n: number) => {
  const table: Array<[number, string]> = [
    [1000, 'm'], [900, 'cm'], [500, 'd'], [400, 'cd'], [100, 'c'], [90, 'xc'],
    [50, 'l'], [40, 'xl'], [10, 'x'], [9, 'ix'], [5, 'v'], [4, 'iv'], [1, 'i']
  ];
  let s = '';
  for (const [v, r] of table) while (n >= v) { s += r; n -= v; }
  return s;
};

export function formatNumber(n: number, fmt: NumberFormat): string {
  const base = fmt[0];
  const suffix = fmt[1];
  const body =
    base === '1' ? String(n) : base === 'a' ? toAlpha(n) : base === 'A' ? toAlpha(n).toUpperCase() : base === 'i' ? toRoman(n) : toRoman(n).toUpperCase();
  return body + suffix;
}

function detectFormat(marker: string): NumberFormat {
  const body = marker.slice(0, -1);
  const suffix = marker.slice(-1) as '.' | ')';
  const pick = (base: string) => ((NUMBER_FORMATS as string[]).includes(base + suffix) ? base + suffix : base + '.') as NumberFormat;
  if (/^\d+$/.test(body)) return pick('1');
  if (/^[ivxlcdm]+$/.test(body) && (body === 'i' || body.length > 1)) return pick('i');
  if (/^[IVXLCDM]+$/.test(body) && (body === 'I' || body.length > 1)) return pick('I');
  if (/^[a-z]+$/.test(body)) return pick('a');
  return pick('A');
}

/** Value of a number marker ("3." → 3, "c)" → 3, "iv." → 4). */
function markerValue(marker: string): number {
  const body = marker.slice(0, -1);
  const fmt = detectFormat(marker)[0];
  if (fmt === '1') return parseInt(body, 10) || 1;
  if (fmt === 'a' || fmt === 'A') return [...body.toLowerCase()].reduce((n, ch) => n * 26 + (ch.charCodeAt(0) - 96), 0) || 1;
  const vals: Record<string, number> = { i: 1, v: 5, x: 10, l: 50, c: 100, d: 500, m: 1000 };
  const ds = [...body.toLowerCase()].map((ch) => vals[ch] || 0);
  return ds.reduce((n, v, k) => n + (v < (ds[k + 1] || 0) ? -v : v), 0) || 1;
}

// ---------- line parsing ----------

const MARKER_RE = /^([ \t]*)([•◦▪–]|(?:\d{1,3}|[a-zA-Z]|[ivxlcdmIVXLCDM]{1,6})[.)]) /;

interface ParsedLine {
  indent: string;
  level: number;
  /** Marker without its trailing space, e.g. "•" or "3." */
  marker: string | null;
  numbered: boolean;
}

function parseLine(text: string): ParsedLine {
  const m = MARKER_RE.exec(text);
  const indent = m ? m[1] : (/^[ \t]*/.exec(text) as RegExpExecArray)[0];
  const width = indent.replace(/\t/g, INDENT).length;
  return { indent, level: Math.floor(width / INDENT.length), marker: m ? m[2] : null, numbered: !!m && !BULLET_CHARS.includes(m[2]) };
}

/** Which list (if any) the line under the caret belongs to, to highlight the toolbar button. */
export function listAt(text: string, sel: Sel): 'bullet' | 'number' | null {
  const lines = text.split('\n');
  const idx = sel ? text.slice(0, sel[0]).split('\n').length - 1 : 0;
  const p = parseLine(lines[idx] || '');
  return p.marker ? (p.numbered ? 'number' : 'bullet') : null;
}

// ---------- run surgery ----------

function splitLines(runs: TextRun[]): TextRun[][] {
  const lines: TextRun[][] = [[]];
  for (const r of runs) {
    const parts = r.text.split('\n');
    parts.forEach((p, i) => {
      if (i > 0) lines.push([]);
      if (p) lines[lines.length - 1].push({ ...r, text: p });
    });
  }
  return lines;
}

function joinLines(lines: TextRun[][]): TextRun[] {
  const out: TextRun[] = [];
  lines.forEach((line, i) => {
    if (i > 0) {
      const prev = out[out.length - 1] || line[0] || { text: '' };
      out.push({ ...prev, text: '\n' });
    }
    out.push(...line);
  });
  return mergeRuns(out);
}

function mergeRuns(runs: TextRun[]): TextRun[] {
  const out: TextRun[] = [];
  for (const r of runs) {
    if (!r.text) continue;
    const last = out[out.length - 1];
    if (last && !!last.bold === !!r.bold && !!last.italic === !!r.italic && !!last.underline === !!r.underline) last.text += r.text;
    else out.push({ ...r });
  }
  return out;
}

/** Replace the first `cut` characters of a line with `insert` (styled like the line's text). */
function replacePrefix(line: TextRun[], cut: number, insert: string): TextRun[] {
  const out: TextRun[] = [];
  let left = cut;
  for (const r of line) {
    if (left >= r.text.length) {
      left -= r.text.length;
      continue;
    }
    out.push({ ...r, text: r.text.slice(left) });
    left = 0;
  }
  if (insert) {
    const style = out[0] || line[0] || { text: '' };
    out.unshift({ text: insert, bold: style.bold, italic: style.italic });
  }
  return out;
}

type LineEdit = { cut: number; insert: string } | null;

/** Apply per-line prefix edits and move the selection along with the text. */
function editLines(runs: TextRun[], sel: Sel, edit: (text: string, index: number) => LineEdit): { runs: TextRun[]; sel: Sel } {
  const lines = splitLines(runs);
  const texts = lines.map((l) => l.map((r) => r.text).join(''));
  const starts: number[] = [];
  let pos = 0;
  for (const t of texts) {
    starts.push(pos);
    pos += t.length + 1;
  }
  const edits = texts.map((t, i) => edit(t, i));
  const mapOffset = (off: number) => {
    let delta = 0;
    for (let i = 0; i < texts.length; i++) {
      const e = edits[i];
      const inLine = off >= starts[i] && off <= starts[i] + texts[i].length;
      if (inLine) {
        if (!e) return off + delta;
        const col = off - starts[i];
        return starts[i] + delta + Math.max(0, col - e.cut) + e.insert.length;
      }
      if (e) delta += e.insert.length - e.cut;
    }
    return off + delta;
  };
  const next = lines.map((l, i) => (edits[i] ? replacePrefix(l, edits[i]!.cut, edits[i]!.insert) : l));
  return { runs: joinLines(next), sel: sel ? [mapOffset(sel[0]), mapOffset(sel[1])] : null };
}

/** Indices of the lines the selection touches (all lines when there is no selection). */
function targetLines(runs: TextRun[], sel: Sel): Set<number> {
  const texts = splitLines(runs).map((l) => l.map((r) => r.text).join(''));
  const out = new Set<number>();
  let pos = 0;
  texts.forEach((t, i) => {
    const end = pos + t.length;
    if (!sel || (sel[0] <= end && sel[1] >= pos)) out.add(i);
    pos = end + 1;
  });
  return out;
}

// ---------- list operations ----------

/**
 * Recount the numbered lists that contain `touched` lines: items at the same level continue,
 * deeper levels restart. Other numbered-looking text (e.g. a heading "3. Terms") is left alone.
 */
export function renumber(runs: TextRun[], sel: Sel, touched: Set<number>): { runs: TextRun[]; sel: Sel } {
  const texts = splitLines(runs).map((l) => l.map((r) => r.text).join(''));
  // Group consecutive list lines (blank lines don't break a list)
  const group: number[] = [];
  let g = 0;
  texts.forEach((t, i) => {
    if (!parseLine(t).marker && t.trim()) g++;
    group[i] = g;
    if (!parseLine(t).marker && t.trim()) g++;
  });
  const live = new Set([...touched].map((i) => group[i]));
  const counters: Array<{ n: number; fmt: NumberFormat } | undefined> = [];
  return editLines(runs, sel, (text, i) => {
    const p = parseLine(text);
    if (!p.marker) {
      if (text.trim()) counters.length = 0; // a normal paragraph ends the list
      return null;
    }
    counters.length = p.level + 1;
    if (!p.numbered) return null;
    const c = counters[p.level];
    // The first item keeps its number, so a list placed after "3." continues from it
    const next = c ? { n: c.n + 1, fmt: c.fmt } : { n: markerValue(p.marker), fmt: detectFormat(p.marker) };
    counters[p.level] = next;
    const marker = formatNumber(next.n, next.fmt);
    return marker === p.marker || !live.has(group[i]) ? null : { cut: p.indent.length + p.marker.length, insert: p.indent + marker };
  });
}

/** Toggle bullets / numbering / a multilevel list on the selected lines (like Word's buttons). */
export function applyList(runs: TextRun[], sel: Sel, kind: ListKind): { runs: TextRun[]; sel: Sel } {
  const targets = targetLines(runs, sel);
  const texts = splitLines(runs).map((l) => l.map((r) => r.text).join(''));
  const matches = (p: ParsedLine) =>
    !!p.marker &&
    (kind.type === 'bullet'
      ? p.marker === kind.char
      : kind.type === 'number'
      ? p.numbered && detectFormat(p.marker)[0] === kind.format[0] && p.marker.slice(-1) === kind.format[1]
      : p.numbered);
  const relevant = [...targets].filter((i) => texts[i].trim() || targets.size === 1);
  const remove = relevant.length > 0 && relevant.every((i) => matches(parseLine(texts[i])));

  const res = editLines(runs, sel, (text, i) => {
    if (!targets.has(i) || (!text.trim() && targets.size > 1)) return null;
    const p = parseLine(text);
    const cut = p.indent.length + (p.marker ? p.marker.length + 1 : 0);
    if (remove) return { cut, insert: p.indent };
    const marker =
      kind.type === 'bullet' ? kind.char : kind.type === 'number' ? formatNumber(1, kind.format) : formatNumber(1, MULTI_FORMATS[p.level % MULTI_FORMATS.length]);
    return { cut, insert: `${p.indent}${marker} ` };
  });
  return renumber(res.runs, res.sel, targets);
}

/**
 * Move the selected list items one level deeper (+1) or shallower (-1).
 * Returns null when the selection has no list items (the caller then indents the whole block).
 */
export function changeListLevel(runs: TextRun[], sel: Sel, delta: 1 | -1): { runs: TextRun[]; sel: Sel } | null {
  const targets = targetLines(runs, sel);
  const texts = splitLines(runs).map((l) => l.map((r) => r.text).join(''));
  if (![...targets].some((i) => parseLine(texts[i]).marker)) return null;
  const res = editLines(runs, sel, (text, i) => {
    if (!targets.has(i)) return null;
    const p = parseLine(text);
    if (!p.marker) return null;
    const level = Math.max(0, p.level + delta);
    if (level === p.level) return null;
    const indent = INDENT.repeat(level);
    // Deeper levels get their own marker style, as in Word's multilevel lists
    const marker = p.numbered
      ? formatNumber(1, MULTI_FORMATS[level % MULTI_FORMATS.length])
      : BULLET_CHARS.slice(0, 3).includes(p.marker)
      ? LEVEL_BULLETS[level % LEVEL_BULLETS.length]
      : p.marker;
    return { cut: p.indent.length + p.marker.length, insert: indent + marker };
  });
  return renumber(res.runs, res.sel, targets);
}

/** Indent / outdent the selected lines by one step (text without list markers). */
export function shiftLines(runs: TextRun[], sel: Sel, delta: 1 | -1): { runs: TextRun[]; sel: Sel } {
  const targets = targetLines(runs, sel);
  return editLines(runs, sel, (text, i) => {
    if (!targets.has(i)) return null;
    if (delta > 0) return { cut: 0, insert: INDENT };
    const lead = /^( {1,4}|\t)/.exec(text);
    return lead ? { cut: lead[0].length, insert: '' } : null;
  });
}

/** Line spacing → distance between baselines, for a font size (single = 1.2 × size, like Word). */
export const pitchFor = (fontSize: number, spacing: number) => fontSize * 1.2 * spacing;

/** Plain-text helpers for text boxes (no per-word styling). */
export const textToRuns = (text: string): TextRun[] => (text ? [{ text }] : []);
export const runsToText = (runs: TextRun[]) => runs.map((r) => r.text).join('');
