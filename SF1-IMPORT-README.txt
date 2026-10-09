GRADEDOCK — OFFICIAL DEPED SF1 IMPORT

This version was checked against a real legacy .xls DepEd School Form 1 layout.

HOW TO IMPORT:
1. Sign in to GradeDock and open Classes.
2. Select your class and click Manage students.
3. Under Import DepEd School Form 1 (SF1), choose your .xls or .xlsx file.
4. Wait for GradeDock to read the workbook. The student preview appears automatically.
5. Check the total and male/female counts, then click Add students to this class.
6. Wait until importing is complete. The roster refreshes automatically.

Standard SF1: uses LRN, NAME (Last Name, First Name, Middle Name),
SEX (M/F), TOTAL MALE and TOTAL FEMALE. No separate gender column is required.
A normal .xlsx or CSV roster is also supported. Students without sex information
are imported as Unspecified instead of guessing from their names.

Existing students are skipped (matched by normalized name or 12-digit LRN).
Data is not sent to Supabase until you confirm the preview.

The scanning engine (js/scanner.js), answer sheet generator (js/sheet.js),
and Supabase connection (js/config.js) were not modified.
No new SQL or Edge Function is needed for this change on your connected GradeDock project.

The example SF1 supplied for testing is NOT included in this ZIP.
