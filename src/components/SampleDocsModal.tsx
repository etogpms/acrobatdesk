import React from 'react';
import { X, FileText, ArrowRight, CheckCircle2, Shield, ScanText, FileCheck } from 'lucide-react';
import { SAMPLE_DOCS, SampleDocMeta } from '../services/samplePdfs';

interface SampleDocsModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectSample: (id: string) => void;
}

export const SampleDocsModal: React.FC<SampleDocsModalProps> = ({
  isOpen,
  onClose,
  onSelectSample
}) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="bg-neutral-900 border border-neutral-800 rounded-xl max-w-2xl w-full shadow-2xl overflow-hidden flex flex-col">
        {/* Header */}
        <div className="px-5 py-4 border-b border-neutral-800 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-cyan-600/20 border border-cyan-500/40 flex items-center justify-center text-cyan-400">
              <FileText className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-white tracking-tight">Load Sample PDF Document</h2>
              <p className="text-[11px] text-neutral-400">
                Choose a pre-formatted template to test Acrobat signing, annotating, and OCR features
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1 text-neutral-400 hover:text-white rounded transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* List of sample documents */}
        <div className="p-5 grid grid-cols-1 sm:grid-cols-2 gap-3.5">
          {SAMPLE_DOCS.map((doc) => {
            const isOcr = doc.id === 'scanned_ocr';
            const isContract = doc.id === 'contract';

            return (
              <div
                key={doc.id}
                onClick={() => {
                  onSelectSample(doc.id);
                  onClose();
                }}
                className={`p-4 rounded-xl border cursor-pointer transition-all flex flex-col justify-between group ${
                  isOcr
                    ? 'bg-neutral-850 hover:bg-neutral-800 border-cyan-800/60 hover:border-cyan-500 shadow-cyan-950/20 shadow-md'
                    : 'bg-neutral-850 hover:bg-neutral-800 border-neutral-800 hover:border-neutral-700'
                }`}
              >
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${
                      isOcr
                        ? 'bg-cyan-950 text-cyan-300 border border-cyan-800/80'
                        : isContract
                        ? 'bg-purple-950 text-purple-300 border border-purple-800/80'
                        : 'bg-neutral-800 text-neutral-300'
                    }`}>
                      {doc.badge}
                    </span>
                    <span className="text-[11px] font-mono text-neutral-500">{doc.pages} {doc.pages === 1 ? 'page' : 'pages'}</span>
                  </div>

                  <h3 className="text-xs font-semibold text-white group-hover:text-cyan-300 transition-colors mb-1.5 flex items-center gap-1.5">
                    {isOcr ? <ScanText className="w-3.5 h-3.5 text-cyan-400" /> : <FileCheck className="w-3.5 h-3.5 text-neutral-400" />}
                    <span>{doc.name}</span>
                  </h3>

                  <p className="text-[11px] text-neutral-400 leading-relaxed">
                    {doc.description}
                  </p>
                </div>

                <div className="mt-4 pt-3 border-t border-neutral-800/80 flex items-center justify-between text-xs font-medium text-neutral-400 group-hover:text-cyan-400 transition-colors">
                  <span>Open Document</span>
                  <ArrowRight className="w-3.5 h-3.5 group-hover:translate-x-1 transition-transform" />
                </div>
              </div>
            );
          })}
        </div>

        {/* Footer info */}
        <div className="px-5 py-3 border-t border-neutral-800 bg-neutral-900/60 flex items-center justify-between text-xs text-neutral-400">
          <div className="flex items-center gap-1.5">
            <Shield className="w-3.5 h-3.5 text-emerald-400" />
            <span>All sample files process 100% locally on your personal desktop.</span>
          </div>
          <button
            onClick={onClose}
            className="px-3 py-1 bg-neutral-800 hover:bg-neutral-700 text-neutral-300 rounded text-xs transition-colors"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
};
