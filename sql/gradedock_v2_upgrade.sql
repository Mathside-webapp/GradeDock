-- GradeDock v2 upgrade for a database that previously used GradeDock v1.
-- Run this ONCE if you already ran the older gradedock.sql.

alter table public.results
  add column if not exists class_id uuid references public.classes(id) on delete set null;

create index if not exists results_class_idx on public.results(class_id);

-- GradeDock v2 no longer uses student rosters in the interface.
-- Existing public.students data can remain; nothing is deleted by this upgrade.
-- Existing exams may still have class_id. GradeDock v2 simply stops using that field.

-- Strengthen result inserts/updates so new v2 results must belong to one of the teacher's classes.
drop policy if exists "results_insert_own" on public.results;
drop policy if exists "results_update_own" on public.results;

create policy "results_insert_own" on public.results for insert to authenticated
with check (
  (select auth.uid()) = teacher_id
  and class_id is not null
  and exists (select 1 from public.exams e where e.id = results.exam_id and e.teacher_id = (select auth.uid()))
  and exists (select 1 from public.classes c where c.id = results.class_id and c.teacher_id = (select auth.uid()))
);

create policy "results_update_own" on public.results for update to authenticated
using ((select auth.uid()) = teacher_id)
with check (
  (select auth.uid()) = teacher_id
  and class_id is not null
  and exists (select 1 from public.exams e where e.id = results.exam_id and e.teacher_id = (select auth.uid()))
  and exists (select 1 from public.classes c where c.id = results.class_id and c.teacher_id = (select auth.uid()))
);
