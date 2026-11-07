/** The desktop shell's bridge (electron/preload.cjs). Undefined when running in a browser. */
export interface DesktopFile {
  path: string;
  name: string;
  bytes: Uint8Array;
}

export interface DesktopApi {
  isDesktop: true;
  platform: string;
  openPdf(): Promise<DesktopFile | null>;
  takePendingFiles(): Promise<DesktopFile[]>;
  writeFile(path: string, bytes: Uint8Array): Promise<boolean>;
  saveDialog(suggestedName: string, kind: 'pdf' | 'txt' | 'md', bytes: Uint8Array): Promise<{ path: string; name: string } | null>;
  saveToFolder(files: Array<{ name: string; bytes: Uint8Array }>): Promise<boolean>;
  setDocumentState(state: { dirty: boolean }): void;
  onOpenFile(cb: (file: DesktopFile) => void): () => void;
  onMenu(cb: (command: string) => void): () => void;
}

export const desktop: DesktopApi | undefined = typeof window !== 'undefined' ? (window as any).desktopApi : undefined;

/** A saved/opened file on disk in the desktop app (stands in for a browser FileSystemFileHandle). */
export interface DesktopFileHandle {
  kind: 'desktop';
  path: string;
  name: string;
}

export const isDesktopHandle = (h: unknown): h is DesktopFileHandle => !!h && (h as any).kind === 'desktop' && typeof (h as any).path === 'string';
