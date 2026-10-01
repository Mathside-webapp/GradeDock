GradeDock v3.9 — Portrait Camera Scanner

This is the COMPLETE GradeDock package and includes js/config.js, SQL, templates, samples, and all current frontend files.

Camera improvements in v3.9:
- Portrait A4-style camera preview instead of landscape.
- Rear camera remains preferred on phones.
- Camera frames are center-cropped to the answer-sheet portrait ratio so the on-screen guide matches the image sent to OMR.
- Live scan-readiness indicator checks lighting, focus/sharpness, marker visibility, and how much of the frame the paper occupies.
- Optional browser-controlled camera light appears on supported phone cameras.
- Requests continuous autofocus where supported.
- More tolerant corner-marker detection for uneven lighting.
- Higher quality capture for bubble recognition.
- Clear guidance to keep the sheet upright with the exam title at the top.

Testing the camera locally:
Run GradeDock through localhost (for example VS Code Live Server or python -m http.server 8000). Camera access may not work reliably when index.html is opened directly as a file.

Important:
The four black squares are registration/alignment markers. Keep all four clean and visible.
