-- GradeDock v3.20 upgrade. Run ONCE in your EXISTING GradeDock Supabase SQL Editor.
-- Preserves all current classes, exams, keys, and scan results.
alter table public.classes add column if not exists is_archived boolean not null default false;
alter table public.exams add column if not exists is_archived boolean not null default false;

create table if not exists public.students (
  id uuid primary key default gen_random_uuid(),
  teacher_id uuid not null references auth.users(id) on delete cascade,
  class_id uuid not null references public.classes(id) on delete cascade,
  full_name text not null check (length(trim(full_name)) > 0),
  gender text not null check (gender in ('Male', 'Female')),
  lrn text,
  created_at timestamptz not null default now()
);
create index if not exists gradedock_students_teacher_class_idx on public.students(teacher_id, class_id);
alter table public.students enable row level security;
drop policy if exists "gradedock_students_select" on public.students;
drop policy if exists "gradedock_students_insert" on public.students;
drop policy if exists "gradedock_students_update" on public.students;
drop policy if exists "gradedock_students_delete" on public.students;
create policy "gradedock_students_select" on public.students for select to authenticated
 using (teacher_id=(select auth.uid()) and exists (select 1 from public.classes c where c.id=students.class_id and c.teacher_id=(select auth.uid())));
create policy "gradedock_students_insert" on public.students for insert to authenticated
 with check (teacher_id=(select auth.uid()) and exists (select 1 from public.classes c where c.id=students.class_id and c.teacher_id=(select auth.uid())));
create policy "gradedock_students_update" on public.students for update to authenticated
 using (teacher_id=(select auth.uid()))
 with check (teacher_id=(select auth.uid()) and exists (select 1 from public.classes c where c.id=students.class_id and c.teacher_id=(select auth.uid())));
create policy "gradedock_students_delete" on public.students for delete to authenticated
 using (teacher_id=(select auth.uid()));
grant select,insert,update,delete on public.students to authenticated;
