// The runtime import is the `legacy` build (see lib/pdf/loadPdfjs.ts for why),
// which ships as a bare .mjs with no adjacent declarations. Its API surface is
// identical to the package entry, so borrow that one's types rather than hand-
// writing a second copy that can drift.
declare module 'pdfjs-dist/legacy/build/pdf.min.mjs' {
  export * from 'pdfjs-dist'
}
