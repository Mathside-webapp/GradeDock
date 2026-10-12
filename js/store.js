(function () {
  const cfg = window.GRADEDOCK_CONFIG || {};
  const configured = Boolean(cfg.supabaseUrl && cfg.supabasePublishableKey && window.supabase?.createClient);
  const client = configured
    ? window.supabase.createClient(cfg.supabaseUrl, cfg.supabasePublishableKey, {
        auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
      })
    : null;

  const Store = {
    client,
    configured,

    friendlyError(err) {
      const message = String(err?.message || err || 'Unknown error');
      const code = String(err?.code || '');
      if (code === 'PGRST205' || /relation .* does not exist|could not find the table|schema cache/i.test(message)) {
        return 'GradeDock database tables are not installed yet. In Supabase SQL Editor, run sql/01_RUN_THIS_FIRST.sql, then refresh this page.';
      }
      if (/row-level security|violates row-level security/i.test(message)) {
        return 'Supabase blocked this action. Run the latest sql/01_RUN_THIS_FIRST.sql so the required RLS policies are installed.';
      }
      return message;
    },

    async session() {
      
      if (!client) return null;
      const { data } = await client.auth.getSession();
      return data.session;
    },

    async signup({ name, email, password }) {
      if (!client) throw new Error('Supabase is not configured. Please check js/config.js.');
      const { data, error } = await client.auth.signUp({ email, password, options: { data: { full_name: name } } });
      if (error) throw error;
      return data;
    },

    async signin({ email, password }) {
      if (!client) throw new Error('Supabase is not configured. Please check js/config.js.');
      const { data, error } = await client.auth.signInWithPassword({ email, password });
      if (error) throw error;
      return data;
    },

    async signout() {
      if (client) await client.auth.signOut();
    },

    async user() {
      
      const s = await this.session();
      if (!s?.user) return null;
      let { data, error } = await client.from('profiles').select('*').eq('id', s.user.id).maybeSingle();
      if (error) throw error;
      if (!data) {
        const profile = {
          id: s.user.id,
          full_name: s.user.user_metadata?.full_name || s.user.email?.split('@')[0] || 'Teacher',
          email: s.user.email
        };
        const q = await client.from('profiles').upsert(profile).select().single();
        if (q.error) throw q.error;
        data = q.data;
      }
      return data;
    },

    async updateProfile(payload) {
      
      const s = await this.session();
      const { data, error } = await client.from('profiles').update(payload).eq('id', s.user.id).select().single();
      if (error) throw error;
      return data;
    },

    async classes() {
      
      const { data, error } = await client.from('classes').select('*').order('created_at', { ascending: false });
      if (error) throw error;
      return data;
    },

    async createClass(payload) {
      const normalized = { ...payload, name: payload.section || payload.name || 'Section' };
      
      const s = await this.session();
      const { data, error } = await client.from('classes').insert({ ...normalized, teacher_id: s.user.id }).select().single();
      if (error) throw error;
      return data;
    },

    async students(classId = null) {
      
      let query = client.from('students').select('*').order('gender').order('full_name');
      if (classId) query = query.eq('class_id', classId);
      const { data, error } = await query;
      if (error) throw error;
      return data || [];
    },

    async addStudents(classId, students) {
      const rows = students.map(student => ({ class_id: classId, full_name: student.full_name.trim(), gender: student.gender || 'Unspecified', lrn: student.lrn || null }));
      if (!rows.length) return [];
      
      const s = await this.session();
      const { data, error } = await client.from('students').insert(rows.map(x => ({ ...x, teacher_id: s.user.id }))).select();
      if (error) throw error;
      return data;
    },

    async editStudent(studentId, changes) {
      
      const { data, error } = await client.from('students').update(changes).eq('id', studentId).select().single();
      if (error) throw error;
      return data;
    },

    async deleteStudent(studentId) {
      
      const { error } = await client.from('students').delete().eq('id', studentId);
      if (error) throw error;
    },

    async setArchived(kind, itemId, archived) {
      if (!['classes', 'exams'].includes(kind)) throw new Error('Invalid archive type.');
      
      const { data, error } = await client.from(kind).update({ is_archived: archived }).eq('id', itemId).select().single();
      if (error) throw error;
      return data;
    },

    async exams() {
      
      const { data, error } = await client.from('exams').select('*').order('created_at', { ascending: false });
      if (error) throw error;
      return data;
    },

    async createExam(payload, key = []) {
      const completeKey = Array.isArray(key)
        && key.length === Number(payload.question_count)
        && key.every(answer => Boolean(answer));
      
      const s = await this.session();
      const { data: exam, error } = await client.from('exams').insert({ ...payload, teacher_id: s.user.id }).select().single();
      if (error) throw error;
      if (completeKey) {
        const rows = key.map((answer, i) => ({ exam_id: exam.id, question_number: i + 1, correct_answer: answer }));
        const keyInsert = await client.from('exam_keys').insert(rows);
        if (keyInsert.error) throw keyInsert.error;
      }
      return exam;
    },

    async updateExam(examId, payload) {
      
      const { data, error } = await client.from('exams').update(payload).eq('id', examId).select().single();
      if (error) throw error;
      return data;
    },

    async deleteExam(examId) {
      
      // Remove stored scan images for this exam first, when scan storage is enabled.
      const scans = await client.from('results').select('scan_path').eq('exam_id', examId);
      if (!scans.error) {
        const paths = (scans.data || []).map(x => x.scan_path).filter(Boolean);
        if (paths.length) await client.storage.from(cfg.storageBucket || 'gradedock-scans').remove(paths);
      }
      const { error } = await client.from('exams').delete().eq('id', examId);
      if (error) throw error;
      return true;
    },

    async replaceExamKey(examId, key = []) {
      if (!Array.isArray(key) || !key.length || key.some(answer => !answer)) {
        throw new Error('The imported answer key must contain a correct answer for every item.');
      }
      
      const removed = await client.from('exam_keys').delete().eq('exam_id', examId);
      if (removed.error) throw removed.error;
      const rows = key.map((answer, i) => ({ exam_id: examId, question_number: i + 1, correct_answer: answer }));
      const inserted = await client.from('exam_keys').insert(rows);
      if (inserted.error) throw inserted.error;
      return key;
    },

    async examKey(examId) {
      
      const { data, error } = await client.from('exam_keys')
        .select('question_number,correct_answer')
        .eq('exam_id', examId)
        .order('question_number');
      if (error) throw error;
      return data.map(x => x.correct_answer);
    },

    async results() {
      
      const { data, error } = await client.from('results')
        .select('*, classes(section,name,grade_level), exams(title)')
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data.map(r => ({
        ...r,
        student_name: r.student_name || 'Unnamed student',
        exam_title: r.exams?.title || 'Exam',
        class_name: r.classes?.section || r.classes?.name || 'Unassigned',
        grade_level: r.classes?.grade_level || ''
      }));
    },

    async resultAnswers(resultId) {
      
      const { data, error } = await client.from('result_answers')
        .select('result_id,question_number,student_answer,correct_answer,is_correct,status')
        .eq('result_id', resultId)
        .order('question_number');
      if (error) throw error;
      return data || [];
    },

    async updateResultAnswers(resultId, answers) {
      const normalized = (answers || []).map(a => ({
        result_id: resultId,
        question_number: Number(a.question_number ?? a.question),
        student_answer: a.student_answer ?? a.answer ?? null,
        correct_answer: a.correct_answer ?? a.key ?? null,
        is_correct: Boolean(a.is_correct ?? a.isCorrect),
        status: a.status ?? a.state ?? 'ok'
      }));
      if (!normalized.length) throw new Error('No saved answers were found for this result.');

      const score = normalized.filter(a => a.is_correct).length;
      const total_items = normalized.length;
      const percentage = Math.round((score / total_items) * 10000) / 100;
      const review_count = normalized.filter(a => a.status !== 'ok').length;

      

      const saved = await client.from('result_answers')
        .upsert(normalized, { onConflict: 'result_id,question_number' });
      if (saved.error) throw saved.error;

      const { data: row, error } = await client.from('results')
        .update({ score, total_items, percentage, review_count })
        .eq('id', resultId)
        .select()
        .single();
      if (error) throw error;
      return row;
    },


    async deleteResult(resultId) {
      

      const existing = await client.from('results')
        .select('id,scan_path')
        .eq('id', resultId)
        .maybeSingle();
      if (existing.error) throw existing.error;
      if (!existing.data) throw new Error('Result not found.');

      const scanPath = existing.data.scan_path || null;
      const removed = await client.from('results').delete().eq('id', resultId);
      if (removed.error) throw removed.error;

      // result_answers are removed automatically by ON DELETE CASCADE.
      // If a stored scan image exists, remove it after the database row succeeds.
      if (scanPath) {
        const storageRemoved = await client.storage
          .from(cfg.storageBucket || 'gradedock-scans')
          .remove([scanPath]);
        if (storageRemoved.error) console.warn('Could not remove stored scan image:', storageRemoved.error);
      }
      return true;
    },

    async saveResult(payload, answers, imageBlob) {
      

      const s = await this.session();
      let scan_path = null;
      if (imageBlob && localStorage.getItem('gradedock_store_scans') === '1') {
        const file = `${s.user.id}/${payload.exam_id}/${Date.now()}.jpg`;
        const upload = await client.storage.from(cfg.storageBucket || 'gradedock-scans')
          .upload(file, imageBlob, { contentType: 'image/jpeg', upsert: false });
        if (!upload.error) scan_path = file;
      }

      const { data: row, error } = await client.from('results')
        .insert({ ...payload, teacher_id: s.user.id, scan_path })
        .select()
        .single();
      if (error) throw error;

      const answerRows = answers.map(a => ({
        result_id: row.id,
        question_number: a.question,
        student_answer: a.answer || null,
        correct_answer: a.key || null,
        is_correct: a.isCorrect,
        status: a.state
      }));
      const q = await client.from('result_answers').insert(answerRows);
      if (q.error) throw q.error;
      return row;
    }
  };

  window.GradeDockStore = Store;
})();
