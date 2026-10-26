GradeDock current database guide (26 October 2026)

FIRST: Run 00_CHECK_DATABASE.sql in your GradeDock Supabase project.
- New EMPTY project with no GradeDock tables: run 01_COMPLETE_SUPABASE_SETUP.sql once.
- Existing project with exams but missing/broken answer key table: run 05_REPAIR_EXAM_KEYS_EXISTING.sql.
- If everything exists: use NOTIFY pgrst, 'reload schema'; and check Data API.

01_RUN_THIS_FIRST.sql and gradedock.sql are old v2 copies. Do NOT use those for new v3.27 installations.
Read ../GRADEDOCK-EXAM-ANSWER-KEY-FIX.txt for safe instructions.
