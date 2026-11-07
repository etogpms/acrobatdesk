// Copies the runtime files that pdf.js and Tesseract load on demand into public/vendor, so the
// app never needs the internet (web server and desktop app alike). Runs on install and build.
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const nm = (...p) => join(root, 'node_modules', ...p);
const out = (...p) => join(root, 'public', 'vendor', ...p);

rmSync(out(), { recursive: true, force: true });

// pdf.js: character maps, standard fonts, image decoders (JPEG2000/JBIG2) and colour profiles
for (const dir of ['cmaps', 'standard_fonts', 'wasm', 'iccs']) {
  if (existsSync(nm('pdfjs-dist', dir))) cpSync(nm('pdfjs-dist', dir), out('pdfjs', dir), { recursive: true });
}

// Tesseract OCR: worker script, the LSTM engine (one build per CPU feature level; the app uses
// LSTM-only mode, so the legacy-engine builds are not needed) and English language data
mkdirSync(out('tesseract', 'core'), { recursive: true });
cpSync(nm('tesseract.js', 'dist', 'worker.min.js'), out('tesseract', 'worker.min.js'));
for (const f of readdirSync(nm('tesseract.js-core'))) {
  if (/^tesseract-core.*-lstm\.wasm\.js$/.test(f)) cpSync(nm('tesseract.js-core', f), out('tesseract', 'core', f));
}
cpSync(nm('@tesseract.js-data', 'eng', '4.0.0_best_int'), out('tesseract', 'lang'), { recursive: true });

console.log('Copied offline runtime assets to public/vendor');
