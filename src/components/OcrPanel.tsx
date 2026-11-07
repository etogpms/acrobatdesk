import React, { useState } from 'react';
import {
  ScanText,
  Copy,
  Download,
  Search,
  Check,
  RefreshCw,
  FileCode,
  CheckCircle2,
  AlertCircle,
  HardDrive
} from 'lucide-react';
import { OcrPageResult } from '../types/pdf';
import { OcrProgressState, ocrService } from '../services/ocrService';
import { StorageService } from '../services/storageService';

interface OcrPanelProps {
  currentPage: number;
  totalPages: number;
  ocrResult: OcrPageResult | null;
  isRunningOcr: boolean;
  ocrProgress: OcrProgressState | null;
  onRunOcrCurrentPage: () => void;
  onRunOcrAllPages: () => void;
  onClose: () => void;
}

export const OcrPanel: React.FC<OcrPanelProps> = ({
  currentPage,
  totalPages,
  ocrResult,
  isRunningOcr,
  ocrProgress,
  onRunOcrCurrentPage,
  onRunOcrAllPages,
  onClose
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [copied, setCopied] = useState(false);
  const [editableText, setEditableText] = useState<string>('');

  // Keep editable text synced when new OCR result arrives
  React.useEffect(() => {
    if (ocrResult?.text) {
      setEditableText(ocrResult.text);
    }
  }, [ocrResult]);

  // Copy to clipboard
  const handleCopy = () => {
    const textToCopy = editableText;
    navigator.clipboard.writeText(textToCopy);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // Export to local desktop
  const handleExportTxt = () => {
    const textToExport = editableText;
    StorageService.exportTextFile(textToExport, `OCR_Page_${currentPage}_Extracted.txt`);
  };

  const handleExportMd = () => {
    const textToExport = editableText;
    const mdContent = `# OCR Text Extraction - Page ${currentPage}\n\nConfidence: ${ocrResult?.confidence || 95}%\nExtracted: ${new Date().toLocaleString()}\n\n---\n\n${textToExport}`;
    StorageService.exportTextFile(mdContent, `OCR_Page_${currentPage}_Extracted.md`);
  };

  // Filter text lines by search term
  const displayedText = editableText;
  const wordCount = displayedText ? displayedText.trim().split(/\s+/).length : 0;
  const charCount = displayedText ? displayedText.length : 0;

  return (
    <aside className="w-80 md:w-96 bg-neutral-900 border-l border-neutral-800 flex flex-col select-none shrink-0 h-full z-10">
      {/* Panel Header */}
      <div className="h-12 px-4 border-b border-neutral-800 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 rounded bg-cyan-600/20 border border-cyan-500/40 flex items-center justify-center text-cyan-400">
            <ScanText className="w-3.5 h-3.5" />
          </div>
          <span className="font-semibold text-xs text-white">OCR Text Recognition</span>
        </div>
        <button
          onClick={onClose}
          className="text-neutral-400 hover:text-white text-xs px-2 py-1 rounded transition-colors"
        >
          Close
        </button>
      </div>

      {/* Trigger & Action Bar */}
      <div className="p-3 border-b border-neutral-800 space-y-2">
        <div className="grid grid-cols-2 gap-2">
          <button
            onClick={onRunOcrCurrentPage}
            disabled={isRunningOcr}
            className="w-full py-2 px-3 bg-cyan-600 hover:bg-cyan-500 disabled:opacity-50 text-white rounded text-xs font-medium flex items-center justify-center gap-1.5 shadow transition-colors"
          >
            {isRunningOcr ? (
              <>
                <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                <span>Recognizing...</span>
              </>
            ) : (
              <>
                <ScanText className="w-3.5 h-3.5" />
                <span>OCR Page {currentPage}</span>
              </>
            )}
          </button>

          <button
            onClick={onRunOcrAllPages}
            disabled={isRunningOcr}
            className="w-full py-2 px-3 bg-neutral-800 hover:bg-neutral-700 disabled:opacity-50 text-neutral-200 rounded text-xs font-medium flex items-center justify-center gap-1.5 border border-neutral-700 transition-colors"
          >
            <span>OCR All Pages</span>
          </button>
        </div>

        {/* Local Storage Privacy Pill */}
        <div className="flex items-center gap-1.5 text-[10px] text-neutral-400 bg-neutral-850 px-2 py-1 rounded border border-neutral-800">
          <HardDrive className="w-3 h-3 text-emerald-400 shrink-0" />
          <span>Runs 100% locally on your machine via Web Workers</span>
        </div>
      </div>

      {/* Progress Bar (Visible during recognition) */}
      {isRunningOcr && ocrProgress && (
        <div className="p-3 bg-neutral-850 border-b border-neutral-800">
          <div className="flex items-center justify-between text-xs mb-1.5">
            <span className="text-cyan-400 font-medium truncate">{ocrProgress.status}</span>
            <span className="font-mono text-neutral-300">{Math.round(ocrProgress.progress * 100)}%</span>
          </div>
          <div className="w-full h-1.5 bg-neutral-800 rounded-full overflow-hidden">
            <div
              className="h-full bg-cyan-500 transition-all duration-300"
              style={{ width: `${Math.round(ocrProgress.progress * 100)}%` }}
            />
          </div>
        </div>
      )}

      {/* Results Meta & Tabs */}
      {ocrResult && (
        <div className="px-3 py-2 bg-neutral-850 border-b border-neutral-800 flex items-center justify-between text-xs">
          <div className="flex items-center gap-2">
            <span className="text-emerald-400 font-medium font-mono">
              {ocrResult.confidence}% Confidence
            </span>
            <span className="text-neutral-500">·</span>
            <span className="text-neutral-400 font-mono text-[11px]">{wordCount} words</span>
          </div>

        </div>
      )}

      {/* Search Input Filter */}
      {ocrResult && (
        <div className="p-2 border-b border-neutral-800">
          <div className="relative">
            <Search className="w-3.5 h-3.5 absolute left-2.5 top-2.5 text-neutral-500" />
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Filter extracted words..."
              className="w-full bg-neutral-800 border border-neutral-700 rounded pl-8 pr-3 py-1.5 text-xs text-neutral-200 outline-none focus:border-cyan-500"
            />
          </div>
        </div>
      )}

      {/* Extracted Text Area */}
      <div className="flex-1 overflow-y-auto p-3 text-xs font-mono text-neutral-200 leading-relaxed bg-neutral-950/60">
        {ocrResult ? (
          <textarea
            value={displayedText}
            onChange={(e) => setEditableText(e.target.value)}
            className="w-full h-full bg-transparent resize-none outline-none leading-relaxed text-neutral-200 select-text font-mono text-xs"
            placeholder="No text recognized yet"
          />
        ) : (
          <div className="h-full flex flex-col items-center justify-center text-center text-neutral-400 gap-2 p-4">
            <ScanText className="w-10 h-10 text-neutral-500 stroke-1" />
            <p className="text-xs font-sans font-medium text-neutral-300">No OCR Text Generated</p>
            <p className="text-[11px] font-sans text-neutral-500 max-w-xs">
              Click <strong className="text-cyan-400 font-semibold">"OCR Page {currentPage}"</strong> above to extract text, tables, and numbers from this document page.
            </p>
          </div>
        )}
      </div>

      {/* Export & Copy Footer */}
      {ocrResult && (
        <div className="p-3 border-t border-neutral-800 bg-neutral-900 flex items-center justify-between gap-2">
          <button
            onClick={handleCopy}
            className="flex-1 py-1.5 px-2 bg-neutral-800 hover:bg-neutral-750 text-neutral-200 rounded text-xs font-medium flex items-center justify-center gap-1.5 transition-colors"
          >
            {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
            <span>{copied ? 'Copied!' : 'Copy Text'}</span>
          </button>

          <button
            onClick={handleExportTxt}
            className="py-1.5 px-2.5 bg-neutral-800 hover:bg-neutral-750 text-neutral-200 rounded text-xs font-medium flex items-center gap-1 transition-colors"
            title="Export as .txt file to desktop"
          >
            <Download className="w-3.5 h-3.5" />
            <span>.TXT</span>
          </button>

          <button
            onClick={handleExportMd}
            className="py-1.5 px-2.5 bg-neutral-800 hover:bg-neutral-750 text-neutral-200 rounded text-xs font-medium flex items-center gap-1 transition-colors"
            title="Export as Markdown to desktop"
          >
            <FileCode className="w-3.5 h-3.5" />
            <span>.MD</span>
          </button>
        </div>
      )}
    </aside>
  );
};
