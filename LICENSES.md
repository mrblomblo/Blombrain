# Third-Party Licenses & Acknowledgements

Blombrain bundles and relies on several open-source components. Major bundled runtime, desktop shell, and library attributions are summarized below. Exact package versions and license texts can also be inspected in `package.json`, `backend/package.json`, `frontend/package.json`, and `src-tauri/Cargo.toml`.

## Runtime & Desktop Shell
- **Node.js** - MIT License (bundled as the Single Executable Application host for the local backend service).
- **Tauri v2** (`tauri`, `tauri-plugin-shell`, `tauri-plugin-single-instance`, `tauri-plugin-opener`, `tauri-plugin-dialog`) - Apache-2.0 / MIT License.
- **WebKitGTK / GTK** - Dynamically linked Linux system desktop webview libraries (LGPL).

## Backend Dependencies
- **Fastify** (`fastify`, `@fastify/cookie`, `@fastify/cors`, `@fastify/multipart`, `@fastify/static`) - MIT License.
- **SQLite & `better-sqlite3`** - Public Domain (SQLite) / MIT License (`better-sqlite3`).
- **`@modelcontextprotocol/sdk`** - MIT License.
- **`bcryptjs`** - MIT License (pure-JS bcrypt implementation used for optional local password hashing).
- **`unpdf` / `pdfjs-dist`** - MIT (`unpdf`) / Apache-2.0 (`pdf.js`), used for self-contained PDF text extraction when system `pdftotext` is not present.
- **`zod`** - MIT License.
- **Poppler (`pdftotext`)** *(optional system integration)* - GPL-2.0 / GPL-3.0. If installed on the host system, `pdftotext` is invoked as a separate subprocess for layout-preserving PDF text extraction, with `unpdf` providing built-in fallback.

## Frontend Dependencies
- **Svelte 5** - MIT License.
- **Tailwind CSS** - MIT License.
- **TipTap & ProseMirror** (`@tiptap/*`, `tiptap-markdown`) - MIT License.
- **`@tanstack/svelte-query`** - MIT License.
- **`highlight.js` & `lowlight`** - BSD-3-Clause (`highlight.js`) / MIT (`lowlight`).
- **`marked`** - MIT License.
- **`DOMPurify`** - Apache-2.0 / MPL-2.0.
- **`morphdom`** - MIT License.
- **`lucide` (`@lucide/svelte`)** - ISC License.
- **Fontsource JetBrains Mono & Ubuntu** - OFL-1.1 / Ubuntu Font License 1.0.
