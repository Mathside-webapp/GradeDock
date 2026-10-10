(function () {
  const $ = s => document.querySelector(s);
  const $$ = s => [...document.querySelectorAll(s)];
  const Store = window.GradeDockStore;

  const state = {
    user: null,
    classes: [],
    exams: [],
    students: [],
    results: [],
    scan: null,
    scanImageBlob: null,
    currentPage: 'dashboard'
  };

  let cameraAssistTimer = null;
  let cameraAssistBusy = false;
  let cameraAssistLastState = '';

  const subtitles = {
    dashboard: 'Overview of your classes and assessments',
    classes: 'Organize grade levels and sections',
    exams: 'Create assessments, keys, and downloadable answer sheets',
    scan: 'Choose a section, then capture or upload an answer sheet',
    results: 'Review scores organized by section/class',
    analytics: 'See performance patterns across assessments',
    archives: 'Archived classes and exams can be restored anytime',
    settings: 'Profile, connection, and scanning preferences'
  };

  const esc = s => String(s ?? '').replace(/[&<>"']/g, m => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;'
  }[m]));

  function classLabel(c) {
    if (!c) return 'Unassigned';
    return c.section || c.name || 'Section';
  }

  function resultClassLabel(r) {
    if (r.class_name) return r.class_name;
    return classLabel(state.classes.find(c => c.id === r.class_id));
  }

  function examTitle(id) {
    return state.exams.find(e => e.id === id)?.title || 'Exam';
  }

  function toast(message, type = 'ok') {
    const el = document.createElement('div');
    el.className = `toast ${type}`;
    el.textContent = message;
    $('#toastHost').appendChild(el);
    setTimeout(() => el.remove(), 3500);
  }

  function modal(html) {
    $('#modalHost').innerHTML = `<div class="modal-backdrop"><div class="modal-card">${html}</div></div>`;
    $('.modal-backdrop').addEventListener('click', e => {
      if (e.target === e.currentTarget) closeModal();
    });
    $$('[data-close-modal]').forEach(b => b.onclick = closeModal);
  }

  function closeModal() { $('#modalHost').innerHTML = ''; }

  function processModal(title, message, icon = 'GD') {
    $('#modalHost').innerHTML = `<div class="modal-backdrop process-backdrop"><div class="modal-card process-card" role="status" aria-live="polite">
      <div class="process-animation"><span class="process-logo">${esc(icon)}</span><i></i><i></i><i></i></div>
      <h3>${esc(title)}</h3><p>${esc(message)}</p>
    </div></div>`;
  }

  function successModal(title, message, detail = '', buttonLabel = 'Done', onDone = null) {
    modal(`<div class="success-process-card">
      <div class="success-checkmark">✓</div>
      <span class="kicker">GRADEDock</span>
      <h3>${esc(title)}</h3><p>${esc(message)}</p>
      ${detail ? `<div class="success-process-detail">${esc(detail)}</div>` : ''}
      <div class="modal-actions"><button type="button" id="successProcessDone" class="btn btn-primary">${esc(buttonLabel)}</button></div>
    </div>`);
    $('#successProcessDone').onclick = () => { closeModal(); if (typeof onDone === 'function') onDone(); };
  }

  function go(page) {
    if (page !== 'scan' && state.currentPage === 'scan') {
      stopCameraAssist();
      window.GradeDockScanner?.stopCamera?.($('#cameraVideo'));
      $('#cameraPlaceholder')?.classList.remove('hidden');
      if ($('#captureBtn')) $('#captureBtn').disabled = true;
    }
    state.currentPage = page;
    $$('.page').forEach(x => x.classList.remove('active'));
    $(`#page-${page}`).classList.add('active');
    $$('.nav-item[data-page]').forEach(x => x.classList.toggle('active', x.dataset.page === page));
    $('#pageTitle').textContent = page[0].toUpperCase() + page.slice(1);
    $('#pageSubtitle').textContent = subtitles[page] || '';
    $('#sidebar').classList.remove('open');
    if (page === 'scan') populateScanSelectors();
  }

  async function refresh() {
    state.user = await Store.user();
    state.classes = await Store.classes();
    state.exams = await Store.exams();
    state.students = await Store.students();
    state.results = await Store.results();
    renderAll();
  }

  function renderAll() {
    const u = state.user || {};
    $('#userName').textContent = u.full_name || 'Teacher';
    $('#userEmail').textContent = u.email || '';
    $('#userAvatar').textContent = (u.full_name || 'T')[0].toUpperCase();
    $('#welcomeTitle').textContent = `Good day, ${(u.full_name || 'Teacher').split(' ')[0]}.`;
    const modeBadge = $('#modeBadge');
    if (modeBadge) modeBadge.textContent = Store.demo ? 'Demo mode' : 'Supabase connected';
    renderDashboard();
    renderClasses();
    renderExams();
    renderArchives();
    renderResults();
    renderAnalytics();
    renderSettings();
    populateScanSelectors();
  }

  function emptyMini(heading, text) {
    return `<div class="empty-mini"><strong>${heading}</strong><span>${text}</span></div>`;
  }

  function renderDashboard() {
    const avg = state.results.length
      ? Math.round(state.results.reduce((a, b) => a + Number(b.percentage || 0), 0) / state.results.length)
      : 0;

    $('#statGrid').innerHTML = [
      ['Classes', state.classes.filter(c => !c.is_archived).length, '▦'],
      ['Exams', state.exams.filter(e => !e.is_archived).length, '▤'],
      ['Scanned papers', state.results.length, '⌗'],
      ['Average score', `${avg}%`, '↗']
    ].map(([label, value, icon]) => `
      <div class="stat-card"><span class="stat-icon">${icon}</span><div><small>${label}</small><strong>${value}</strong></div></div>
    `).join('');

    $('#recentExams').innerHTML = state.exams.filter(e => !e.is_archived).slice(0, 4).map(e => examRow(e, true)).join('') ||
      emptyMini('No exams yet', 'Create your first assessment.');

    $('#recentResults').innerHTML = state.results.slice(0, 5).map(r => `
      <div class="result-mini"><div><strong>${esc(r.student_name || 'Unnamed student')}</strong><small>${esc(examTitle(r.exam_id))} • ${esc(resultClassLabel(r))}</small></div><b>${r.score}/${r.total_items}</b></div>
    `).join('') || emptyMini('No results yet', 'Scan a paper to generate your first score.');
  }

  function renderClasses() {
    const q = ($('#classSearch')?.value || '').toLowerCase();
    const list = state.classes.filter(c => !c.is_archived).filter(c => `${classLabel(c)} ${c.grade_level || ''} ${c.school_year || ''}`.toLowerCase().includes(q));

    $('#classesGrid').innerHTML = list.map(c => {
      const scans = state.results.filter(r => r.class_id === c.id).length;
      const students = state.students.filter(s => s.class_id === c.id).length;
      return `
        <article class="class-card" data-class="${c.id}">
          <div class="class-color"></div>
          <span class="kicker">GRADE ${esc(c.grade_level || '—')}</span>
          <h3>${esc(classLabel(c))}</h3>
          <p>${esc(c.school_year || 'School year not set')}</p>
          <div class="class-meta"><span>${students} student${students === 1 ? '' : 's'}</span><span>${scans} result${scans === 1 ? '' : 's'}</span></div>
          <div class="gd-flex-buttons"><button class="btn btn-soft" data-open-class="${c.id}">Open class</button><button class="btn btn-soft" data-archive-class="${c.id}">Archive</button></div>
        </article>`;
    }).join('') || `<div class="empty-state"><span>▦</span><h4>No classes found</h4><p>Create a grade level and section to organize scan results.</p></div>`;

    $$('[data-open-class]').forEach(b => b.onclick = () => openClass(b.dataset.openClass));
    $$('[data-archive-class]').forEach(b => b.onclick = () => archiveItem('classes', b.dataset.archiveClass));
  }

  function examRow(exam, compact = false) {
    const count = state.results.filter(r => r.exam_id === exam.id).length;
    const pdfLabel = compact ? '⇩ PDF' : '⇩ Answer Sheet PDF';
    const pngLabel = compact ? '⇩ PNG' : '⇩ Answer Sheet Image';
    const keyLabel = compact ? '✎ Key' : '✎ Set / Update Answer Key';
    const scanLabel = compact ? '⌗ Scan' : '⌗ Scan Papers';
    return `
      <div class="exam-row">
        <div class="exam-icon">${exam.question_count}</div>
        <div class="exam-main"><strong>${esc(exam.title)}</strong><small>${exam.question_count} items • A–${String.fromCharCode(64 + Number(exam.choice_count || 4))} • ${count} scan${count === 1 ? '' : 's'}</small></div>
        ${compact ? '' : '<span class="muted">Answer sheet available anytime</span>'}
        <div class="row-actions exam-actions">
          <button class="mini-action sheet-download-action" data-sheet-pdf="${exam.id}" title="Download scanner-ready answer sheet as PDF">${pdfLabel}</button>
          <button class="mini-action" data-sheet-png="${exam.id}" title="Download scanner-ready answer sheet as PNG image">${pngLabel}</button>
          <button class="mini-action" data-manage-key="${exam.id}" title="Enter, import, or replace the answer key">${keyLabel}</button>
          <button class="mini-action" data-scan-exam="${exam.id}" title="Scan this exam">${scanLabel}</button>
          ${compact ? '' : `<button class="mini-action" data-archive-exam="${exam.id}">Archive</button><button class="mini-action danger-action" data-delete-exam="${exam.id}" title="Delete this exam">Delete</button>`}
        </div>
      </div>`;
  }

  function bindExamRowActions() {
    $$('[data-sheet-pdf]').forEach(b => b.onclick = () => downloadSheetPdf(b.dataset.sheetPdf));
    $$('[data-sheet-png]').forEach(b => b.onclick = () => downloadSheetPng(b.dataset.sheetPng));
    $$('[data-manage-key]').forEach(b => b.onclick = () => manageExamKey(b.dataset.manageKey));
    $$('[data-delete-exam]').forEach(b => b.onclick = () => confirmDeleteExam(b.dataset.deleteExam));
    $$('[data-archive-exam]').forEach(b => b.onclick = () => archiveItem('exams', b.dataset.archiveExam));
    $$('[data-scan-exam]').forEach(b => b.onclick = () => {
      go('scan');
      $('#scanExam').value = b.dataset.scanExam;
      $('#scanStatusText').textContent = 'Choose the section that this paper belongs to, then scan it.';
    });
  }

  function renderExams() {
    const q = ($('#examSearch')?.value || '').toLowerCase();
    $('#examList').innerHTML = state.exams
      .filter(e => !e.is_archived)
      .filter(e => e.title.toLowerCase().includes(q))
      .map(e => examRow(e))
      .join('') || `<div class="empty-state"><span>▤</span><h4>No exams found</h4><p>Create an exam first to download its scanner-ready answer sheet. The correct answers can be added later.</p></div>`;
    bindExamRowActions();
  }

  function renderResults() {
    const classFilter = $('#resultClassFilter');
    const examFilter = $('#resultExamFilter');

    if (classFilter) {
      const current = classFilter.value;
      classFilter.innerHTML = '<option value="">All sections</option>' + state.classes.map(c =>
        `<option value="${c.id}">Grade ${esc(c.grade_level || '—')} • ${esc(classLabel(c))}</option>`
      ).join('');
      if (state.classes.some(c => c.id === current)) classFilter.value = current;
    }

    if (examFilter) {
      const current = examFilter.value;
      examFilter.innerHTML = '<option value="">All exams</option>' + state.exams.map(e =>
        `<option value="${e.id}">${esc(e.title)}</option>`
      ).join('');
      if (state.exams.some(e => e.id === current)) examFilter.value = current;
    }

    const filtered = state.results.filter(r =>
      (!classFilter?.value || r.class_id === classFilter.value) &&
      (!examFilter?.value || r.exam_id === examFilter.value)
    );

    const groups = new Map();
    filtered.forEach(r => {
      const key = r.class_id || 'unassigned';
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(r);
    });

    const order = [...state.classes.map(c => c.id), 'unassigned'];
    const html = order.filter(id => groups.has(id)).map(id => {
      const rows = groups.get(id);
      const cls = state.classes.find(c => c.id === id);
      const title = cls ? classLabel(cls) : 'Unassigned';
      const grade = cls?.grade_level ? `Grade ${cls.grade_level}` : 'Section';
      return `
        <section class="panel results-section">
          <div class="panel-head"><div><span class="kicker">${esc(grade)}</span><h3>${esc(title)}</h3><p>${rows.length} result${rows.length === 1 ? '' : 's'} in this section</p></div></div>
          <div class="table-wrap"><table><thead><tr><th>Student</th><th>Exam</th><th>Score</th><th>Percentage</th><th>Review</th><th>Date</th><th>Actions</th></tr></thead><tbody>
            ${rows.map(r => `<tr><td><strong>${esc(r.student_name || 'Unnamed student')}</strong></td><td>${esc(examTitle(r.exam_id))}</td><td><b>${r.score}/${r.total_items}</b></td><td>${r.percentage}%</td><td>${r.review_count ? `<span class="badge warn">${r.review_count} review</span>` : '<span class="badge good">Clear</span>'}</td><td>${new Date(r.created_at).toLocaleDateString()}</td><td><div class="result-actions"><button class="mini-action result-edit-btn" data-edit-result="${r.id}">Preview / Edit</button><button class="mini-action danger-action" data-delete-result="${r.id}">Delete</button></div></td></tr>`).join('')}
          </tbody></table></div>
        </section>`;
    }).join('');

    $('#resultsGroups').innerHTML = html || `<section class="panel"><div class="empty-state"><span>✓</span><h4>No results</h4><p>Scanned papers will be grouped here by section/class.</p></div></section>`;
    $$('[data-edit-result]').forEach(b => b.onclick = () => openResultEditor(b.dataset.editResult));
    $$('[data-delete-result]').forEach(b => b.onclick = () => openDeleteResult(b.dataset.deleteResult));
  }

  function openDeleteResult(resultId) {
    const result = state.results.find(r => r.id === resultId);
    if (!result) return;
    modal(`
      <div class="modal-head"><div><span class="kicker danger-text">DELETE RESULT</span><h3>${esc(result.student_name || 'Unnamed student')}</h3><p>${esc(examTitle(result.exam_id))} • ${esc(resultClassLabel(result))}</p></div><button class="icon-btn" data-close-modal>✕</button></div>
      <div class="delete-warning">This permanently deletes this student's saved score, answer details, and its stored scan image if one was saved.</div>
      <div class="modal-actions"><button type="button" class="btn btn-soft" data-close-modal>Cancel</button><button type="button" id="confirmDeleteResultBtn" class="btn btn-danger">Delete result</button></div>`);

    $('#confirmDeleteResultBtn').onclick = async () => {
      const btn = $('#confirmDeleteResultBtn');
      btn.disabled = true;
      btn.textContent = 'Deleting…';
      processModal('Deleting result…', `Removing ${result.student_name || 'this student'}'s saved scan result.`, '×');
      try {
        await Store.deleteResult(resultId);
        await refresh();
        successModal('Result deleted', `${result.student_name || 'The student'}'s scan result was removed.`);
      } catch (err) {
        closeModal();
        toast(Store.friendlyError ? Store.friendlyError(err) : err.message, 'warn');
      }
    };
  }

  async function openResultEditor(resultId) {
    const result = state.results.find(r => r.id === resultId);
    if (!result) return;
    const exam = state.exams.find(e => e.id === result.exam_id);
    const choiceCount = Number(exam?.choice_count || 4);

    modal(`
      <div class="modal-head"><div><span class="kicker">RESULT DETAILS</span><h3>${esc(result.student_name || 'Unnamed student')}</h3><p>${esc(examTitle(result.exam_id))} • ${esc(resultClassLabel(result))}</p></div><button class="icon-btn" data-close-modal>✕</button></div>
      <div class="result-editor-loading">Loading saved answers…</div>`);

    try {
      const saved = await Store.resultAnswers(resultId);
      if (!saved.length) throw new Error('No saved answer details were found for this result.');
      const answers = saved.map(a => ({
        question_number: Number(a.question_number),
        student_answer: a.student_answer || '',
        correct_answer: a.correct_answer || '',
        is_correct: Boolean(a.is_correct),
        status: a.status || 'ok'
      }));

      const answerRows = () => answers.map(a => {
        const options = ['', ...Array.from({ length: choiceCount }, (_, i) => String.fromCharCode(65 + i))]
          .map(v => `<option value="${v}" ${v === a.student_answer ? 'selected' : ''}>${v || 'Blank'}</option>`).join('');
        return `<div class="saved-answer-row ${a.is_correct ? 'is-correct' : 'is-wrong'}">
          <b>${a.question_number}</b>
          <select data-saved-answer="${a.question_number}">${options}</select>
          <span>Key: <strong>${esc(a.correct_answer || '—')}</strong></span>
          <em data-saved-status="${a.question_number}">${a.student_answer ? (a.is_correct ? 'Correct' : 'Incorrect') : 'Blank'}</em>
        </div>`;
      }).join('');

      modal(`
        <div class="modal-head"><div><span class="kicker">RESULT DETAILS</span><h3>${esc(result.student_name || 'Unnamed student')}</h3><p>${esc(examTitle(result.exam_id))} • ${esc(resultClassLabel(result))}</p></div><button class="icon-btn" data-close-modal>✕</button></div>
        <div class="result-editor-summary">
          <div><small>SCORE</small><strong id="savedResultScore">${result.score}/${result.total_items}</strong></div>
          <div><small>PERCENTAGE</small><strong id="savedResultPct">${result.percentage}%</strong></div>
          <div><small>SECTION</small><strong>${esc(resultClassLabel(result))}</strong></div>
        </div>
        <div class="result-editor-note">Preview every detected response below. Change any answer that the camera read incorrectly, then save.</div>
        <div class="saved-answer-grid">${answerRows()}</div>
        <div class="modal-actions result-editor-actions"><button type="button" class="btn btn-soft" data-close-modal>Cancel</button><button type="button" id="saveResultEditsBtn" class="btn btn-primary">Save answer changes</button></div>`);

      const recalc = () => {
        const score = answers.filter(a => a.is_correct).length;
        const pct = Math.round((score / answers.length) * 10000) / 100;
        $('#savedResultScore').textContent = `${score}/${answers.length}`;
        $('#savedResultPct').textContent = `${pct}%`;
      };

      $$('[data-saved-answer]').forEach(sel => sel.onchange = () => {
        const answer = answers.find(a => a.question_number === Number(sel.dataset.savedAnswer));
        if (!answer) return;
        answer.student_answer = sel.value;
        answer.status = sel.value ? 'ok' : 'blank';
        answer.is_correct = Boolean(sel.value) && sel.value === answer.correct_answer;
        const row = sel.closest('.saved-answer-row');
        row.classList.toggle('is-correct', answer.is_correct);
        row.classList.toggle('is-wrong', !answer.is_correct);
        const status = row.querySelector(`[data-saved-status="${answer.question_number}"]`);
        if (status) status.textContent = answer.student_answer ? (answer.is_correct ? 'Correct' : 'Incorrect') : 'Blank';
        recalc();
      });

      $('#saveResultEditsBtn').onclick = async () => {
        const btn = $('#saveResultEditsBtn');
        btn.disabled = true;
        btn.textContent = 'Saving…';
        try {
          await Store.updateResultAnswers(resultId, answers);
          closeModal();
          await refresh();
          toast('Student answers and score updated');
        } catch (err) {
          btn.disabled = false;
          btn.textContent = 'Save answer changes';
          toast(Store.friendlyError ? Store.friendlyError(err) : err.message, 'warn');
        }
      };
    } catch (err) {
      modal(`
        <div class="modal-head"><div><span class="kicker">RESULT DETAILS</span><h3>${esc(result.student_name || 'Unnamed student')}</h3><p>${esc(examTitle(result.exam_id))} • ${esc(resultClassLabel(result))}</p></div><button class="icon-btn" data-close-modal>✕</button></div>
        <div class="delete-warning">${esc(Store.friendlyError ? Store.friendlyError(err) : err.message)}</div>`);
    }
  }

  function renderAnalytics() {
    const avg = state.results.length
      ? Math.round(state.results.reduce((a, b) => a + Number(b.percentage || 0), 0) / state.results.length)
      : 0;
    const clear = state.results.filter(r => !r.review_count).length;

    $('#analyticsStats').innerHTML = [
      ['Average', `${avg}%`, '↗'],
      ['Results', state.results.length, '✓'],
      ['Clear scans', clear, '●'],
      ['Needs review', state.results.length - clear, '!']
    ].map(([label, value, icon]) => `<div class="stat-card"><span class="stat-icon">${icon}</span><div><small>${label}</small><strong>${value}</strong></div></div>`).join('');

    const byExam = state.exams.map(e => {
      const rs = state.results.filter(r => r.exam_id === e.id);
      const average = rs.length ? Math.round(rs.reduce((x, y) => x + Number(y.percentage || 0), 0) / rs.length) : 0;
      return { e, average, n: rs.length };
    }).filter(x => x.n);

    $('#examBars').innerHTML = byExam.map(x => `
      <div class="bar-row"><div><strong>${esc(x.e.title)}</strong><small>${x.n} result${x.n === 1 ? '' : 's'}</small></div><div class="bar-track"><i style="width:${x.average}%"></i></div><b>${x.average}%</b></div>
    `).join('') || emptyMini('No analytics yet', 'Scan answer sheets to build performance data.');

    const buckets = [['90–100', 0], ['80–89', 0], ['70–79', 0], ['Below 70', 0]];
    state.results.forEach(r => {
      const p = Number(r.percentage);
      if (p >= 90) buckets[0][1]++;
      else if (p >= 80) buckets[1][1]++;
      else if (p >= 70) buckets[2][1]++;
      else buckets[3][1]++;
    });
    $('#distribution').innerHTML = buckets.map(([label, n]) => `<div class="dist-row"><span>${label}</span><div class="dots">${Array.from({ length: n }, () => '<i></i>').join('')}</div><b>${n}</b></div>`).join('');

    const analysisExam = $('#itemAnalysisExam');
    const analysisClass = $('#itemAnalysisClass');
    if (analysisExam) {
      const current = analysisExam.value;
      analysisExam.innerHTML = '<option value="">Choose an exam…</option>' + state.exams.map(e => `<option value="${e.id}">${esc(e.title)}</option>`).join('');
      if (state.exams.some(e => e.id === current)) analysisExam.value = current;
    }
    if (analysisClass) {
      const current = analysisClass.value;
      analysisClass.innerHTML = '<option value="">All sections</option>' + state.classes.map(c => `<option value="${c.id}">Grade ${esc(c.grade_level || '—')} • ${esc(classLabel(c))}</option>`).join('');
      if (state.classes.some(c => c.id === current)) analysisClass.value = current;
    }
  }

  function renderSettings() {
    $('#profileName').value = state.user?.full_name || '';
    $('#profileSchool').value = state.user?.school_name || '';
    $('#storeScansToggle').checked = localStorage.getItem('gradedock_store_scans') === '1';
    $('#connectionCard').innerHTML = Store.demo
      ? `<div class="connection demo"><strong>Demo mode</strong><p>Data is stored only in this browser. To enable accounts and cloud storage, configure <code>js/config.js</code> and run the SQL setup.</p></div>`
      : `<div class="connection live"><strong>Supabase connected</strong><p>Authentication and teacher-owned classes, exams, answer keys, and results are using your configured Supabase project.</p></div>`;
  }

  function newClass() {
    modal(`
      <div class="modal-head"><div><h3>Create class</h3><p>Create a grade level and section. The section is the class name shown throughout GradeDock.</p></div><button class="icon-btn" data-close-modal>✕</button></div>
      <form id="classForm" class="form-stack">
        <div class="form-grid two compact-grid">
          <label>Grade level<input name="grade_level" required placeholder="9"></label>
          <label>Section<input name="section" required placeholder="Cobalt"></label>
        </div>
        <label>School year<input name="school_year" placeholder="2026-2027"></label>
        <div class="modal-actions"><button type="button" class="btn btn-soft" data-close-modal>Cancel</button><button class="btn btn-primary">Create class</button></div>
      </form>`);

    $('#classForm').onsubmit = async e => {
      e.preventDefault();
      const payload = Object.fromEntries(new FormData(e.target));
      payload.name = payload.section;
      processModal('Creating class…', `Setting up ${payload.section || 'your class'} and saving it to GradeDock.`);
      try {
        await Store.createClass(payload);
        await refresh();
        successModal('Class created', `${payload.section || 'Your class'} is ready.`, payload.grade_level ? `Grade ${payload.grade_level}` : '');
      } catch (err) {
        closeModal();
        toast(Store.friendlyError ? Store.friendlyError(err) : err.message, 'warn');
      }
    };
  }

  function openClass(id) {
    const c = state.classes.find(x => x.id === id);
    const rows = state.results.filter(r => r.class_id === id).slice(0, 8);
    const students = state.students.filter(s => s.class_id === id);
    modal(`
      <div class="modal-head"><div><span class="kicker">GRADE ${esc(c?.grade_level || '—')}</span><h3>${esc(classLabel(c))}</h3><p>${esc(c?.school_year || 'School year not set')}</p></div><button class="icon-btn" data-close-modal>✕</button></div>
      <div class="class-summary-strip"><div><small>Saved results</small><strong>${state.results.filter(r => r.class_id === id).length}</strong></div><div><small>Section</small><strong>${esc(classLabel(c))}</strong></div></div>
      <div class="gd-roster-actions"><strong>Student roster (${students.length})</strong><button type="button" class="btn btn-primary" id="manageRosterBtn">Manage students</button></div>
      <div class="gd-roster-preview">${students.length ? students.slice(0, 6).map(s => `<span>${esc(s.full_name)}</span>`).join('') : '<small>No students added yet</small>'}</div>
      <div class="class-results-preview">
        ${rows.length ? rows.map(r => `<div class="class-result-row"><div><strong>${esc(r.student_name || 'Unnamed student')}</strong><small>${esc(examTitle(r.exam_id))}</small></div><b>${r.score}/${r.total_items}</b></div>`).join('') : emptyMini('No results yet', 'Select this section when scanning papers and its results will appear here.')}
      </div>`);
    $('#manageRosterBtn').onclick = () => manageRoster(id);
  }

  function archiveItem(kind, id) {
    const thing = (kind === 'classes' ? state.classes : state.exams).find(x => x.id === id);
    if (!thing) return;
    const label = kind === 'classes' ? classLabel(thing) : thing.title;
    modal(`<div class="gd-dialog"><h3>Archive ${kind === 'classes' ? 'class' : 'exam'}?</h3><p>${esc(label)} will move to Archives. Its existing results and data will be preserved. You can restore it later.</p><div class="modal-actions"><button class="btn btn-soft" data-close-modal>Cancel</button><button id="archiveYes" class="btn btn-primary">Archive</button></div></div>`);
    $('#archiveYes').onclick = async () => {
      try { await Store.setArchived(kind, id, true); closeModal(); await refresh(); toast('Moved to Archives'); }
      catch (e) { closeModal(); toast(Store.friendlyError(e), 'warn'); }
    };
  }

  async function restoreItem(kind, id) {
    try { await Store.setArchived(kind, id, false); await refresh(); toast('Restored successfully'); }
    catch (e) { toast(Store.friendlyError(e), 'warn'); }
  }

  function renderArchives() {
    const classes = state.classes.filter(c => c.is_archived);
    const exams = state.exams.filter(e => e.is_archived);
    $('#archivedClasses').innerHTML = classes.map(c => `<div class="gd-archive-row"><div><strong>${esc(classLabel(c))}</strong><small>Grade ${esc(c.grade_level || '—')} · ${state.students.filter(s => s.class_id === c.id).length} students</small></div><button class="btn btn-soft" data-restore-class="${c.id}">Restore class</button></div>`).join('') || emptyMini('No archived classes', 'Classes you archive will appear here.');
    $('#archivedExams').innerHTML = exams.map(e => `<div class="gd-archive-row"><div><strong>${esc(e.title)}</strong><small>${e.question_count} questions · ${state.results.filter(r => r.exam_id === e.id).length} saved results</small></div><button class="btn btn-soft" data-restore-exam="${e.id}">Restore exam</button></div>`).join('') || emptyMini('No archived exams', 'Exams you archive will appear here.');
    $$('[data-restore-class]').forEach(b => b.onclick = () => restoreItem('classes', b.dataset.restoreClass));
    $$('[data-restore-exam]').forEach(b => b.onclick = () => restoreItem('exams', b.dataset.restoreExam));
  }

  function manageRoster(classId) {
    const cls = state.classes.find(c => c.id === classId);
    const students = state.students.filter(s => s.class_id === classId).sort((a,b) => (({Male:0,Female:1,Unspecified:2})[a.gender] ?? 2) - (({Male:0,Female:1,Unspecified:2})[b.gender] ?? 2) || a.full_name.localeCompare(b.full_name));
    modal(`<div class="modal-head"><div><h3>Students · ${esc(classLabel(cls))}</h3><p>Add students individually or import an SF1 Excel file. Male and Female groups are detected automatically from SF1; no gender column is required.</p></div><button class="icon-btn" data-close-modal>✕</button></div>
      <div class="gd-roster-top"><form id="addRosterForm" class="form-stack">
        <label>Student name<input name="name" required placeholder="Surname, First Name"></label>
        <div class="form-grid two compact-grid"><label>Gender<select name="gender"><option value="Male">Male</option><option value="Female">Female</option><option value="Unspecified">Unspecified</option></select></label><label>LRN (optional)<input name="lrn" placeholder="Optional"></label></div>
        <button class="btn btn-primary">+ Add student</button>
      </form><div class="gd-sf1-import"><strong>Import DepEd School Form 1 (SF1)</strong><p>Choose your SF1 Excel file. GradeDock reads the names, LRNs, and Male/Female entries automatically. Check the preview, then add the students to this class.</p><input id="gdSF1Input" type="file" accept=".xls,.xlsx,.csv,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv"><small id="gdSF1Info" role="status" aria-live="polite">Select a file to preview the students.</small><div id="gdSF1Preview" class="gd-sf1-preview" hidden></div><button type="button" class="btn btn-primary" id="gdSF1Import" disabled>Import students</button><a class="gd-sf1-template-link" href="templates/GradeDock-Student-Import-Template.xlsx" download>Download a simple Excel template</a></div></div>
      <div class="gd-roster-heading">${students.length} students</div>
      <div class="student-list">${students.map((s,i) => `<div><small>${i+1}</small><div><strong>${esc(s.full_name)}</strong><small>${esc(s.gender)}${s.lrn ? ' · LRN '+esc(s.lrn) : ''}</small></div><div class="row-actions"><button class="mini-action" data-edit-student="${s.id}">Edit</button><button class="mini-action danger-action" data-remove-student="${s.id}">Delete</button></div></div>`).join('') || emptyMini('No students yet','Add names above to start your roster.')}</div>`);
    $('#addRosterForm').onsubmit = async ev => {
      ev.preventDefault(); const f = new FormData(ev.target);
      try { await Store.addStudents(classId, [{full_name:String(f.get('name')).trim(), gender:f.get('gender'), lrn:String(f.get('lrn')).trim()}]); await refresh(); manageRoster(classId); toast('Student added'); }
      catch(e) { toast(Store.friendlyError(e),'warn'); }
    };
    // Two-stage import: reading an Excel file never writes student records.
    // The teacher reviews the roster, then clicks Import to save it.
    let sf1Preview = null;
    const sf1File = $('#gdSF1Input');
    const sf1Button = $('#gdSF1Import');
    const sf1Info = $('#gdSF1Info');
    const sf1Panel = $('#gdSF1Preview');
    sf1File.onchange = async () => {
      sf1Preview = null;
      sf1Button.disabled = true;
      sf1Button.textContent = 'Import students';
      sf1Panel.hidden = true;
      sf1Panel.innerHTML = '';
      const file=sf1File.files?.[0];
      if(!file){sf1Info.textContent='Select an Excel file to preview students.';return;}
      sf1Info.textContent = `Reading ${file.name}…`;
      try {
        const parsed = await window.GradeDockRosterImport.read(file, students);
        const records=parsed.students;
        if(!records.length) throw new Error('No new student records found. Check whether these students are already in the class or whether the file contains a valid LRN and Name column.');
        const males=records.filter(x=>x.gender==='Male').length;
        const females=records.filter(x=>x.gender==='Female').length;
        const unspecified=records.filter(x=>x.gender==='Unspecified').length;
        const summaries=[`${males} male`,`${females} female`];
        if(unspecified)summaries.push(`${unspecified} unspecified`);
        sf1Info.textContent = `${parsed.format}: ${records.length} students detected (${summaries.join(', ')}). ${parsed.duplicates||0} existing/duplicate skipped.`;
        // Escape spreadsheet text before inserting it in the document.
        sf1Panel.innerHTML = `<div class="gd-sf1-summary"><strong>${records.length} students ready to import</strong><small>Male ${males} · Female ${females}${unspecified?' · Unspecified '+unspecified:''}</small></div>
          <div class="gd-sf1-preview-scroller"><table class="gd-sf1-table"><thead><tr><th>Name</th><th>Sex</th><th>LRN</th></tr></thead><tbody>${records.map(x=>`<tr><td>${esc(x.full_name)}</td><td>${esc(x.gender)}</td><td>${esc(x.lrn||'—')}</td></tr>`).join('')}</tbody></table></div>
          <small class="gd-sf1-review-note">Review before importing. These names have not yet been saved to GradeDock.</small>`;
        sf1Panel.hidden = false;
        sf1Preview = parsed;
        sf1Button.textContent = `Add ${records.length} students to ${cls?.section||'class'}`;
        sf1Button.disabled = false;
      } catch(e){
        sf1Info.textContent='Could not read this roster: '+(e.message||String(e));
        console.error('GradeDock SF1 preview:',e);
      }
    };
    sf1Button.onclick = async () => {
      if(!sf1Preview?.students?.length)return;
      const imported=sf1Preview.students;
      sf1Button.disabled = true;
      sf1File.disabled = true;
      sf1Button.textContent = 'Importing…';
      try {
        for(let i=0;i<imported.length;i+=40){
          await Store.addStudents(classId,imported.slice(i,i+40));
          sf1Info.textContent=`Saving ${Math.min(i+40,imported.length)} of ${imported.length} students…`;
        }
        await refresh();
        toast(`${imported.length} SF1 students added to ${cls?.section||'your class'}`);
        manageRoster(classId);
      } catch(e){
        sf1Info.textContent='Import failed: '+Store.friendlyError(e)+'. If some students were added, reopen the roster to review before retrying.';
        toast(Store.friendlyError(e),'warn');
        sf1Button.disabled=false;
        sf1Button.textContent = `Retry import`;
      } finally {sf1File.disabled=false;}
    };
    $$('[data-edit-student]').forEach(b => b.onclick = () => {
      const s = students.find(x => x.id === b.dataset.editStudent);
      modal(`<div class="modal-head"><h3>Edit student</h3><button class="icon-btn" data-close-modal>✕</button></div><form id="editStudentForm" class="form-stack"><label>Name<input name="full_name" required value="${esc(s.full_name)}"></label><label>Gender<select name="gender"><option value="Male" ${s.gender==='Male'?'selected':''}>Male</option><option value="Female" ${s.gender==='Female'?'selected':''}>Female</option><option value="Unspecified" ${s.gender==='Unspecified'?'selected':''}>Unspecified</option></select></label><label>LRN (optional)<input name="lrn" value="${esc(s.lrn || '')}"></label><div class="modal-actions"><button type="button" class="btn btn-soft" data-close-modal>Cancel</button><button class="btn btn-primary">Save</button></div></form>`);
      $('#editStudentForm').onsubmit = async ev => {ev.preventDefault();const f=new FormData(ev.target);try {await Store.editStudent(s.id,{full_name:String(f.get('full_name')).trim(),gender:f.get('gender'),lrn:String(f.get('lrn')).trim()||null});await refresh();manageRoster(classId);toast('Student updated');}catch(e){toast(Store.friendlyError(e),'warn');}};
    });
    $$('[data-remove-student]').forEach(b => b.onclick = () => {
      const id = b.dataset.removeStudent;
      modal(`<div class="gd-dialog"><h3>Delete student?</h3><p>This removes the student from the roster. Previously saved scan results remain unchanged.</p><div class="modal-actions"><button class="btn btn-soft" data-close-modal>Cancel</button><button class="btn btn-primary" id="confirmRemoveStudent">Delete student</button></div></div>`);
      $('#confirmRemoveStudent').onclick = async () => {try {await Store.deleteStudent(id);await refresh();manageRoster(classId);toast('Student removed');}catch(e){toast(Store.friendlyError(e),'warn');}};
    });
  }

  function newExam() {
    modal(`
      <div class="modal-head"><div><h3>Create exam</h3><p>Create the exam now to get its answer sheet. The answer key is optional and can be imported later.</p></div><button class="icon-btn" data-close-modal>✕</button></div>
      <form id="examForm" class="form-stack">
        <label>Exam title<input id="examTitleInput" name="title" required placeholder="Quarter 1 Mathematics"></label>
        <div class="form-grid two compact-grid">
          <label>Number of items<input id="qCount" name="question_count" type="number" min="5" max="50" value="40" required></label>
          <label>Choices<select id="choiceCount" name="choice_count"><option value="4">A–D</option><option value="5">A–E</option></select></label>
        </div>
        <div class="excel-key-box">
          <div><strong>Excel answer-key workflow</strong><small>Download the template, choose the item count inside Excel, fill the active yellow answer rows, then import it. GradeDock will use the item count stored in the workbook.</small></div>
          <div class="excel-key-actions"><button type="button" id="downloadKeyTemplate" class="btn btn-soft">⇩ Download Excel template</button><button type="button" id="importKeyBtn" class="btn btn-soft">⇧ Import completed Excel</button><input id="keyWorkbookInput" type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" hidden></div>
        </div>
        <div><div class="key-head"><strong>Answer key <span class="muted">(optional for now)</span></strong><span id="keyImportStatus" class="muted">Leave it blank if you only need the answer sheet first.</span></div><div id="keyGrid" class="key-grid"></div></div>
        <div class="modal-actions"><button type="button" class="btn btn-soft" data-close-modal>Cancel</button><button class="btn btn-primary">Create exam</button></div>
      </form>`);

    const examDraft = () => ({
      title: $('#examTitleInput').value.trim() || 'Untitled Exam',
      question_count: Number($('#qCount').value || 40),
      choice_count: Number($('#choiceCount').value || 4)
    });

    const draftKey = () => Array.from({ length: Number($('#qCount').value || 0) }, (_, i) =>
      document.querySelector(`[data-key-radio="${i}"]:checked`)?.value || ''
    );

    const draw = (keep = []) => {
      const n = Number($('#qCount').value);
      const c = Number($('#choiceCount').value);
      $('#keyGrid').innerHTML = Array.from({ length: n }, (_, i) => `
        <div class="radio-key-row">
          <span class="radio-key-number">${i + 1}</span>
          <div class="key-radio-options" role="radiogroup" aria-label="Correct answer for item ${i + 1}">
            ${Array.from({ length: c }, (_, j) => {
              const v = String.fromCharCode(65 + j);
              return `<label class="key-radio-choice"><input type="radio" name="create-key-${i}" data-key-radio="${i}" value="${v}" ${keep[i] === v ? 'checked' : ''}><span>${v}</span></label>`;
            }).join('')}
          </div>
          <button type="button" class="key-clear-btn" data-clear-create-key="${i}" title="Clear item ${i + 1}">Clear</button>
        </div>
      `).join('');
      $$('[data-clear-create-key]').forEach(btn => btn.onclick = () => {
        const checked = document.querySelector(`[data-key-radio="${btn.dataset.clearCreateKey}"]:checked`);
        if (checked) checked.checked = false;
      });
    };

    draw();
    $('#qCount').oninput = () => draw(draftKey());
    $('#choiceCount').onchange = () => draw(draftKey());

    $('#downloadKeyTemplate').onclick = async () => {
      try {
        await window.GradeDockExcel.downloadTemplate(examDraft(), [], state.user?.full_name || 'Teacher');
        toast('Excel answer-key template downloaded');
      } catch (err) { toast(err.message, 'warn'); }
    };

    $('#importKeyBtn').onclick = () => $('#keyWorkbookInput').click();
    $('#keyWorkbookInput').onchange = async e => {
      const file = e.target.files[0];
      if (!file) return;
      try {
        const imported = await window.GradeDockExcel.importTemplate(file);
        $('#qCount').value = imported.questionCount;
        $('#choiceCount').value = String(imported.choiceCount);
        if (imported.title && !$('#examTitleInput').value.trim()) $('#examTitleInput').value = imported.title;
        draw(imported.answers);
        $('#keyImportStatus').textContent = `Imported ${imported.answers.length} answers • ${imported.questionCount} items • A–${String.fromCharCode(64 + imported.choiceCount)} • ${file.name}`;
        toast(`Answer key imported: ${imported.questionCount} items detected`);
      } catch (err) { toast(err.message, 'warn'); }
      e.target.value = '';
    };

    $('#examForm').onsubmit = async e => {
      e.preventDefault();
      const submitBtn = e.submitter || e.target.querySelector('button[type="submit"]');
      if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = 'Creating...'; }
      try {
        const payload = Object.fromEntries(new FormData(e.target));
        delete payload.class_id;
        payload.question_count = Number(payload.question_count);
        payload.choice_count = Number(payload.choice_count);
        const key = draftKey();
        const hasCompleteKey = key.length === payload.question_count && key.every(Boolean);
        const hasPartialKey = key.some(Boolean) && !hasCompleteKey;
        processModal('Creating exam…', `Saving ${payload.title || 'your exam'} and preparing its answer-sheet tools.`);
        const createdExam = await Store.createExam(payload, hasCompleteKey ? key : []);
        await refresh();
        showExamCreatedActions(createdExam, hasCompleteKey);
        if (hasPartialKey) toast('Exam created. The incomplete key was not saved; add it later.', 'warn');
      } catch (err) {
        const message = Store.friendlyError ? Store.friendlyError(err) : (err?.message || 'Could not create the exam.');
        toast(message, 'warn');
        if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = 'Create exam'; }
      }
    };
  }


  function showExamCreatedActions(exam, hasKey = false) {
    if (!exam) return;
    modal(`
      <div class="modal-head"><div><span class="kicker">EXAM READY</span><h3>${esc(exam.title)}</h3><p>${hasKey ? 'The exam and answer key are saved.' : 'The exam is saved. You can download the answer sheet now and add the correct answers later.'}</p></div><button class="icon-btn" data-close-modal>✕</button></div>
      <div class="exam-ready-body">
        <div class="exam-ready-summary"><strong>${exam.question_count} items</strong><span>A–${String.fromCharCode(64 + Number(exam.choice_count || 4))} choices</span></div>
        <button id="createdDownloadSheetPdf" class="btn btn-primary btn-block">⇩ Download Answer Sheet PDF</button>
        <button id="createdDownloadSheetPng" class="btn btn-soft btn-block">⇩ Download Answer Sheet Image (PNG)</button>
        <button id="createdManageKey" class="btn btn-soft btn-block">✎ ${hasKey ? 'Update Answer Key' : 'Add Answer Key Later'}</button>
        <button id="createdScanPapers" class="btn btn-soft btn-block">⌗ Go to Scan Papers</button>
      </div>
      <div class="modal-actions exam-ready-actions"><button type="button" class="btn btn-soft" data-close-modal>Done</button></div>`);
    $('#createdDownloadSheetPdf').onclick = () => downloadSheetPdf(exam.id);
    $('#createdDownloadSheetPng').onclick = () => downloadSheetPng(exam.id);
    $('#createdManageKey').onclick = () => manageExamKey(exam.id);
    $('#createdScanPapers').onclick = () => {
      closeModal();
      go('scan');
      populateScanSelectors();
      $('#scanExam').value = exam.id;
      $('#scanStatusText').textContent = 'Choose the section that this paper belongs to, then scan it.';
    };
  }

  function downloadSheetPdf(id) {
    const exam = state.exams.find(x => x.id === id);
    if (!exam) return;
    window.GradeDockSheet.downloadPdf(exam, state.user?.full_name || 'Teacher');
    toast('Answer sheet PDF downloaded');
  }

  function downloadSheetPng(id) {
    const exam = state.exams.find(x => x.id === id);
    if (!exam) return;
    window.GradeDockSheet.downloadPng(exam, state.user?.full_name || 'Teacher');
    toast('Answer sheet PNG downloaded');
  }

  async function exportExamKey(id) {
    const exam = state.exams.find(x => x.id === id);
    if (!exam) return;
    try {
      const key = await Store.examKey(exam.id);
      await window.GradeDockExcel.downloadTemplate(exam, key, state.user?.full_name || 'Teacher');
      toast(key.length ? 'Answer key exported to Excel' : 'Blank answer-key template downloaded');
    } catch (err) { toast(err.message, 'warn'); }
  }

  async function manageExamKey(id) {
    const exam = state.exams.find(x => x.id === id);
    if (!exam) return;
    let currentKey = [];
    try { currentKey = await Store.examKey(exam.id); } catch (_) {}

    const manualGrid = () => Array.from({ length: Number(exam.question_count) }, (_, i) => {
      const current = currentKey[i] || '';
      return `<div class="radio-key-row">
        <span class="radio-key-number">${i + 1}</span>
        <div class="key-radio-options" role="radiogroup" aria-label="Correct answer for item ${i + 1}">
          ${Array.from({ length: Number(exam.choice_count || 4) }, (_, j) => {
            const value = String.fromCharCode(65 + j);
            return `<label class="key-radio-choice"><input type="radio" name="manual-key-${i}" data-manual-key-radio="${i}" value="${value}" ${current === value ? 'checked' : ''}><span>${value}</span></label>`;
          }).join('')}
        </div>
      </div>`;
    }).join('');

    const collectManualKey = () => Array.from({ length: Number(exam.question_count) }, (_, i) =>
      document.querySelector(`[data-manual-key-radio="${i}"]:checked`)?.value || ''
    );

    modal(`
      <div class="modal-head"><div><span class="kicker">ANSWER KEY</span><h3>${esc(exam.title)}</h3><p>Enter the correct answers manually, or use the Excel template. A complete key is only required when you are ready to scan and score papers.</p></div><button class="icon-btn" data-close-modal>✕</button></div>
      <div class="exam-ready-body key-manager-body">
        <div class="exam-ready-summary"><strong>${currentKey.length === Number(exam.question_count) && currentKey.every(Boolean) ? 'Key ready' : 'No complete key yet'}</strong><span>${exam.question_count} items • A-${String.fromCharCode(64 + Number(exam.choice_count || 4))}</span></div>
        <div class="manual-key-section">
          <div class="key-head"><strong>Manual answer key</strong><span class="muted">Choose one answer for every item, then save.</span></div>
          <div class="key-grid manual-key-grid">${manualGrid()}</div>
          <button id="saveManualKey" class="btn btn-primary btn-block">Save Manual Answer Key</button>
        </div>
        <div class="key-divider"><span>or use Excel</span></div>
        <button id="manageDownloadKey" class="btn btn-soft btn-block">⇩ Download Excel Answer-Key Template</button>
        <button id="manageUploadKey" class="btn btn-soft btn-block">⇧ Upload Completed Excel Key</button>
        <input id="manageKeyFile" type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" hidden>
      </div>
      <div class="modal-actions"><button type="button" class="btn btn-soft" data-close-modal>Close</button></div>`);

    $('#saveManualKey').onclick = async () => {
      const key = collectManualKey();
      if (key.length !== Number(exam.question_count) || key.some(x => !x)) {
        toast('Choose a correct answer for every item before saving the manual key.', 'warn');
        return;
      }
      try {
        await Store.replaceExamKey(exam.id, key);
        closeModal();
        await refresh();
        toast('Manual answer key saved');
      } catch (err) {
        toast(Store.friendlyError ? Store.friendlyError(err) : err.message, 'warn');
      }
    };

    $('#manageDownloadKey').onclick = async () => {
      try { await window.GradeDockExcel.downloadTemplate(exam, currentKey, state.user?.full_name || 'Teacher'); }
      catch (err) { toast(err.message, 'warn'); }
    };
    $('#manageUploadKey').onclick = () => $('#manageKeyFile').click();
    $('#manageKeyFile').onchange = async e => {
      const file = e.target.files[0];
      if (!file) return;
      try {
        const imported = await window.GradeDockExcel.importTemplate(file);
        if (imported.answers.length !== imported.questionCount || imported.answers.some(x => !x)) {
          throw new Error('Complete every active Correct Answer row in the Excel file before uploading it.');
        }
        await Store.updateExam(exam.id, {
          question_count: imported.questionCount,
          choice_count: imported.choiceCount,
          ...(imported.title ? { title: imported.title } : {})
        });
        await Store.replaceExamKey(exam.id, imported.answers);
        closeModal();
        await refresh();
        toast(`Answer key saved: ${imported.questionCount} items detected from Excel`);
      } catch (err) { toast(Store.friendlyError ? Store.friendlyError(err) : err.message, 'warn'); }
      e.target.value = '';
    };
  }

  function confirmDeleteExam(id) {
    const exam = state.exams.find(x => x.id === id);
    if (!exam) return;
    const resultCount = state.results.filter(r => r.exam_id === id).length;
    modal(`
      <div class="modal-head"><div><span class="kicker danger-text">DELETE EXAM</span><h3>${esc(exam.title)}</h3><p>This permanently deletes the exam, its answer key, and ${resultCount} saved result${resultCount === 1 ? '' : 's'} linked to it.</p></div><button class="icon-btn" data-close-modal>✕</button></div>
      <div class="delete-warning">This action cannot be undone.</div>
      <div class="modal-actions"><button type="button" class="btn btn-soft" data-close-modal>Cancel</button><button type="button" id="confirmDeleteExamBtn" class="btn btn-danger">Delete exam</button></div>`);
    $('#confirmDeleteExamBtn').onclick = async () => {
      const btn = $('#confirmDeleteExamBtn');
      btn.disabled = true;
      btn.textContent = 'Deleting...';
      processModal('Deleting exam…', `Removing ${exam.title} and its linked records.`, '×');
      try {
        await Store.deleteExam(id);
        await refresh();
        successModal('Exam deleted', `${exam.title} was removed from GradeDock.`);
      } catch (err) {
        closeModal();
        toast(Store.friendlyError ? Store.friendlyError(err) : err.message, 'warn');
      }
    };
  }

  function populateScanSelectors() {
    const classSelect = $('#scanClass');
    const examSelect = $('#scanExam');
    if (!classSelect || !examSelect) return;

    const currentClass = classSelect.value;
    const currentExam = examSelect.value;

    classSelect.innerHTML = '<option value="">Choose a section…</option>' + state.classes.filter(c => !c.is_archived).map(c =>
      `<option value="${c.id}">Grade ${esc(c.grade_level || '—')} • ${esc(classLabel(c))}</option>`
    ).join('');
    examSelect.innerHTML = '<option value="">Choose an exam…</option>' + state.exams.filter(e => !e.is_archived).map(e =>
      `<option value="${e.id}">${esc(e.title)}</option>`
    ).join('');

    if (state.classes.some(c => c.id === currentClass)) classSelect.value = currentClass;
    if (state.exams.some(e => e.id === currentExam)) examSelect.value = currentExam;
  }

  function scanContext() {
    const cls = state.classes.find(c => c.id === $('#scanClass').value);
    const exam = state.exams.find(e => e.id === $('#scanExam').value);
    return { cls, exam };
  }

  function requireScanContext() {
    const { cls, exam } = scanContext();
    if (!cls) { toast('Select the section/class first.', 'warn'); return null; }
    if (!exam) { toast('Select the exam before scanning.', 'warn'); return null; }
    return { cls, exam };
  }

  async function processCanvas(canvas, blob = null) {
    const context = requireScanContext();
    if (!context) return;
    const { cls, exam } = context;
    try {
      $('#scanStatusText').textContent = `Reading ${classLabel(cls)} paper: registration markers and bubbles…`;
      $('#scanConfidence').textContent = 'Scanning';
      $('#scanConfidence').className = 'badge neutral';
      const key = await Store.examKey(exam.id);
      if (key.length !== Number(exam.question_count) || key.some(x => !x)) {
        throw new Error('This exam does not have a complete answer key yet. Open Exams → Set / Update Answer Key, then upload the completed Excel key before scanning.');
      }
      const result = window.GradeDockScanner.analyze(canvas, exam, key);
      state.scan = { ...result, exam, key, classId: cls.id, className: classLabel(cls) };
      state.scanImageBlob = blob;
      renderScanResult();
      const activeScan = state.scan;
      window.GradeDockScanner.readStudentName(canvas, result.homography, result.orientationTransform).then(ocr => {
        if (state.scan !== activeScan) return;
        const input = $('#scannedStudentName');
        const note = $('#nameOcrStatus');
        if (!input || !note) return;
        if (ocr.text) {
          if (!input.value.trim()) input.value = ocr.text;
          note.textContent = `Detected name: ${ocr.text}. Please verify before saving.`;
          note.className = 'ocr-success';
        } else if (ocr.available === false) {
          note.textContent = 'Automatic name reading is unavailable. Type the name manually.';
          note.className = 'ocr-warn';
        } else {
          note.textContent = 'I could not read the handwriting clearly. Type or correct the name manually.';
          note.className = 'ocr-warn';
        }
      });
      return true;
    } catch (err) {
      state.scan = null;
      $('#scanConfidence').textContent = 'Needs retake';
      $('#scanConfidence').className = 'badge warn';
      $('#scanStatusText').textContent = err.message;
      if (window.GradeDockScanner?.stream) {
        setCameraAssistStatus({ state: 'warn', title: 'Not ready to scan', text: 'Reposition the paper, wait for a green GOOD TO SCAN message, then retry.' }, true);
      }
      toast(err.message, 'warn');
      return false;
    }
  }

  function renderScanResult() {
    const r = state.scan;
    $('#scanEmpty').classList.add('hidden');
    $('#scanResult').classList.remove('hidden');
        $('#scanConfidence').textContent = `${r.confidence}% clear responses`;
    $('#scanConfidence').className = `badge ${r.uncertain ? 'warn' : 'good'}`;
    const mirrorNote = r.cameraMirrorCorrected ? ' Camera orientation was corrected automatically.' : '';
    $('#scanStatusText').textContent = r.uncertain
      ? `${r.uncertain} response${r.uncertain === 1 ? '' : 's'} need teacher confirmation before saving to ${r.className}.${mirrorNote}`
      : `All responses were read clearly. This result will be saved to ${r.className}.${mirrorNote}`;

    const choices = ['', ...Array.from({ length: Number(r.exam.choice_count || 4) }, (_, i) => String.fromCharCode(65 + i))];
    const stateLabel = a => {
      if (a.state === 'multiple') return 'Multiple marks — choose one';
      if (a.state === 'blank') return 'No clear mark — confirm blank or choose';
      if (a.state === 'low') return `Unclear mark: ${a.answer || '—'} — confirm`;
      return a.answer ? (a.isCorrect ? '✓ Correct' : `✕ Key: ${a.key}`) : 'Blank';
    };

    $('#scanResult').innerHTML = `
      <div class="scan-section-pill">SECTION: <strong>${esc(r.className)}</strong></div>
      <div class="score-hero"><div><small>SCORE</small><strong id="liveScore">${r.correct}/${r.total}</strong><span id="livePct">${r.percentage}%</span></div><div class="score-ring">${r.percentage}%</div></div>
      <div class="review-help"><strong>Review highlighted items.</strong><span>Check the selected answers, especially Multiple?, Blank?, or Light mark. Confirm items individually or use Confirm All after reviewing. GradeDock will not save until all are confirmed.</span><div class="review-bulk-actions"><span id="reviewPendingCount">${r.uncertain} item${r.uncertain === 1 ? '' : 's'} to confirm</span><button type="button" id="confirmAllReviewBtn" class="btn btn-soft" ${r.uncertain ? '' : 'disabled'}>✓ Confirm All</button></div></div>
      <div class="answer-review">${r.answers.map(a => {
        const needsConfirm = a.state !== 'ok';
        const options = choices.map(x => `<option value="${x}" ${x === a.answer ? 'selected' : ''}>${x || 'Blank'}</option>`).join('');
        return `<div class="answer-chip ${needsConfirm ? 'uncertain needs-confirm' : a.isCorrect ? 'correct' : 'wrong'}" data-answer-chip="${a.question}">
          <b>${a.question}</b>
          <select data-review="${a.question}" aria-label="Answer for item ${a.question}">${options}</select>
          <small data-review-status="${a.question}">${stateLabel(a)}</small>
          ${needsConfirm ? `<button type="button" class="confirm-answer-btn" data-confirm-review="${a.question}">✓ Confirm</button>` : ''}
        </div>`;
      }).join('')}
      </div>
      <div class="save-scan"><div class="scanned-name-wrap"><label class="gd-name-label" for="scannedStudentName">Student name — search or select</label><input id="scannedStudentName" type="search" autocomplete="off" placeholder="Search student name…"><select id="gdScanRosterSelect" aria-label="Select student from roster"><option value="">Choose from class roster…</option></select><small id="nameOcrStatus">Reading the handwritten name…</small></div><div class="scan-save-actions"><button id="retryScanBtn" type="button" class="btn btn-soft">↻ Retry scan</button><button id="saveScanBtn" class="btn btn-primary" ${r.uncertain ? 'disabled' : ''}>Save to ${esc(r.className)}</button></div></div>`;

    const roster = state.students.filter(s => s.class_id === r.classId).sort((a,b)=>a.full_name.localeCompare(b.full_name));
    const nameInput = $('#scannedStudentName'), nameSelect = $('#gdScanRosterSelect');
    const renderNames = (q='') => {
      const matches = roster.filter(s => s.full_name.toLowerCase().includes(q.toLowerCase()));
      nameSelect.innerHTML = '<option value="">Choose from class roster…</option>' + matches.map(st => `<option value="${esc(st.full_name)}">${esc(st.full_name)}</option>`).join('');
    };
    renderNames();
    nameInput.addEventListener('input', () => renderNames(nameInput.value));
    nameSelect.addEventListener('change', () => {if(nameSelect.value) {nameInput.value=nameSelect.value;renderNames();nameSelect.value=nameInput.value;}});

    const updateChip = a => {
      const chip = $(`[data-answer-chip="${a.question}"]`);
      if (!chip) return;
      chip.classList.remove('uncertain', 'needs-confirm', 'correct', 'wrong');
      const status = chip.querySelector(`[data-review-status="${a.question}"]`);
      const confirm = chip.querySelector(`[data-confirm-review="${a.question}"]`);
      if (a.state !== 'ok') {
        chip.classList.add('uncertain', 'needs-confirm');
        if (status) status.textContent = stateLabel(a);
        if (confirm) confirm.classList.remove('hidden');
      } else {
        chip.classList.add(a.isCorrect ? 'correct' : 'wrong');
        if (status) status.textContent = a.answer ? (a.isCorrect ? '✓ Correct' : `✕ Key: ${a.key}`) : 'Blank confirmed';
        if (confirm) confirm.remove();
      }
    };

    $$('[data-review]').forEach(sel => sel.onchange = () => {
      const a = r.answers.find(x => x.question == sel.dataset.review);
      if (!a) return;
      a.answer = sel.value;
      // A highlighted item stays unresolved until the teacher explicitly confirms it.
      if (a.state === 'ok') {
        a.isCorrect = Boolean(a.answer) && a.answer === a.key;
        updateChip(a);
        recalcScan();
      } else {
        a.isCorrect = false;
        const status = $(`[data-review-status="${a.question}"]`);
        if (status) status.textContent = a.answer ? `Selected ${a.answer} — press ✓ Confirm` : 'Selected Blank — press ✓ Confirm';
      }
    });

    $$('[data-confirm-review]').forEach(btn => btn.onclick = () => {
      const a = r.answers.find(x => x.question == btn.dataset.confirmReview);
      if (!a) return;
      const sel = $(`[data-review="${a.question}"]`);
      a.answer = sel ? sel.value : a.answer;
      a.state = 'ok';
      a.isCorrect = Boolean(a.answer) && a.answer === a.key;
      updateChip(a);
      recalcScan();
      const next = r.answers.find(x => x.state !== 'ok');
      if (next) {
        const nextChip = $(`[data-answer-chip="${next.question}"]`);
        nextChip?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
    });

    $('#confirmAllReviewBtn').onclick = () => {
      const remaining = r.answers.filter(a => a.state !== 'ok');
      if (!remaining.length) return;
      modal(`<div class="confirm-all-dialog"><h3>Confirm all ${remaining.length} items?</h3
        <p>This will accept the currently selected answer (including Blank) for every highlighted item. Please check uncertain, multiple-mark, and blank items against the paper first. This does not save the result yet.</p>
        <div class="modal-actions"><button type="button" class="btn btn-soft" data-close-modal>Review again</button><button type="button" class="btn btn-primary" id="applyConfirmAllBtn">✓ Confirm ${remaining.length} items</button></div></div>`);
      $('#applyConfirmAllBtn').onclick = () => {
        remaining.forEach(a => {
          const sel = $(`[data-review="${a.question}"]`);
          a.answer = sel ? sel.value : a.answer;
          a.state = 'ok';
          a.isCorrect = Boolean(a.answer) && a.answer === a.key;
          updateChip(a);
        });
        recalcScan();
        closeModal();
        toast(`${remaining.length} items confirmed. Check the score, then save.`);
      };
    };

    $('#retryScanBtn').onclick = retryScan;
    $('#saveScanBtn').onclick = saveScan;
  }

  function retryScan() {
    state.scan = null;
    state.scanImageBlob = null;
    $('#scanResult').classList.add('hidden');
    $('#scanResult').innerHTML = '';
    $('#scanEmpty').classList.remove('hidden');
    $('#scanConfidence').textContent = 'Waiting';
    $('#scanConfidence').className = 'badge neutral';
    $('#scanStatusText').textContent = 'Ready to retry. Position the answer sheet and scan again.';
    if (window.GradeDockScanner?.stream) {
      startCameraAssist();
      const stage = $('.camera-stage');
      stage?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    } else if ($('#cameraMode')?.classList.contains('active')) {
      $('#startCameraBtn')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }

  function recalcScan() {
    const r = state.scan;
    r.correct = r.answers.filter(a => a.isCorrect).length;
    r.uncertain = r.answers.filter(a => a.state !== 'ok').length;
    r.percentage = Math.round(r.correct / r.total * 10000) / 100;
    $('#liveScore').textContent = `${r.correct}/${r.total}`;
    $('#livePct').textContent = `${r.percentage}%`;
    const ring = $('.score-ring');
    if (ring) ring.textContent = `${r.percentage}%`;
    const count = $('#reviewPendingCount');
    if (count) count.textContent = `${r.uncertain} item${r.uncertain === 1 ? '' : 's'} to confirm`;
    const bulkBtn = $('#confirmAllReviewBtn');
    if (bulkBtn) bulkBtn.disabled = r.uncertain === 0;
    const saveBtn = $('#saveScanBtn');
    if (saveBtn) saveBtn.disabled = r.uncertain > 0;
    const badge = $('#scanConfidence');
    if (badge) {
      badge.textContent = r.uncertain ? `${r.uncertain} to confirm` : 'Checked';
      badge.className = `badge ${r.uncertain ? 'warn' : 'good'}`;
    }
    if (r.uncertain) {
      $('#scanStatusText').textContent = `${r.uncertain} highlighted response${r.uncertain === 1 ? '' : 's'} still need teacher confirmation.`;
    } else {
      $('#scanStatusText').textContent = `All highlighted responses have been checked. Ready to save to ${r.className}.`;
    }
  }

  async function saveScan() {
    const r = state.scan;
    if (!r) return;
    const unresolved = r.answers.filter(a => a.state !== 'ok');
    if (unresolved.length) {
      toast(`Confirm ${unresolved.length} highlighted answer${unresolved.length === 1 ? '' : 's'} before saving.`, 'warn');
      const first = $(`[data-answer-chip=\"${unresolved[0].question}\"]`);
      first?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
    const name = $('#scannedStudentName').value.trim();
    if (!name) {
      toast('Type the student name shown on the answer sheet.', 'warn');
      $('#scannedStudentName').focus();
      return;
    }

    const payload = {
      exam_id: r.exam.id,
      class_id: r.classId,
      student_name: name,
      score: r.correct,
      total_items: r.total,
      percentage: r.percentage,
      review_count: r.uncertain
    };

    try {
      processModal('Saving scan…', `Recording ${name}'s result in ${r.className}.`, '⌗');
      await Store.saveResult(payload, r.answers, state.scanImageBlob);
      state.scan = null;
      state.scanImageBlob = null;
      $('#scanResult').classList.add('hidden');
      $('#scanEmpty').classList.remove('hidden');
      $('#scanStatusText').textContent = `Saved to ${r.className}. Ready for the next paper.`;
      await refresh();
      successModal('Scan complete', `${name}'s paper was scanned and saved successfully.`, `${r.correct}/${r.total} • ${r.percentage}% • ${r.className}`, 'Scan next paper', () => {
        go('scan');
        $('#scanStatusText').textContent = `Ready for the next ${r.className} paper.`;
        if (window.GradeDockScanner?.stream) startCameraAssist();
      });
    } catch (err) { closeModal(); toast(err.message, 'warn'); }
  }

  const Analysis = window.GradeDockItemAnalysis;

  async function buildItemAnalysisReport() {
    const examId = $('#itemAnalysisExam')?.value || '';
    const classId = $('#itemAnalysisClass')?.value || '';
    if (!examId) throw new Error('Choose an exam first.');
    const exam = state.exams.find(e => e.id === examId);
    if (!exam) throw new Error('Exam not found.');

    const selectedResults = state.results.filter(r => r.exam_id === examId && (!classId || r.class_id === classId));
    if (!selectedResults.length) throw new Error('There are no saved scan results for this exam and section yet.');

    const detailed = await Promise.all(selectedResults.map(async result => {
      try { return { result, answers: await Store.resultAnswers(result.id) }; }
      catch (_) { return { result, answers: [] }; }
    }));
    const usable = detailed.filter(x => x.answers.length);
    if (!usable.length) throw new Error('These results do not contain saved per-item answers yet, so item analysis cannot be generated.');

    const key = await Store.examKey(examId);
    const choiceCount = Number(exam.choice_count || 4);
    const choices = Array.from({ length: choiceCount }, (_, i) => String.fromCharCode(65 + i));
    const questionCount = Number(exam.question_count || key.length || 0);
    const sorted = [...usable].sort((a, b) => Number(b.result.score || 0) - Number(a.result.score || 0) || String(a.result.student_name || '').localeCompare(String(b.result.student_name || '')) || String(a.result.id || '').localeCompare(String(b.result.id || '')));
    const groupSize = Analysis.groupSize(sorted.length);
    const upper = groupSize ? sorted.slice(0, groupSize) : [];
    const lower = groupSize ? sorted.slice(-groupSize) : [];

    const answerAt = (entry, item) => entry.answers.find(a => Number(a.question_number) === item);
    const rows = Array.from({ length: questionCount }, (_, idx) => {
      const item = idx + 1;
      const answerRows = usable.map(entry => answerAt(entry, item)).filter(Boolean);
      const n = answerRows.length;
      const correct = answerRows.filter(a => Boolean(a.is_correct)).length;
      const blank = answerRows.filter(a => !String(a.student_answer || '').trim()).length;
      const incorrect = Math.max(0, n - correct - blank);
      const percentCorrect = n ? Math.round(correct / n * 10000) / 100 : 0;
      const distribution = Object.fromEntries(choices.map(choice => [choice, answerRows.filter(a => a.student_answer === choice).length]));
      const upperCorrect = upper.filter(entry => Boolean(answerAt(entry, item)?.is_correct)).length;
      const lowerCorrect = lower.filter(entry => Boolean(answerAt(entry, item)?.is_correct)).length;
      const metrics = Analysis.metrics(upperCorrect, lowerCorrect, groupSize);
      const correctAnswer = key[idx] || answerRows.find(Boolean)?.correct_answer || '';
      return {
        item, correctAnswer, examinees: n, correct, incorrect, blank, percentCorrect,
        upperCorrect, lowerCorrect, ...metrics, distribution
      };
    });

    const classInfo = classId ? state.classes.find(c => c.id === classId) : null;
    const analyzedResults = usable.map(x => x.result);
    const meanScore = analyzedResults.length ? analyzedResults.reduce((sum, r) => sum + Number(r.score || 0), 0) / analyzedResults.length : 0;
    const mps = questionCount ? (meanScore / questionCount) * 100 : 0;
    // GradeDock follows the common DepEd consolidated-report convention where
    // Minimum Proficiency Level (MPL) is 60% of the total test items.
    const mpl = Math.ceil(questionCount * 0.60);
    const learnersAtOrAboveMpl = analyzedResults.filter(r => Number(r.score || 0) >= mpl).length;
    const percentAtOrAboveMpl = analyzedResults.length ? learnersAtOrAboveMpl / analyzedResults.length * 100 : 0;
    const avg = Math.round(mps * 100) / 100;
    const ranked = rows.filter(r => r.examinees).sort((a, b) => a.percentCorrect - b.percentCorrect);
    return {
      exam,
      classInfo,
      sectionLabel: classInfo ? `Grade ${classInfo.grade_level || '—'} • ${classLabel(classInfo)}` : 'All sections',
      examinees: usable.length,
      groupSize,
      upperGroup: upper.map(x => x.result),
      lowerGroup: lower.map(x => x.result),
      actionCounts: {RETAIN:rows.filter(x=>x.action==='RETAIN').length,REVISE:rows.filter(x=>x.action==='REVISE').length,REMOVE:rows.filter(x=>x.action==='REMOVE').length},
      meanScore: Math.round(meanScore * 100) / 100,
      mps: Math.round(mps * 100) / 100,
      mpl,
      mplPercent: 60,
      learnersAtOrAboveMpl,
      percentAtOrAboveMpl: Math.round(percentAtOrAboveMpl * 100) / 100,
      averagePercentage: avg,
      easiest: ranked.length ? ranked[ranked.length - 1] : null,
      mostDifficult: ranked.length ? ranked[0] : null,
      rows,
      choices
    };
  }

  function itemAnalysisRowClass(row) {
    if (row.difficulty === 'Difficult') return 'analysis-difficult';
    if (row.difficulty === 'Easy') return 'analysis-easy';
    return 'analysis-moderate';
  }

  async function previewItemAnalysis() {
    const button = $('#previewItemAnalysisBtn');
    if (button) { button.disabled = true; button.textContent = 'Building preview…'; }
    try {
      const report = await buildItemAnalysisReport();
      const rows = report.rows.map(row => `<tr class="${itemAnalysisRowClass(row)}">
        <td><b>${row.item}</b></td><td>${esc(row.correctAnswer || '—')}</td>
        <td>${row.upperCorrect}</td><td>${row.du == null ? '—' : row.du.toFixed(2)}</td>
        <td>${row.lowerCorrect}</td><td>${row.dl == null ? '—' : row.dl.toFixed(2)}</td>
        <td><b>${row.difficultyIndex == null ? '—' : row.difficultyIndex.toFixed(2)}</b></td>
        <td><span class="difficulty-pill ${row.difficulty === 'Moderately Difficult' ? 'moderate' : row.difficulty.toLowerCase().replace(/\s/g,'-')}">${esc(row.difficulty)}</span></td>
        <td>${row.discrimination == null ? '—' : row.discrimination.toFixed(2)}</td><td>${esc(row.discriminationInterpretation)}</td>
        <td><span class="gd-action-pill ${row.action.toLowerCase().replace(/\s/g,'-')}">${esc(row.action)}</span></td>
        <td>${row.percentCorrect.toFixed(2)}%</td>
      </tr>`).join('');
      modal(`
        <div class="modal-head"><div><span class="kicker">ITEM ANALYSIS PREVIEW</span><h3>${esc(report.exam.title)}</h3><p>${esc(report.sectionLabel)} • ${report.examinees} analyzed result${report.examinees === 1 ? '' : 's'}</p></div><button class="icon-btn" data-close-modal>✕</button></div>
        <div class="analysis-summary-grid">
          <div><small>EXAMINEES</small><strong>${report.examinees}</strong></div>
          <div><small>UPPER / LOWER 25%</small><strong>${report.groupSize} each</strong></div>
          <div><small>MPS</small><strong>${report.mps}%</strong></div>
          <div><small>RETAIN</small><strong>${report.actionCounts.RETAIN}</strong></div>
          <div><small>REVISE</small><strong>${report.actionCounts.REVISE}</strong></div>
          <div><small>REMOVE</small><strong>${report.actionCounts.REMOVE}</strong></div>
        </div>
        <div class="analysis-guide"><b>MA Math Ed 215 method:</b> Rank students by total score and take the upper and lower 25% (whole number of students per group). DU = upper correct ÷ upper group, DL = lower correct ÷ lower group, difficulty index = (upper correct + lower correct) ÷ (2 × group size), and discrimination index = DU − DL. Indices are shown to two decimal places. Difficulty: Difficult 0.00–0.40, Moderately Difficult 0.41–0.60, Easy 0.61–1.00. Discrimination: Not Discriminating ≤0.19, Moderately Discriminating 0.20–0.29, Discriminating ≥0.30. Recommendations follow the PPT's conditions. <b>All % Correct</b> separately uses every saved answer. ${!report.groupSize ? '<b>At least four complete scans are required for upper/lower group analysis.</b>' : ''}</div>
        <div class="analysis-table-wrap"><table class="analysis-table"><thead><tr><th>Item</th><th>Key</th><th>Upper Correct</th><th>DU</th><th>Lower Correct</th><th>DL</th><th>Difficulty Index</th><th>Difficulty</th><th>Discrimination Index</th><th>Discrimination</th><th>Action</th><th>All % Correct</th></tr></thead><tbody>${rows}</tbody></table></div>
        <div class="modal-actions analysis-actions"><button type="button" class="btn btn-soft" data-close-modal>Close</button><button type="button" id="downloadItemAnalysisExcelBtn" class="btn btn-primary">⇩ Download Excel</button></div>`);
      $('#downloadItemAnalysisExcelBtn').onclick = async () => {
        const btn = $('#downloadItemAnalysisExcelBtn');
        btn.disabled = true; btn.textContent = 'Preparing Excel…';
        try { await downloadItemAnalysisExcel(report); toast('Item analysis Excel downloaded'); }
        catch (err) { toast(err.message, 'warn'); }
        finally { btn.disabled = false; btn.textContent = '⇩ Download Excel'; }
      };
    } catch (err) {
      toast(Store.friendlyError ? Store.friendlyError(err) : err.message, 'warn');
    } finally {
      if (button) { button.disabled = false; button.textContent = 'Preview item analysis'; }
    }
  }

  async function downloadItemAnalysisExcel(report) {
    if (!window.ExcelJS) throw new Error('Excel export library is not available. Reload GradeDock while online, then try again.');
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'GradeDock';
    workbook.created = new Date();
    workbook.calcProperties.fullCalcOnLoad = true;
    const NAVY='FF172B4D', BLUE='FF2563EB', LIGHT='FFEFF6FF', BORDER='FFD6DEE9', WHITE='FFFFFFFF';
    const border = {top:{style:'thin',color:{argb:BORDER}},bottom:{style:'thin',color:{argb:BORDER}},left:{style:'thin',color:{argb:BORDER}},right:{style:'thin',color:{argb:BORDER}}};
    const titleBar = (ws, lastColumn, title, subtitle) => {
      ws.mergeCells(1,1,1,lastColumn);
      const cell=ws.getCell(1,1);cell.value=title;cell.font={bold:true,size:17,color:{argb:WHITE}};
      cell.fill={type:'pattern',pattern:'solid',fgColor:{argb:NAVY}};
      cell.alignment={vertical:'middle',horizontal:'center'};ws.getRow(1).height=34;
      ws.mergeCells(2,1,2,lastColumn);const c=ws.getCell(2,1);c.value=subtitle;c.font={color:{argb:'FF475569'},italic:true};c.alignment={horizontal:'center'};ws.getRow(2).height=24;
    };
    const styleHeader = row => {row.height=34;row.eachCell(c=>{c.font={bold:true,color:{argb:WHITE}};c.fill={type:'pattern',pattern:'solid',fgColor:{argb:BLUE}};c.alignment={horizontal:'center',vertical:'middle',wrapText:true};c.border=border;});};
    const styleBody = (row,i) => {row.height=24;row.eachCell({includeEmpty:true},c=>{c.border=border;c.alignment={vertical:'middle',horizontal:'center',wrapText:true};if(i%2)c.fill={type:'pattern',pattern:'solid',fgColor:{argb:'FFF8FAFC'}};});};

    const summary=workbook.addWorksheet('Summary',{views:[{state:'frozen',ySplit:3}]});
    summary.getColumn(1).width=38;summary.getColumn(2).width=33;
    titleBar(summary,2,'GradeDock | MA Item Analysis',`${report.exam.title} • ${report.sectionLabel}`);
    const items=[
      ['Exam',report.exam.title],['Section',report.sectionLabel],
      ['Analyzed Papers',report.examinees],['Upper 25% Group (count)',report.groupSize],
      ['Lower 25% Group (count)',report.groupSize],['Number of Test Items',report.rows.length],
      ['Mean Score',report.meanScore],['MPS — all papers',report.mps/100],
      ['MPL — 60% of total items',report.mpl],['Learners at / above MPL',report.learnersAtOrAboveMpl],
      ['% at / above MPL',report.percentAtOrAboveMpl/100],
      ['Items to RETAIN',report.actionCounts.RETAIN],['Items to REVISE',report.actionCounts.REVISE],
      ['Items to REMOVE',report.actionCounts.REMOVE],
      ['Generated',new Date()]
    ];
    items.forEach((r,i)=>{const row=summary.getRow(i+4);row.values=r;row.height=23;styleBody(row,i);row.getCell(1).fill={type:'pattern',pattern:'solid',fgColor:{argb:LIGHT}};row.getCell(1).font={bold:true,color:{argb:NAVY}};row.getCell(2).alignment={vertical:'middle',horizontal:'left',wrapText:true};});
    summary.getCell('B10').numFmt='0.00';summary.getCell('B11').numFmt='0.00%';summary.getCell('B14').numFmt='0.00%';summary.getCell('B18').numFmt='mmm d, yyyy h:mm AM/PM';

    const ws=workbook.addWorksheet('Item Analysis',{views:[{state:'frozen',ySplit:7,xSplit:2}]});
    const headers=['Item','Key','Upper Correct','DU','Lower Correct','DL','Difficulty Index (DI)','Difficulty','Discrimination Index (ID)','Discrimination','Action','All Correct','All Responses','All % Correct','Blank','Incorrect',...report.choices.map(x=>`${x} Count`)];
    titleBar(ws,headers.length,'GradeDock | Item Analysis — Upper & Lower 25%',`${report.exam.title} • ${report.sectionLabel} • ${report.examinees} papers`);
    ws.mergeCells(3,1,3,headers.length);
    ws.getCell(3,1).value='Source: MA Math Ed 215, Item Analysis (slides 7–13). DU=upper correct / group; DL=lower correct / group; DI=(upper correct + lower correct)/(2×group size); ID=DU−DL.';
    ws.getCell(3,1).font={size:10,italic:true,color:{argb:'FF475569'}};ws.getCell(3,1).alignment={wrapText:true,horizontal:'center'};ws.getRow(3).height=27;
    ws.mergeCells('A4:C4');ws.getCell('A4').value='Upper/Lower group size (each):';ws.getCell('A4').font={bold:true,color:{argb:NAVY}};
    ws.getCell('D4').value=report.groupSize;ws.getCell('D4').font={bold:true,color:{argb:'FF1D4ED8'}};ws.getCell('D4').fill={type:'pattern',pattern:'solid',fgColor:{argb:LIGHT}};ws.getCell('D4').alignment={horizontal:'center'};
    ws.mergeCells(4,5,4,headers.length);ws.getCell(4,5).value='The full-sample % Correct is additional information; DI and ID use only the upper and lower 25% groups as on the sample PPT sheet.';ws.getCell(4,5).font={italic:true,size:10,color:{argb:'FF64748B'}};ws.getCell(4,5).alignment={wrapText:true,vertical:'middle'};ws.getRow(4).height=30;
    ws.mergeCells(5,1,5,headers.length);ws.getCell(5,1).value='DI 0.00–0.40 Difficult | 0.41–0.60 Moderately Difficult | 0.61–1.00 Easy     •     ID ≤0.19 Not Discriminating | 0.20–0.29 Moderately Discriminating | ≥0.30 Discriminating';ws.getCell(5,1).alignment={wrapText:true,horizontal:'center'};ws.getCell(5,1).font={size:10,color:{argb:NAVY}};ws.getRow(5).height=30;
    ws.mergeCells(6,1,6,headers.length);ws.getCell(6,1).value='Action: ID ≥0.30 → RETAIN; ID 0.20–0.29 → REVISE; ID ≤0.19 → REVISE if moderately difficult, otherwise REMOVE.';ws.getCell(6,1).alignment={wrapText:true,horizontal:'center'};ws.getCell(6,1).font={size:10,bold:true,color:{argb:'FF334155'}};ws.getRow(6).height=28;
    const header=ws.getRow(7);header.values=headers;styleHeader(header);
    report.rows.forEach((r,index)=>{
      const ri=index+8;
      const row=ws.getRow(ri);
      row.values=[r.item,r.correctAnswer||'',r.upperCorrect,'',r.lowerCorrect,'','','','','','',r.correct,r.examinees,'',r.blank,r.incorrect,...report.choices.map(c=>r.distribution[c]||0)];
      // Excel formulas permit teachers to inspect, correct, or recompute every index.
      row.getCell(4).value={formula:`IF($D$4=0,"",ROUND(C${ri}/$D$4,2))`,result:r.du==null?'':r.du};
      row.getCell(6).value={formula:`IF($D$4=0,"",ROUND(E${ri}/$D$4,2))`,result:r.dl==null?'':r.dl};
      row.getCell(7).value={formula:`IF($D$4=0,"",ROUND((C${ri}+E${ri})/(2*$D$4),2))`,result:r.difficultyIndex==null?'':r.difficultyIndex};
      row.getCell(8).value={formula:`IF(G${ri}="","Insufficient data",IF(G${ri}<=0.4,"Difficult",IF(G${ri}<=0.6,"Moderately Difficult","Easy")))`,result:r.difficulty};
      row.getCell(9).value={formula:`IF(OR(D${ri}="",F${ri}=""),"",ROUND(D${ri}-F${ri},2))`,result:r.discrimination==null?'':r.discrimination};
      row.getCell(10).value={formula:`IF(I${ri}="","Insufficient data",IF(I${ri}<0.2,"Not Discriminating",IF(I${ri}<0.3,"Moderately Discriminating","Discriminating")))`,result:r.discriminationInterpretation};
      row.getCell(11).value={formula:`IF(OR(G${ri}="",I${ri}=""),"INSUFFICIENT DATA",IF(I${ri}>=0.3,"RETAIN",IF(AND(G${ri}>0.4,G${ri}<=0.6),"REVISE",IF(I${ri}>=0.2,"REVISE","REMOVE"))))`,result:r.action};
      row.getCell(14).value={formula:`IF(M${ri}=0,"",ROUND(L${ri}/M${ri},4))`,result:r.examinees?r.correct/r.examinees:0};
      styleBody(row,index);
      [4,6,7,9].forEach(i=>row.getCell(i).numFmt='0.00');row.getCell(14).numFmt='0.00%';
      row.getCell(2).font={bold:true,color:{argb:'FF1D4ED8'}};
      const actionColor=r.action==='RETAIN'?'FFE8F7ED':r.action==='REMOVE'?'FFFFE8E8':'FFFFF5D6';
      row.getCell(11).fill={type:'pattern',pattern:'solid',fgColor:{argb:actionColor}};
      row.getCell(11).font={bold:true,color:{argb:r.action==='RETAIN'?'FF166534':r.action==='REMOVE'?'FF991B1B':'FF92400E'}};
      if (typeof r.discrimination==='number' && r.discrimination<0) row.getCell(9).font={bold:true,color:{argb:'FF991B1B'}};
    });
    ws.autoFilter={from:{row:7,column:1},to:{row:7+report.rows.length,column:headers.length}};
    [8,9,16,10,16,10,18,23,20,27,22,12,14,14,10,12,...report.choices.map(()=>11)].forEach((w,i)=>ws.getColumn(i+1).width=w);
    ws.printOptions={horizontalCentered:true};ws.pageSetup={orientation:'landscape',fitToPage:true,fitToWidth:1,fitToHeight:0,paperSize:9};
    ws.headerFooter.oddFooter='GradeDock | MA Math Ed 215 • Page &P / &N';

    const rules=workbook.addWorksheet('Interpretation Guide');
    [28,24,27,26].forEach((w,i)=>rules.getColumn(i+1).width=w);
    titleBar(rules,4,'MA Math Ed 215 | Formula & Decision Guide','Based on uploaded Item-Analysis.pdf, pages 7–13');
    const info=[
      ['Group selection','Rank students by test score','Upper 25% and lower 25%','Take equal whole-number groups, without overlap'],
      ['DU','Upper correct ÷ group size','Round to 2 decimals','Displayed as in the PPT table'],
      ['DL','Lower correct ÷ group size','Round to 2 decimals','Displayed as in the PPT table'],
      ['Difficulty Index','(Upper Correct + Lower Correct) ÷ (2 × group size)','Round to 2 decimals','Uses counts; matches PPT sample page 13'],
      ['Discrimination Index','DU − DL','Round to 2 decimals','Negative is Not Discriminating'],
      ['Difficult','DI 0.00–0.40','',''],
      ['Moderately Difficult','DI 0.41–0.60','',''],
      ['Easy','DI 0.61–1.00','',''],
      ['Not Discriminating','ID ≤0.19','',''],
      ['Moderately Discriminating','ID 0.20–0.29','',''],
      ['Discriminating','ID ≥0.30','',''],
      ['DIFFICULT + Not Discriminating','','','REMOVE'],
      ['DIFFICULT + Moderately Discriminating','','','REVISE'],
      ['DIFFICULT + Discriminating','','','RETAIN'],
      ['MODERATELY DIFFICULT + Not Discriminating','','','REVISE'],
      ['MODERATELY DIFFICULT + Moderately Discriminating','','','REVISE'],
      ['MODERATELY DIFFICULT + Discriminating','','','RETAIN'],
      ['EASY + Not Discriminating','','','REMOVE'],
      ['EASY + Moderately Discriminating','','','REVISE'],
      ['EASY + Discriminating','','','RETAIN'],
      ['Important distinction','Slide 7 gives the all-responses difficulty proportion.','Slide 13 calculates it from the selected upper/lower 25% groups.','GradeDock DI/ID follows the slide 13 Excel example.'],
      ['Small data','If fewer than 4 saved papers have item-level answers, groups cannot be formed.','','The action displays INSUFFICIENT DATA.'],
      ['Missing submissions','The report uses saved scans with per-question records.','','All % Correct uses recorded item responses.'],
      ['Reference','MA Math Ed 215 — Item Analysis','R. R. Briones, PhD','Slides 7–13 (user-provided PDF)']
    ];
    const hr=rules.getRow(4);hr.values=['Term / Condition','Formula / Range','Meaning','Action / Note'];styleHeader(hr);
    info.forEach((r,i)=>{const row=rules.getRow(i+5);row.values=r;row.height=(i>=20?38:27);row.eachCell({includeEmpty:true},c=>{c.border=border;c.alignment={vertical:'middle',wrapText:true};if(i%2)c.fill={type:'pattern',pattern:'solid',fgColor:{argb:'FFF8FAFC'}};});if(/^(DIFFICULT|MODERATELY DIFFICULT|EASY) \+/.test(String(r[0])))row.getCell(4).font={bold:true,color:{argb:r[3]==='RETAIN'?'FF166534':r[3]==='REMOVE'?'FF991B1B':'FF92400E'}};});
    rules.views=[{state:'frozen',ySplit:4}];

    const groups=workbook.addWorksheet('25% Group Audit',{views:[{state:'frozen',ySplit:4}]});
    titleBar(groups,4,'Upper & Lower 25% Selection','Audit which saved papers were ranked into each group');
    [16,31,14,18].forEach((w,i)=>groups.getColumn(i+1).width=w);
    const gh=groups.getRow(4);gh.values=['Group','Student Name','Total Score','Items'];styleHeader(gh);
    const g=[...report.upperGroup.map(x=>['Upper 25%',x.student_name||'',Number(x.score||0),Number(x.total_items||report.rows.length)]),...report.lowerGroup.map(x=>['Lower 25%',x.student_name||'',Number(x.score||0),Number(x.total_items||report.rows.length)])];
    g.forEach((x,i)=>{const row=groups.addRow(x);styleBody(row,i);});
    const buffer=await workbook.xlsx.writeBuffer();
    const blob=new Blob([buffer],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});
    const url=URL.createObjectURL(blob);
    const link=document.createElement('a');link.href=url;
    const safeTitle=String(report.exam.title||'exam').replace(/[^a-z0-9_-]+/gi,'-').replace(/^-|-$/g,'')||'exam';
    link.download=`GradeDock-Item-Analysis-MA-Method-${safeTitle}.xlsx`;
    document.body.appendChild(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1200);
  }

  async function exportResultsExcel() {
    if (!window.ExcelJS) { toast('Excel export library is not available. Reload GradeDock while online, then try again.', 'warn'); return; }
    const filtered = state.results.filter(r =>
      (!$('#resultClassFilter')?.value || r.class_id === $('#resultClassFilter').value) &&
      (!$('#resultExamFilter')?.value || r.exam_id === $('#resultExamFilter').value)
    );
    if (!filtered.length) { toast('There are no results to export for the current filter.', 'warn'); return; }

    processModal('Preparing Excel…', 'Formatting GradeDock results with clear headers, borders, colors, and readable dates.', '⇩');
    try {
      const workbook = new ExcelJS.Workbook();
      workbook.creator = 'GradeDock'; workbook.created = new Date();
      const ws = workbook.addWorksheet('Results', { views: [{ state:'frozen', ySplit:5 }] });
      const headers = ['Section','Grade Level','Student','Exam','Score','Total','Percentage','Review','Date'];
      ws.mergeCells(1,1,1,headers.length);
      const title = ws.getCell(1,1); title.value = 'GradeDock Results';
      title.font = { bold:true, size:18, color:{argb:'FFFFFFFF'} };
      title.fill = { type:'pattern', pattern:'solid', fgColor:{argb:'FF1D4ED8'} };
      title.alignment = { horizontal:'center', vertical:'middle' }; ws.getRow(1).height = 30;

      ws.mergeCells(2,1,2,headers.length);
      const filters = [];
      const classId = $('#resultClassFilter')?.value || '';
      const examId = $('#resultExamFilter')?.value || '';
      if (classId) { const c = state.classes.find(x => x.id === classId); if (c) filters.push(`Grade ${c.grade_level || '—'} • ${classLabel(c)}`); }
      if (examId) filters.push(examTitle(examId));
      ws.getCell(2,1).value = filters.length ? filters.join(' • ') : 'All saved results';
      ws.getCell(2,1).alignment = { horizontal:'center' }; ws.getCell(2,1).font = { italic:true, color:{argb:'FF64748B'} };

      const avgPct = filtered.reduce((sum,r) => sum + Number(r.percentage || 0), 0) / filtered.length;
      ws.mergeCells('A3:B3'); ws.getCell('A3').value = `Papers: ${filtered.length}`;
      ws.mergeCells('C3:D3'); ws.getCell('C3').value = `Average: ${avgPct.toFixed(2)}%`;
      ws.mergeCells('E3:F3'); ws.getCell('E3').value = `Generated: ${new Date().toLocaleDateString()}`;
      ['A3','C3','E3'].forEach(ref => { ws.getCell(ref).font={bold:true,color:{argb:'FF334155'}}; ws.getCell(ref).fill={type:'pattern',pattern:'solid',fgColor:{argb:'FFEFF6FF'}}; ws.getCell(ref).alignment={horizontal:'center'}; });

      const headerRow = ws.getRow(5); headerRow.values = headers; headerRow.height = 28;
      headerRow.eachCell(cell => {
        cell.font = { bold:true, color:{argb:'FFFFFFFF'} };
        cell.fill = { type:'pattern', pattern:'solid', fgColor:{argb:'FF2563EB'} };
        cell.alignment = { horizontal:'center', vertical:'middle', wrapText:true };
        cell.border = { top:{style:'thin',color:{argb:'FF9FB3D1'}}, left:{style:'thin',color:{argb:'FF9FB3D1'}}, bottom:{style:'thin',color:{argb:'FF9FB3D1'}}, right:{style:'thin',color:{argb:'FF9FB3D1'}} };
      });

      filtered.forEach((r, idx) => {
        const cls = state.classes.find(c => c.id === r.class_id);
        const row = ws.addRow([
          resultClassLabel(r), r.grade_level || cls?.grade_level || '', r.student_name || 'Unnamed student',
          examTitle(r.exam_id), Number(r.score || 0), Number(r.total_items || 0), Number(r.percentage || 0)/100,
          Number(r.review_count || 0), r.created_at ? new Date(r.created_at) : ''
        ]);
        row.height = 22;
        row.eachCell(cell => {
          cell.border = { top:{style:'thin',color:{argb:'FFD6DEE9'}}, left:{style:'thin',color:{argb:'FFD6DEE9'}}, bottom:{style:'thin',color:{argb:'FFD6DEE9'}}, right:{style:'thin',color:{argb:'FFD6DEE9'}} };
          cell.alignment = { vertical:'middle', wrapText:true };
          if (idx % 2 === 1) cell.fill = { type:'pattern', pattern:'solid', fgColor:{argb:'FFF8FAFC'} };
        });
        row.getCell(5).alignment = row.getCell(6).alignment = row.getCell(7).alignment = row.getCell(8).alignment = { horizontal:'center', vertical:'middle' };
        row.getCell(7).numFmt = '0.00%';
        row.getCell(9).numFmt = 'mmm d, yyyy h:mm AM/PM';
        const pct = Number(r.percentage || 0);
        row.getCell(7).fill = { type:'pattern', pattern:'solid', fgColor:{argb: pct >= 75 ? 'FFE8F7ED' : pct >= 60 ? 'FFFFF5D6' : 'FFFFE8E8'} };
        row.getCell(7).font = { bold:true, color:{argb: pct >= 75 ? 'FF166534' : pct >= 60 ? 'FF92400E' : 'FF991B1B'} };
        if (Number(r.review_count || 0) > 0) { row.getCell(8).fill={type:'pattern',pattern:'solid',fgColor:{argb:'FFFFF5D6'}}; row.getCell(8).font={bold:true,color:{argb:'FF92400E'}}; }
      });
      ws.autoFilter = { from:{row:5,column:1}, to:{row:5+filtered.length,column:headers.length} };
      [18,12,28,28,10,10,13,10,24].forEach((w,i)=>{ ws.getColumn(i+1).width=w; });

      const buffer = await workbook.xlsx.writeBuffer();
      const blob = new Blob([buffer], { type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      const url = URL.createObjectURL(blob); const link = document.createElement('a');
      link.href=url; link.download='GradeDock-Results.xlsx'; document.body.appendChild(link); link.click(); link.remove();
      setTimeout(()=>URL.revokeObjectURL(url),1200);
      closeModal(); toast('Formatted Excel results downloaded');
    } catch (err) { closeModal(); toast(err.message, 'warn'); }
  }

  function setCameraAssistStatus(status = {}, visible = true) {
    const box = $('#cameraScanAssist');
    if (!box) return;
    if (!visible) {
      box.classList.add('hidden');
      box.style.setProperty('display', 'none', 'important');
      return;
    }
    const stateName = status.state || 'searching';
    box.classList.remove('hidden', 'state-starting', 'state-searching', 'state-focus', 'state-warn', 'state-ready', 'state-reading');
    box.style.setProperty('display', 'grid', 'important');
    box.classList.add(`state-${stateName}`);
    const title = $('#cameraScanAssistTitle');
    const text = $('#cameraScanAssistText');
    const icon = $('#cameraScanAssistIcon');
    const label = box.querySelector('.camera-scan-assist-label');
    if (label) label.textContent = stateName === 'ready' ? 'GOOD TO SCAN' : stateName === 'reading' ? 'CHECKING' : 'NOT READY';
    if (title) title.textContent = status.title || 'Position the answer sheet';
    if (text) text.textContent = status.text || 'Keep the whole sheet visible and hold the camera steady.';
    if (icon) icon.textContent = stateName === 'ready' ? '✓' : stateName === 'reading' ? '⌗' : '!';

    if (stateName === 'ready' && cameraAssistLastState !== 'ready' && navigator.vibrate) {
      try { navigator.vibrate(35); } catch (_) {}
    }
    cameraAssistLastState = stateName;
  }

  function stopCameraAssist(hide = true) {
    if (cameraAssistTimer) clearInterval(cameraAssistTimer);
    cameraAssistTimer = null;
    cameraAssistBusy = false;
    cameraAssistLastState = '';
    if (hide) setCameraAssistStatus({}, false);
  }

  function updateCameraAssist() {
    if (cameraAssistBusy || !window.GradeDockScanner?.stream) return;
    const video = $('#cameraVideo');
    if (!video) return;
    cameraAssistBusy = true;
    try {
      const status = window.GradeDockScanner.inspectFrame(video);
      setCameraAssistStatus(status, true);
    } catch (err) {
      setCameraAssistStatus({ state: 'searching', title: 'Looking for answer sheet…', text: 'Keep the entire paper visible and hold the camera steady.' }, true);
    } finally {
      cameraAssistBusy = false;
    }
  }

  function startCameraAssist() {
    stopCameraAssist(false);
    setCameraAssistStatus({ state: 'starting', title: 'Not ready to scan', text: 'Show the whole answer sheet and hold the phone steady.' }, true);
    updateCameraAssist();
    cameraAssistTimer = setInterval(updateCameraAssist, 550);
  }

  function switchScanMode(mode) {
    $('#cameraTab').classList.toggle('active', mode === 'camera');
    $('#uploadTab').classList.toggle('active', mode === 'upload');
    $('#cameraMode').classList.toggle('active', mode === 'camera');
    $('#uploadMode').classList.toggle('active', mode === 'upload');
    if (mode === 'upload') {
      stopCameraAssist();
      window.GradeDockScanner.stopCamera($('#cameraVideo'));
      $('#cameraPlaceholder')?.classList.remove('hidden');
      if ($('#captureBtn')) $('#captureBtn').disabled = true;
    }
  }

  function bind() {
    $$('.auth-tab').forEach(b => b.onclick = () => {
      $$('.auth-tab').forEach(x => x.classList.remove('active'));
      b.classList.add('active');
      $$('.auth-form').forEach(f => f.classList.remove('active'));
      $(`#${b.dataset.authTab}Form`).classList.add('active');
    });

    $('#demoBtn').onclick = async () => { Store.useDemo(); await enterApp(); };

    $('#signinForm').onsubmit = async e => {
      e.preventDefault();
      processModal('Signing you in…', 'Opening your GradeDock teacher workspace.');
      try {
        await Store.signin({ email: $('#signinEmail').value, password: $('#signinPassword').value });
        await enterApp();
        closeModal();
        toast('Welcome back');
      } catch (err) { closeModal(); toast(err.message, 'warn'); }
    };

    $('#signupForm').onsubmit = async e => {
      e.preventDefault();
      processModal('Creating account…', 'Setting up your GradeDock teacher workspace.');
      try {
        const d = await Store.signup({ name: $('#signupName').value, email: $('#signupEmail').value, password: $('#signupPassword').value });
        if (d.session) { await enterApp(); closeModal(); toast('Account created'); }
        else { closeModal(); successModal('Check your email', 'Your GradeDock account was created. Confirm your email before signing in.'); }
      } catch (err) { closeModal(); toast(err.message, 'warn'); }
    };

    $$('.nav-item[data-page]').forEach(b => b.onclick = () => go(b.dataset.page));
    $$('[data-go]').forEach(b => b.onclick = () => go(b.dataset.go));
    $$('[data-action="new-exam"]').forEach(b => b.onclick = newExam);
    const quickScanBtn = $('#quickScanBtn');
    if (quickScanBtn) quickScanBtn.onclick = () => go('scan');
    $('#newClassBtn').onclick = newClass;
    $('#newExamBtn').onclick = newExam;
    $('#downloadBlankExcelBtn').onclick = async () => {
      try {
        await window.GradeDockExcel.downloadTemplate({ title: '', question_count: 40, choice_count: 4 }, [], state.user?.full_name || 'Teacher');
        toast('Dynamic Excel answer-key template downloaded');
      } catch (err) { toast(err.message, 'warn'); }
    };
    $('#classSearch').oninput = renderClasses;
    $('#examSearch').oninput = renderExams;
    $('#resultClassFilter').onchange = renderResults;
    $('#resultExamFilter').onchange = renderResults;
    $('#exportResultsBtn').onclick = exportResultsExcel;
    $('#previewItemAnalysisBtn').onclick = previewItemAnalysis;
    $('#menuBtn').onclick = () => $('#sidebar').classList.toggle('open');
    $('#signoutBtn').onclick = async () => {
      stopCameraAssist();
      window.GradeDockScanner.stopCamera($('#cameraVideo'));
      processModal('Signing you out…', 'Closing your GradeDock workspace safely.');
      try {
        await Store.signout();
        setTimeout(() => location.reload(), 450);
      } catch (err) { closeModal(); toast(err.message, 'warn'); }
    };

    $('#cameraTab').onclick = () => switchScanMode('camera');
    $('#uploadTab').onclick = () => switchScanMode('upload');

    const syncCameraOrientationUI = () => {
      const orientation = window.GradeDockScanner?.orientation === 'portrait' ? 'portrait' : 'landscape';
      const stage = $('.camera-stage');
      const button = $('#cameraOrientationBtn');
      stage?.classList.toggle('camera-portrait', orientation === 'portrait');
      stage?.classList.toggle('camera-landscape', orientation === 'landscape');
      if (button) {
        button.textContent = orientation === 'portrait' ? '↕ Portrait' : '↔ Landscape';
        button.setAttribute('aria-pressed', orientation === 'portrait' ? 'true' : 'false');
        button.title = orientation === 'portrait' ? 'Switch camera view to landscape' : 'Switch camera view to portrait';
      }
    };
    window.GradeDockScanner?.setOrientation?.('landscape');
    syncCameraOrientationUI();

    $('#cameraOrientationBtn').onclick = async () => {
      if (!requireScanContext()) return;
      const video = $('#cameraVideo');
      const wasRunning = Boolean(window.GradeDockScanner?.stream);
      const orientation = window.GradeDockScanner.toggleOrientation();
      syncCameraOrientationUI();
      $('#scanStatusText').textContent = `${orientation === 'portrait' ? 'Portrait' : 'Landscape'} view selected.`;
      if (!wasRunning) return;
      const button = $('#cameraOrientationBtn');
      button.disabled = true;
      try {
        await window.GradeDockScanner.startCamera(video);
        $('#cameraPlaceholder').classList.add('hidden');
        $('#captureBtn').disabled = false;
        startCameraAssist();
        $('#scanStatusText').textContent = `${orientation === 'portrait' ? 'Portrait' : 'Landscape'} camera ready. Follow the live scanning message below the camera.`;
      } catch (err) {
        stopCameraAssist();
        $('#captureBtn').disabled = true;
        $('#scanStatusText').textContent = err.message;
        toast(err.message, 'warn');
      } finally {
        button.disabled = false;
      }
    };

    $('#startCameraBtn').onclick = async () => {
      const context = requireScanContext();
      if (!context) return;
      const startBtn = $('#startCameraBtn');
      const help = $('#cameraHelpText');
      startBtn.disabled = true;
      startBtn.textContent = 'Starting…';
      $('#scanStatusText').textContent = `Opening camera for ${classLabel(context.cls)}…`;
      try {
        await window.GradeDockScanner.startCamera($('#cameraVideo'));
        $('#cameraPlaceholder').classList.add('hidden');
        $('#captureBtn').disabled = false;
        startBtn.textContent = 'Restart camera';
        if (help) help.textContent = 'Need another method? You can take a photo with your device camera instead.';
        startCameraAssist();
        $('#scanStatusText').textContent = 'Camera ready. Follow the live scanning message below the camera.';
      } catch (err) {
        stopCameraAssist();
        startBtn.textContent = 'Start camera';
        $('#captureBtn').disabled = true;
        if (help) help.textContent = err.message;
        $('#scanStatusText').textContent = err.message;
        toast(err.message, 'warn');
      } finally {
        startBtn.disabled = false;
      }
    };

    $('#switchCameraBtn').onclick = async () => {
      if (!requireScanContext()) return;
      try {
        await window.GradeDockScanner.switchCamera($('#cameraVideo'));
        $('#cameraPlaceholder').classList.add('hidden');
        $('#captureBtn').disabled = false;
        startCameraAssist();
        $('#scanStatusText').textContent = 'Camera switched. Follow the live scanning message below the camera.';
      } catch (err) {
        stopCameraAssist();
        $('#scanStatusText').textContent = err.message;
        toast(err.message, 'warn');
      }
    };

    $('#captureBtn').onclick = async () => {
      if (!requireScanContext()) return;
      stopCameraAssist(false);
      setCameraAssistStatus({ state: 'reading', title: 'Reading answer sheet…', text: 'Keep the paper steady while GradeDock checks the markers and bubbles.' }, true);
      const captured = await window.GradeDockScanner.captureBestFrame($('#cameraVideo'), $('#captureCanvas'));
      const canvas = captured.canvas;
      const blob = captured.blob;
      const ok = await processCanvas(canvas, blob);
      if (ok) stopCameraAssist();
      else if (window.GradeDockScanner?.stream) startCameraAssist();
    };

    $('#cameraFallbackFile').onchange = async e => {
      const file = e.target.files[0];
      if (!file) return;
      if (!requireScanContext()) { e.target.value = ''; return; }
      try {
        const canvas = await window.GradeDockScanner.fileToCanvas(file, $('#captureCanvas'));
        await processCanvas(canvas, file);
      } catch (err) {
        $('#scanStatusText').textContent = err.message;
        toast(err.message, 'warn');
      }
      e.target.value = '';
    };

    $('#scanFile').onchange = async e => {
      const file = e.target.files[0];
      if (!file) return;
      if (!requireScanContext()) { e.target.value = ''; return; }
      const canvas = await window.GradeDockScanner.fileToCanvas(file, $('#captureCanvas'));
      processCanvas(canvas, file);
      e.target.value = '';
    };

    $('#dropZone').ondragover = e => { e.preventDefault(); e.currentTarget.classList.add('drag'); };
    $('#dropZone').ondragleave = e => e.currentTarget.classList.remove('drag');
    $('#dropZone').ondrop = async e => {
      e.preventDefault();
      e.currentTarget.classList.remove('drag');
      const file = e.dataTransfer.files[0];
      if (!file || !requireScanContext()) return;
      const canvas = await window.GradeDockScanner.fileToCanvas(file, $('#captureCanvas'));
      processCanvas(canvas, file);
    };

    $('#profileForm').onsubmit = async e => {
      e.preventDefault();
      await Store.updateProfile({ full_name: $('#profileName').value.trim(), school_name: $('#profileSchool').value.trim() });
      await refresh();
      toast('Profile updated');
    };
    $('#storeScansToggle').onchange = e => localStorage.setItem('gradedock_store_scans', e.target.checked ? '1' : '0');
  }

  async function enterApp() {
    $('#authView').classList.add('hidden');
    $('#appView').classList.remove('hidden');
    await refresh();
  }

  async function init() {
    bind();
    if (Store.configured) {
      const s = await Store.session();
      if (s?.user) await enterApp();
    }
  }

  init();
})();
