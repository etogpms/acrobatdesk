import React, { useState } from 'react';
import { MessageSquare, X, UserRound } from 'lucide-react';
import { AnnotationItem } from '../types/pdf';
import { CommentThread, describeAnchor, timeAgo } from './CommentThread';

interface CommentsPanelProps {
  annotations: AnnotationItem[];
  activeCommentId: string | null;
  authorName: string;
  onAuthorNameChange: (name: string) => void;
  onOpenComment: (c: AnnotationItem) => void;
  onUpdate: (c: AnnotationItem) => void;
  onDelete: (id: string) => void;
  onClose: () => void;
}

type Filter = 'open' | 'resolved' | 'all';

export const CommentsPanel: React.FC<CommentsPanelProps> = ({
  annotations,
  activeCommentId,
  authorName,
  onAuthorNameChange,
  onOpenComment,
  onUpdate,
  onDelete,
  onClose
}) => {
  const [filter, setFilter] = useState<Filter>('open');
  const [editingName, setEditingName] = useState(false);
  const comments = annotations.filter((a) => a.type === 'note' && a.content);
  const shown = comments
    .filter((c) => (filter === 'all' ? true : filter === 'open' ? !c.resolved : c.resolved))
    .sort((a, b) => a.pageIndex - b.pageIndex || a.y - b.y || a.x - b.x);
  const openCount = comments.filter((c) => !c.resolved).length;

  const pages = [...new Set(shown.map((c) => c.pageIndex))];

  return (
    <aside className="w-80 bg-neutral-900 border-l border-neutral-800 flex flex-col shrink-0 h-full">
      <div className="h-10 px-3 border-b border-neutral-800 flex items-center justify-between">
        <span className="flex items-center gap-1.5 text-xs font-medium text-neutral-200">
          <MessageSquare className="w-3.5 h-3.5 text-amber-400" />
          Comments ({openCount} open)
        </span>
        <button onClick={onClose} className="p-1 text-neutral-400 hover:text-white rounded" title="Close">
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      <div className="px-3 py-2 border-b border-neutral-800 space-y-2">
        <div className="flex items-center gap-1.5 text-[11px] text-neutral-400">
          <UserRound className="w-3.5 h-3.5" />
          {editingName ? (
            <input
              autoFocus
              defaultValue={authorName}
              onBlur={(e) => {
                onAuthorNameChange(e.target.value.trim() || authorName);
                setEditingName(false);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
              }}
              className="bg-neutral-800 border border-neutral-700 rounded px-1.5 py-0.5 text-neutral-100 text-[11px] outline-none focus:border-blue-500"
            />
          ) : (
            <button onClick={() => setEditingName(true)} className="hover:text-white" title="Name shown on your comments">
              Commenting as <span className="text-neutral-200 font-medium">{authorName}</span> · change
            </button>
          )}
        </div>
        <div className="flex gap-1">
          {(['open', 'resolved', 'all'] as Filter[]).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-2 py-0.5 rounded text-[11px] capitalize ${filter === f ? 'bg-neutral-700 text-white' : 'text-neutral-400 hover:text-neutral-200'}`}
            >
              {f}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-2 space-y-3">
        {shown.length === 0 && (
          <p className="text-[11px] text-neutral-500 px-2 py-6 leading-relaxed text-center">
            {filter === 'resolved' ? 'No resolved comments.' : 'No comments yet. Highlight text with the Comment tool, or right-click anything on the page and choose “Add comment”.'}
          </p>
        )}
        {pages.map((p) => (
          <div key={p}>
            <div className="px-1 pb-1 text-[10px] uppercase tracking-wider text-neutral-500 font-semibold">Page {p + 1}</div>
            <div className="space-y-2">
              {shown
                .filter((c) => c.pageIndex === p)
                .map((c) => {
                  const active = c.id === activeCommentId;
                  if (active) {
                    return (
                      <div key={c.id} className="bg-white rounded-lg p-3 ring-2 ring-amber-400">
                        <CommentThread
                          comment={c}
                          allAnnotations={annotations}
                          authorName={authorName}
                          onChange={onUpdate}
                          onDelete={() => onDelete(c.id)}
                          compact
                        />
                      </div>
                    );
                  }
                  const a = describeAnchor(c, annotations);
                  const Icon = a.icon;
                  return (
                    <button
                      key={c.id}
                      onClick={() => onOpenComment(c)}
                      className={`w-full text-left bg-neutral-800/70 hover:bg-neutral-800 rounded-lg p-2.5 border border-neutral-700/60 ${c.resolved ? 'opacity-60' : ''}`}
                    >
                      <div className="flex items-center gap-1 text-[10px] text-neutral-400 mb-1">
                        <Icon className="w-3 h-3" />
                        <span>{a.label}</span>
                        <span className="ml-auto">{timeAgo(c.updatedAt || c.createdAt)}</span>
                      </div>
                      {a.quote && <div className="text-[11px] italic text-neutral-400 border-l-2 border-amber-500/70 pl-1.5 mb-1 line-clamp-2">“{a.quote}”</div>}
                      <div className="text-[12px] text-neutral-100 line-clamp-3">
                        <span className="font-semibold">{c.author}: </span>
                        {c.content}
                      </div>
                      {(c.replies?.length || 0) > 0 && (
                        <div className="text-[10px] text-blue-300 mt-1">{c.replies!.length} {c.replies!.length === 1 ? 'reply' : 'replies'}</div>
                      )}
                    </button>
                  );
                })}
            </div>
          </div>
        ))}
      </div>
    </aside>
  );
};
