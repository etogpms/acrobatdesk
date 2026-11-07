# AcrobatDesk

A PDF editor for Windows and macOS: edit text and images, sign, comment, organise pages
(split, merge, extract, page numbers), search, and OCR scanned pages.

**Fully offline and private.** Documents are opened, edited and saved on the user's own computer.
Nothing is uploaded and the app makes no internet requests. Everything it needs (PDF engine,
OCR engine and English language data, fonts) ships with it.

There are two ways to run it:

| | Desktop app (recommended) | Office web server |
|---|---|---|
| Install | Installer per computer | Once, on the server |
| Files | Native Open/Save dialogs, double-click PDFs | Browser open/save or downloads |
| Needs | Nothing else | A server, ideally with HTTPS |

---

## 1. Desktop app

### Installing

**macOS**: open `AcrobatDesk-<version>-mac-arm64.dmg` (Apple Silicon: M1/M2/M3/M4) or
`…-mac-x64.dmg` (older Intel Macs) and drag AcrobatDesk to Applications.

**Windows**: run `AcrobatDesk-<version>-windows-x64-setup.exe`. It installs for the current user
(no admin rights needed) and adds Start-menu and desktop shortcuts.

To open a PDF from Finder or Explorer, use *Open With → AcrobatDesk*. The installer does not make
AcrobatDesk the default PDF app; users can choose that themselves.

#### First launch of unsigned builds

Until the app is code-signed (see below), the operating system warns on first launch:

- **macOS**: "AcrobatDesk can't be opened…". Open **System Settings → Privacy & Security** and click
  **Open Anyway**. IT can also clear the warning in advance:
  `xattr -dr com.apple.quarantine /Applications/AcrobatDesk.app`
- **Windows**: "Windows protected your PC". Click **More info → Run anyway**.

### Building the installers

Requires [Node.js](https://nodejs.org) 22 or newer.

```bash
npm install
npm run dist:mac     # macOS .dmg files (Apple Silicon + Intel)
npm run dist:win     # Windows installer (.exe); can be built on a Mac or on Windows
```

Installers are written to `release/`. If the project folder's path contains special characters
such as `&`, they go to `~/AcrobatDesk-release` instead.

### Official (signed) builds

Code signing removes the first-launch warnings above and is recommended before rolling the app out
widely.

- **macOS**: needs an Apple Developer account (Developer ID Application certificate). With the
  certificate in the keychain, run:
  ```bash
  export APPLE_ID="you@company.com"
  export APPLE_APP_SPECIFIC_PASSWORD="xxxx-xxxx-xxxx-xxxx"
  export APPLE_TEAM_ID="ABCDE12345"
  npm run dist:mac:signed     # signs and notarizes with Apple
  ```
- **Windows**: needs a code-signing certificate (or Microsoft Trusted Signing). With a `.pfx`
  certificate:
  ```bash
  export CSC_LINK="/path/to/certificate.pfx"
  export CSC_KEY_PASSWORD="…"
  npm run dist:win
  ```

---

## 2. Office web server

```bash
npm install
npm run build
npm start            # serves http://<server>:3000 (set PORT / HOST to change)
```

The server only delivers the app's files. It stores no documents and contacts no external services.

**Use HTTPS** (for example behind your existing reverse proxy). Over plain `http://` browsers
disable "save back to the original file" and the system clipboard, so the app falls back to
downloads and in-app copy and paste.

Each user's autosaved drafts, saved signatures and settings are stored in their own browser on their
own computer. People who share a computer should use separate browser profiles or logins.

---

## Development

```bash
npm run dev                                    # web app with live reload on http://localhost:3000
ELECTRON_START_URL=http://localhost:3000 npm run desktop:dev   # desktop window on the dev server
npm run desktop                                # build, then run the desktop app
npm run lint                                   # type-check
```

`npm install` (and every build) copies the offline runtime files from `node_modules` into
`public/vendor/` (see `scripts/copy-runtime-assets.mjs`).

### Third-party components

pdf.js (Apache-2.0), pdf-lib (MIT), Tesseract.js (Apache-2.0) with English language data,
Electron (MIT), and the fonts Carlito, Caladea and Liberation (SIL OFL; licences in `public/fonts`).
