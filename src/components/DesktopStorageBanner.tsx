import React from 'react';
import { X, HardDrive, ShieldCheck, Database, Lock, FolderCheck, CheckCircle2 } from 'lucide-react';
import { DocumentMetadata } from '../types/pdf';

interface DesktopStorageBannerProps {
  isOpen: boolean;
  onClose: () => void;
  metadata: DocumentMetadata;
  savedSignaturesCount: number;
}

export const DesktopStorageBanner: React.FC<DesktopStorageBannerProps> = ({
  isOpen,
  onClose,
  metadata,
  savedSignaturesCount
}) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="bg-neutral-900 border border-neutral-800 rounded-xl max-w-lg w-full shadow-2xl overflow-hidden flex flex-col">
        {/* Header */}
        <div className="px-5 py-4 border-b border-neutral-800 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-emerald-600/20 border border-emerald-500/40 flex items-center justify-center text-emerald-400">
              <HardDrive className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-white tracking-tight">Personal Desktop Storage Architecture</h2>
              <p className="text-[11px] text-neutral-400">100% Local Privacy · Zero Cloud Data Exposure</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1 text-neutral-400 hover:text-white rounded transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content */}
        <div className="p-5 space-y-4 text-xs text-neutral-300">
          {/* Security Guarantee Box */}
          <div className="p-3.5 bg-emerald-950/40 border border-emerald-800/60 rounded-lg flex items-start gap-3">
            <ShieldCheck className="w-5 h-5 text-emerald-400 shrink-0 mt-0.5" />
            <div className="space-y-1">
              <h4 className="font-semibold text-emerald-300">Total Desktop Isolation Verified</h4>
              <p className="text-[11px] text-emerald-400/90 leading-relaxed">
                All PDF documents, handwritten signatures, annotations, and OCR recognition engines operate strictly inside your browser. No files or private records are ever uploaded to cloud databases.
              </p>
            </div>
          </div>

          {/* Architecture Pillars */}
          <div className="space-y-3">
            <div className="flex items-start gap-3 p-2.5 rounded bg-neutral-850 border border-neutral-800">
              <FolderCheck className="w-4 h-4 text-cyan-400 shrink-0 mt-0.5" />
              <div>
                <strong className="text-white block font-medium">Desktop File System Access</strong>
                <span className="text-neutral-400 text-[11px]">
                  When you open or save files, AcrobatDesk uses the HTML5 File System Access API to read and write directly to your local hard drive.
                </span>
              </div>
            </div>

            <div className="flex items-start gap-3 p-2.5 rounded bg-neutral-850 border border-neutral-800">
              <Database className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
              <div>
                <strong className="text-white block font-medium">Local Browser Session Cache</strong>
                <span className="text-neutral-400 text-[11px]">
                  Document drafts and annotations are backed up in your browser's private IndexedDB so work is never lost if the page reloads.
                </span>
              </div>
            </div>

            <div className="flex items-start gap-3 p-2.5 rounded bg-neutral-850 border border-neutral-800">
              <Lock className="w-4 h-4 text-purple-400 shrink-0 mt-0.5" />
              <div>
                <strong className="text-white block font-medium">Personal Signature Vault</strong>
                <span className="text-neutral-400 text-[11px]">
                  Signatures and initials are encrypted in your local device storage ({savedSignaturesCount} signature{savedSignaturesCount === 1 ? '' : 's'} stored).
                </span>
              </div>
            </div>
          </div>

          {/* Current Document Metrics */}
          <div className="p-3 bg-neutral-800/60 rounded-lg border border-neutral-700/60 text-[11px] grid grid-cols-2 gap-2 font-mono">
            <div>
              <span className="text-neutral-500 block">Current File:</span>
              <span className="text-white truncate block">{metadata.fileName}</span>
            </div>
            <div>
              <span className="text-neutral-500 block">File Size:</span>
              <span className="text-neutral-200 block">{(metadata.fileSizeBytes / 1024).toFixed(1)} KB</span>
            </div>
            <div>
              <span className="text-neutral-500 block">Page Count:</span>
              <span className="text-neutral-200 block">{metadata.pageCount} Pages</span>
            </div>
            <div>
              <span className="text-neutral-500 block">Storage Target:</span>
              <span className="text-emerald-400 flex items-center gap-1">
                <CheckCircle2 className="w-3 h-3" /> User Desktop
              </span>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-neutral-800 bg-neutral-900/60 flex items-center justify-end">
          <button
            onClick={onClose}
            className="px-4 py-1.5 bg-neutral-800 hover:bg-neutral-700 text-white rounded text-xs font-medium transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
