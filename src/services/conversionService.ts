import * as xlsx from 'xlsx';
import {
  Document as DocxDocument,
  Paragraph as DocxParagraph,
  TextRun as DocxTextRun,
  HeadingLevel,
  Packer,
  Table as DocxTable,
  TableRow as DocxTableRow,
  TableCell as DocxTableCell,
  WidthType,
  BorderStyle
} from 'docx';
import * as mammoth from 'mammoth';
import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';
import { PdfRendererService } from './pdfRenderer';
import { OcrPageResult } from '../types/pdf';

export class ConversionService {
  // 1. PDF TO EXCEL (.xlsx)
  static async convertPdfToExcel(
    renderer: PdfRendererService,
    numPages: number,
    ocrResults: Record<number, OcrPageResult>,
    documentTitle: string
  ): Promise<Uint8Array> {
    const wb = xlsx.utils.book_new();

    for (let p = 1; p <= numPages; p++) {
      const pageIndex = p - 1;
      const sheetData: string[][] = [];

      // Check if OCR results exist for page
      const ocr = ocrResults[pageIndex];
      if (ocr && ocr.lines && ocr.lines.length > 0) {
        for (const line of ocr.lines) {
          const cells = line.text.split(/\s{2,}|\t|\|/).map(c => c.trim()).filter(Boolean);
          if (cells.length > 0) {
            sheetData.push(cells);
          }
        }
      } else {
        // Extract vector text lines from PDF.js
        const { items } = await renderer.extractPageText(p);
        // Group items by vertical proximity
        const rowsByY: Record<number, Array<{ str: string; x: number }>> = {};
        for (const item of items) {
          const roundedY = Math.round(item.y / 8) * 8; // Group within 8pt
          if (!rowsByY[roundedY]) rowsByY[roundedY] = [];
          rowsByY[roundedY].push({ str: item.str, x: item.x });
        }

        const sortedYs = Object.keys(rowsByY).map(Number).sort((a, b) => a - b);
        for (const y of sortedYs) {
          const rowItems = rowsByY[y].sort((a, b) => a.x - b.x);
          const rowLine = rowItems.map(i => i.str).join(' ');
          const cells = rowLine.split(/\s{2,}|\t|\|/).map(c => c.trim()).filter(Boolean);
          if (cells.length > 0) {
            sheetData.push(cells);
          }
        }
      }

      if (sheetData.length === 0) {
        sheetData.push(['No structured tabular text detected on this page']);
      }

      const ws = xlsx.utils.aoa_to_sheet(sheetData);
      const sheetName = numPages === 1 ? 'Extracted Data' : `Page ${p}`;
      xlsx.utils.book_append_sheet(wb, ws, sheetName);
    }

    const outBuffer = xlsx.write(wb, { bookType: 'xlsx', type: 'array' });
    return new Uint8Array(outBuffer);
  }

  // 2. PDF TO CSV
  static async convertPdfToCsv(
    renderer: PdfRendererService,
    numPages: number,
    ocrResults: Record<number, OcrPageResult>
  ): Promise<string> {
    const lines: string[] = [];
    for (let p = 1; p <= numPages; p++) {
      const pageIndex = p - 1;
      const ocr = ocrResults[pageIndex];
      if (ocr && ocr.text) {
        lines.push(`--- Page ${p} ---`);
        const pageLines = ocr.text.split('\n');
        for (const line of pageLines) {
          const cells = line.split(/\s{2,}|\t/).map(c => `"${c.replace(/"/g, '""')}"`);
          lines.push(cells.join(','));
        }
      } else {
        const { fullText } = await renderer.extractPageText(p);
        lines.push(`--- Page ${p} ---`);
        for (const line of fullText.split('\n')) {
          const cells = line.split(/\s{2,}|\t/).map(c => `"${c.replace(/"/g, '""')}"`);
          lines.push(cells.join(','));
        }
      }
    }
    return lines.join('\n');
  }

  // 3. PDF TO WORD (.docx)
  static async convertPdfToWord(
    renderer: PdfRendererService,
    numPages: number,
    ocrResults: Record<number, OcrPageResult>,
    documentTitle: string
  ): Promise<Blob> {
    const children: any[] = [];

    // Title Heading
    children.push(
      new DocxParagraph({
        text: documentTitle.replace(/\.pdf$/i, ''),
        heading: HeadingLevel.TITLE,
        spacing: { after: 300 }
      })
    );

    for (let p = 1; p <= numPages; p++) {
      const pageIndex = p - 1;
      children.push(
        new DocxParagraph({
          text: `Page ${p}`,
          heading: HeadingLevel.HEADING_2,
          spacing: { before: 200, after: 150 }
        })
      );

      const ocr = ocrResults[pageIndex];
      let pageText = '';
      if (ocr && ocr.text) {
        pageText = ocr.text;
      } else {
        const extracted = await renderer.extractPageText(p);
        pageText = extracted.fullText;
      }

      const paragraphs = pageText.split('\n\n').filter(p => p.trim());
      if (paragraphs.length === 0) {
        const singleLines = pageText.split('\n').filter(l => l.trim());
        for (const line of singleLines) {
          children.push(
            new DocxParagraph({
              children: [new DocxTextRun({ text: line, size: 22 })],
              spacing: { after: 120 }
            })
          );
        }
      } else {
        for (const para of paragraphs) {
          children.push(
            new DocxParagraph({
              children: [new DocxTextRun({ text: para.replace(/\n/g, ' '), size: 22 })],
              spacing: { after: 160 }
            })
          );
        }
      }
    }

    const doc = new DocxDocument({
      sections: [
        {
          properties: {},
          children
        }
      ]
    });

    return await Packer.toBlob(doc);
  }

