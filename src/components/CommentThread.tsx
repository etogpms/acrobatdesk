import React, { useLayoutEffect, useRef, useState } from 'react';
import { Check, CheckCircle2, RotateCcw, Trash2, X, MessageSquare, Image as ImageIcon, Highlighter, MapPin } from 'lucide-react';
import { AnnotationItem, CommentReply } from '../types/pdf';

export const timeAgo = (ms: number) => {
  const s = Math.max(0, (Date.now() - ms) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
};

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join('') || '?';

const avatarColor = (name: string) => {
  const palette = ['#f59e0b', '#10b981', '#3b82f6', '#ec4899', '#8b5cf6', '#14b8a6', '#ef4444'];
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return palette[h % palette.length];
};

/** What a comment is attached to, for the thread header. */
export function describeAnchor(c: AnnotationItem, all: AnnotationItem[]): { icon: React.ElementType; label: string; quote?: string } {
  if (c.anchor?.kind === 'annotation') {
    const anchorId = c.anchor.id;
    const target = all.find((a) => a.id === anchorId);
    if (target?.type === 'highlight') return { icon: Highlighter, label: 'Highlighted text', quote: target.quote };
    if (target?.type === 'image' || target?.type === 'image_removal') return { icon: ImageIcon, label: 'Image' };
    if (target?.type === 'signature') return { icon: ImageIcon, label: 'Signature' };
    if (target?.type === 'stamp') return { icon: ImageIcon, label: 'Stamp' };
    if (target?.type === 'shape') return { icon: MapPin, label: 'Shape' };
    if (target?.type === 'text') return { icon: MapPin, label: 'Text box', quote: target.content };
    return { icon: MapPin, label: 'Page' };
  }
  if (c.anchor?.kind === 'image') return { icon: ImageIcon, label: 'Image in the PDF' };
  return { icon: MessageSquare, label: 'Page comment' };
}

interface CommentThreadProps {
  comment: AnnotationItem;
  allAnnotations: AnnotationItem[];
  authorName: string;
  onChange: (c: AnnotationItem) => void;
  onDelete: () => void;
  onClose?: () => void;
  autoFocus?: boolean;
  compact?: boolean;
}

const Avatar: React.FC<{ name: string }> = ({ name }) => (
  <span
    className="w-6 h-6 rounded-full text-[10px] font-semibold text-white flex items-center justify-center shrink-0"
    style={{ backgroundColor: avatarColor(name) }}
    title={name}
  >
    {initials(name)}
  </span>
);

export const CommentThread: React.FC<CommentThreadProps> = ({ comment, allAnnotations, authorName, onChange, onDelete, onClose, autoFocus, compact }) => {
  const isNew = !comment.content;
  const [draft, setDraft] = useState('');
  const [editing, setEditing] = useState<string | null>(null); // 'root' or reply id
  const [editText, setEditText] = useState('');
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const anchor = describeAnchor(comment, allAnnotations);
  const AnchorIcon = anchor.icon;

  // Focus the box as soon as the thread opens, so typing right away goes into the comment
  useLayoutEffect(() => {
    if (!autoFocus) return;
    inputRef.current?.focus({ preventScroll: true });
    const t = setTimeout(() => {
      if (document.activeElement !== inputRef.current && !(document.activeElement as HTMLElement)?.isContentEditable) inputRef.current?.focus({ preventScroll: true });
    }, 50);
    return () => clearTimeout(t);
  }, [autoFocus, comment.id]);

  const post = () => {
    const text = draft.trim();
    if (!text) return;
    if (isNew) {
      onChange({ ...comment, content: text, author: authorName, createdAt: Date.now(), updatedAt: Date.now() });
    } else {
      const reply: CommentReply = { id: `reply-${Date.now()}`, author: authorName, text, createdAt: Date.now() };
      onChange({ ...comment, replies: [...(comment.replies || []), reply], resolved: false, updatedAt: Date.now() });
    }
    setDraft('');
  };

  const saveEdit = () => {
    const text = editText.trim();
    if (!text) return;
    if (editing === 'root') onChange({ ...comment, content: text, updatedAt: Date.now() });
    else onChange({ ...comment, replies: (comment.replies || []).map((r) => (r.id === editing ? { ...r, text } : r)), updatedAt: Date.now() });
    setEditing(null);
  };

  const messages: Array<{ id: string; author: string; text: string; createdAt: number }> = comment.content
    ? [{ id: 'root', author: comment.author || 'Unknown', text: comment.content, createdAt: comment.createdAt }, ...(comment.replies || [])]
    : [];

  return (
    <div
      className={`text-neutral-800 text-xs ${compact ? '' : 'w-72'} ${comment.resolved ? 'opacity-80' : ''}`}
      onMouseDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.stopPropagation()}
    >
      {/* Header: what this is about */}
      <div className="flex items-center justify-between gap-2 pb-2 mb-2 border-b border-neutral-200">
        <span className="flex items-center gap-1.5 text-[11px] text-neutral-500 font-medium min-w-0">
          <AnchorIcon className="w-3.5 h-3.5 shrink-0" />
          <span className="truncate">{anchor.label}</span>
          {comment.resolved && <span className="text-emerald-600 flex items-center gap-0.5"><CheckCircle2 className="w-3 h-3" /> Resolved</span>}
        </span>
        <span className="flex items-center gap-0.5 shrink-0">
          {!isNew && (
            <button
              onClick={() => onChange({ ...comment, resolved: !comment.resolved, updatedAt: Date.now() })}
              className={`p-1 rounded hover:bg-neutral-100 ${comment.resolved ? 'text-amber-600' : 'text-emerald-600'}`}
              title={comment.resolved ? 'Reopen' : 'Resolve'}
            >
              {comment.resolved ? <RotateCcw className="w-3.5 h-3.5" /> : <Check className="w-3.5 h-3.5" />}
            </button>
          )}
          <button onClick={onDelete} className="p-1 rounded hover:bg-neutral-100 text-neutral-500 hover:text-rose-600" title="Delete thread">
            <Trash2 className="w-3.5 h-3.5" />
          </button>
          {onClose && (
            <button onClick={onClose} className="p-1 rounded hover:bg-neutral-100 text-neutral-500" title="Close">
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </span>
      </div>

      {anchor.quote && (
        <blockquote className="border-l-2 border-amber-400 pl-2 mb-2 text-[11px] italic text-neutral-600 line-clamp-3">“{anchor.quote}”</blockquote>
      )}

      {/* Messages */}
      <div className="space-y-2.5 max-h-64 overflow-y-auto pr-0.5">
        {messages.map((m) => (
          <div key={m.id} className="flex gap-2 group">
            <Avatar name={m.author} />
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline gap-1.5">
                <span className="font-semibold text-[11px] truncate">{m.author}</span>
                <span className="text-[10px] text-neutral-400">{timeAgo(m.createdAt)}</span>
                {m.author === authorName && editing !== m.id && (
                  <span className="ml-auto hidden group-hover:flex gap-1 text-[10px] text-neutral-400">
                    <button className="hover:text-neutral-700" onClick={() => { setEditing(m.id); setEditText(m.text); }}>Edit</button>
                    {m.id !== 'root' && (
                      <button className="hover:text-rose-600" onClick={() => onChange({ ...comment, replies: (comment.replies || []).filter((r) => r.id !== m.id) })}>
                        Delete
                      </button>
                    )}
                  </span>
                )}
              </div>
              {editing === m.id ? (
                <div className="mt-1">
                  <textarea
                    value={editText}
                    onChange={(e) => setEditText(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); saveEdit(); }
                      if (e.key === 'Escape') setEditing(null);
                    }}
                    autoFocus
                    rows={2}
                    className="w-full border border-neutral-300 rounded p-1.5 text-xs outline-none focus:border-blue-500 resize-none"
                  />
                  <div className="flex justify-end gap-1 mt-1">
                    <button className="px-2 py-0.5 text-[11px] text-neutral-500" onClick={() => setEditing(null)}>Cancel</button>
                    <button className="px-2 py-0.5 text-[11px] bg-blue-600 text-white rounded" onClick={saveEdit}>Save</button>
                  </div>
                </div>
              ) : (
                <p className="whitespace-pre-wrap break-words leading-snug text-[12px] text-neutral-800">{m.text}</p>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Composer */}
      <div className={`flex gap-2 ${messages.length ? 'mt-3 pt-2 border-t border-neutral-100' : ''}`}>
        <Avatar name={authorName} />
        <div className="flex-1">
          <textarea
            ref={inputRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                post();
              } else if (e.key === 'Escape') {
                if (isNew) onDelete();
                else onClose?.();
              }
            }}
            rows={isNew ? 3 : 2}
            placeholder={isNew ? 'Add a comment…' : 'Reply…'}
            className="w-full border border-neutral-300 rounded-md p-1.5 text-xs outline-none focus:border-blue-500 resize-none bg-white"
          />
          <div className="flex justify-between items-center mt-1">
            <span className="text-[10px] text-neutral-400">Enter to post · Shift+Enter new line</span>
            <span className="flex gap-1">
              {isNew && (
                <button className="px-2 py-0.5 text-[11px] text-neutral-500 hover:text-neutral-800" onClick={onDelete}>
                  Cancel
                </button>
              )}
              <button
                className="px-2.5 py-0.5 text-[11px] bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-white rounded"
                disabled={!draft.trim()}
                onClick={post}
              >
                {isNew ? 'Comment' : 'Reply'}
              </button>
            </span>
          </div>
        </div>
      </div>
    </div>
  );
};
