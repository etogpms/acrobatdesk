import { SavedSignature, RecentFileRecord, AnnotationItem } from '../types/pdf';
import { desktop, isDesktopHandle } from './desktop';

const DB_NAME = 'AcrobatDesk_Storage';
const DB_VERSION = 1;
const STORE_DRAFTS = 'document_drafts';

// IndexedDB Helper for private desktop persistence
function getDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_DRAFTS)) {
        db.createObjectStore(STORE_DRAFTS, { keyPath: 'id' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export const StorageService = {
  // Check if Native File System Access API is supported
  isFileSystemAccessSupported(): boolean {
    return typeof window !== 'undefined' && 'showOpenFilePicker' in window && 'showSaveFilePicker' in window;
  },

  // Open PDF directly from User's Desktop Hard Drive
  async openDesktopFile(): Promise<{
    file: File;
    handle: FileSystemFileHandle | null;
    bytes: Uint8Array;
  }> {
    // Desktop app: native Open dialog
    if (desktop) {
      const f = await desktop.openPdf();
      if (!f) throw Object.assign(new Error('Cancelled'), { name: 'AbortError' });
      const bytes = new Uint8Array(f.bytes);
      return {
        file: new File([bytes as unknown as BlobPart], f.name, { type: 'application/pdf' }),
        handle: { kind: 'desktop', path: f.path, name: f.name } as unknown as FileSystemFileHandle,
        bytes
      };
    }
    if (this.isFileSystemAccessSupported()) {
      try {
        const [handle] = await (window as any).showOpenFilePicker({
          types: [
            {
              description: 'PDF Documents (*.pdf)',
              accept: { 'application/pdf': ['.pdf'] }
            }
          ],
          multiple: false
        });
        const file = await handle.getFile();
        const buffer = await file.arrayBuffer();
        return {
          file,
          handle,
          bytes: new Uint8Array(buffer)
        };
      } catch (err: any) {
        // User cancelled picker
        if (err.name === 'AbortError') {
          throw err;
        }
        console.warn('File System Access API failed, falling back to file input', err);
      }
    }

    // Fallback: Standard file input dialog
    return new Promise((resolve, reject) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'application/pdf';
      input.onchange = async () => {
        if (!input.files || input.files.length === 0) {
          reject(new Error('No file selected'));
          return;
        }
        const file = input.files[0];
        const buffer = await file.arrayBuffer();
        resolve({
          file,
          handle: null,
          bytes: new Uint8Array(buffer)
        });
      };
      input.click();
    });
  },

  // Save changes directly back to the original desktop file
  async saveToOriginalDesktopFile(handle: FileSystemFileHandle, bytes: Uint8Array): Promise<boolean> {
    const h: unknown = handle;
    if (isDesktopHandle(h) && desktop) {
      try {
        return await desktop.writeFile(h.path, bytes);
      } catch (err) {
        console.error('Failed to write file:', err);
        return false;
      }
    }
    try {
      const writable = await (handle as any).createWritable();
      await writable.write(bytes);
      await writable.close();
      return true;
    } catch (err) {
      console.error('Failed to write to original file handle:', err);
      return false;
    }
  },

  // Save As to chosen Desktop destination folder
  async saveAsDesktopFile(bytes: Uint8Array, suggestedName: string): Promise<FileSystemFileHandle | null> {
    const cleanName = suggestedName.endsWith('.pdf') ? suggestedName : `${suggestedName}.pdf`;

    if (desktop) {
      const res = await desktop.saveDialog(cleanName, 'pdf', bytes);
      return res ? ({ kind: 'desktop', path: res.path, name: res.name } as unknown as FileSystemFileHandle) : null;
    }

    if (this.isFileSystemAccessSupported()) {
      try {
        const handle = await (window as any).showSaveFilePicker({
          suggestedName: cleanName,
          types: [
            {
              description: 'PDF Document (*.pdf)',
              accept: { 'application/pdf': ['.pdf'] }
            }
          ]
        });
        const writable = await handle.createWritable();
        await writable.write(bytes);
        await writable.close();
        return handle;
      } catch (err: any) {
        if (err.name === 'AbortError') return null;
        console.warn('Native save picker failed, triggering browser download', err);
      }
    }

    // Fallback: Direct local file download
    this.downloadLocally(bytes, cleanName);
    return null;
  },

  // Direct local file download
  downloadLocally(bytes: Uint8Array, fileName: string) {
    if (desktop) {
      // Desktop app: a native Save dialog instead of a browser download
      desktop.saveDialog(fileName.endsWith('.pdf') ? fileName : `${fileName}.pdf`, 'pdf', bytes);
      return;
    }
    const blob = new Blob([bytes as unknown as BlobPart], { type: 'application/pdf' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName.endsWith('.pdf') ? fileName : `${fileName}.pdf`;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }, 1000);
  },

  // Export OCR Text as .txt or .md file to desktop
  exportTextFile(content: string, fileName: string) {
    if (desktop) {
      desktop.saveDialog(fileName, fileName.toLowerCase().endsWith('.md') ? 'md' : 'txt', new TextEncoder().encode(content));
      return;
    }
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }, 1000);
  },

  // Save Working Session Draft to local IndexedDB (zero cloud upload)
  async saveDraft(id: string, fileName: string, bytes: Uint8Array, annotations: AnnotationItem[]): Promise<void> {
    try {
      const db = await getDB();
      const tx = db.transaction(STORE_DRAFTS, 'readwrite');
      const store = tx.objectStore(STORE_DRAFTS);
      store.put({
        id,
        fileName,
        bytes,
        annotations,
        updatedAt: Date.now()
      });
    } catch (e) {
      console.warn('Could not persist draft to IndexedDB:', e);
    }
  },

  // Load Saved Working Session Draft
  async loadDraft(id: string): Promise<{ fileName: string; bytes: Uint8Array; annotations: AnnotationItem[] } | null> {
    try {
      const db = await getDB();
      return new Promise((resolve) => {
        const tx = db.transaction(STORE_DRAFTS, 'readonly');
        const store = tx.objectStore(STORE_DRAFTS);
        const req = store.get(id);
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => resolve(null);
      });
    } catch {
      return null;
    }
  },

  // Saved Signatures Vault in localStorage
  getSavedSignatures(): SavedSignature[] {
    try {
      const raw = localStorage.getItem('acrobatdesk_signatures');
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  },

  saveSignature(sig: SavedSignature): SavedSignature[] {
    try {
      const current = this.getSavedSignatures();
      const updated = [sig, ...current.filter(s => s.id !== sig.id)].slice(0, 12);
      localStorage.setItem('acrobatdesk_signatures', JSON.stringify(updated));
      return updated;
    } catch {
      return [];
    }
  },

  deleteSignature(id: string): SavedSignature[] {
    try {
      const current = this.getSavedSignatures();
      const updated = current.filter(s => s.id !== id);
      localStorage.setItem('acrobatdesk_signatures', JSON.stringify(updated));
      return updated;
    } catch {
      return [];
    }
  },

  // Recent Local Documents List
  getRecentFiles(): RecentFileRecord[] {
    try {
      const raw = localStorage.getItem('acrobatdesk_recent_files');
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  },

  addRecentFile(record: RecentFileRecord): void {
    try {
      const current = this.getRecentFiles().filter(f => f.fileName !== record.fileName);
      const updated = [record, ...current].slice(0, 8);
      localStorage.setItem('acrobatdesk_recent_files', JSON.stringify(updated));
    } catch {
      // Ignore quota errors
    }
  }
};
