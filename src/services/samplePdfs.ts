import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';

export interface SampleDocMeta {
  id: string;
  name: string;
  description: string;
  pages: number;
  badge: string;
}

export const SAMPLE_DOCS: SampleDocMeta[] = [
  {
    id: 'contract',
    name: 'Master Services Agreement & NDA.pdf',
    description: '3-page commercial legal contract with formal signature blocks, terms, and date fields.',
    pages: 3,
    badge: 'Legal & Sign'
  },
  {
    id: 'invoice',
    name: 'Commercial Invoice & PO #8492.pdf',
    description: '1-page itemized business invoice with line items, tax breakdown, and approval stamp zone.',
    pages: 1,
    badge: 'Billing & Form'
  },
  {
    id: 'scanned_ocr',
    name: 'Scanned Diagnostic Report (OCR Ready).pdf',
    description: 'High-contrast scanned lab results document with text, numbers, and tables to test OCR recognition.',
    pages: 1,
    badge: 'OCR Test'
  },
  {
    id: 'blank',
    name: 'Blank Document.pdf',
    description: 'Clean single-page blank canvas for creating annotations, notes, and signing from scratch.',
    pages: 1,
    badge: 'Blank'
  }
];

export async function createSamplePdf(type: string): Promise<{ bytes: Uint8Array; fileName: string }> {
  const pdfDoc = await PDFDocument.create();
  const timesRoman = await pdfDoc.embedFont(StandardFonts.TimesRoman);
  const timesBold = await pdfDoc.embedFont(StandardFonts.TimesRomanBold);
  const helvetica = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const helveticaBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const courier = await pdfDoc.embedFont(StandardFonts.Courier);

  if (type === 'contract') {
    // Page 1: Master Services Agreement
    const page1 = pdfDoc.addPage([595, 842]); // A4
    page1.drawText('MASTER SERVICES AGREEMENT & MUTUAL NDA', {
      x: 60,
      y: 770,
      size: 16,
      font: helveticaBold,
      color: rgb(0.1, 0.15, 0.25)
    });

    page1.drawLine({
      start: { x: 60, y: 755 },
      end: { x: 535, y: 755 },
      thickness: 1.5,
      color: rgb(0.2, 0.3, 0.5)
    });

    page1.drawText('Document Reference: MSA-2026-X941  ·  Effective Date: November 05, 2026', {
      x: 60,
      y: 735,
      size: 9,
      font: helvetica,
      color: rgb(0.4, 0.45, 0.5)
    });

    page1.drawText('1. PARTIES & BACKGROUND', {
      x: 60,
      y: 695,
      size: 12,
      font: helveticaBold,
      color: rgb(0.15, 0.2, 0.3)
    });

    const p1Body = [
      'This Master Services Agreement ("Agreement") is entered into as of the Effective Date by and between:',
      '• ACME GLOBAL ENTERPRISES LLC, with principal offices at 450 Lexington Ave, New York, NY ("Client"), and',
      '• DESKTOP SYSTEMS CORP., a Delaware corporation with offices at 100 Montgomery St, San Francisco, CA ("Provider").',
      '',
      'WHEREAS, Client desires to retain Provider to perform professional engineering, digital document architecture, and',
      'system integration services, and Provider agrees to perform such services under the terms set forth herein.',
      '',
      '2. SCOPE OF SERVICES & DELIVERABLES',
      'Provider shall furnish the software deliverables, browser-native document rendering engines, and security modules',
      'detailed in Exhibit A (Statement of Work). All services shall be performed in accordance with high industry standards,',
      'strictly guaranteeing 100% client-side privacy with no unauthorized external data transmission.',
      '',
      '3. CLIENT-SIDE LOCAL STORAGE MANDATE',
      'Both parties expressly acknowledge and agree that all customer documents, annotations, signatures, and confidential',
      'records processed through the application shall remain exclusively on the user\'s local desktop storage repository.',
      'No files or unencrypted intermediate representations shall be stored in external cloud datastores without explicit consent.'
    ];

    let y = 670;
    for (const line of p1Body) {
      if (line.startsWith('2.') || line.startsWith('3.')) {
        y -= 10;
        page1.drawText(line, { x: 60, y, size: 12, font: helveticaBold, color: rgb(0.15, 0.2, 0.3) });
      } else {
        page1.drawText(line, { x: 60, y, size: 10, font: timesRoman, color: rgb(0.15, 0.15, 0.15) });
      }
      y -= 17;
    }

    page1.drawText('Page 1 of 3 · Confidential Agreement', {
      x: 230,
      y: 35,
      size: 9,
      font: helvetica,
      color: rgb(0.5, 0.5, 0.5)
    });

    // Page 2: Terms and Covenants
    const page2 = pdfDoc.addPage([595, 842]);
    page2.drawText('MASTER SERVICES AGREEMENT (CONTINUED)', {
      x: 60,
      y: 770,
      size: 14,
      font: helveticaBold,
      color: rgb(0.1, 0.15, 0.25)
    });

    page2.drawLine({
      start: { x: 60, y: 755 },
      end: { x: 535, y: 755 },
      thickness: 1,
      color: rgb(0.7, 0.75, 0.8)
    });

    const p2Body = [
      '4. COMPENSATION & PAYMENT TERMS',
      'Client shall pay Provider the agreed professional fees in accordance with the milestone schedule set forth in Exhibit B.',
      'All undisputed invoices submitted by Provider shall be payable Net Thirty (30) days from receipt.',
      '',
      '5. CONFIDENTIALITY & PROPRIETARY INFORMATION',
      '"Confidential Information" means all non-public technical, business, financial, or operational information disclosed',
      'by either party to the other, whether orally, in writing, or through digital document transmission. Each party agrees:',
      '(a) To hold the other party\'s Confidential Information in strict confidence using no less than reasonable care;',
      '(b) Not to disclose such information to any third party without prior written authorization;',
      '(c) To strictly utilize browser-sandboxed desktop storage to prevent involuntary leakage.',
      '',
      '6. INTELLECTUAL PROPERTY RIGHTS',
      'Upon full and final payment, Client shall own all right, title, and interest in and to the custom deliverables developed',
      'expressly for Client under this Agreement, excluding Provider\'s pre-existing software, frameworks, and open-source tooling.',
      '',
      '7. TERM AND TERMINATION',
      'This Agreement shall commence on the Effective Date and continue for a period of twelve (12) months, unless terminated',
      'earlier by either party upon thirty (30) days written notice for material breach.'
    ];

    let y2 = 720;
    for (const line of p2Body) {
      if (line.startsWith('4.') || line.startsWith('5.') || line.startsWith('6.') || line.startsWith('7.')) {
        y2 -= 10;
        page2.drawText(line, { x: 60, y: y2, size: 12, font: helveticaBold, color: rgb(0.15, 0.2, 0.3) });
      } else {
        page2.drawText(line, { x: 60, y: y2, size: 10, font: timesRoman, color: rgb(0.15, 0.15, 0.15) });
      }
      y2 -= 17;
    }

    page2.drawText('Page 2 of 3 · Confidential Agreement', {
      x: 230,
      y: 35,
      size: 9,
      font: helvetica,
      color: rgb(0.5, 0.5, 0.5)
    });

    // Page 3: Execution and Signature Blocks
    const page3 = pdfDoc.addPage([595, 842]);
    page3.drawText('EXECUTION & SIGNATURE ACCEPTANCE', {
      x: 60,
      y: 770,
      size: 14,
      font: helveticaBold,
      color: rgb(0.1, 0.15, 0.25)
    });

    page3.drawLine({
      start: { x: 60, y: 755 },
      end: { x: 535, y: 755 },
      thickness: 1,
      color: rgb(0.7, 0.75, 0.8)
    });

    page3.drawText('IN WITNESS WHEREOF, the parties have executed this Agreement by their duly authorized representatives.', {
      x: 60,
      y: 720,
      size: 10,
      font: timesRoman,
      color: rgb(0.15, 0.15, 0.15)
    });

    // Client Signature Box
    page3.drawRectangle({
      x: 60,
      y: 490,
      width: 220,
      height: 180,
      borderColor: rgb(0.75, 0.8, 0.85),
      borderWidth: 1,
      color: rgb(0.97, 0.98, 0.99)
    });

    page3.drawText('CLIENT: ACME GLOBAL LLC', { x: 75, y: 645, size: 10, font: helveticaBold, color: rgb(0.1, 0.2, 0.3) });
    page3.drawText('Authorized Signature:', { x: 75, y: 590, size: 9, font: helvetica, color: rgb(0.4, 0.45, 0.5) });
    page3.drawLine({ start: { x: 75, y: 565 }, end: { x: 260, y: 565 }, thickness: 1, color: rgb(0.6, 0.65, 0.7) });
    page3.drawText('Sign here (Fill & Sign tool)', { x: 75, y: 550, size: 8, font: timesRoman, color: rgb(0.6, 0.2, 0.2) });
    page3.drawText('Name: Sarah Jenkins, VP Operations', { x: 75, y: 525, size: 9, font: helvetica, color: rgb(0.2, 0.2, 0.2) });
    page3.drawText('Date: ________________________', { x: 75, y: 505, size: 9, font: helvetica, color: rgb(0.3, 0.3, 0.3) });

    // Provider Signature Box
    page3.drawRectangle({
      x: 315,
      y: 490,
      width: 220,
      height: 180,
      borderColor: rgb(0.75, 0.8, 0.85),
      borderWidth: 1,
      color: rgb(0.97, 0.98, 0.99)
    });

    page3.drawText('PROVIDER: DESKTOP SYSTEMS CORP.', { x: 330, y: 645, size: 10, font: helveticaBold, color: rgb(0.1, 0.2, 0.3) });
    page3.drawText('Authorized Signature:', { x: 330, y: 590, size: 9, font: helvetica, color: rgb(0.4, 0.45, 0.5) });
    page3.drawLine({ start: { x: 330, y: 565 }, end: { x: 515, y: 565 }, thickness: 1, color: rgb(0.6, 0.65, 0.7) });
    page3.drawText('Sign here (Fill & Sign tool)', { x: 330, y: 550, size: 8, font: timesRoman, color: rgb(0.6, 0.2, 0.2) });
    page3.drawText('Name: Marcus Vance, CEO', { x: 330, y: 525, size: 9, font: helvetica, color: rgb(0.2, 0.2, 0.2) });
    page3.drawText('Date: ________________________', { x: 330, y: 505, size: 9, font: helvetica, color: rgb(0.3, 0.3, 0.3) });

    // Notary & Approval Stamp area
    page3.drawRectangle({
      x: 60,
      y: 350,
      width: 475,
      height: 100,
      borderColor: rgb(0.8, 0.85, 0.9),
      borderWidth: 1,
      color: rgb(0.99, 0.99, 1.0)
    });
    page3.drawText('OFFICIAL LEGAL STAMP & ATTESTATION AREA', { x: 75, y: 425, size: 10, font: helveticaBold, color: rgb(0.3, 0.35, 0.45) });
    page3.drawText('Place corporate digital stamp, company seal, or approved endorsement using the Stamp Tool.', { x: 75, y: 405, size: 9, font: timesRoman, color: rgb(0.4, 0.4, 0.4) });
    page3.drawText('Verification Code: VERIF-2026-DESK-SECURE-100PCT-LOCAL', { x: 75, y: 375, size: 8, font: courier, color: rgb(0.4, 0.5, 0.6) });

    page3.drawText('Page 3 of 3 · Final Execution Copy', {
      x: 230,
      y: 35,
      size: 9,
      font: helvetica,
      color: rgb(0.5, 0.5, 0.5)
    });

    const bytes = await pdfDoc.save();
    return { bytes, fileName: 'Master Services Agreement & NDA.pdf' };
  }

  if (type === 'invoice') {
    // Commercial Invoice
    const page = pdfDoc.addPage([595, 842]);
    page.drawText('COMMERCIAL INVOICE', { x: 60, y: 770, size: 20, font: helveticaBold, color: rgb(0.1, 0.15, 0.25) });
    page.drawText('INVOICE NO: INV-2026-8492', { x: 370, y: 770, size: 12, font: helveticaBold, color: rgb(0.2, 0.3, 0.5) });
    page.drawText('Date: November 05, 2026', { x: 370, y: 750, size: 10, font: helvetica, color: rgb(0.4, 0.4, 0.4) });
    page.drawText('Payment Due: December 05, 2026 (Net 30)', { x: 370, y: 735, size: 9, font: helvetica, color: rgb(0.7, 0.2, 0.2) });

    page.drawLine({ start: { x: 60, y: 720 }, end: { x: 535, y: 720 }, thickness: 1.5, color: rgb(0.15, 0.2, 0.3) });

    // Bill From / Bill To
    page.drawText('ISSUED BY:', { x: 60, y: 695, size: 9, font: helveticaBold, color: rgb(0.4, 0.4, 0.4) });
    page.drawText('AcrobatDesk Technologies Inc.', { x: 60, y: 680, size: 10, font: helveticaBold, color: rgb(0.1, 0.1, 0.1) });
    page.drawText('500 Enterprise Way, Suite 400', { x: 60, y: 665, size: 9, font: helvetica, color: rgb(0.3, 0.3, 0.3) });
    page.drawText('San Francisco, CA 94105 · billing@acrobatdesk.internal', { x: 60, y: 650, size: 9, font: helvetica, color: rgb(0.3, 0.3, 0.3) });

    page.drawText('BILLED TO:', { x: 320, y: 695, size: 9, font: helveticaBold, color: rgb(0.4, 0.4, 0.4) });
    page.drawText('Vertex Industrial Systems Corp.', { x: 320, y: 680, size: 10, font: helveticaBold, color: rgb(0.1, 0.1, 0.1) });
    page.drawText('Attn: Accounts Payable Department', { x: 320, y: 665, size: 9, font: helvetica, color: rgb(0.3, 0.3, 0.3) });
    page.drawText('1200 Technology Plaza, Austin, TX 78701', { x: 320, y: 650, size: 9, font: helvetica, color: rgb(0.3, 0.3, 0.3) });

    // Table Header
    page.drawRectangle({
      x: 60,
      y: 590,
      width: 475,
      height: 25,
      color: rgb(0.15, 0.2, 0.3)
    });
    page.drawText('DESCRIPTION OF SERVICES', { x: 70, y: 600, size: 9, font: helveticaBold, color: rgb(1, 1, 1) });
    page.drawText('HOURS', { x: 320, y: 600, size: 9, font: helveticaBold, color: rgb(1, 1, 1) });
    page.drawText('RATE', { x: 390, y: 600, size: 9, font: helveticaBold, color: rgb(1, 1, 1) });
    page.drawText('AMOUNT (USD)', { x: 450, y: 600, size: 9, font: helveticaBold, color: rgb(1, 1, 1) });

    // Table Rows
    const items = [
      { desc: 'Browser PDF Architecture & Annotation Engine', qty: '60.0', rate: '$180.00', total: '$10,800.00' },
      { desc: 'Client-Side Offline Tesseract OCR Pipeline', qty: '45.0', rate: '$185.00', total: '$8,325.00' },
      { desc: 'Desktop Hard Drive Direct File System Integration', qty: '35.0', rate: '$190.00', total: '$6,650.00' },
      { desc: 'Digital Fill & Sign Studio (Handwritten/Upload)', qty: '30.0', rate: '$175.00', total: '$5,250.00' },
      { desc: 'Security Hardening & 100% Privacy Sandbox', qty: '20.0', rate: '$195.00', total: '$3,900.00' }
    ];

    let rowY = 565;
    items.forEach((item, index) => {
      if (index % 2 === 1) {
        page.drawRectangle({ x: 60, y: rowY - 6, width: 475, height: 22, color: rgb(0.96, 0.97, 0.98) });
      }
      page.drawText(item.desc, { x: 70, y: rowY, size: 9, font: helvetica, color: rgb(0.15, 0.15, 0.15) });
      page.drawText(item.qty, { x: 330, y: rowY, size: 9, font: helvetica, color: rgb(0.2, 0.2, 0.2) });
      page.drawText(item.rate, { x: 395, y: rowY, size: 9, font: helvetica, color: rgb(0.2, 0.2, 0.2) });
      page.drawText(item.total, { x: 460, y: rowY, size: 9, font: helveticaBold, color: rgb(0.1, 0.1, 0.1) });
      rowY -= 26;
    });

    page.drawLine({ start: { x: 60, y: rowY + 5 }, end: { x: 535, y: rowY + 5 }, thickness: 1, color: rgb(0.8, 0.8, 0.8) });

    // Totals Box
    const totY = rowY - 15;
    page.drawText('SUBTOTAL:', { x: 360, y: totY, size: 10, font: helvetica, color: rgb(0.4, 0.4, 0.4) });
    page.drawText('$34,925.00', { x: 460, y: totY, size: 10, font: helvetica, color: rgb(0.2, 0.2, 0.2) });

    page.drawText('TAX / VAT (0% Exempt):', { x: 360, y: totY - 18, size: 10, font: helvetica, color: rgb(0.4, 0.4, 0.4) });
    page.drawText('$0.00', { x: 460, y: totY - 18, size: 10, font: helvetica, color: rgb(0.2, 0.2, 0.2) });

    page.drawRectangle({ x: 340, y: totY - 50, width: 195, height: 26, color: rgb(0.9, 0.94, 0.98) });
    page.drawText('TOTAL BALANCE DUE:', { x: 350, y: totY - 42, size: 10, font: helveticaBold, color: rgb(0.1, 0.2, 0.4) });
    page.drawText('$34,925.00', { x: 460, y: totY - 42, size: 11, font: helveticaBold, color: rgb(0.1, 0.2, 0.4) });

    // Approval Stamp / Sign Box
    page.drawRectangle({
      x: 60,
      y: 220,
      width: 250,
      height: 110,
      borderColor: rgb(0.7, 0.75, 0.8),
      borderWidth: 1,
      borderDashArray: [4, 4],
      color: rgb(0.98, 0.99, 1.0)
    });
    page.drawText('FINANCE APPROVAL STAMP', { x: 75, y: 305, size: 9, font: helveticaBold, color: rgb(0.3, 0.4, 0.5) });
    page.drawText('Approved By: __________________________', { x: 75, y: 275, size: 9, font: helvetica, color: rgb(0.4, 0.4, 0.4) });
    page.drawText('Date Approved: ________________________', { x: 75, y: 250, size: 9, font: helvetica, color: rgb(0.4, 0.4, 0.4) });
    page.drawText('Use Stamp tool or Sign tool to approve', { x: 75, y: 232, size: 8, font: timesRoman, color: rgb(0.6, 0.3, 0.1) });

    page.drawText('Banking: First Commercial Bank · Routing: 121000358 · Account: 984029104', {
      x: 60,
      y: 120,
      size: 9,
      font: courier,
      color: rgb(0.4, 0.4, 0.4)
    });
    page.drawText('All files saved to user desktop with zero external data exposure.', {
      x: 60,
      y: 105,
      size: 8,
      font: helvetica,
      color: rgb(0.5, 0.5, 0.5)
    });

    const bytes = await pdfDoc.save();
    return { bytes, fileName: 'Commercial Invoice & PO #8492.pdf' };
  }

  if (type === 'scanned_ocr') {
    // Scanned document designed specifically for OCR recognition
    const page = pdfDoc.addPage([595, 842]);
    
    // Background simulation of high-contrast scanned document
    page.drawRectangle({
      x: 0,
      y: 0,
      width: 595,
      height: 842,
      color: rgb(0.98, 0.98, 0.96)
    });

    page.drawText('CENTRAL CLINICAL & DIAGNOSTIC LABORATORIES', {
      x: 60,
      y: 780,
      size: 15,
      font: courier,
      color: rgb(0.1, 0.1, 0.1)
    });
    page.drawText('CONFIDENTIAL MEDICAL LABORATORY EXAMINATION REPORT', {
      x: 60,
      y: 762,
      size: 11,
      font: courier,
      color: rgb(0.15, 0.15, 0.15)
    });
    page.drawText('========================================================================', {
      x: 60,
      y: 750,
      size: 9,
      font: courier,
      color: rgb(0.3, 0.3, 0.3)
    });

    page.drawText('PATIENT ID:      PX-9042-881               SPECIMEN TYPE:   WHOLE BLOOD', {
      x: 60,
      y: 730,
      size: 9.5,
      font: courier,
      color: rgb(0.1, 0.1, 0.1)
    });
    page.drawText('PATIENT NAME:    ELEANOR R. HENDERSON       COLLECTION DATE: 2026-11-04 08:30 AM', {
      x: 60,
      y: 715,
      size: 9.5,
      font: courier,
      color: rgb(0.1, 0.1, 0.1)
    });
    page.drawText('DOB:             1982-06-14 (AGE 44)       REPORT DATE:     2026-11-05 14:15 PM', {
      x: 60,
      y: 700,
      size: 9.5,
      font: courier,
      color: rgb(0.1, 0.1, 0.1)
    });
    page.drawText('ORDERING MD:     DR. ARTHUR STERLING, MD   LAB LICENSE:     CLIA-99D0741289', {
      x: 60,
      y: 685,
      size: 9.5,
      font: courier,
      color: rgb(0.1, 0.1, 0.1)
    });

    page.drawText('------------------------------------------------------------------------', {
      x: 60,
      y: 670,
      size: 9,
      font: courier,
      color: rgb(0.3, 0.3, 0.3)
    });
    page.drawText('TEST DESCRIPTION          RESULT      UNITS      REFERENCE INTERVAL  FLAG', {
      x: 60,
      y: 655,
      size: 9.5,
      font: courier,
      color: rgb(0.05, 0.05, 0.05)
    });
    page.drawText('------------------------------------------------------------------------', {
      x: 60,
      y: 645,
      size: 9,
      font: courier,
      color: rgb(0.3, 0.3, 0.3)
    });

    const labTests = [
      'WHITE BLOOD CELL (WBC)     7.4         K/uL       4.5 - 11.0         NORMAL',
      'RED BLOOD CELL (RBC)       4.82        M/uL       4.20 - 5.40        NORMAL',
      'HEMOGLOBIN                 14.6        g/dL       12.0 - 16.0        NORMAL',
      'HEMATOCRIT                 43.8        %          37.0 - 47.0        NORMAL',
      'PLATELET COUNT             265         K/uL       150 - 450          NORMAL',
      'FASTING GLUCOSE            94          mg/dL      70 - 99            NORMAL',
      'CHOLESTEROL (TOTAL)        218         mg/dL      < 200              HIGH *',
      'HDL CHOLESTEROL            58          mg/dL      > 50               NORMAL',
      'LDL CHOLESTEROL (CALC)     134         mg/dL      < 100              BORDER',
      'TRIGLYCERIDES              130         mg/dL      < 150              NORMAL',
      'CREATININE                 0.88        mg/dL      0.60 - 1.20        NORMAL',
      'ESTIMATED GFR (eGFR)       > 90        mL/min     > 60               NORMAL'
    ];

    let labY = 630;
    for (const test of labTests) {
      page.drawText(test, {
        x: 60,
        y: labY,
        size: 9.5,
        font: courier,
        color: test.includes('HIGH *') ? rgb(0.65, 0.1, 0.1) : rgb(0.1, 0.1, 0.1)
      });
      labY -= 17;
    }

    page.drawText('------------------------------------------------------------------------', {
      x: 60,
      y: labY,
      size: 9,
      font: courier,
      color: rgb(0.3, 0.3, 0.3)
    });

    labY -= 20;
    page.drawText('PATHOLOGIST INTERPRETATION & CLINICAL SUMMARY:', {
      x: 60,
      y: labY,
      size: 10,
      font: courier,
      color: rgb(0.1, 0.1, 0.1)
    });
    labY -= 16;
    page.drawText('Routine hematological parameters demonstrate normal cellularity. Fasting', {
      x: 60,
      y: labY,
      size: 9.5,
      font: courier,
      color: rgb(0.2, 0.2, 0.2)
    });
    labY -= 14;
    page.drawText('lipid panel reflects mild hypercholesterolemia. Dietary modification and', {
      x: 60,
      y: labY,
      size: 9.5,
      font: courier,
      color: rgb(0.2, 0.2, 0.2)
    });
    labY -= 14;
    page.drawText('exercise regimen recommended. Follow-up lipid screening in 6 months.', {
      x: 60,
      y: labY,
      size: 9.5,
      font: courier,
      color: rgb(0.2, 0.2, 0.2)
    });

    labY -= 30;
    page.drawText('SIGNATURE OF REVIEWING PATHOLOGIST:', {
      x: 60,
      y: labY,
      size: 9.5,
      font: courier,
      color: rgb(0.1, 0.1, 0.1)
    });
    labY -= 20;
    page.drawLine({ start: { x: 60, y: labY }, end: { x: 260, y: labY }, thickness: 1, color: rgb(0.4, 0.4, 0.4) });
    page.drawText('Marcus Sterling, M.D. - Board Certified Clinical Pathologist', {
      x: 60,
      y: labY - 14,
      size: 8.5,
      font: courier,
      color: rgb(0.3, 0.3, 0.3)
    });

    page.drawText('BARCODE VERIFICATION: ||||| | |||| |||||| | ||||| |||', {
      x: 310,
      y: labY - 5,
      size: 11,
      font: courier,
      color: rgb(0.1, 0.1, 0.1)
    });

    page.drawText('[Use the OCR Tool to extract this entire table & clinical text into editable data]', {
      x: 60,
      y: 40,
      size: 9,
      font: helveticaBold,
      color: rgb(0.1, 0.45, 0.7)
    });

    const bytes = await pdfDoc.save();
    return { bytes, fileName: 'Scanned Diagnostic Report (OCR Ready).pdf' };
  }

  // Blank Document
  const blankPage = pdfDoc.addPage([595, 842]);
  blankPage.drawText('Untitled Document', {
    x: 60,
    y: 780,
    size: 18,
    font: helveticaBold,
    color: rgb(0.3, 0.3, 0.3)
  });
  blankPage.drawLine({
    start: { x: 60, y: 765 },
    end: { x: 535, y: 765 },
    thickness: 1,
    color: rgb(0.85, 0.85, 0.85)
  });
  blankPage.drawText('Use the Acrobat toolbar above to add text, insert signatures, draw, or annotate.', {
    x: 60,
    y: 735,
    size: 10,
    font: helvetica,
    color: rgb(0.5, 0.5, 0.5)
  });

  const bytes = await pdfDoc.save();
  return { bytes, fileName: 'Blank Document.pdf' };
}
