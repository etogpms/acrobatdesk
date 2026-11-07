import React, { useRef, useState, useEffect } from 'react';
import {
  X,
  PenTool,
  Type,
  Upload,
  RotateCcw,
  Check,
  Trash2,
  Lock,
  Sparkles
} from 'lucide-react';
import { SavedSignature } from '../types/pdf';
import { StorageService } from '../services/storageService';

interface SignatureModalProps {
  isOpen: boolean;
  onClose: () => void;
  onApplySignature: (dataUrl: string) => void;
  savedSignatures: SavedSignature[];
  onRefreshSavedSignatures: () => void;
}

export const SignatureModal: React.FC<SignatureModalProps> = ({
  isOpen,
  onClose,
  onApplySignature,
  savedSignatures,
  onRefreshSavedSignatures
}) => {
  const [tab, setTab] = useState<'draw' | 'type' | 'upload' | 'vault'>('draw');
  const [typedName, setTypedName] = useState('John Doe');
  const [selectedFont, setSelectedFont] = useState<string>('font-signature-caveat');
  const [inkColor, setInkColor] = useState<string>('#0F172A'); // Dark Navy Black
  const [saveToVault, setSaveToVault] = useState<boolean>(true);
  const [uploadedDataUrl, setUploadedDataUrl] = useState<string | null>(null);

  // Drawing Canvas
  const drawCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [hasDrawnSomething, setHasDrawnSomething] = useState(false);

  // Initialize or clear drawing canvas
  const clearCanvas = () => {
    const canvas = drawCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    setHasDrawnSomething(false);
  };

  useEffect(() => {
    if (tab === 'draw') {
      setTimeout(clearCanvas, 50);
    }
  }, [tab]);

  if (!isOpen) return null;

  // Drawing Handlers
  const startDrawing = (e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
    const canvas = drawCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    setIsDrawing(true);
    setHasDrawnSomething(true);

    const rect = canvas.getBoundingClientRect();
    const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
    const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;
    const x = clientX - rect.left;
    const y = clientY - rect.top;

    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.strokeStyle = inkColor;
    ctx.lineWidth = 2.5;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
  };

  const drawMove = (e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
    if (!isDrawing) return;
    const canvas = drawCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const rect = canvas.getBoundingClientRect();
    const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
    const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;
    const x = clientX - rect.left;
    const y = clientY - rect.top;

    ctx.lineTo(x, y);
    ctx.stroke();
  };

  const stopDrawing = () => {
    setIsDrawing(false);
  };

  // Convert Typed Name to PNG Data URL
  const generateTypedSignaturePng = (): string => {
    const canvas = document.createElement('canvas');
    canvas.width = 600;
    canvas.height = 180;
    const ctx = canvas.getContext('2d');
    if (!ctx) return '';

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = inkColor;
    
    // Choose font family
    const fontName = selectedFont === 'font-signature-caveat' ? 'Caveat, cursive' : 'Dancing Script, cursive';
    ctx.font = `italic 64px ${fontName}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(typedName || 'Signature', 300, 90);

    return canvas.toDataURL('image/png');
  };

  // Handle Image Upload
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (ev) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        ctx.drawImage(img, 0, 0);
        // Make bright/white background transparent
        const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const data = imgData.data;
        for (let i = 0; i < data.length; i += 4) {
          const r = data[i];
          const g = data[i + 1];
          const b = data[i + 2];
          // If pixel is near white, set alpha to 0
          if (r > 215 && g > 215 && b > 215) {
            data[i + 3] = 0;
          }
        }
        ctx.putImageData(imgData, 0, 0);
        setUploadedDataUrl(canvas.toDataURL('image/png'));
      };
      img.src = ev.target?.result as string;
    };
    reader.readAsDataURL(file);
  };

  // Final Apply Signature
  const handleApply = () => {
    let finalDataUrl = '';

    if (tab === 'draw') {
      if (!drawCanvasRef.current || !hasDrawnSomething) return;
      finalDataUrl = drawCanvasRef.current.toDataURL('image/png');
    } else if (tab === 'type') {
      finalDataUrl = generateTypedSignaturePng();
    } else if (tab === 'upload') {
      if (!uploadedDataUrl) return;
      finalDataUrl = uploadedDataUrl;
    }

    if (!finalDataUrl) return;

    // Save to Vault if requested
    if (saveToVault) {
      const sigRecord: SavedSignature = {
        id: `sig-${Date.now()}`,
        name: tab === 'type' ? typedName : `Signature ${new Date().toLocaleDateString()}`,
        type: tab as any,
        dataUrl: finalDataUrl,
        createdAt: Date.now()
      };
      StorageService.saveSignature(sigRecord);
      onRefreshSavedSignatures();
    }

    onApplySignature(finalDataUrl);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="bg-neutral-900 border border-neutral-800 rounded-xl max-w-xl w-full shadow-2xl overflow-hidden flex flex-col">
        {/* Modal Header */}
        <div className="px-5 py-4 border-b border-neutral-800 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded bg-purple-600/20 border border-purple-500/40 flex items-center justify-center text-purple-400">
              <PenTool className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-white tracking-tight">Create Signature & Initials</h2>
              <p className="text-[11px] text-neutral-400">Stored privately in your personal desktop browser vault</p>
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
            onClick={() => setTab('draw')}
            className={`pb-2.5 flex items-center gap-1.5 border-b-2 transition-colors ${
              tab === 'draw'
                ? 'border-purple-500 text-purple-400'
                : 'border-transparent text-neutral-400 hover:text-neutral-200'
            }`}
          >
            <PenTool className="w-3.5 h-3.5" />
            <span>Draw</span>
          </button>

          <button
            onClick={() => setTab('type')}
            className={`pb-2.5 flex items-center gap-1.5 border-b-2 transition-colors ${
              tab === 'type'
                ? 'border-purple-500 text-purple-400'
                : 'border-transparent text-neutral-400 hover:text-neutral-200'
            }`}
          >
            <Type className="w-3.5 h-3.5" />
            <span>Type</span>
          </button>

          <button
            onClick={() => setTab('upload')}
            className={`pb-2.5 flex items-center gap-1.5 border-b-2 transition-colors ${
              tab === 'upload'
                ? 'border-purple-500 text-purple-400'
                : 'border-transparent text-neutral-400 hover:text-neutral-200'
            }`}
          >
            <Upload className="w-3.5 h-3.5" />
            <span>Upload Image</span>
          </button>

          {savedSignatures.length > 0 && (
            <button
              onClick={() => setTab('vault')}
              className={`pb-2.5 flex items-center gap-1.5 border-b-2 transition-colors ${
                tab === 'vault'
                  ? 'border-purple-500 text-purple-400'
                  : 'border-transparent text-neutral-400 hover:text-neutral-200'
              }`}
            >
              <Lock className="w-3.5 h-3.5" />
              <span>Saved Vault ({savedSignatures.length})</span>
            </button>
          )}
        </div>

        {/* Modal Body */}
        <div className="p-5 flex-1">
          {/* TAB 1: DRAW */}
          {tab === 'draw' && (
            <div className="space-y-3">
              <div className="flex items-center justify-between text-xs text-neutral-400">
                <span>Sign inside the box using mouse, stylus, or touchpad:</span>
                <button
                  onClick={clearCanvas}
                  className="flex items-center gap-1 text-neutral-400 hover:text-white transition-colors"
                >
                  <RotateCcw className="w-3 h-3" />
                  <span>Clear</span>
                </button>
              </div>

              <div className="relative bg-white rounded-lg border-2 border-neutral-700/80 overflow-hidden shadow-inner h-44">
                <canvas
                  ref={drawCanvasRef}
                  width={540}
                  height={176}
                  onMouseDown={startDrawing}
                  onMouseMove={drawMove}
                  onMouseUp={stopDrawing}
                  onMouseLeave={stopDrawing}
                  onTouchStart={startDrawing}
                  onTouchMove={drawMove}
                  onTouchEnd={stopDrawing}
                  className="w-full h-full cursor-crosshair block"
                />
                {!hasDrawnSomething && (
                  <div className="absolute inset-0 pointer-events-none flex items-center justify-center text-neutral-400 text-sm font-signature-caveat text-xl opacity-60">
                    Sign Here With Mouse or Trackpad
                  </div>
                )}
                {/* Signing baseline */}
                <div className="absolute bottom-6 left-6 right-6 border-b border-neutral-200 pointer-events-none" />
              </div>
            </div>
          )}

          {/* TAB 2: TYPE */}
          {tab === 'type' && (
            <div className="space-y-4">
              <div>
                <label className="block text-xs text-neutral-400 mb-1.5">Enter your full name or initials:</label>
                <input
                  type="text"
                  value={typedName}
                  onChange={(e) => setTypedName(e.target.value)}
                  className="w-full bg-neutral-800 border border-neutral-700 rounded-lg px-3 py-2 text-sm text-white outline-none focus:border-purple-500"
                  placeholder="e.g. John Doe"
                />
              </div>

              <div>
                <label className="block text-xs text-neutral-400 mb-2">Select Calligraphy Style:</label>
                <div className="grid grid-cols-2 gap-3">
                  <div
                    onClick={() => setSelectedFont('font-signature-caveat')}
                    className={`p-4 bg-white rounded-lg border-2 cursor-pointer text-center text-2xl font-signature-caveat text-neutral-900 transition-all ${
                      selectedFont === 'font-signature-caveat'
                        ? 'border-purple-500 ring-2 ring-purple-500/30'
                        : 'border-neutral-300 hover:border-neutral-400'
                    }`}
                  >
                    {typedName || 'Signature'}
                  </div>

                  <div
                    onClick={() => setSelectedFont('font-signature-dancing')}
                    className={`p-4 bg-white rounded-lg border-2 cursor-pointer text-center text-2xl font-signature-dancing text-neutral-900 transition-all ${
                      selectedFont === 'font-signature-dancing'
                        ? 'border-purple-500 ring-2 ring-purple-500/30'
                        : 'border-neutral-300 hover:border-neutral-400'
                    }`}
                  >
                    {typedName || 'Signature'}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* TAB 3: UPLOAD */}
          {tab === 'upload' && (
            <div className="space-y-4">
              <label className="block text-xs text-neutral-400">
                Upload PNG or JPG image of your signature:
              </label>

              <div className="border-2 border-dashed border-neutral-700 rounded-lg p-6 text-center hover:border-purple-500 transition-colors">
                <input
                  type="file"
                  accept="image/png, image/jpeg, image/jpg"
                  onChange={handleFileUpload}
                  className="hidden"
                  id="sig-file-upload"
                />
                <label htmlFor="sig-file-upload" className="cursor-pointer flex flex-col items-center gap-2">
                  <Upload className="w-8 h-8 text-neutral-400" />
                  <span className="text-xs text-neutral-300 font-medium">Click to select signature file from desktop</span>
                  <span className="text-[11px] text-neutral-500">Auto-cleans white background for transparent ink</span>
                </label>
              </div>

              {uploadedDataUrl && (
                <div className="p-3 bg-neutral-800 rounded-lg border border-neutral-700 flex items-center justify-between">
                  <div className="h-14 bg-white rounded p-1 flex items-center justify-center">
                    <img src={uploadedDataUrl} alt="Uploaded signature" className="max-h-full max-w-full object-contain" />
                  </div>
                  <span className="text-xs text-emerald-400 flex items-center gap-1">
                    <Check className="w-3.5 h-3.5" /> Signature Ready
                  </span>
                </div>
              )}
            </div>
          )}

          {/* TAB 4: VAULT */}
          {tab === 'vault' && (
            <div className="space-y-3 max-h-56 overflow-y-auto">
              <span className="text-xs text-neutral-400">Click a saved signature to apply instantly:</span>
              <div className="grid grid-cols-2 gap-3">
                {savedSignatures.map((sig) => (
                  <div
                    key={sig.id}
                    className="group relative p-3 bg-neutral-800 hover:bg-neutral-750 border border-neutral-700 hover:border-purple-500 rounded-lg cursor-pointer transition-all flex flex-col items-center justify-between"
                    onClick={() => {
                      onApplySignature(sig.dataUrl);
                      onClose();
                    }}
                  >
                    <div className="w-full h-16 bg-white rounded p-1 flex items-center justify-center mb-2">
                      <img src={sig.dataUrl} alt={sig.name} className="max-h-full max-w-full object-contain" />
                    </div>
                    <span className="text-[11px] text-neutral-300 truncate w-full text-center">{sig.name}</span>

                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        StorageService.deleteSignature(sig.id);
                        onRefreshSavedSignatures();
                      }}
                      className="absolute top-1 right-1 p-1 text-neutral-500 hover:text-red-400 transition-colors opacity-0 group-hover:opacity-100"
                      title="Delete saved signature"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Common Options: Ink Color & Save to Vault */}
          {tab !== 'vault' && (
            <div className="mt-4 pt-3 border-t border-neutral-800 flex items-center justify-between text-xs">
              <div className="flex items-center gap-2">
                <span className="text-neutral-400">Ink Color:</span>
                {[
                  { name: 'Dark Navy', color: '#0F172A' },
                  { name: 'Classic Blue', color: '#1E3A8A' },
                  { name: 'Royal Blue', color: '#2563EB' }
                ].map((c) => (
                  <button
                    key={c.color}
                    onClick={() => setInkColor(c.color)}
                    style={{ backgroundColor: c.color }}
                    className={`w-4 h-4 rounded-full transition-transform ${
                      inkColor === c.color ? 'scale-125 ring-2 ring-purple-400' : 'hover:scale-110'
                    }`}
                    title={c.name}
                  />
                ))}
              </div>

              <label className="flex items-center gap-1.5 cursor-pointer text-neutral-300">
                <input
                  type="checkbox"
                  checked={saveToVault}
                  onChange={(e) => setSaveToVault(e.target.checked)}
                  className="rounded border-neutral-700 text-purple-600 focus:ring-purple-500 bg-neutral-800"
                />
                <span className="text-[11px]">Save to Desktop Vault</span>
              </label>
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div className="px-5 py-3 border-t border-neutral-800 bg-neutral-900/60 flex items-center justify-end gap-2">
          <button
            onClick={onClose}
            className="px-4 py-1.5 rounded text-xs text-neutral-400 hover:text-white transition-colors"
          >
            Cancel
          </button>
          {tab !== 'vault' && (
            <button
              onClick={handleApply}
              disabled={tab === 'draw' && !hasDrawnSomething}
              className="px-4 py-1.5 bg-purple-600 hover:bg-purple-500 disabled:opacity-40 text-white rounded text-xs font-medium transition-colors shadow"
            >
              Apply Signature
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
