import { createWorker, Worker } from 'tesseract.js';
import { assetUrl } from './assetUrl';
import { OcrPageResult, OcrLine, OcrWord } from '../types/pdf';

export interface OcrProgressState {
  status: string;
  progress: number; // 0 to 1
  pageIndex: number;
}

class OcrService {
  private worker: Worker | null = null;
  private isInitializing: boolean = false;

  private async getWorker(onProgress?: (state: OcrProgressState) => void, pageIndex: number = 0): Promise<Worker> {
    if (this.worker) return this.worker;

    this.isInitializing = true;
    try {
      const worker = await createWorker('eng', 1, {
        // Worker, engine and English language data are bundled with the app (no internet needed)
        workerPath: assetUrl('vendor/tesseract/worker.min.js'),
        corePath: assetUrl('vendor/tesseract/core/'),
        langPath: assetUrl('vendor/tesseract/lang'),
        gzip: true,
        logger: (m: any) => {
          if (onProgress && m && typeof m.progress === 'number') {
            onProgress({
              status: m.status || 'Processing text recognition',
              progress: Math.min(Math.max(m.progress, 0), 1),
              pageIndex
            });
          }
        }
      });
      this.worker = worker;
      return worker;
    } catch (err) {
      console.error('Failed to initialize Tesseract worker:', err);
      throw err;
    } finally {
      this.isInitializing = false;
    }
  }

  // Run 100% offline client-side OCR on an image data URL
  async recognizeImage(
    imageDataUrl: string,
    pageIndex: number,
    onProgress?: (state: OcrProgressState) => void
  ): Promise<OcrPageResult> {
    const worker = await this.getWorker(onProgress, pageIndex);

    if (onProgress) {
      onProgress({ status: 'Recognizing characters...', progress: 0.1, pageIndex });
    }

    const ret = await worker.recognize(imageDataUrl);
    const data = ret.data;

    // Parse lines and words
    const rawLines = (data as any).lines || [];
    const lines: OcrLine[] = rawLines.map((line: any) => {
      const words: OcrWord[] = (line.words || []).map((w: any) => ({
        text: w.text || '',
        confidence: w.confidence || 0,
        bbox: {
          x0: w.bbox?.x0 || 0,
          y0: w.bbox?.y0 || 0,
          x1: w.bbox?.x1 || 0,
          y1: w.bbox?.y1 || 0
        }
      }));

      return {
        text: line.text || '',
        confidence: line.confidence || 0,
        words
      };
    });

    if (onProgress) {
      onProgress({ status: 'OCR Complete', progress: 1.0, pageIndex });
    }

    return {
      pageIndex,
      text: data.text || '',
      confidence: Math.round(data.confidence || 0),
      lines,
      timestamp: Date.now()
    };
  }

  // Terminate worker when cleaning up
  async terminate(): Promise<void> {
    if (this.worker) {
      await this.worker.terminate();
      this.worker = null;
    }
  }

}

export const ocrService = new OcrService();