  // 4. WORD (.docx) TO PDF
  static async convertWordToPdf(
    docxBuffer: ArrayBuffer,
    fileName: string
  ): Promise<{ bytes: Uint8Array; fileName: string }> {
    // Extract raw text and structure from Word file using mammoth
    const result = await mammoth.extractRawText({ arrayBuffer: docxBuffer });
    const rawText = result.value || 'Empty Word Document';

    const pdfDoc = await PDFDocument.create();
    const helvetica = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const helveticaBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

    const lines = rawText.split('\n').map(l => l.trim());
    let page = pdfDoc.addPage([595, 842]); // A4
    let y = 780;

    // Header Title
    const title = fileName.replace(/\.docx?$/i, '');
    page.drawText(title, {
      x: 50,
      y,
      size: 16,
      font: helveticaBold,
      color: rgb(0.1, 0.2, 0.35)
    });
    y -= 15;
    page.drawLine({
      start: { x: 50, y },
      end: { x: 545, y },
      thickness: 1.5,
      color: rgb(0.2, 0.4, 0.7)
    });
    y -= 25;

    for (const line of lines) {
      if (!line) {
        y -= 10;
        continue;
      }

      // Check if page overflow
      if (y < 60) {
        page = pdfDoc.addPage([595, 842]);
        y = 780;
      }

      // Word wrapping helper (max ~80 chars per line for size 10)
      const maxChars = 85;
      if (line.length <= maxChars) {
        const isHeading = line.length < 50 && (line === line.toUpperCase() || line.endsWith(':'));
        page.drawText(line, {
          x: 50,
          y,
          size: isHeading ? 11 : 9.5,
          font: isHeading ? helveticaBold : helvetica,
          color: isHeading ? rgb(0.15, 0.25, 0.4) : rgb(0.15, 0.15, 0.15)
        });
        y -= isHeading ? 18 : 14;
      } else {
        // Split long line into words
        const words = line.split(' ');
        let currentChunk = '';
        for (const w of words) {
          if ((currentChunk + ' ' + w).length <= maxChars) {
            currentChunk += (currentChunk ? ' ' : '') + w;
          } else {
            if (y < 60) {
              page = pdfDoc.addPage([595, 842]);
              y = 780;
            }
            page.drawText(currentChunk, {
              x: 50,
              y,
              size: 9.5,
              font: helvetica,
              color: rgb(0.15, 0.15, 0.15)
            });
            y -= 14;
            currentChunk = w;
          }
        }
        if (currentChunk) {
          if (y < 60) {
            page = pdfDoc.addPage([595, 842]);
            y = 780;
          }
          page.drawText(currentChunk, {
            x: 50,
            y,
            size: 9.5,
            font: helvetica,
            color: rgb(0.15, 0.15, 0.15)
          });
          y -= 14;
        }
      }
    }

    const bytes = await pdfDoc.save();
    return {
      bytes,
      fileName: `${title}.pdf`
    };
  }

  // 5. EXCEL (.xlsx / .csv) TO PDF
  static async convertExcelToPdf(
    xlsxBuffer: ArrayBuffer,
    fileName: string
  ): Promise<{ bytes: Uint8Array; fileName: string }> {
    const wb = xlsx.read(xlsxBuffer, { type: 'array' });
    const pdfDoc = await PDFDocument.create();
    const helvetica = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const helveticaBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

    const title = fileName.replace(/\.(xlsx|xls|csv)$/i, '');

    for (const sheetName of wb.SheetNames) {
      const sheet = wb.Sheets[sheetName];
      const rawData: any[][] = xlsx.utils.sheet_to_json(sheet, { header: 1 });
      if (!rawData || rawData.length === 0) continue;

      let page = pdfDoc.addPage([842, 595]); // Landscape A4 for tables
      let y = 540;

      // Sheet title
      page.drawText(`${title} - ${sheetName}`, {
        x: 40,
        y,
        size: 14,
        font: helveticaBold,
        color: rgb(0.1, 0.2, 0.35)
      });
      y -= 12;
      page.drawLine({
        start: { x: 40, y },
        end: { x: 802, y },
        thickness: 1.5,
        color: rgb(0.2, 0.4, 0.7)
      });
      y -= 25;

      // Determine column count and widths
      const maxCols = Math.min(Math.max(...rawData.map(r => r.length)), 8);
      const colWidth = (762 / maxCols);

      for (let r = 0; r < rawData.length; r++) {
        const row = rawData[r] || [];
        if (y < 50) {
          page = pdfDoc.addPage([842, 595]);
          y = 540;
        }

        const isHeaderRow = r === 0;

        // Draw row background
        if (isHeaderRow) {
          page.drawRectangle({
            x: 40,
            y: y - 5,
            width: 762,
            height: 20,
            color: rgb(0.15, 0.25, 0.4)
          });
        } else if (r % 2 === 1) {
          page.drawRectangle({
            x: 40,
            y: y - 5,
            width: 762,
            height: 18,
            color: rgb(0.95, 0.96, 0.98)
          });
        }

        // Draw cells
        for (let c = 0; c < maxCols; c++) {
          const val = row[c] !== undefined && row[c] !== null ? String(row[c]) : '';
          const truncated = val.length > 25 ? val.substring(0, 23) + '..' : val;
          const cellX = 40 + c * colWidth + 5;

          page.drawText(truncated, {
            x: cellX,
            y: y,
            size: isHeaderRow ? 9 : 8.5,
            font: isHeaderRow ? helveticaBold : helvetica,
            color: isHeaderRow ? rgb(1, 1, 1) : rgb(0.15, 0.15, 0.15)
          });
        }

        y -= isHeaderRow ? 22 : 18;
      }
    }

    const bytes = await pdfDoc.save();
    return {
      bytes,
      fileName: `${title}.pdf`
    };
  }
}
