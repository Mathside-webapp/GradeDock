-- Read-only verification, run after 01_COMPLETE_SUPABASE_SETUP.sql
select table_name from information_schema.tables where table_schema='public' and table_name in ('profiles','classes','exams','exam_keys','students','results','result_answers') order by table_name;
select column_name from information_schema.columns where table_schema='public' and table_name='students' order by ordinal_position;
select id,public from storage.buckets where id='gradedock-scans';
