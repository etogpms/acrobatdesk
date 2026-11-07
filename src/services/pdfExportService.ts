import { PDFDocument, rgb, degrees, StandardFonts, PDFPage, PDFStream, PDFName, PDFBool } from 'pdf-lib';
import { AnnotationItem, PageInfo } from '../types/pdf';
import { RunFontProvider, drawTextBlock } from './textBlockExport';
import { annotationFamilyId } from './fontLibrary';
import { BBox, SIGNATURE_MARK, bboxClose, listImageDraws, removeImagesFromPage } from './contentStreamEditor';
import { exportCommentsToPage } from './commentsIO';

// Parse hex color string to pdf-lib rgb(r, g, b)
function parseHexColor(hex?: string, defaultColor = { r: 0, g: 0, b: 0 }) {
  if (!hex || !hex.startsWith('#')) return rgb(defaultColor.r, defaultColor.g, defaultColor.b);
  const cleanHex = hex.replace('#', '');
  if (cleanHex.length === 3) {
    const r = parseInt(cleanHex[0] + cleanHex[0], 16) / 255;
    const g = parseInt(cleanHex[1] + cleanHex[1], 16) / 255;
    const b = parseInt(cleanHex[2] + cleanHex[2], 16) / 255;
    return rgb(r, g, b);
  } else if (cleanHex.length === 6) {
    const r = parseInt(cleanHex.substring(0, 2), 16) / 255;
    const g = parseInt(cleanHex.substring(2, 4), 16) / 255;
    const b = parseInt(cleanHex.substring(4, 6), 16) / 255;
    return rgb(r, g, b);
  }
  return rgb(defaultColor.r, defaultColor.g, defaultColor.b);
}

