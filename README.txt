GradeDock v3.5 - Replacement Files Only

Replace these files in your current GradeDock folder:
1. index.html
2. css/styles.css
3. js/app.js
4. js/scanner.js

What changed:
- Removed the GradeDock text/logo block from the mobile white header/login area.
- Improved live-camera startup and browser permission/error messages.
- Added a phone-camera fallback button (Take photo instead).
- Camera still requires a Section/Class and Exam selection first.
- Made modal action buttons smaller and raised the modal layer above page buttons.
- Black corner squares are alignment/registration markers only. They do not identify a student or exam.

Keep your current js/sheet.js from v3.4.2; this package does not replace it.

Live camera note:
Use HTTPS (for example GitHub Pages) or localhost. Browsers can block live camera access when index.html is opened directly from the file system or served over insecure HTTP.
