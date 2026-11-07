import React from 'react';
import {
  ListFilter,
  Highlighter,
  Type,
  FileSignature,
  EyeOff,
  MessageSquare,
  PenTool,
  Square,
  Trash2,
  Calendar,
  X
} from 'lucide-react';
import { AnnotationItem } from '../types/pdf';

interface AnnotationsPanelProps {
  annotations: AnnotationItem[];
  selectedAnnotationId: string | null;
  onSelectAnnotation: (id: string, pageIndex: number) => void;
  onDeleteAnnotation: (id: string) => void;
  onClose: () => void;
}

export const AnnotationsPanel: React.FC<AnnotationsPanelProps> = ({
  annotations,
  selectedAnnotationId,
  onSelectAnnotation,
  onDeleteAnnotation,
  onClose
}) => {
  const getIcon = (type: string) => {
    switch (type) {
      case 'highlight':
        return <Highlighter className="w-3.5 h-3.5 text-amber-400" />;
      case 'text':
        return <Type className="w-3.5 h-3.5 text-emerald-400" />;
      case 'signature':
        return <FileSignature className="w-3.5 h-3.5 text-purple-400" />;
      case 'redact':
        return <EyeOff className="w-3.5 h-3.5 text-rose-400" />;
      case 'note':
        return <MessageSquare className="w-3.5 h-3.5 text-amber-300" />;
      case 'pen':
        return <PenTool className="w-3.5 h-3.5 text-blue-400" />;
      default:
        return <Square className="w-3.5 h-3.5 text-indigo-400" />;
    }
  };

  return (
    <aside className="w-72 bg-neutral-900 border-l border-neutral-800 flex flex-col select-none shrink-0 h-full z-10">
      {/* Header */}
      <div className="h-12 px-4 border-b border-neutral-800 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <ListFilter className="w-4 h-4 text-neutral-400" />
          <span className="font-semibold text-xs text-white">
            Annotations ({annotations.length})
          </span>
        </div>
        <button
          onClick={onClose}
          className="text-neutral-400 hover:text-white text-xs px-2 py-1 rounded transition-colors"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto p-3 space-y-2 text-xs">
        {annotations.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-center text-neutral-400 p-4 gap-2">
            <Highlighter className="w-8 h-8 text-neutral-500 stroke-1" />
            <span className="text-xs text-neutral-300 font-medium">No Annotations Yet</span>
            <span className="text-[11px] text-neutral-400 max-w-xs">
              Use the toolbar above to highlight, draw, add text, or sign the document.
            </span>
          </div>
        ) : (
          annotations.map((ann) => {
            const isSelected = selectedAnnotationId === ann.id;
            return (
              <div
                key={ann.id}
                onClick={() => onSelectAnnotation(ann.id, ann.pageIndex)}
                className={`p-2.5 rounded-lg border cursor-pointer transition-all flex items-start justify-between group ${
                  isSelected
                    ? 'bg-neutral-800 border-blue-500 shadow-md ring-1 ring-blue-500/50'
                    : 'bg-neutral-850 hover:bg-neutral-800 border-neutral-800'
                }`}
              >
                <div className="flex items-start gap-2.5 min-w-0">
                  <div className="p-1 rounded bg-neutral-800 border border-neutral-700/60 mt-0.5 shrink-0">
                    {getIcon(ann.type)}
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5 mb-0.5">
                      <span className="text-[11px] font-semibold text-white capitalize">
                        {ann.type}
                      </span>
                      <span className="text-[10px] font-mono text-neutral-400">
                        Page {ann.pageIndex + 1}
                      </span>
                    </div>

                    <p className="text-[11px] text-neutral-400 truncate max-w-[140px]">
                      {ann.content || (ann.type === 'signature' ? 'Handwritten Signature' : ann.type === 'redact' ? 'Redaction Block' : 'Drawn Annotation')}
                    </p>
                  </div>
                </div>

                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onDeleteAnnotation(ann.id);
                  }}
                  className="p-1 text-neutral-500 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity"
                  title="Delete annotation"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            );
          })
        )}
      </div>
    </aside>
  );
};
