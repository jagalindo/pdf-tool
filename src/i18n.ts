// ─── Internationalization (es / en) ──────────────────────
export type Lang = "es" | "en";

const LANG_STORAGE_KEY = "pdf-toolkit-lang";

const dict = {
  // App / topbar
  "app.name":            { es: "PDF Toolkit", en: "PDF Toolkit" },
  "app.tagline":         { es: "100% local · Sin subida", en: "100% local · No uploads" },
  "app.hero":            { es: "100% privado — tus archivos nunca salen de tu navegador.", en: "100% private — your files never leave your browser." },
  "doc.title":           { es: "PDF Toolkit — Herramientas PDF 100% en tu navegador", en: "PDF Toolkit — PDF tools 100% in your browser" },
  "topbar.install":      { es: "⬇ Instalar", en: "⬇ Install" },
  "topbar.installTitle": { es: "Instalar como app", en: "Install as app" },
  "topbar.history":      { es: "Historial", en: "History" },
  "topbar.themeTitle":   { es: "Cambiar tema (T)", en: "Toggle theme (T)" },
  "topbar.langTitle":    { es: "Switch to English", en: "Cambiar a español" },

  // Home
  "home.searchPlaceholder": { es: "Buscar herramientas…", en: "Search tools…" },
  "home.noResults":         { es: "No se encontraron herramientas.", en: "No tools found." },

  // Groups
  "group.organize": { es: "Organizar", en: "Organize" },
  "group.convert":  { es: "Convertir", en: "Convert" },
  "group.enhance":  { es: "Mejorar", en: "Enhance" },
  "group.security": { es: "Seguridad", en: "Security" },

  // Tools
  "tool.merge.title":          { es: "Combinar PDFs", en: "Merge PDFs" },
  "tool.merge.subtitle":       { es: "Une varios PDFs en uno solo", en: "Join multiple PDFs into one" },
  "tool.split.title":          { es: "Dividir PDF", en: "Split PDF" },
  "tool.split.subtitle":       { es: "Extrae páginas seleccionadas (ej: 1,3,5-7; 10-12)", en: "Extract selected pages (e.g. 1,3,5-7; 10-12)" },
  "tool.compress.title":       { es: "Comprimir PDF", en: "Compress PDF" },
  "tool.compress.subtitle":    { es: "Compresión decente vía qpdf-wasm", en: "Solid compression via qpdf-wasm" },
  "tool.pdf2img.title":        { es: "PDF a Imagen", en: "PDF to Image" },
  "tool.pdf2img.subtitle":     { es: "Renderiza páginas a PNG/JPG en ZIP (MuPDF WASM)", en: "Render pages to PNG/JPG in a ZIP (MuPDF WASM)" },
  "tool.rotate.title":         { es: "Rotar páginas", en: "Rotate pages" },
  "tool.rotate.subtitle":      { es: "Rota todas las páginas o un rango (90/180/270°)", en: "Rotate all pages or a range (90/180/270°)" },
  "tool.img2pdf.title":        { es: "Imagen a PDF", en: "Image to PDF" },
  "tool.img2pdf.subtitle":     { es: "Convierte JPG/PNG a un PDF de una o varias páginas", en: "Convert JPG/PNG into a one or multi-page PDF" },
  "tool.protect.title":        { es: "Contraseña PDF", en: "PDF Password" },
  "tool.protect.subtitle":     { es: "Añade o quita contraseña de un PDF (AES-256)", en: "Add or remove a PDF password (AES-256)" },
  "tool.deletepages.title":    { es: "Eliminar páginas", en: "Delete pages" },
  "tool.deletepages.subtitle": { es: "Borra páginas específicas de un PDF", en: "Remove specific pages from a PDF" },
  "tool.watermark.title":      { es: "Marca de agua", en: "Watermark" },
  "tool.watermark.subtitle":   { es: "Añade texto semitransparente en diagonal", en: "Add semi-transparent diagonal text" },
  "tool.pagenumbers.title":    { es: "Numerar páginas", en: "Page numbers" },
  "tool.pagenumbers.subtitle": { es: "Inserta numeración en el pie de cada página", en: "Insert numbering at the foot of each page" },
  "tool.metadata.title":       { es: "Editar metadatos", en: "Edit metadata" },
  "tool.metadata.subtitle":    { es: "Cambia título, autor, tema y palabras clave", en: "Change title, author, subject and keywords" },
  "tool.extracttext.title":    { es: "Extraer texto", en: "Extract text" },
  "tool.extracttext.subtitle": { es: "Exporta el texto del PDF como archivo .txt", en: "Export the PDF text as a .txt file" },
  "tool.crop.title":           { es: "Recortar márgenes", en: "Crop margins" },
  "tool.crop.subtitle":        { es: "Reduce el área visible de cada página (CropBox)", en: "Reduce the visible area of each page (CropBox)" },
  "tool.reorder.title":        { es: "Reordenar páginas", en: "Reorder pages" },
  "tool.reorder.subtitle":     { es: "Cambia el orden de las páginas con vista visual", en: "Change page order with a visual preview" },

  // Tags
  "tag.pdf":      { es: "PDF", en: "PDF" },
  "tag.offline":  { es: "Offline", en: "Offline" },
  "tag.fast":     { es: "Rápido", en: "Fast" },
  "tag.pages":    { es: "Páginas", en: "Pages" },
  "tag.zip":      { es: "ZIP", en: "ZIP" },
  "tag.wasm":     { es: "WASM", en: "WASM" },
  "tag.images":   { es: "Imágenes", en: "Images" },
  "tag.security": { es: "Seguridad", en: "Security" },
  "tag.private":  { es: "Modo privado", en: "Private mode" },

  // Stepper / wizard
  "wizard.backToTools": { es: "← Todas las herramientas", en: "← All tools" },
  "step.1":             { es: "Añadir archivos", en: "Add files" },
  "step.2":             { es: "Opciones", en: "Options" },
  "step.3":             { es: "Resultado", en: "Result" },
  "btn.continue":       { es: "Continuar →", en: "Continue →" },
  "btn.back":           { es: "← Atrás", en: "← Back" },
  "btn.run":            { es: "Ejecutar", en: "Run" },
  "btn.running":        { es: "Procesando…", en: "Processing…" },
  "btn.queued":         { es: "En cola ({0})…", en: "Queued ({0})…" },
  "btn.cancel":         { es: "✕ Cancelar", en: "✕ Cancel" },
  "btn.upload":         { es: "Subir", en: "Upload" },
  "btn.clear":          { es: "Limpiar", en: "Clear" },
  "btn.remove":         { es: "Quitar", en: "Remove" },
  "btn.useAsInput":     { es: "Usar como entrada", en: "Use as input" },
  "btn.startOver":      { es: "Empezar de nuevo", en: "Start over" },
  "btn.tryAgain":       { es: "Reintentar", en: "Try again" },
  "btn.downloadAll":    { es: "⬇ Todos ({0})", en: "⬇ All ({0})" },

  // Drop zone / files
  "drop.titlePdf":          { es: "Arrastra PDFs aquí", en: "Drop PDFs here" },
  "drop.titleImg":          { es: "Arrastra imágenes aquí", en: "Drop images here" },
  "drop.hintPdf":           { es: "o haz clic para seleccionar archivos", en: "or click to choose files" },
  "drop.hintImg":           { es: "JPG y PNG admitidos", en: "JPG and PNG supported" },
  "files.none":             { es: "Sin archivos seleccionados.", en: "No files selected." },
  "files.reorderHint":      { es: "Arrastra los nombres para reordenar.", en: "Drag the names to reorder." },
  "files.passwordPlaceholder": { es: "Contraseña (si protegido)", en: "Password (if protected)" },
  "files.passwordNote":     { es: "Solo en tu navegador.", en: "Only in your browser." },
  "files.pageChip":         { es: "{0} pág.", en: "{0} pg." },
  "files.dragTitle":        { es: "Reordenar", en: "Reorder" },

  // Validation
  "val.pagesEmpty":      { es: "Ingresa al menos una página.", en: "Enter at least one page." },
  "val.pagesChars":      { es: "Caracteres no válidos. Usa solo números, comas, guiones y punto y coma.", en: "Invalid characters. Use only numbers, commas, hyphens and semicolons." },
  "val.pagesNone":       { es: "No se encontraron páginas válidas. Usa formato: 1,3,5-7", en: "No valid pages found. Use format: 1,3,5-7" },
  "val.pagesMany":       { es: "{0} páginas seleccionadas. El proceso puede tardar.", en: "{0} pages selected. Processing may take a while." },
  "val.pageMaxHigh":     { es: "Página máxima muy alta. Verifica el PDF.", en: "Maximum page is very high. Check the PDF." },
  "val.pagesOk":         { es: "{0} página(s){1}.", en: "{0} page(s){1}." },
  "val.pagesGroups":     { es: " en {0} grupos", en: " in {0} groups" },
  "val.dpiInvalid":      { es: "Ingresa un número válido entre 36 y 600.", en: "Enter a valid number between 36 and 600." },
  "val.dpiMin":          { es: "DPI mínimo: 36.", en: "Minimum DPI: 36." },
  "val.dpiMax":          { es: "DPI máximo: 600.", en: "Maximum DPI: 600." },
  "val.dpiHigh":         { es: "DPI alto ({0}). Las imágenes serán grandes.", en: "High DPI ({0}). Images will be large." },
  "val.dpiOk":           { es: "{0} DPI.", en: "{0} DPI." },
  "val.pwdEmpty":        { es: "Ingresa una contraseña nueva.", en: "Enter a new password." },
  "val.pwdMismatch":     { es: "Las contraseñas no coinciden.", en: "Passwords do not match." },
  "val.pwdShort":        { es: "Contraseña corta. Se recomiendan al menos 8 caracteres.", en: "Short password. At least 8 characters are recommended." },
  "val.pwdOk":           { es: "Contraseña válida.", en: "Valid password." },
  "val.reorderEmpty":    { es: "Ingresa el nuevo orden de páginas (ej: 3,1,2).", en: "Enter the new page order (e.g. 3,1,2)." },
  "val.reorderChars":    { es: "Solo se permiten números separados por comas.", en: "Only comma-separated numbers are allowed." },
  "val.reorderInts":     { es: "Todos los valores deben ser enteros mayores a 0.", en: "All values must be integers greater than 0." },
  "val.reorderDupes":    { es: "Hay páginas duplicadas en el orden.", en: "There are duplicate pages in the order." },
  "val.reorderMissing":  { es: "Faltan páginas en el orden: {0}. El PDF tiene {1} páginas.", en: "Pages missing from the order: {0}. The PDF has {1} pages." },
  "val.reorderRange":    { es: "Página fuera de rango. El PDF tiene {0} páginas.", en: "Page out of range. The PDF has {0} pages." },
  "val.reorderOk":       { es: "{0} página(s) en el nuevo orden.", en: "{0} page(s) in the new order." },
  "val.filesNonePdf":    { es: "Agrega al menos un archivo PDF.", en: "Add at least one PDF file." },
  "val.filesNoneImg":    { es: "Agrega al menos una imagen.", en: "Add at least one image." },
  "val.mergeMin":        { es: "Combinar necesita al menos 2 PDFs.", en: "Merge needs at least 2 PDFs." },
  "val.mergeMax":        { es: "Máximo {0} archivos.", en: "Maximum {0} files." },
  "val.onlyFirst":       { es: "Solo se procesará el primer archivo.", en: "Only the first file will be processed." },
  "val.emptyFile":       { es: "Hay un archivo vacío.", en: "There is an empty file." },
  "val.fileTooBig":      { es: "Un archivo excede {0}.", en: "A file exceeds {0}." },
  "val.fileBig":         { es: "\"{0}\" es grande ({1}).", en: "\"{0}\" is large ({1})." },

  // Alerts
  "alert.ignoredImg":    { es: "{0} archivo(s) ignorado(s): solo se aceptan JPG y PNG.", en: "{0} file(s) ignored: only JPG and PNG are accepted." },
  "alert.ignoredPdf":    { es: "{0} archivo(s) ignorado(s): solo se aceptan PDFs.", en: "{0} file(s) ignored: only PDFs are accepted." },
  "alert.tooBigIgnored": { es: "\"{0}\" excede {1} y fue ignorado.", en: "\"{0}\" exceeds {1} and was ignored." },
  "alert.mergeTrim":     { es: "Máximo {0} archivos. Se aceptaron los primeros {0}.", en: "Maximum {0} files. The first {0} were accepted." },
  "alert.readError":     { es: "Error leyendo archivo: {0}", en: "Error reading file: {0}" },
  "alert.watermarkText": { es: "Ingresa el texto de la marca de agua.", en: "Enter the watermark text." },

  // Jobs / history
  "job.queued":       { es: "En cola", en: "Queued" },
  "job.done":         { es: "Completado", en: "Done" },
  "job.error":        { es: "Error", en: "Error" },
  "job.interrupted":  { es: "Interrumpido", en: "Interrupted" },
  "job.cancelled":    { es: "Cancelado por el usuario.", en: "Cancelled by user." },
  "job.files":        { es: "{0} archivo(s)", en: "{0} file(s)" },
  "job.input":        { es: "Entrada: {0}", en: "Input: {0}" },
  "job.output":       { es: " → Salida: {0}", en: " → Output: {0}" },
  "job.success":      { es: "Proceso completado exitosamente.", en: "Process completed successfully." },
  "history.empty":    { es: "Sin trabajos aún.", en: "No jobs yet." },
  "history.zipName":  { es: "resultados_{0}.zip", en: "results_{0}.zip" },

  // Result step
  "result.workingTitle": { es: "Procesando tu archivo…", en: "Processing your file…" },
  "result.queuedTitle":  { es: "En cola, empezará en breve…", en: "Queued, starting soon…" },
  "result.doneTitle":    { es: "¡Listo!", en: "Done!" },
  "result.doneSub":      { es: "Tu archivo está listo para descargar.", en: "Your file is ready to download." },
  "result.errorTitle":   { es: "Algo salió mal", en: "Something went wrong" },
  "result.download":     { es: "⬇ Descargar {0}", en: "⬇ Download {0}" },
  "result.none":         { es: "No hay ningún proceso activo.", en: "There is no active process." },

  // Options — compress
  "opt.compressLevel":   { es: "Nivel de compresión", en: "Compression level" },
  "opt.cmp.small":       { es: "Ligera", en: "Light" },
  "opt.cmp.balanced":    { es: "Equilibrada", en: "Balanced" },
  "opt.cmp.best":        { es: "Máxima", en: "Maximum" },
  "opt.cmp.aggressive":  { es: "Agresiva", en: "Aggressive" },
  "opt.cmp.smallDesc":      { es: "Reescritura rápida sin recompresión.", en: "Fast rewrite without recompression." },
  "opt.cmp.balancedDesc":   { es: "Recompresión estándar con flate.", en: "Standard flate recompression." },
  "opt.cmp.bestDesc":       { es: "Recompresión agresiva + linearización.", en: "Aggressive recompression + linearization." },
  "opt.cmp.aggressiveDesc": { es: "Rasteriza páginas a 150 DPI JPEG — el texto no será seleccionable.", en: "Rasterizes pages to 150 DPI JPEG — text won't be selectable." },

  // Options — split
  "opt.visualMode":      { es: "🖼 Modo visual", en: "🖼 Visual mode" },
  "opt.textMode":        { es: "✏ Modo texto", en: "✏ Text mode" },
  "opt.pages":           { es: "Páginas", en: "Pages" },
  "opt.pagesPlaceholder":{ es: "ej: 1,2,5-7; 10-12", en: "e.g. 1,2,5-7; 10-12" },
  "opt.splitFormat":     { es: "Formato: 1,3,5-7 (1-based). Separa con ; para múltiples PDFs en ZIP.", en: "Format: 1,3,5-7 (1-based). Separate with ; for multiple PDFs in a ZIP." },
  "opt.output":          { es: "Salida", en: "Output" },
  "opt.singlePdf":       { es: "PDF único", en: "Single PDF" },
  "opt.zipPerRange":     { es: "ZIP (un PDF por rango)", en: "ZIP (one PDF per range)" },

  // Options — pdf2img
  "opt.format":     { es: "Formato", en: "Format" },
  "opt.dpi":        { es: "DPI (36–600)", en: "DPI (36–600)" },
  "opt.pdf2imgNote":{ es: "Genera un ZIP con todas las páginas. Mayor DPI = mayor calidad.", en: "Generates a ZIP with all pages. Higher DPI = higher quality." },

  // Options — rotate
  "opt.angle":          { es: "Ángulo", en: "Angle" },
  "opt.applyTo":        { es: "Aplicar a", en: "Apply to" },
  "opt.allPages":       { es: "Todas las páginas", en: "All pages" },
  "opt.specificPages":  { es: "Páginas específicas", en: "Specific pages" },
  "opt.pagesPlaceholder2": { es: "ej: 1,3,5-7", en: "e.g. 1,3,5-7" },

  // Options — img2pdf
  "opt.pageSize":    { es: "Tamaño de página", en: "Page size" },
  "opt.autoSize":    { es: "Auto (tamaño imagen)", en: "Auto (image size)" },
  "opt.img2pdfNote": { es: "Cada imagen → una página. Con A4/Letter la imagen se escala para ajustarse.", en: "Each image → one page. With A4/Letter the image is scaled to fit." },

  // Options — protect
  "opt.mode":           { es: "Modo", en: "Mode" },
  "opt.addPassword":    { es: "Añadir contraseña", en: "Add password" },
  "opt.removePassword": { es: "Quitar contraseña", en: "Remove password" },
  "opt.newPassword":    { es: "Nueva contraseña", en: "New password" },
  "opt.newPwdPlaceholder":     { es: "Contraseña nueva", en: "New password" },
  "opt.confirmPassword":       { es: "Confirmar contraseña", en: "Confirm password" },
  "opt.confirmPwdPlaceholder": { es: "Repetir contraseña", en: "Repeat password" },
  "opt.removeNote":     { es: "Usa el campo de contraseña en el archivo para desencriptar. El PDF resultante no tendrá contraseña.", en: "Use the password field on the file to decrypt. The resulting PDF will have no password." },

  // Options — deletepages
  "opt.pagesToDelete":  { es: "Páginas a eliminar", en: "Pages to delete" },
  "opt.deleteNote":     { es: "Las páginas indicadas serán eliminadas. Las demás se conservan.", en: "The listed pages will be removed. The rest are kept." },

  // Options — watermark
  "opt.text":           { es: "Texto", en: "Text" },
  "opt.wmPlaceholder":  { es: "ej: CONFIDENCIAL", en: "e.g. CONFIDENTIAL" },
  "opt.opacity":        { es: "Opacidad (%)", en: "Opacity (%)" },
  "opt.angleDeg":       { es: "Ángulo (°)", en: "Angle (°)" },
  "opt.sizePt":         { es: "Tamaño (pt)", en: "Size (pt)" },
  "opt.color":          { es: "Color", en: "Color" },

  // Options — pagenumbers
  "opt.position":      { es: "Posición", en: "Position" },
  "opt.bottomLeft":    { es: "Inf. izquierda", en: "Bottom left" },
  "opt.bottomCenter":  { es: "Inf. centro", en: "Bottom center" },
  "opt.bottomRight":   { es: "Inf. derecha", en: "Bottom right" },
  "opt.startNumber":   { es: "Número inicial", en: "Starting number" },
  "opt.prefix":        { es: "Prefijo", en: "Prefix" },
  "opt.prefixPlaceholder": { es: "ej: Pág. ", en: "e.g. Page " },
  "opt.fontSize":      { es: "Tamaño fuente (pt)", en: "Font size (pt)" },

  // Options — metadata
  "opt.metaNote":     { es: "Los campos vacíos conservan los metadatos actuales del PDF.", en: "Empty fields keep the PDF's current metadata." },
  "opt.metaTitle":    { es: "Título", en: "Title" },
  "opt.metaAuthor":   { es: "Autor", en: "Author" },
  "opt.metaSubject":  { es: "Tema", en: "Subject" },
  "opt.metaKeywords": { es: "Palabras clave", en: "Keywords" },
  "opt.metaCreator":  { es: "Creador", en: "Creator" },
  "opt.metaCreatorPlaceholder": { es: "Aplicación creadora", en: "Creating application" },

  // Options — extracttext
  "opt.extractNote": { es: "Extrae texto de todas las páginas → archivo <strong>.txt</strong>. Requiere PDF con texto seleccionable (no PDFs escaneados sin OCR).", en: "Extracts text from all pages → a <strong>.txt</strong> file. Requires a PDF with selectable text (not scanned PDFs without OCR)." },

  // Options — crop
  "opt.unit":      { es: "Unidad", en: "Unit" },
  "opt.mm":        { es: "Milímetros (mm)", en: "Millimeters (mm)" },
  "opt.pt":        { es: "Puntos (pt)", en: "Points (pt)" },
  "opt.cropTop":    { es: "Superior", en: "Top" },
  "opt.cropBottom": { es: "Inferior", en: "Bottom" },
  "opt.cropLeft":   { es: "Izquierdo", en: "Left" },
  "opt.cropRight":  { es: "Derecho", en: "Right" },
  "opt.cropNote":  { es: "Reduce el área visible de todas las páginas. El contenido fuera del recorte queda oculto.", en: "Reduces the visible area of all pages. Content outside the crop is hidden." },

  // Options — reorder
  "opt.newOrder":            { es: "Nuevo orden de páginas", en: "New page order" },
  "opt.reorderPlaceholder":  { es: "ej: 3,1,2,4,5", en: "e.g. 3,1,2,4,5" },
  "opt.reorderNote":         { es: "Lista completa de páginas (1-based) en el nuevo orden, separadas por comas.", en: "Complete list of pages (1-based) in the new order, comma-separated." },
  "opt.noOptions":           { es: "Sin opciones adicionales.", en: "No additional options." },

  // Thumbnails
  "thumb.loadFailed":   { es: "⚠ No se pudieron cargar las vistas previas. Usa el campo de texto para especificar el orden.", en: "⚠ Previews could not be loaded. Use the text field to specify the order." },
  "thumb.loading":      { es: "Cargando vistas previas…", en: "Loading previews…" },
  "thumb.dragReorder":  { es: "Arrastra las páginas para reordenarlas. El orden se refleja en el campo de texto.", en: "Drag the pages to reorder them. The order is reflected in the text field." },
  "thumb.clickSelect":  { es: "Haz clic en las páginas para seleccionarlas/deseleccionarlas.", en: "Click pages to select/deselect them." },
  "thumb.selected":     { es: "Seleccionadas: {0}", en: "Selected: {0}" },

  // Misc
  "misc.shortcuts": { es: "Atajos: Ctrl+O abrir · Enter continuar/ejecutar · Esc atrás · T tema", en: "Shortcuts: Ctrl+O open · Enter continue/run · Esc back · T theme" },
  "misc.workerNote": { es: "Procesado en un Web Worker — sin subida de datos.", en: "Processed in a Web Worker — no data uploads." },
} as const;

export type I18nKey = keyof typeof dict;

let lang: Lang = (() => {
  const s = localStorage.getItem(LANG_STORAGE_KEY);
  if (s === "es" || s === "en") return s;
  return (navigator.language || "en").toLowerCase().startsWith("es") ? "es" : "en";
})();

export function getLang(): Lang { return lang; }

export function setLang(next: Lang) {
  lang = next;
  try { localStorage.setItem(LANG_STORAGE_KEY, next); } catch { /* quota */ }
  document.documentElement.lang = next;
}

export function t(key: I18nKey, ...args: Array<string | number>): string {
  let s: string = dict[key][lang];
  for (let i = 0; i < args.length; i++) s = s.split(`{${i}}`).join(String(args[i]));
  return s;
}
