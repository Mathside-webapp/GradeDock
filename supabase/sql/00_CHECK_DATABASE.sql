-- GradeDock: read-only Supabase diagnostic.
-- Run in YOUR GradeDock Supabase SQL Editor (not Mathside or ClassCheck).
-- This script does not alter or delete data.
WITH required(table_name) AS (
  VALUES ('profiles'), ('classes'), ('exams'), ('exam_keys'),
         ('students'), ('results'), ('result_answers')
)
SELECT r.table_name,
       CASE WHEN to_regclass('public.' || r.table_name) IS NOT NULL
            THEN 'EXISTS' ELSE 'MISSING' END AS table_status,
       COALESCE((SELECT c.relrowsecurity::text FROM pg_class c
                 WHERE c.oid = to_regclass('public.' || r.table_name)), 'n/a') AS rls_enabled,
       CASE WHEN to_regclass('public.' || r.table_name) IS NOT NULL
            THEN has_table_privilege('authenticated', to_regclass('public.' || r.table_name), 'SELECT')::text
            ELSE 'n/a' END AS authenticated_can_select
FROM required r ORDER BY r.table_name;

-- Check relevant exam columns. Empty output means the exams table does not exist.
SELECT column_name, data_type FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'exams'
ORDER BY ordinal_position;

-- Check the answer-key table's columns. Empty output means missing table.
SELECT column_name, data_type FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'exam_keys'
ORDER BY ordinal_position;

-- If all tables exist yet the browser gets PGRST205, refresh the API schema cache:
-- NOTIFY pgrst, 'reload schema';
