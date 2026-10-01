GradeDock v3.8 - Scanner Sensitivity + Required Answer Confirmation

Replace ONLY these files in your existing GradeDock website:

1. js/scanner.js
2. js/app.js
3. css/styles.css

No SQL changes are required.

Changes:
- Scanner uses the generated GradeDock answer-sheet template as a reference mask.
- Printed A/B/C/D letters inside empty bubbles are ignored during OMR scoring.
- Scanner compensates for uneven lighting around each bubble.
- Detection compares each bubble with the other choices in the same question.
- Small/light shading is detected more sensitively.
- Light marks are shown for teacher confirmation instead of immediately becoming blank.
- Multiple answers require the teacher to choose A/B/C/D (or Blank) and click "Confirm".
- Results cannot be saved while highlighted answers remain unresolved.
