// ─── Internationalization (es / en / de / fr) ─────────────
export type Lang = "es" | "en" | "de" | "fr";
export const LANGS: Lang[] = ["es", "en", "de", "fr"];

const LANG_STORAGE_KEY = "pdf-toolkit-lang";

const dict = {
  // App / topbar
  "app.name":            { es: "PDF Toolkit", en: "PDF Toolkit", de: "PDF Toolkit", fr: "PDF Toolkit" },
  "app.tagline":         { es: "100% local · Sin subida", en: "100% local · No uploads", de: "100% lokal · Kein Upload", fr: "100% local · Sans envoi" },
  "app.hero":            { es: "100% privado — tus archivos nunca salen de tu navegador.", en: "100% private — your files never leave your browser.", de: "100% privat — deine Dateien verlassen niemals den Browser.", fr: "100% privé — vos fichiers ne quittent jamais votre navigateur." },
  "doc.title":           { es: "PDF Toolkit — Herramientas PDF 100% en tu navegador", en: "PDF Toolkit — PDF tools 100% in your browser", de: "PDF Toolkit — PDF-Werkzeuge 100% in deinem Browser", fr: "PDF Toolkit — Outils PDF 100% dans votre navigateur" },
  "topbar.install":      { es: "⬇ Instalar", en: "⬇ Install", de: "⬇ Installieren", fr: "⬇ Installer" },
  "topbar.installTitle": { es: "Instalar como app", en: "Install as app", de: "Als App installieren", fr: "Installer comme app" },
  "topbar.history":      { es: "Historial", en: "History", de: "Verlauf", fr: "Historique" },
  "topbar.themeTitle":   { es: "Cambiar tema (T)", en: "Toggle theme (T)", de: "Design wechseln (T)", fr: "Changer le thème (T)" },

  // Home
  "home.searchPlaceholder": { es: "Buscar herramientas…", en: "Search tools…", de: "Werkzeuge suchen…", fr: "Rechercher des outils…" },
  "home.noResults":         { es: "No se encontraron herramientas.", en: "No tools found.", de: "Keine Werkzeuge gefunden.", fr: "Aucun outil trouvé." },

  // Groups
  "group.organize": { es: "Organizar", en: "Organize", de: "Organisieren", fr: "Organiser" },
  "group.convert":  { es: "Convertir", en: "Convert", de: "Konvertieren", fr: "Convertir" },
  "group.enhance":  { es: "Mejorar", en: "Enhance", de: "Verbessern", fr: "Améliorer" },
  "group.security": { es: "Seguridad", en: "Security", de: "Sicherheit", fr: "Sécurité" },

  // Tools
  "tool.merge.title":          { es: "Combinar PDFs", en: "Merge PDFs", de: "PDFs zusammenführen", fr: "Fusionner des PDFs" },
  "tool.merge.subtitle":       { es: "Une varios PDFs en uno solo", en: "Join multiple PDFs into one", de: "Mehrere PDFs zu einem zusammenfügen", fr: "Assembler plusieurs PDFs en un seul" },
  "tool.split.title":          { es: "Dividir PDF", en: "Split PDF", de: "PDF aufteilen", fr: "Diviser un PDF" },
  "tool.split.subtitle":       { es: "Extrae páginas seleccionadas (ej: 1,3,5-7; 10-12)", en: "Extract selected pages (e.g. 1,3,5-7; 10-12)", de: "Ausgewählte Seiten extrahieren (z.B. 1,3,5-7; 10-12)", fr: "Extraire les pages sélectionnées (ex : 1,3,5-7 ; 10-12)" },
  "tool.compress.title":       { es: "Comprimir PDF", en: "Compress PDF", de: "PDF komprimieren", fr: "Compresser un PDF" },
  "tool.compress.subtitle":    { es: "Compresión decente vía qpdf-wasm", en: "Solid compression via qpdf-wasm", de: "Solide Komprimierung via qpdf-wasm", fr: "Compression fiable via qpdf-wasm" },
  "tool.pdf2img.title":        { es: "PDF a Imagen", en: "PDF to Image", de: "PDF zu Bild", fr: "PDF en Image" },
  "tool.pdf2img.subtitle":     { es: "Renderiza páginas a PNG/JPG en ZIP (MuPDF WASM)", en: "Render pages to PNG/JPG in a ZIP (MuPDF WASM)", de: "Seiten als PNG/JPG in einem ZIP rendern (MuPDF WASM)", fr: "Convertir les pages en PNG/JPG dans un ZIP (MuPDF WASM)" },
  "tool.rotate.title":         { es: "Rotar páginas", en: "Rotate pages", de: "Seiten drehen", fr: "Faire pivoter les pages" },
  "tool.rotate.subtitle":      { es: "Rota todas las páginas o un rango (90/180/270°)", en: "Rotate all pages or a range (90/180/270°)", de: "Alle Seiten oder einen Bereich drehen (90/180/270°)", fr: "Faire pivoter toutes les pages ou une plage (90/180/270°)" },
  "tool.img2pdf.title":        { es: "Imagen a PDF", en: "Image to PDF", de: "Bild zu PDF", fr: "Image en PDF" },
  "tool.img2pdf.subtitle":     { es: "Convierte JPG/PNG a un PDF de una o varias páginas", en: "Convert JPG/PNG into a one or multi-page PDF", de: "JPG/PNG in ein ein- oder mehrseitiges PDF umwandeln", fr: "Convertir JPG/PNG en un PDF d'une ou plusieurs pages" },
  "tool.protect.title":        { es: "Contraseña PDF", en: "PDF Password", de: "PDF-Passwort", fr: "Mot de passe PDF" },
  "tool.protect.subtitle":     { es: "Añade o quita contraseña de un PDF (AES-256)", en: "Add or remove a PDF password (AES-256)", de: "PDF-Passwort hinzufügen oder entfernen (AES-256)", fr: "Ajouter ou supprimer un mot de passe PDF (AES-256)" },
  "tool.deletepages.title":    { es: "Eliminar páginas", en: "Delete pages", de: "Seiten löschen", fr: "Supprimer des pages" },
  "tool.deletepages.subtitle": { es: "Borra páginas específicas de un PDF", en: "Remove specific pages from a PDF", de: "Bestimmte Seiten aus einem PDF entfernen", fr: "Supprimer des pages spécifiques d'un PDF" },
  "tool.watermark.title":      { es: "Marca de agua", en: "Watermark", de: "Wasserzeichen", fr: "Filigrane" },
  "tool.watermark.subtitle":   { es: "Añade texto semitransparente en diagonal", en: "Add semi-transparent diagonal text", de: "Halbtransparenten Diagonaltext hinzufügen", fr: "Ajouter un texte diagonal semi-transparent" },
  "tool.pagenumbers.title":    { es: "Numerar páginas", en: "Page numbers", de: "Seitenzahlen", fr: "Numéroter les pages" },
  "tool.pagenumbers.subtitle": { es: "Inserta numeración en el pie de cada página", en: "Insert numbering at the foot of each page", de: "Seitenzahlen am Fuß jeder Seite einfügen", fr: "Insérer la numérotation en bas de chaque page" },
  "tool.metadata.title":       { es: "Editar metadatos", en: "Edit metadata", de: "Metadaten bearbeiten", fr: "Modifier les métadonnées" },
  "tool.metadata.subtitle":    { es: "Cambia título, autor, tema y palabras clave", en: "Change title, author, subject and keywords", de: "Titel, Autor, Thema und Schlüsselwörter ändern", fr: "Modifier le titre, l'auteur, le sujet et les mots-clés" },
  "tool.extracttext.title":    { es: "Extraer texto", en: "Extract text", de: "Text extrahieren", fr: "Extraire le texte" },
  "tool.extracttext.subtitle": { es: "Exporta el texto del PDF como archivo .txt", en: "Export the PDF text as a .txt file", de: "PDF-Text als .txt-Datei exportieren", fr: "Exporter le texte du PDF en fichier .txt" },
  "tool.crop.title":           { es: "Recortar márgenes", en: "Crop margins", de: "Ränder beschneiden", fr: "Rogner les marges" },
  "tool.crop.subtitle":        { es: "Reduce el área visible de cada página (CropBox)", en: "Reduce the visible area of each page (CropBox)", de: "Sichtbaren Bereich jeder Seite reduzieren (CropBox)", fr: "Réduire la zone visible de chaque page (CropBox)" },
  "tool.reorder.title":        { es: "Reordenar páginas", en: "Reorder pages", de: "Seiten neu anordnen", fr: "Réorganiser les pages" },
  "tool.reorder.subtitle":     { es: "Cambia el orden de las páginas con vista visual", en: "Change page order with a visual preview", de: "Seitenreihenfolge mit Vorschau ändern", fr: "Changer l'ordre des pages avec un aperçu visuel" },

  // Tags
  "tag.pdf":      { es: "PDF", en: "PDF", de: "PDF", fr: "PDF" },
  "tag.offline":  { es: "Offline", en: "Offline", de: "Offline", fr: "Hors ligne" },
  "tag.fast":     { es: "Rápido", en: "Fast", de: "Schnell", fr: "Rapide" },
  "tag.pages":    { es: "Páginas", en: "Pages", de: "Seiten", fr: "Pages" },
  "tag.zip":      { es: "ZIP", en: "ZIP", de: "ZIP", fr: "ZIP" },
  "tag.wasm":     { es: "WASM", en: "WASM", de: "WASM", fr: "WASM" },
  "tag.images":   { es: "Imágenes", en: "Images", de: "Bilder", fr: "Images" },
  "tag.security": { es: "Seguridad", en: "Security", de: "Sicherheit", fr: "Sécurité" },
  "tag.private":  { es: "Modo privado", en: "Private mode", de: "Privater Modus", fr: "Mode privé" },

  // Stepper / wizard
  "wizard.backToTools": { es: "← Todas las herramientas", en: "← All tools", de: "← Alle Werkzeuge", fr: "← Tous les outils" },
  "step.1":             { es: "Añadir archivos", en: "Add files", de: "Dateien hinzufügen", fr: "Ajouter des fichiers" },
  "step.2":             { es: "Opciones", en: "Options", de: "Optionen", fr: "Options" },
  "step.3":             { es: "Resultado", en: "Result", de: "Ergebnis", fr: "Résultat" },
  "btn.continue":       { es: "Continuar →", en: "Continue →", de: "Weiter →", fr: "Continuer →" },
  "btn.back":           { es: "← Atrás", en: "← Back", de: "← Zurück", fr: "← Retour" },
  "btn.run":            { es: "Ejecutar", en: "Run", de: "Ausführen", fr: "Exécuter" },
  "btn.running":        { es: "Procesando…", en: "Processing…", de: "Verarbeitung…", fr: "Traitement…" },
  "btn.queued":         { es: "En cola ({0})…", en: "Queued ({0})…", de: "Warteschlange ({0})…", fr: "En attente ({0})…" },
  "btn.cancel":         { es: "✕ Cancelar", en: "✕ Cancel", de: "✕ Abbrechen", fr: "✕ Annuler" },
  "btn.upload":         { es: "Subir", en: "Upload", de: "Hochladen", fr: "Importer" },
  "btn.clear":          { es: "Limpiar", en: "Clear", de: "Leeren", fr: "Effacer" },
  "btn.remove":         { es: "Quitar", en: "Remove", de: "Entfernen", fr: "Retirer" },
  "btn.useAsInput":     { es: "Usar como entrada", en: "Use as input", de: "Als Eingabe verwenden", fr: "Utiliser comme entrée" },
  "btn.startOver":      { es: "Empezar de nuevo", en: "Start over", de: "Von vorne beginnen", fr: "Recommencer" },
  "btn.tryAgain":       { es: "Reintentar", en: "Try again", de: "Erneut versuchen", fr: "Réessayer" },
  "btn.downloadAll":    { es: "⬇ Todos ({0})", en: "⬇ All ({0})", de: "⬇ Alle ({0})", fr: "⬇ Tous ({0})" },

  // Drop zone / files
  "drop.titlePdf":          { es: "Arrastra PDFs aquí", en: "Drop PDFs here", de: "PDFs hier ablegen", fr: "Déposez les PDFs ici" },
  "drop.titleImg":          { es: "Arrastra imágenes aquí", en: "Drop images here", de: "Bilder hier ablegen", fr: "Déposez les images ici" },
  "drop.hintPdf":           { es: "o haz clic para seleccionar archivos", en: "or click to choose files", de: "oder klicken zum Auswählen", fr: "ou cliquez pour choisir des fichiers" },
  "drop.hintImg":           { es: "JPG y PNG admitidos", en: "JPG and PNG supported", de: "JPG und PNG unterstützt", fr: "JPG et PNG pris en charge" },
  "files.none":             { es: "Sin archivos seleccionados.", en: "No files selected.", de: "Keine Dateien ausgewählt.", fr: "Aucun fichier sélectionné." },
  "files.reorderHint":      { es: "Arrastra los nombres para reordenar.", en: "Drag the names to reorder.", de: "Namen zum Neuanordnen ziehen.", fr: "Faites glisser les noms pour réorganiser." },
  "files.passwordPlaceholder": { es: "Contraseña (si protegido)", en: "Password (if protected)", de: "Passwort (falls geschützt)", fr: "Mot de passe (si protégé)" },
  "files.passwordNote":     { es: "Solo en tu navegador.", en: "Only in your browser.", de: "Nur in deinem Browser.", fr: "Uniquement dans votre navigateur." },
  "files.pageChip":         { es: "{0} pág.", en: "{0} pg.", de: "{0} S.", fr: "{0} p." },
  "files.dragTitle":        { es: "Reordenar", en: "Reorder", de: "Neu anordnen", fr: "Réorganiser" },

  // Validation
  "val.pagesEmpty":      { es: "Ingresa al menos una página.", en: "Enter at least one page.", de: "Gib mindestens eine Seite ein.", fr: "Saisissez au moins une page." },
  "val.pagesChars":      { es: "Caracteres no válidos. Usa solo números, comas, guiones y punto y coma.", en: "Invalid characters. Use only numbers, commas, hyphens and semicolons.", de: "Ungültige Zeichen. Nur Zahlen, Kommas, Bindestriche und Semikolons.", fr: "Caractères invalides. Utilisez uniquement des chiffres, virgules, tirets et points-virgules." },
  "val.pagesNone":       { es: "No se encontraron páginas válidas. Usa formato: 1,3,5-7", en: "No valid pages found. Use format: 1,3,5-7", de: "Keine gültigen Seiten gefunden. Format: 1,3,5-7", fr: "Aucune page valide trouvée. Format : 1,3,5-7" },
  "val.pagesMany":       { es: "{0} páginas seleccionadas. El proceso puede tardar.", en: "{0} pages selected. Processing may take a while.", de: "{0} Seiten ausgewählt. Die Verarbeitung kann dauern.", fr: "{0} pages sélectionnées. Le traitement peut prendre du temps." },
  "val.pageMaxHigh":     { es: "Página máxima muy alta. Verifica el PDF.", en: "Maximum page is very high. Check the PDF.", de: "Maximale Seitenzahl sehr hoch. PDF überprüfen.", fr: "Numéro de page maximum très élevé. Vérifiez le PDF." },
  "val.pagesOk":         { es: "{0} página(s){1}.", en: "{0} page(s){1}.", de: "{0} Seite(n){1}.", fr: "{0} page(s){1}." },
  "val.pagesGroups":     { es: " en {0} grupos", en: " in {0} groups", de: " in {0} Gruppen", fr: " en {0} groupes" },
  "val.dpiInvalid":      { es: "Ingresa un número válido entre 36 y 600.", en: "Enter a valid number between 36 and 600.", de: "Gib eine gültige Zahl zwischen 36 und 600 ein.", fr: "Saisissez un nombre valide entre 36 et 600." },
  "val.dpiMin":          { es: "DPI mínimo: 36.", en: "Minimum DPI: 36.", de: "Mindest-DPI: 36.", fr: "DPI minimum : 36." },
  "val.dpiMax":          { es: "DPI máximo: 600.", en: "Maximum DPI: 600.", de: "Maximale DPI: 600.", fr: "DPI maximum : 600." },
  "val.dpiHigh":         { es: "DPI alto ({0}). Las imágenes serán grandes.", en: "High DPI ({0}). Images will be large.", de: "Hoher DPI ({0}). Bilder werden groß sein.", fr: "DPI élevé ({0}). Les images seront volumineuses." },
  "val.dpiOk":           { es: "{0} DPI.", en: "{0} DPI.", de: "{0} DPI.", fr: "{0} DPI." },
  "val.pwdEmpty":        { es: "Ingresa una contraseña nueva.", en: "Enter a new password.", de: "Gib ein neues Passwort ein.", fr: "Saisissez un nouveau mot de passe." },
  "val.pwdMismatch":     { es: "Las contraseñas no coinciden.", en: "Passwords do not match.", de: "Passwörter stimmen nicht überein.", fr: "Les mots de passe ne correspondent pas." },
  "val.pwdShort":        { es: "Contraseña corta. Se recomiendan al menos 8 caracteres.", en: "Short password. At least 8 characters are recommended.", de: "Kurzes Passwort. Mindestens 8 Zeichen empfohlen.", fr: "Mot de passe court. Au moins 8 caractères sont recommandés." },
  "val.pwdOk":           { es: "Contraseña válida.", en: "Valid password.", de: "Gültiges Passwort.", fr: "Mot de passe valide." },
  "val.reorderEmpty":    { es: "Ingresa el nuevo orden de páginas (ej: 3,1,2).", en: "Enter the new page order (e.g. 3,1,2).", de: "Neue Seitenreihenfolge eingeben (z.B. 3,1,2).", fr: "Saisissez le nouvel ordre des pages (ex : 3,1,2)." },
  "val.reorderChars":    { es: "Solo se permiten números separados por comas.", en: "Only comma-separated numbers are allowed.", de: "Nur kommagetrennte Zahlen erlaubt.", fr: "Seuls des nombres séparés par des virgules sont autorisés." },
  "val.reorderInts":     { es: "Todos los valores deben ser enteros mayores a 0.", en: "All values must be integers greater than 0.", de: "Alle Werte müssen ganzzahlig und größer als 0 sein.", fr: "Toutes les valeurs doivent être des entiers supérieurs à 0." },
  "val.reorderDupes":    { es: "Hay páginas duplicadas en el orden.", en: "There are duplicate pages in the order.", de: "Es gibt doppelte Seiten in der Reihenfolge.", fr: "Il y a des pages en double dans l'ordre." },
  "val.reorderMissing":  { es: "Faltan páginas en el orden: {0}. El PDF tiene {1} páginas.", en: "Pages missing from the order: {0}. The PDF has {1} pages.", de: "Fehlende Seiten in der Reihenfolge: {0}. Das PDF hat {1} Seiten.", fr: "Pages manquantes dans l'ordre : {0}. Le PDF a {1} pages." },
  "val.reorderRange":    { es: "Página fuera de rango. El PDF tiene {0} páginas.", en: "Page out of range. The PDF has {0} pages.", de: "Seite außerhalb des Bereichs. Das PDF hat {0} Seiten.", fr: "Page hors plage. Le PDF a {0} pages." },
  "val.reorderOk":       { es: "{0} página(s) en el nuevo orden.", en: "{0} page(s) in the new order.", de: "{0} Seite(n) in der neuen Reihenfolge.", fr: "{0} page(s) dans le nouvel ordre." },
  "val.filesNonePdf":    { es: "Agrega al menos un archivo PDF.", en: "Add at least one PDF file.", de: "Füge mindestens eine PDF-Datei hinzu.", fr: "Ajoutez au moins un fichier PDF." },
  "val.filesNoneImg":    { es: "Agrega al menos una imagen.", en: "Add at least one image.", de: "Füge mindestens ein Bild hinzu.", fr: "Ajoutez au moins une image." },
  "val.mergeMin":        { es: "Combinar necesita al menos 2 PDFs.", en: "Merge needs at least 2 PDFs.", de: "Zusammenführen benötigt mindestens 2 PDFs.", fr: "La fusion nécessite au moins 2 PDFs." },
  "val.mergeMax":        { es: "Máximo {0} archivos.", en: "Maximum {0} files.", de: "Maximal {0} Dateien.", fr: "Maximum {0} fichiers." },
  "val.onlyFirst":       { es: "Solo se procesará el primer archivo.", en: "Only the first file will be processed.", de: "Nur die erste Datei wird verarbeitet.", fr: "Seul le premier fichier sera traité." },
  "val.emptyFile":       { es: "Hay un archivo vacío.", en: "There is an empty file.", de: "Es gibt eine leere Datei.", fr: "Il y a un fichier vide." },
  "val.fileTooBig":      { es: "Un archivo excede {0}.", en: "A file exceeds {0}.", de: "Eine Datei überschreitet {0}.", fr: "Un fichier dépasse {0}." },
  "val.fileBig":         { es: "\"{0}\" es grande ({1}).", en: "\"{0}\" is large ({1}).", de: "\"{0}\" ist groß ({1}).", fr: "« {0} » est volumineux ({1})." },

  // Alerts
  "alert.ignoredImg":    { es: "{0} archivo(s) ignorado(s): solo se aceptan JPG y PNG.", en: "{0} file(s) ignored: only JPG and PNG are accepted.", de: "{0} Datei(en) ignoriert: nur JPG und PNG werden akzeptiert.", fr: "{0} fichier(s) ignoré(s) : seuls JPG et PNG sont acceptés." },
  "alert.ignoredPdf":    { es: "{0} archivo(s) ignorado(s): solo se aceptan PDFs.", en: "{0} file(s) ignored: only PDFs are accepted.", de: "{0} Datei(en) ignoriert: nur PDFs werden akzeptiert.", fr: "{0} fichier(s) ignoré(s) : seuls les PDFs sont acceptés." },
  "alert.tooBigIgnored": { es: "\"{0}\" excede {1} y fue ignorado.", en: "\"{0}\" exceeds {1} and was ignored.", de: "\"{0}\" überschreitet {1} und wurde ignoriert.", fr: "« {0} » dépasse {1} et a été ignoré." },
  "alert.mergeTrim":     { es: "Máximo {0} archivos. Se aceptaron los primeros {0}.", en: "Maximum {0} files. The first {0} were accepted.", de: "Maximal {0} Dateien. Die ersten {0} wurden akzeptiert.", fr: "Maximum {0} fichiers. Les {0} premiers ont été acceptés." },
  "alert.readError":     { es: "Error leyendo archivo: {0}", en: "Error reading file: {0}", de: "Fehler beim Lesen der Datei: {0}", fr: "Erreur lors de la lecture du fichier : {0}" },
  "alert.watermarkText": { es: "Ingresa el texto de la marca de agua.", en: "Enter the watermark text.", de: "Gib den Wasserzeichentext ein.", fr: "Saisissez le texte du filigrane." },

  // Jobs / history
  "job.queued":       { es: "En cola", en: "Queued", de: "Warteschlange", fr: "En attente" },
  "job.done":         { es: "Completado", en: "Done", de: "Abgeschlossen", fr: "Terminé" },
  "job.error":        { es: "Error", en: "Error", de: "Fehler", fr: "Erreur" },
  "job.interrupted":  { es: "Interrumpido", en: "Interrupted", de: "Unterbrochen", fr: "Interrompu" },
  "job.cancelled":    { es: "Cancelado por el usuario.", en: "Cancelled by user.", de: "Vom Benutzer abgebrochen.", fr: "Annulé par l'utilisateur." },
  "job.files":        { es: "{0} archivo(s)", en: "{0} file(s)", de: "{0} Datei(en)", fr: "{0} fichier(s)" },
  "job.input":        { es: "Entrada: {0}", en: "Input: {0}", de: "Eingabe: {0}", fr: "Entrée : {0}" },
  "job.output":       { es: " → Salida: {0}", en: " → Output: {0}", de: " → Ausgabe: {0}", fr: " → Sortie : {0}" },
  "job.success":      { es: "Proceso completado exitosamente.", en: "Process completed successfully.", de: "Verarbeitung erfolgreich abgeschlossen.", fr: "Traitement terminé avec succès." },
  "history.empty":    { es: "Sin trabajos aún.", en: "No jobs yet.", de: "Noch keine Aufgaben.", fr: "Aucun travail pour l'instant." },
  "history.zipName":  { es: "resultados_{0}.zip", en: "results_{0}.zip", de: "ergebnisse_{0}.zip", fr: "resultats_{0}.zip" },

  // Result step
  "result.workingTitle": { es: "Procesando tu archivo…", en: "Processing your file…", de: "Datei wird verarbeitet…", fr: "Traitement de votre fichier…" },
  "result.queuedTitle":  { es: "En cola, empezará en breve…", en: "Queued, starting soon…", de: "Warteschlange, startet bald…", fr: "En attente, démarrage imminent…" },
  "result.doneTitle":    { es: "¡Listo!", en: "Done!", de: "Fertig!", fr: "Terminé !" },
  "result.doneSub":      { es: "Tu archivo está listo para descargar.", en: "Your file is ready to download.", de: "Deine Datei ist zum Herunterladen bereit.", fr: "Votre fichier est prêt à être téléchargé." },
  "result.errorTitle":   { es: "Algo salió mal", en: "Something went wrong", de: "Etwas ist schiefgelaufen", fr: "Une erreur s'est produite" },
  "result.download":     { es: "⬇ Descargar {0}", en: "⬇ Download {0}", de: "⬇ Herunterladen {0}", fr: "⬇ Télécharger {0}" },
  "result.none":         { es: "No hay ningún proceso activo.", en: "There is no active process.", de: "Kein aktiver Prozess.", fr: "Aucun processus actif." },

  // Options — compress
  "opt.compressLevel":   { es: "Nivel de compresión", en: "Compression level", de: "Komprimierungsstufe", fr: "Niveau de compression" },
  "opt.cmp.small":       { es: "Ligera", en: "Light", de: "Leicht", fr: "Légère" },
  "opt.cmp.balanced":    { es: "Equilibrada", en: "Balanced", de: "Ausgewogen", fr: "Équilibrée" },
  "opt.cmp.best":        { es: "Máxima", en: "Maximum", de: "Maximum", fr: "Maximum" },
  "opt.cmp.aggressive":  { es: "Agresiva", en: "Aggressive", de: "Aggressiv", fr: "Agressive" },
  "opt.cmp.smallDesc":      { es: "Reescritura rápida sin recompresión.", en: "Fast rewrite without recompression.", de: "Schnelles Umschreiben ohne Neukomprimierung.", fr: "Réécriture rapide sans recompression." },
  "opt.cmp.balancedDesc":   { es: "Recompresión estándar con flate.", en: "Standard flate recompression.", de: "Standardmäßige Flate-Neukomprimierung.", fr: "Recompression flate standard." },
  "opt.cmp.bestDesc":       { es: "Recompresión agresiva + linearización.", en: "Aggressive recompression + linearization.", de: "Aggressive Neukomprimierung + Linearisierung.", fr: "Recompression agressive + linéarisation." },
  "opt.cmp.aggressiveDesc": { es: "Rasteriza páginas a 150 DPI JPEG — el texto no será seleccionable.", en: "Rasterizes pages to 150 DPI JPEG — text won't be selectable.", de: "Seiten als 150 DPI JPEG rastern — Text nicht auswählbar.", fr: "Rastérise les pages en JPEG 150 DPI — le texte ne sera pas sélectionnable." },

  // Options — split
  "opt.visualMode":      { es: "🖼 Modo visual", en: "🖼 Visual mode", de: "🖼 Visueller Modus", fr: "🖼 Mode visuel" },
  "opt.textMode":        { es: "✏ Modo texto", en: "✏ Text mode", de: "✏ Textmodus", fr: "✏ Mode texte" },
  "opt.pages":           { es: "Páginas", en: "Pages", de: "Seiten", fr: "Pages" },
  "opt.pagesPlaceholder":{ es: "ej: 1,2,5-7; 10-12", en: "e.g. 1,2,5-7; 10-12", de: "z.B. 1,2,5-7; 10-12", fr: "ex : 1,2,5-7 ; 10-12" },
  "opt.splitFormat":     { es: "Formato: 1,3,5-7 (1-based). Separa con ; para múltiples PDFs en ZIP.", en: "Format: 1,3,5-7 (1-based). Separate with ; for multiple PDFs in a ZIP.", de: "Format: 1,3,5-7 (1-basiert). Mit ; für mehrere PDFs in ZIP trennen.", fr: "Format : 1,3,5-7 (base 1). Séparer par ; pour plusieurs PDFs en ZIP." },
  "opt.output":          { es: "Salida", en: "Output", de: "Ausgabe", fr: "Sortie" },
  "opt.singlePdf":       { es: "PDF único", en: "Single PDF", de: "Einzelnes PDF", fr: "PDF unique" },
  "opt.zipPerRange":     { es: "ZIP (un PDF por rango)", en: "ZIP (one PDF per range)", de: "ZIP (ein PDF pro Bereich)", fr: "ZIP (un PDF par plage)" },

  // Options — pdf2img
  "opt.format":     { es: "Formato", en: "Format", de: "Format", fr: "Format" },
  "opt.dpi":        { es: "DPI (36–600)", en: "DPI (36–600)", de: "DPI (36–600)", fr: "DPI (36–600)" },
  "opt.pdf2imgNote":{ es: "Genera un ZIP con todas las páginas. Mayor DPI = mayor calidad.", en: "Generates a ZIP with all pages. Higher DPI = higher quality.", de: "Erzeugt ein ZIP mit allen Seiten. Höhere DPI = höhere Qualität.", fr: "Génère un ZIP avec toutes les pages. DPI plus élevé = meilleure qualité." },

  // Options — rotate
  "opt.angle":          { es: "Ángulo", en: "Angle", de: "Winkel", fr: "Angle" },
  "opt.applyTo":        { es: "Aplicar a", en: "Apply to", de: "Anwenden auf", fr: "Appliquer à" },
  "opt.allPages":       { es: "Todas las páginas", en: "All pages", de: "Alle Seiten", fr: "Toutes les pages" },
  "opt.specificPages":  { es: "Páginas específicas", en: "Specific pages", de: "Bestimmte Seiten", fr: "Pages spécifiques" },
  "opt.pagesPlaceholder2": { es: "ej: 1,3,5-7", en: "e.g. 1,3,5-7", de: "z.B. 1,3,5-7", fr: "ex : 1,3,5-7" },

  // Options — img2pdf
  "opt.pageSize":    { es: "Tamaño de página", en: "Page size", de: "Seitengröße", fr: "Taille de page" },
  "opt.autoSize":    { es: "Auto (tamaño imagen)", en: "Auto (image size)", de: "Auto (Bildgröße)", fr: "Auto (taille image)" },
  "opt.img2pdfNote": { es: "Cada imagen → una página. Con A4/Letter la imagen se escala para ajustarse.", en: "Each image → one page. With A4/Letter the image is scaled to fit.", de: "Jedes Bild → eine Seite. Bei A4/Letter wird das Bild skaliert.", fr: "Chaque image → une page. Avec A4/Letter, l'image est mise à l'échelle." },

  // Options — protect
  "opt.mode":           { es: "Modo", en: "Mode", de: "Modus", fr: "Mode" },
  "opt.addPassword":    { es: "Añadir contraseña", en: "Add password", de: "Passwort hinzufügen", fr: "Ajouter un mot de passe" },
  "opt.removePassword": { es: "Quitar contraseña", en: "Remove password", de: "Passwort entfernen", fr: "Supprimer le mot de passe" },
  "opt.newPassword":    { es: "Nueva contraseña", en: "New password", de: "Neues Passwort", fr: "Nouveau mot de passe" },
  "opt.newPwdPlaceholder":     { es: "Contraseña nueva", en: "New password", de: "Neues Passwort", fr: "Nouveau mot de passe" },
  "opt.confirmPassword":       { es: "Confirmar contraseña", en: "Confirm password", de: "Passwort bestätigen", fr: "Confirmer le mot de passe" },
  "opt.confirmPwdPlaceholder": { es: "Repetir contraseña", en: "Repeat password", de: "Passwort wiederholen", fr: "Répéter le mot de passe" },
  "opt.removeNote":     { es: "Usa el campo de contraseña en el archivo para desencriptar. El PDF resultante no tendrá contraseña.", en: "Use the password field on the file to decrypt. The resulting PDF will have no password.", de: "Verwende das Passwortfeld der Datei zum Entschlüsseln. Das resultierende PDF hat kein Passwort.", fr: "Utilisez le champ mot de passe du fichier pour déchiffrer. Le PDF résultant n'aura pas de mot de passe." },

  // Options — deletepages
  "opt.pagesToDelete":  { es: "Páginas a eliminar", en: "Pages to delete", de: "Zu löschende Seiten", fr: "Pages à supprimer" },
  "opt.deleteNote":     { es: "Las páginas indicadas serán eliminadas. Las demás se conservan.", en: "The listed pages will be removed. The rest are kept.", de: "Die angegebenen Seiten werden gelöscht. Die übrigen bleiben erhalten.", fr: "Les pages indiquées seront supprimées. Les autres seront conservées." },

  // Options — watermark
  "opt.text":           { es: "Texto", en: "Text", de: "Text", fr: "Texte" },
  "opt.wmPlaceholder":  { es: "ej: CONFIDENCIAL", en: "e.g. CONFIDENTIAL", de: "z.B. VERTRAULICH", fr: "ex : CONFIDENTIEL" },
  "opt.opacity":        { es: "Opacidad (%)", en: "Opacity (%)", de: "Deckkraft (%)", fr: "Opacité (%)" },
  "opt.angleDeg":       { es: "Ángulo (°)", en: "Angle (°)", de: "Winkel (°)", fr: "Angle (°)" },
  "opt.sizePt":         { es: "Tamaño (pt)", en: "Size (pt)", de: "Größe (pt)", fr: "Taille (pt)" },
  "opt.color":          { es: "Color", en: "Color", de: "Farbe", fr: "Couleur" },

  // Options — pagenumbers
  "opt.position":      { es: "Posición", en: "Position", de: "Position", fr: "Position" },
  "opt.bottomLeft":    { es: "Inf. izquierda", en: "Bottom left", de: "Unten links", fr: "Bas gauche" },
  "opt.bottomCenter":  { es: "Inf. centro", en: "Bottom center", de: "Unten Mitte", fr: "Bas centre" },
  "opt.bottomRight":   { es: "Inf. derecha", en: "Bottom right", de: "Unten rechts", fr: "Bas droite" },
  "opt.startNumber":   { es: "Número inicial", en: "Starting number", de: "Startnummer", fr: "Numéro de départ" },
  "opt.prefix":        { es: "Prefijo", en: "Prefix", de: "Präfix", fr: "Préfixe" },
  "opt.prefixPlaceholder": { es: "ej: Pág. ", en: "e.g. Page ", de: "z.B. S. ", fr: "ex : Page " },
  "opt.fontSize":      { es: "Tamaño fuente (pt)", en: "Font size (pt)", de: "Schriftgröße (pt)", fr: "Taille de police (pt)" },

  // Options — metadata
  "opt.metaNote":     { es: "Los campos vacíos conservan los metadatos actuales del PDF.", en: "Empty fields keep the PDF's current metadata.", de: "Leere Felder behalten die aktuellen PDF-Metadaten.", fr: "Les champs vides conservent les métadonnées actuelles du PDF." },
  "opt.metaTitle":    { es: "Título", en: "Title", de: "Titel", fr: "Titre" },
  "opt.metaAuthor":   { es: "Autor", en: "Author", de: "Autor", fr: "Auteur" },
  "opt.metaSubject":  { es: "Tema", en: "Subject", de: "Thema", fr: "Sujet" },
  "opt.metaKeywords": { es: "Palabras clave", en: "Keywords", de: "Schlüsselwörter", fr: "Mots-clés" },
  "opt.metaCreator":  { es: "Creador", en: "Creator", de: "Ersteller", fr: "Créateur" },
  "opt.metaCreatorPlaceholder": { es: "Aplicación creadora", en: "Creating application", de: "Erstellende Anwendung", fr: "Application créatrice" },

  // Options — extracttext
  "opt.extractNote": { es: "Extrae texto de todas las páginas → archivo <strong>.txt</strong>. Requiere PDF con texto seleccionable (no PDFs escaneados sin OCR).", en: "Extracts text from all pages → a <strong>.txt</strong> file. Requires a PDF with selectable text (not scanned PDFs without OCR).", de: "Extrahiert Text aller Seiten → <strong>.txt</strong>-Datei. Erfordert ein PDF mit auswählbarem Text (keine gescannten PDFs ohne OCR).", fr: "Extrait le texte de toutes les pages → fichier <strong>.txt</strong>. Nécessite un PDF avec du texte sélectionnable (pas de PDFs scannés sans OCR)." },

  // Options — crop
  "opt.unit":      { es: "Unidad", en: "Unit", de: "Einheit", fr: "Unité" },
  "opt.mm":        { es: "Milímetros (mm)", en: "Millimeters (mm)", de: "Millimeter (mm)", fr: "Millimètres (mm)" },
  "opt.pt":        { es: "Puntos (pt)", en: "Points (pt)", de: "Punkte (pt)", fr: "Points (pt)" },
  "opt.cropTop":    { es: "Superior", en: "Top", de: "Oben", fr: "Haut" },
  "opt.cropBottom": { es: "Inferior", en: "Bottom", de: "Unten", fr: "Bas" },
  "opt.cropLeft":   { es: "Izquierdo", en: "Left", de: "Links", fr: "Gauche" },
  "opt.cropRight":  { es: "Derecho", en: "Right", de: "Rechts", fr: "Droite" },
  "opt.cropNote":  { es: "Reduce el área visible de todas las páginas. El contenido fuera del recorte queda oculto.", en: "Reduces the visible area of all pages. Content outside the crop is hidden.", de: "Reduziert den sichtbaren Bereich aller Seiten. Inhalt außerhalb des Schnitts wird ausgeblendet.", fr: "Réduit la zone visible de toutes les pages. Le contenu hors découpe est masqué." },

  // Options — reorder
  "opt.newOrder":            { es: "Nuevo orden de páginas", en: "New page order", de: "Neue Seitenreihenfolge", fr: "Nouvel ordre des pages" },
  "opt.reorderPlaceholder":  { es: "ej: 3,1,2,4,5", en: "e.g. 3,1,2,4,5", de: "z.B. 3,1,2,4,5", fr: "ex : 3,1,2,4,5" },
  "opt.reorderNote":         { es: "Lista completa de páginas (1-based) en el nuevo orden, separadas por comas.", en: "Complete list of pages (1-based) in the new order, comma-separated.", de: "Vollständige Seitenliste (1-basiert) in neuer Reihenfolge, kommagetrennt.", fr: "Liste complète des pages (base 1) dans le nouvel ordre, séparées par des virgules." },
  "opt.noOptions":           { es: "Sin opciones adicionales.", en: "No additional options.", de: "Keine weiteren Optionen.", fr: "Aucune option supplémentaire." },

  // Reorder interactive UI
  "reorder.rotateLeft":    { es: "Rotar izquierda", en: "Rotate left", de: "Links drehen", fr: "Rotation gauche" },
  "reorder.rotateRight":   { es: "Rotar derecha", en: "Rotate right", de: "Rechts drehen", fr: "Rotation droite" },
  "reorder.delete":        { es: "Eliminar página", en: "Delete page", de: "Seite löschen", fr: "Supprimer la page" },
  "reorder.selected":      { es: "{0} páginas seleccionadas", en: "{0} pages selected", de: "{0} Seiten ausgewählt", fr: "{0} pages sélectionnées" },
  "reorder.deselectAll":   { es: "Deseleccionar todo", en: "Deselect all", de: "Alle abwählen", fr: "Tout désélectionner" },
  "reorder.deleteSelected":{ es: "Eliminar selección", en: "Delete selected", de: "Auswahl löschen", fr: "Supprimer la sélection" },
  "reorder.thumbSize":     { es: "Tamaño", en: "Size", de: "Größe", fr: "Taille" },
  "reorder.sizeSlider":    { es: "Tamaño de miniaturas", en: "Thumbnail size", de: "Miniaturengröße", fr: "Taille des miniatures" },

  // Thumbnails
  "thumb.loadFailed":   { es: "⚠ No se pudieron cargar las vistas previas. Usa el campo de texto para especificar el orden.", en: "⚠ Previews could not be loaded. Use the text field to specify the order.", de: "⚠ Vorschauen konnten nicht geladen werden. Textfeld zum Angeben der Reihenfolge verwenden.", fr: "⚠ Les aperçus n'ont pas pu être chargés. Utilisez le champ texte pour spécifier l'ordre." },
  "thumb.loading":      { es: "Cargando vistas previas…", en: "Loading previews…", de: "Vorschauen werden geladen…", fr: "Chargement des aperçus…" },
  "thumb.dragReorder":  { es: "Arrastra las páginas para reordenarlas. El orden se refleja en el campo de texto.", en: "Drag the pages to reorder them. The order is reflected in the text field.", de: "Seiten zum Neuanordnen ziehen. Die Reihenfolge wird im Textfeld angezeigt.", fr: "Faites glisser les pages pour les réorganiser. L'ordre est reflété dans le champ texte." },
  "thumb.clickSelect":  { es: "Haz clic en las páginas para seleccionarlas/deseleccionarlas.", en: "Click pages to select/deselect them.", de: "Auf Seiten klicken zum Auswählen/Abwählen.", fr: "Cliquez sur les pages pour les sélectionner/désélectionner." },
  "thumb.selected":     { es: "Seleccionadas: {0}", en: "Selected: {0}", de: "Ausgewählt: {0}", fr: "Sélectionnées : {0}" },

  // Misc
  "misc.shortcuts": { es: "Atajos: Ctrl+O abrir · Enter continuar/ejecutar · Esc atrás · T tema", en: "Shortcuts: Ctrl+O open · Enter continue/run · Esc back · T theme", de: "Shortcuts: Strg+O öffnen · Enter weiter/ausführen · Esc zurück · T Design", fr: "Raccourcis : Ctrl+O ouvrir · Entrée continuer/exécuter · Échap retour · T thème" },
  "misc.workerNote": { es: "Procesado en un Web Worker — sin subida de datos.", en: "Processed in a Web Worker — no data uploads.", de: "Verarbeitung in einem Web Worker — keine Daten-Uploads.", fr: "Traité dans un Web Worker — aucune donnée envoyée." },
} as const;

export type I18nKey = keyof typeof dict;

let lang: Lang = (() => {
  const s = localStorage.getItem(LANG_STORAGE_KEY);
  if (s === "es" || s === "en" || s === "de" || s === "fr") return s;
  const nav = (navigator.language || "en").toLowerCase();
  if (nav.startsWith("es")) return "es";
  if (nav.startsWith("de")) return "de";
  if (nav.startsWith("fr")) return "fr";
  return "en";
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
