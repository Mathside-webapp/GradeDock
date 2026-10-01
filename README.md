# GradeDock v3.3

GradeDock is a static HTML/CSS/JavaScript teacher assessment platform with Supabase support. Teachers create sections and exams, download scanner-ready answer sheets, set keys manually or with Excel, capture/upload completed papers, and save results by section.

## IMPORTANT: run the SQL first

If you are using a real Supabase account, **exam creation will not work until the database tables and RLS policies are installed**.

1. Open your Supabase project.
2. Open **SQL Editor**.
3. Run the complete file: `sql/01_RUN_THIS_FIRST.sql`.
4. Put your Project URL and browser-safe publishable key in `js/config.js`.
5. Refresh GradeDock and sign in again.

If you are only testing, click **Try demo mode**. Demo mode does not need SQL.

## v3.3 changes

- Exams can be created with **no answer key** so the teacher can download the test answer sheet first.
- The **Set / Update Answer Key** screen now has a complete **manual answer-key editor** in addition to Excel upload/download.
- Exams now have a **Delete** button. Deleting an exam also removes its answer key and linked results through database cascade rules.
- The generated answer sheet has a clear outer border and organized question blocks.
- The word **GradeDock is no longer printed on the student answer sheet**.
- The **exam name is larger and becomes the main heading**.
- Name and Section fields remain on the answer sheet.
- PDF and PNG answer-sheet downloads remain available.
- Four black registration squares are kept because the camera scanner uses them to find the page corners and correct perspective.

## Main website files

```text
GradeDock-v3.3/
├── index.html
├── css/styles.css
├── js/
│   ├── app.js
│   ├── config.js
│   ├── excel.js
│   ├── scanner.js
│   ├── sheet.js
│   └── store.js
├── sql/
│   ├── 01_RUN_THIS_FIRST.sql
│   ├── gradedock.sql
│   └── gradedock_v2_upgrade.sql
├── templates/GradeDock-Dynamic-Answer-Key-Template.xlsx
├── samples/
└── README.md
```

## Supabase config

Open `js/config.js` and set:

```js
window.GRADEDOCK_CONFIG = {
  supabaseUrl: 'https://YOUR_PROJECT.supabase.co',
  supabasePublishableKey: 'sb_publishable_...',
  storageBucket: 'gradedock-scans'
};
```

Never place a service-role/secret key in browser JavaScript.

## Exam workflow

1. Create an exam with title, number of items, and A-D/A-E choices.
2. You may leave every correct answer blank.
3. Create the exam.
4. Download the answer sheet as PDF or PNG.
5. Later click **Set / Update Answer Key**.
6. Either enter the answers manually or upload a completed Excel key.
7. A complete answer key is required only when scanning/scoring.

## Answer-sheet scanning markers

The four black corner squares are registration markers, not decoration. GradeDock's scanner detects them to locate, rotate, and perspective-correct a photographed sheet. Removing them would make camera/image scanning much less reliable.

Print answer sheets at **Actual Size / 100%** when possible, and keep all four black squares visible in the photo.

## Camera access

Camera scanning requires HTTPS or localhost in most browsers. For local testing:

```bash
python -m http.server 8080
```

Then open `http://localhost:8080`.

## Edge Functions

No Edge Function is required for this version. OMR runs in the browser, while Supabase Auth + RLS protects teacher-owned data.


### v3.9.1 UI fix
The sign-in hero artwork now occupies its own responsive column and no longer overlaps the description or feature buttons.
