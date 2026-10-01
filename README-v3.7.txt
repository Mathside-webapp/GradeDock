GradeDock v3.7 replacement files

Replace these files in your current GradeDock website:
- index.html
- css/styles.css
- js/app.js
- js/store.js
- js/scanner.js

Do NOT replace js/sheet.js if you already have the v3.6 answer-sheet template you approved.

New features:
1. Delete individual student results from Results. The related result_answers rows are removed by the existing ON DELETE CASCADE. If a scan image was stored, GradeDock also attempts to remove it from the private storage bucket.
2. Automatic student-name OCR. After a successful sheet scan, GradeDock crops the Name field using the four registration markers and runs browser-side OCR. The detected name is placed in the Student Name field and remains editable.

Important:
- Handwritten-name OCR is best-effort. Neat block/print handwriting works better than cursive or very light pencil. Always verify the detected name before saving.
- The first OCR scan may take a few seconds while the English OCR model loads.
- Internet access is required the first time to load Tesseract.js and its English language model from the CDN.
- No new SQL is required if you already ran the current GradeDock SQL, which includes the result delete RLS policy.
