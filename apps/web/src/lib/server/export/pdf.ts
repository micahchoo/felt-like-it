/**
 * PDF map export — generates an A4 PDF with optional screenshot, title, and metadata.
 * Uses pdfkit (pure JS, no native deps).
 */

import PDFDocument from 'pdfkit';
import type { ExportData } from './shared.js';

interface PdfExportOptions {
  data: ExportData;
  title?: string;
  screenshot?: string; // base64 PNG
}

export async function exportAsPdf(options: PdfExportOptions): Promise<Buffer> {
  const { data, title, screenshot } = options;

  return new Promise<Buffer>((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const chunks: Buffer[] = [];

    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    // Title
    doc.fontSize(20).text(title ?? data.layerName, { align: 'center' });
    doc.moveDown();

    // Screenshot
    if (screenshot) {
      try {
        const imgBuffer = Buffer.from(screenshot, 'base64');
        // Fit within page width (A4 = 595pt, minus margins = 495pt)
        doc.image(imgBuffer, { fit: [495, 350], align: 'center' });
        doc.moveDown();
      } catch {
        // Skip invalid image data
      }
    }

    // Metadata
    doc.fontSize(12).text(`Layer: ${data.layerName}`, { align: 'left' });
    doc.text(`Type: ${data.layerType}`);
    doc.text(`Features: ${data.features.length}`);
    doc.text(`Exported: ${new Date().toISOString()}`);
    doc.moveDown();

    // Feature summary (first 50 features)
    const preview = data.features.slice(0, 50);
    if (preview.length > 0) {
      doc.fontSize(14).text('Feature Properties', { underline: true });
      doc.moveDown(0.5);

      for (const f of preview) {
        const props = Object.entries(f.properties)
          .map(([k, v]) => `${k}: ${String(v ?? '')}`)
          .join(', ');
        doc.fontSize(9).text(props, { width: 495 });
      }

      if (data.features.length > 50) {
        doc.moveDown(0.5);
        doc.fontSize(9).text(`... and ${data.features.length - 50} more features`);
      }
    }

    doc.end();
  });
}
