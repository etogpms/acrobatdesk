import React, { useState } from 'react';
import {
  X,
  FileSpreadsheet,
  FileText,
  ArrowRight,
  ArrowLeftRight,
  Upload,
  Check,
  RefreshCw,
  Download,
  CheckCircle2,
  Table,
  FileCode
} from 'lucide-react';
import { ConversionService } from '../services/conversionService';
import { PdfRendererService } from '../services/pdfRenderer';
import { OcrPageResult } from '../types/pdf';

interface ConversionModalProps {
  isOpen: boolean;
  onClose: () => void;
  renderer: PdfRendererService;
  numPages: number;
  ocrResults: Record<number, OcrPageResult>;
  documentTitle: string;
  onPdfLoaded: (bytes: Uint8Array, fileName: string) => void;
}

export const ConversionModal: React.FC<ConversionModalProps> = ({
  isOpen,
  onClose,
  renderer,
  numPages,
  ocrResults,
  documentTitle,
  onPdfLoaded
}) => {
  const [activeTab, setActiveTab] = useState<'export' | 'import'>('export');
  const [isConverting, setIsConverting] = useState(false);
  const [conversionStatus, setConversionStatus] = useState<string>('');
  const [selectedImportFile, setSelectedImportFile] = useState<File | null>(null);

  if (!isOpen) return null;

  // Trigger Export to Excel (.xlsx)
  const handleExportExcel = async () => {
    setIsConverting(true);
    setConversionStatus('Extracting tables and generating Excel workbook...');
    try {
      const xlsxBytes = await ConversionService.convertPdfToExcel(
        renderer,
        numPages,
        ocrResults,
        documentTitle
      );
      // Download .xlsx locally to desktop
      const blob = new Blob([xlsxBytes as unknown as BlobPart], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${documentTitle.replace(/\.pdf$/i, '')}.xlsx`;
      document.body.appendChild(a);
      a.click();
      setTimeout(() => {
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      }, 1000);
      onClose();
    } catch (err: any) {
      console.error('Excel conversion error:', err);
      alert(`Export error: ${err.message || 'Failed to export to Excel'}`);
    } finally {
      setIsConverting(false);
      setConversionStatus('');
    }
  };

  // Trigger Export to Word (.docx)
  const handleExportWord = async () => {
    setIsConverting(true);
    setConversionStatus('Formatting paragraphs and building Word document...');
    try {
      const docxBlob = await ConversionService.convertPdfToWord(
        renderer,
        numPages,
        ocrResults,
        documentTitle
      );
      const url = URL.createObjectURL(docxBlob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${documentTitle.replace(/\.pdf$/i, '')}.docx`;
      document.body.appendChild(a);
      a.click();
      setTimeout(() => {
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      }, 1000);
      onClose();
    } catch (err: any) {
      console.error('Word conversion error:', err);
      alert(`Export error: ${err.message || 'Failed to export to Word'}`);
    } finally {
      setIsConverting(false);
      setConversionStatus('');
    }
  };

  // Trigger Export to CSV
  const handleExportCsv = async () => {
    setIsConverting(true);
    setConversionStatus('Formatting comma-separated values...');
    try {
      const csvString = await ConversionService.convertPdfToCsv(
        renderer,
        numPages,
        ocrResults
      );
      const blob = new Blob([csvString], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${documentTitle.replace(/\.pdf$/i, '')}.csv`;
      document.body.appendChild(a);
      a.click();
      setTimeout(() => {
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      }, 1000);
      onClose();
    } catch (err: any) {
      console.error('CSV export error:', err);
      alert(`Export error: ${err.message || 'Failed to export to CSV'}`);
    } finally {
      setIsConverting(false);
      setConversionStatus('');
    }
  };

  // Handle file selected for conversion to PDF
  const handleImportFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      setSelectedImportFile(e.target.files[0]);
    }
  };

  // Convert Word or Excel file to PDF
  const handleConvertImportToPdf = async () => {
    if (!selectedImportFile) return;
    setIsConverting(true);
    setConversionStatus(`Converting ${selectedImportFile.name} to formatted PDF...`);

    try {
      const buffer = await selectedImportFile.arrayBuffer();
      const fileName = selectedImportFile.name.toLowerCase();

      let result: { bytes: Uint8Array; fileName: string };

      if (fileName.endsWith('.docx') || fileName.endsWith('.doc')) {
        result = await ConversionService.convertWordToPdf(buffer, selectedImportFile.name);
      } else if (fileName.endsWith('.xlsx') || fileName.endsWith('.xls') || fileName.endsWith('.csv')) {
        result = await ConversionService.convertExcelToPdf(buffer, selectedImportFile.name);
      } else {
        throw new Error('Please select a valid Word (.docx) or Excel (.xlsx / .csv) file.');
      }

      onPdfLoaded(result.bytes, result.fileName);
      onClose();
    } catch (err: any) {
      console.error('Conversion to PDF error:', err);
      alert(`Conversion error: ${err.message || 'Could not convert file to PDF'}`);
    } finally {
      setIsConverting(false);
      setConversionStatus('');
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="bg-neutral-900 border border-neutral-800 rounded-xl max-w-xl w-full shadow-2xl overflow-hidden flex flex-col">
        {/* Header */}
        <div className="px-5 py-4 border-b border-neutral-800 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-emerald-600/20 border border-emerald-500/40 flex items-center justify-center text-emerald-400">
              <ArrowLeftRight className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-white tracking-tight">Convert & Export Studio</h2>
              <p className="text-[11px] text-neutral-400">Two-way conversion between PDF, Excel (.xlsx), and Word (.docx)</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1 text-neutral-400 hover:text-white rounded transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Tab Switcher */}
        <div className="flex items-center border-b border-neutral-800 px-5 pt-2 gap-4 text-xs font-medium">
          <button
            onClick={() => setActiveTab('export')}
            className={`pb-2.5 flex items-center gap-1.5 border-b-2 transition-colors ${
              activeTab === 'export'
                ? 'border-emerald-500 text-emerald-400'
                : 'border-transparent text-neutral-400 hover:text-neutral-200'
            }`}
          >
            <Download className="w-3.5 h-3.5" />
            <span>Export PDF to Excel / Word</span>
          </button>

          <button
            onClick={() => setActiveTab('import')}
            className={`pb-2.5 flex items-center gap-1.5 border-b-2 transition-colors ${
              activeTab === 'import'
                ? 'border-emerald-500 text-emerald-400'
                : 'border-transparent text-neutral-400 hover:text-neutral-200'
            }`}
          >
            <Upload className="w-3.5 h-3.5" />
            <span>Convert Word / Excel to PDF</span>
          </button>
        </div>

        {/* Body */}
        <div className="p-5 flex-1">
          {isConverting ? (
            <div className="h-48 flex flex-col items-center justify-center gap-3 text-center">
              <RefreshCw className="w-8 h-8 text-emerald-400 animate-spin" />
              <p className="text-xs text-white font-medium">{conversionStatus}</p>
              <p className="text-[11px] text-neutral-400 max-w-xs">
                All processing occurs 100% locally on your computer with zero cloud data transmission.
              </p>
            </div>
          ) : activeTab === 'export' ? (
            <div className="space-y-3">
              <p className="text-xs text-neutral-400">
                Choose format to convert and download directly to your desktop:
              </p>

              {/* Option 1: Excel */}
              <div
                onClick={handleExportExcel}
                className="p-3.5 bg-neutral-850 hover:bg-neutral-800 border border-neutral-800 hover:border-emerald-500/80 rounded-xl cursor-pointer transition-all flex items-center justify-between group"
              >
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-lg bg-emerald-950/60 border border-emerald-800/80 flex items-center justify-center text-emerald-400 group-hover:scale-105 transition-transform">
                    <FileSpreadsheet className="w-5 h-5" />
                  </div>
                  <div>
                    <h4 className="text-xs font-semibold text-white group-hover:text-emerald-300 transition-colors">
                      Microsoft Excel (.xlsx)
                    </h4>
                    <p className="text-[11px] text-neutral-400">
                      Extracts tables, financial ledgers, numbers, and forms into multi-sheet spreadsheet
                    </p>
                  </div>
                </div>
                <ArrowRight className="w-4 h-4 text-neutral-400 group-hover:text-emerald-400 group-hover:translate-x-1 transition-transform" />
              </div>

              {/* Option 2: Word */}
              <div
                onClick={handleExportWord}
                className="p-3.5 bg-neutral-850 hover:bg-neutral-800 border border-neutral-800 hover:border-blue-500/80 rounded-xl cursor-pointer transition-all flex items-center justify-between group"
              >
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-lg bg-blue-950/60 border border-blue-800/80 flex items-center justify-center text-blue-400 group-hover:scale-105 transition-transform">
                    <FileText className="w-5 h-5" />
                  </div>
                  <div>
                    <h4 className="text-xs font-semibold text-white group-hover:text-blue-300 transition-colors">
                      Microsoft Word (.docx)
                    </h4>
                    <p className="text-[11px] text-neutral-400">
                      Converts document into editable Word file preserving headings, paragraphs, and text
                    </p>
                  </div>
                </div>
                <ArrowRight className="w-4 h-4 text-neutral-400 group-hover:text-blue-400 group-hover:translate-x-1 transition-transform" />
              </div>

              {/* Option 3: CSV */}
              <div
                onClick={handleExportCsv}
                className="p-3.5 bg-neutral-850 hover:bg-neutral-800 border border-neutral-800 hover:border-neutral-600 rounded-xl cursor-pointer transition-all flex items-center justify-between group"
              >
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-lg bg-neutral-800 border border-neutral-700 flex items-center justify-center text-neutral-300 group-hover:scale-105 transition-transform">
                    <FileCode className="w-5 h-5" />
                  </div>
                  <div>
                    <h4 className="text-xs font-semibold text-white group-hover:text-neutral-200 transition-colors">
                      Comma-Separated Values (.csv)
                    </h4>
                    <p className="text-[11px] text-neutral-400">
                      Raw extracted tabular data for databases, pandas, and data science
                    </p>
                  </div>
                </div>
                <ArrowRight className="w-4 h-4 text-neutral-400 group-hover:text-white group-hover:translate-x-1 transition-transform" />
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <p className="text-xs text-neutral-400">
                Select a Microsoft Word (.docx) or Excel (.xlsx / .csv) file to convert into PDF:
              </p>

              {/* Dropzone / Upload Picker */}
              <div className="border-2 border-dashed border-neutral-700 rounded-xl p-6 text-center hover:border-emerald-500 transition-colors">
                <input
                  type="file"
                  accept=".docx,.doc,.xlsx,.xls,.csv"
                  onChange={handleImportFileChange}
                  className="hidden"
                  id="vice-versa-upload"
                />
                <label htmlFor="vice-versa-upload" className="cursor-pointer flex flex-col items-center gap-2">
                  <Upload className="w-8 h-8 text-neutral-400" />
                  <span className="text-xs text-neutral-200 font-medium">Click to select Word or Excel file from desktop</span>
                  <span className="text-[11px] text-neutral-500">Supports .docx, .doc, .xlsx, .xls, and .csv</span>
                </label>
              </div>

              {selectedImportFile && (
                <div className="p-3 bg-neutral-850 border border-neutral-800 rounded-lg flex items-center justify-between text-xs">
                  <div className="flex items-center gap-2 min-w-0">
                    <div className="p-1 rounded bg-neutral-800 text-emerald-400">
                      {selectedImportFile.name.endsWith('.docx') ? <FileText className="w-4 h-4" /> : <FileSpreadsheet className="w-4 h-4" />}
                    </div>
                    <div className="truncate">
                      <span className="text-white font-medium truncate block">{selectedImportFile.name}</span>
                      <span className="text-[10px] text-neutral-500">{(selectedImportFile.size / 1024).toFixed(1)} KB</span>
                    </div>
                  </div>

                  <button
                    onClick={handleConvertImportToPdf}
                    className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded text-xs font-medium flex items-center gap-1 shadow transition-colors shrink-0"
                  >
                    <span>Convert & Open</span>
                    <ArrowRight className="w-3 h-3" />
                  </button>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-neutral-800 bg-neutral-900/60 flex items-center justify-between text-xs text-neutral-400">
          <span className="text-[11px]">Desktop-based processing · Zero cloud upload</span>
          <button
            onClick={onClose}
            className="px-3.5 py-1.5 bg-neutral-800 hover:bg-neutral-700 text-neutral-200 rounded text-xs transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