// Convert data URL (base64) to Uint8Array
function dataUrlToUint8Array(dataUrl: string): Uint8Array {
  const base64 = dataUrl.split(',')[1] || dataUrl;
  const binary = atob(base64);
  const len = binary.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

export class PdfExportService {
  static async bakeAndExportPdf(
    sourceBytes: Uint8Array,
    annotations: AnnotationItem[],
    pageInfos: PageInfo[],
    editedTextBlocks: import('../types/pdf').PdfTextBlock[] = []
  ): Promise<Uint8Array> {
    const srcDoc = await PDFDocument.load(sourceBytes, { ignoreEncryption: true });
    const outDoc = await PDFDocument.create();

    const helvetica = await outDoc.embedFont(StandardFonts.Helvetica);
    const helveticaBold = await outDoc.embedFont(StandardFonts.HelveticaBold);
    const timesRoman = await outDoc.embedFont(StandardFonts.TimesRoman);
    const timesBold = await outDoc.embedFont(StandardFonts.TimesRomanBold);
    const courier = await outDoc.embedFont(StandardFonts.Courier);
    const courierBold = await outDoc.embedFont(StandardFonts.CourierBold);

    // Map font selection
    const getFont = (fontFamily?: string, isBold?: boolean) => {
      if (fontFamily?.includes('Times')) return isBold ? timesBold : timesRoman;
      if (fontFamily?.includes('Courier') || fontFamily?.includes('Mono')) return isBold ? courierBold : courier;
      return isBold ? helveticaBold : helvetica;
    };

    const runFonts = new RunFontProvider(outDoc);

    // Copy pages in the specified page order
    const pageIndicesToCopy = pageInfos.map(p => p.pageIndex);
    const copiedPages = await outDoc.copyPages(srcDoc, pageIndicesToCopy);

    for (let i = 0; i < copiedPages.length; i++) {
      const page = copiedPages[i];
      const pageInfo = pageInfos[i];
      const originalPageIndex = pageInfo.pageIndex;
      const { width: pageWidth, height: pageHeight } = page.getSize();

      // Apply page rotation
      if (pageInfo.rotation) {
        const currentRot = page.getRotation().angle;
        page.setRotation(degrees((currentRot + pageInfo.rotation) % 360));
      }

      outDoc.addPage(page);

      // Images the user deleted: remove their draw commands from the page content for real
      const removals = annotations.filter(a => a.pageIndex === originalPageIndex && a.type === 'image_removal' && a.removedImageBBox);
      if (removals.length) {
        const { unmatched } = removeImagesFromPage(outDoc, page, removals.map(r => r.removedImageBBox as BBox));
        // Anything we could not locate in the content is at least covered
        for (const bb of unmatched) {
          const cover = removals.find(r => r.removedImageBBox && r.removedImageBBox.every((v, k) => Math.abs(v - bb[k]) < 0.01));
          page.drawRectangle({ x: bb[0], y: bb[1], width: bb[2] - bb[0], height: bb[3] - bb[1], color: parseHexColor(cover?.color, { r: 1, g: 1, b: 1 }) });
        }
      }

      // The user's own "this is / is not a signature" calls on original images
      const flags = annotations.filter(a => a.pageIndex === originalPageIndex && a.type === 'image_flag' && a.flagBBox);
      if (flags.length) {
        for (const draw of listImageDraws(outDoc, page)) {
          const flag = flags.find(f => bboxClose(f.flagBBox as BBox, draw.bbox));
          if (!flag) continue;
          if (flag.flagSignature) draw.image.dict.set(PDFName.of(SIGNATURE_MARK), PDFBool.True);
          else draw.image.dict.delete(PDFName.of(SIGNATURE_MARK));
        }
      }

      // Edited PDF text: cover the original glyphs and draw the new styled text
      const pageEditedBlocks = editedTextBlocks.filter(b => b.pageIndex === originalPageIndex && b.isModified);
      for (const block of pageEditedBlocks) {
        await drawTextBlock(page, block, runFonts, pageWidth, pageHeight, parseHexColor);
      }

      // Render annotations for this page
      const pageAnnotations = annotations.filter(a => a.pageIndex === originalPageIndex);
      await this.renderAnnotationsOnPage(page, pageAnnotations, outDoc, getFont, runFonts);

      // Highlights and comments as real PDF annotations (visible in Acrobat, Preview, Chrome…)
      try {
        exportCommentsToPage(outDoc, page, pageAnnotations, annotations);
      } catch (err) {
        console.warn('Could not write comments for page', i + 1, err);
      }
    }

    return await outDoc.save();
  }

  private static async renderAnnotationsOnPage(
    page: PDFPage,
    annotations: AnnotationItem[],
    doc: PDFDocument,
    getFont: (fontFamily?: string, isBold?: boolean) => any,
    runFonts: RunFontProvider
  ): Promise<void> {
    const { width: pageWidth, height: pageHeight } = page.getSize();

    for (const ann of annotations) {
      try {
        // Percentage coordinates to PDF point coordinates (Origin: bottom-left)
        const elemX = (ann.x / 100) * pageWidth;
        const elemW = ((ann.width || 20) / 100) * pageWidth;
        const elemH = ((ann.height || 5) / 100) * pageHeight;
        // In PDF bottom-left is (0,0), so Y is pageHeight - (ann.y% * pageHeight) - elemH
        const elemY = pageHeight - (ann.y / 100) * pageHeight - elemH;

        if (ann.type === 'text') {
          // Same bundled font (and bold / italic face) the editor shows
          const font = await runFonts.get(annotationFamilyId(ann), !!ann.isBold, !!ann.isItalic);
          const fallback = getFont(ann.fontFamily, ann.isBold);
          const fontSize = ann.fontSize || 12;
          const color = parseHexColor(ann.color, { r: 0.1, g: 0.1, b: 0.1 });
          const lines = (ann.content || '').split('\n');
          const glyphs = (font as any).embedder?.font;
          const hasGlyphs = (text: string) =>
            !glyphs?.hasGlyphForCodePoint || [...text].every((ch) => /\s/.test(ch) || glyphs.hasGlyphForCodePoint(ch.codePointAt(0)));

          const lineGap = fontSize * 1.25 * (ann.lineSpacing || 1);
          let lineY = elemY + elemH - fontSize;
          for (const line of lines) {
            // Characters the font lacks (e.g. ✓): use a standard font, dropping what it can't encode
            let text = line;
            let useFont = font;
            if (!hasGlyphs(line)) {
              useFont = fallback;
              try {
                fallback.encodeText(line);
              } catch {
                text = line.replace(/[^\x20-\x7E]/g, '');
              }
            }
            const w = useFont.widthOfTextAtSize(text, fontSize);
            const x =
              ann.textAlign === 'center' ? elemX + (elemW - w) / 2 : ann.textAlign === 'right' ? elemX + elemW - w : elemX;
            page.drawText(text, { x, y: Math.max(0, lineY), size: fontSize, font: useFont, color });
            if (ann.isUnderline && w > 0) {
              page.drawLine({
                start: { x, y: lineY - fontSize * 0.12 },
                end: { x: x + w, y: lineY - fontSize * 0.12 },
                thickness: Math.max(0.5, fontSize * 0.06),
                color
              });
            }
            lineY -= lineGap;
          }
        } else if (ann.type === 'highlight') {
          // Written as a real /Highlight annotation by exportCommentsToPage
        } else if (ann.type === 'redact') {
          // Opaque whiteout or blackout box
          const isBlack = ann.color === '#000000' || !ann.color;
          const color = isBlack ? rgb(0, 0, 0) : rgb(1, 1, 1);
          page.drawRectangle({
            x: elemX,
            y: elemY,
            width: elemW,
            height: elemH,
            color,
            borderColor: isBlack ? rgb(0, 0, 0) : rgb(0.8, 0.8, 0.8),
            borderWidth: 1,
            opacity: 1
          });
        } else if (ann.type === 'shape') {
          const strokeColor = parseHexColor(ann.color, { r: 0.2, g: 0.4, b: 0.8 });
          if (ann.shapeType === 'rectangle') {
            page.drawRectangle({
              x: elemX,
              y: elemY,
              width: elemW,
              height: elemH,
              borderColor: strokeColor,
              borderWidth: 2
            });
          } else if (ann.shapeType === 'circle') {
            page.drawEllipse({
              x: elemX + elemW / 2,
              y: elemY + elemH / 2,
              xScale: elemW / 2,
              yScale: elemH / 2,
              borderColor: strokeColor,
              borderWidth: 2
            });
          } else if (ann.shapeType === 'line' || ann.shapeType === 'arrow') {
            page.drawLine({
              start: { x: elemX, y: elemY },
              end: { x: elemX + elemW, y: elemY + elemH },
              thickness: 2,
              color: strokeColor
            });
          }
        } else if (ann.type === 'signature' || ann.type === 'stamp' || ann.type === 'image') {
          if (ann.imageData) {
            const imageBytes = dataUrlToUint8Array(ann.imageData);
            let embeddedImage;
            if (ann.imageData.startsWith('data:image/jpeg') || ann.imageData.startsWith('data:image/jpg')) {
              embeddedImage = await doc.embedJpg(imageBytes);
            } else {
              embeddedImage = await doc.embedPng(imageBytes);
            }

            page.drawImage(embeddedImage, {
              x: elemX,
              y: elemY,
              width: elemW,
              height: elemH
            });

            // Signatures stay recognisable (and copy-protected) when the saved file is reopened
            if (ann.type === 'signature' || ann.isSignature) {
              await embeddedImage.embed();
              const obj = doc.context.lookup(embeddedImage.ref);
              if (obj instanceof PDFStream) obj.dict.set(PDFName.of(SIGNATURE_MARK), PDFBool.True);
            }
          }
        } else if (ann.type === 'pen' && ann.drawingPath) {
          const { points, color, width, opacity } = ann.drawingPath;
          if (points && points.length > 1) {
            const strokeColor = parseHexColor(color, { r: 0.1, g: 0.2, b: 0.8 });
            for (let p = 0; p < points.length - 1; p++) {
              const p1 = points[p];
              const p2 = points[p + 1];
              const x1 = (p1.x / 100) * pageWidth;
              const y1 = pageHeight - (p1.y / 100) * pageHeight;
              const x2 = (p2.x / 100) * pageWidth;
              const y2 = pageHeight - (p2.y / 100) * pageHeight;

              page.drawLine({
                start: { x: x1, y: y1 },
                end: { x: x2, y: y2 },
                thickness: width || 2,
                color: strokeColor,
                opacity: opacity || 1
              });
            }
          }
        }
      } catch (err) {
        console.warn('Failed to bake annotation item onto page:', ann, err);
      }
    }
  }
}
