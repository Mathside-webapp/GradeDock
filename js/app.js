(function () {
  const $ = s => document.querySelector(s);
  const $$ = s => [...document.querySelectorAll(s)];
  const Store = window.GradeDockStore;

  const state = {
    user: null,
    classes: [],
    exams: [],
    results: [],
    scan: null,
    scanImageBlob: null,
    currentPage: 'dashboard'
  };

  const subtitles = {
    dashboard: 'Overview of your classes and assessments',
    classes: 'Organize grade levels and sections',
    exams: 'Create assessments, keys, and downloadable answer sheets',
    scan: 'Choose a section, then capture or upload an answer sheet',
    results: 'Review scores organized by section/class',
    analytics: 'See performance patterns across assessments',
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

  function go(page) {
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
      ['Classes', state.classes.length, '▦'],
      ['Exams', state.exams.length, '▤'],
      ['Scanned papers', state.results.length, '⌗'],
      ['Average score', `${avg}%`, '↗']
    ].map(([label, value, icon]) => `
      <div class="stat-card"><span class="stat-icon">${icon}</span><div><small>${label}</small><strong>${value}</strong></div></div>
    `).join('');

    $('#recentExams').innerHTML = state.exams.slice(0, 4).map(e => examRow(e, true)).join('') ||
      emptyMini('No exams yet', 'Create your first assessment.');

    $('#recentResults').innerHTML = state.results.slice(0, 5).map(r => `
      <div class="result-mini"><div><strong>${esc(r.student_name || 'Unnamed student')}</strong><small>${esc(examTitle(r.exam_id))} • ${esc(resultClassLabel(r))}</small></div><b>${r.score}/${r.total_items}</b></div>
    `).join('') || emptyMini('No results yet', 'Scan a paper to generate your first score.');
  }

  function renderClasses() {
    const q = ($('#classSearch')?.value || '').toLowerCase();
    const list = state.classes.filter(c => `${classLabel(c)} ${c.grade_level || ''} ${c.school_year || ''}`.toLowerCase().includes(q));

    $('#classesGrid').innerHTML = list.map(c => {
      const scans = state.results.filter(r => r.class_id === c.id).length;
      return `
        <article class="class-card" data-class="${c.id}">
          <div class="class-color"></div>
          <span class="kicker">GRADE ${esc(c.grade_level || '—')}</span>
          <h3>${esc(classLabel(c))}</h3>
          <p>${esc(c.school_year || 'School year not set')}</p>
          <div class="class-meta"><span>Section</span><span>${scans} result${scans === 1 ? '' : 's'}</span></div>
          <button class="btn btn-soft btn-block" data-open-class="${c.id}">Open class</button>
        </article>`;
    }).join('') || `<div class="empty-state"><span>▦</span><h4>No classes found</h4><p>Create a grade level and section to organize scan results.</p></div>`;

    $$('[data-open-class]').forEach(b => b.onclick = () => openClass(b.dataset.openClass));
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
          ${compact ? '' : `<button class="mini-action danger-action" data-delete-exam="${exam.id}" title="Delete this exam">Delete</button>`}
        </div>
      </div>`;
  }

  function bindExamRowActions() {
    $$('[data-sheet-pdf]').forEach(b => b.onclick = () => downloadSheetPdf(b.dataset.sheetPdf));
    $$('[data-sheet-png]').forEach(b => b.onclick = () => downloadSheetPng(b.dataset.sheetPng));
    $$('[data-manage-key]').forEach(b => b.onclick = () => manageExamKey(b.dataset.manageKey));
    $$('[data-delete-exam]').forEach(b => b.onclick = () => confirmDeleteExam(b.dataset.deleteExam));
    $$('[data-scan-exam]').forEach(b => b.onclick = () => {
      go('scan');
      $('#scanExam').value = b.dataset.scanExam;
      $('#scanStatusText').textContent = 'Choose the section that this paper belongs to, then scan it.';
    });
  }

  function renderExams() {
    const q = ($('#examSearch')?.value || '').toLowerCase();
    $('#examList').innerHTML = state.exams
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
      try {
        await Store.deleteResult(resultId);
        closeModal();
        await refresh();
        toast('Student result deleted');
      } catch (err) {
        btn.disabled = false;
        btn.textContent = 'Delete result';
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
      await Store.createClass(payload);
      closeModal();
      await refresh();
      toast('Class created');
    };
  }

  function openClass(id) {
    const c = state.classes.find(x => x.id === id);
    const rows = state.results.filter(r => r.class_id === id).slice(0, 8);
    modal(`
      <div class="modal-head"><div><span class="kicker">GRADE ${esc(c?.grade_level || '—')}</span><h3>${esc(classLabel(c))}</h3><p>${esc(c?.school_year || 'School year not set')}</p></div><button class="icon-btn" data-close-modal>✕</button></div>
      <div class="class-summary-strip"><div><small>Saved results</small><strong>${state.results.filter(r => r.class_id === id).length}</strong></div><div><small>Section</small><strong>${esc(classLabel(c))}</strong></div></div>
      <div class="class-results-preview">
        ${rows.length ? rows.map(r => `<div class="class-result-row"><div><strong>${esc(r.student_name || 'Unnamed student')}</strong><small>${esc(examTitle(r.exam_id))}</small></div><b>${r.score}/${r.total_items}</b></div>`).join('') : emptyMini('No results yet', 'Select this section when scanning papers and its results will appear here.')}
      </div>`);
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

    const draw = (keep = []) => {
      const n = Number($('#qCount').value);
      const c = Number($('#choiceCount').value);
      $('#keyGrid').innerHTML = Array.from({ length: n }, (_, i) => `
        <label><span>${i + 1}</span><select data-key="${i}"><option value="">—</option>${Array.from({ length: c }, (_, j) => {
          const v = String.fromCharCode(65 + j);
          return `<option value="${v}" ${keep[i] === v ? 'selected' : ''}>${v}</option>`;
        }).join('')}</select></label>
      `).join('');
    };

    draw();
    $('#qCount').oninput = () => draw($$('[data-key]').map(x => x.value));
    $('#choiceCount').onchange = () => draw($$('[data-key]').map(x => x.value));

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
        const key = $$('[data-key]').map(x => x.value);
        const hasCompleteKey = key.length === payload.question_count && key.every(Boolean);
        const hasPartialKey = key.some(Boolean) && !hasCompleteKey;
        const createdExam = await Store.createExam(payload, hasCompleteKey ? key : []);
        closeModal();
        await refresh();
        toast(hasPartialKey ? 'Exam created. The incomplete key was not saved; add it later.' : 'Exam created');
        showExamCreatedActions(createdExam, hasCompleteKey);
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
      const options = Array.from({ length: Number(exam.choice_count || 4) }, (_, j) => {
        const value = String.fromCharCode(65 + j);
        return `<option value="${value}" ${current === value ? 'selected' : ''}>${value}</option>`;
      }).join('');
      return `<label><span>${i + 1}</span><select data-manual-key="${i}"><option value="">-</option>${options}</select></label>`;
    }).join('');

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
      const key = $$('[data-manual-key]').map(el => el.value);
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
      try {
        await Store.deleteExam(id);
        closeModal();
        await refresh();
        toast('Exam deleted');
      } catch (err) {
        btn.disabled = false;
        btn.textContent = 'Delete exam';
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

    classSelect.innerHTML = '<option value="">Choose a section…</option>' + state.classes.map(c =>
      `<option value="${c.id}">Grade ${esc(c.grade_level || '—')} • ${esc(classLabel(c))}</option>`
    ).join('');
    examSelect.innerHTML = '<option value="">Choose an exam…</option>' + state.exams.map(e =>
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
      window.GradeDockScanner.readStudentName(canvas, result.homography).then(ocr => {
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
    } catch (err) {
      state.scan = null;
      $('#scanConfidence').textContent = 'Needs retake';
      $('#scanConfidence').className = 'badge warn';
      $('#scanStatusText').textContent = err.message;
      toast(err.message, 'warn');
    }
  }

  function renderScanResult() {
    const r = state.scan;
    $('#scanEmpty').classList.add('hidden');
    $('#scanResult').classList.remove('hidden');
    $('#scanConfidence').textContent = `${r.confidence}% confidence`;
    $('#scanConfidence').className = `badge ${r.uncertain ? 'warn' : 'good'}`;
    $('#scanStatusText').textContent = r.uncertain
      ? `${r.uncertain} response${r.uncertain === 1 ? '' : 's'} need teacher confirmation before saving to ${r.className}.`
      : `All responses were read clearly. This result will be saved to ${r.className}.`;

    const choices = ['', ...Array.from({ length: Number(r.exam.choice_count || 4) }, (_, i) => String.fromCharCode(65 + i))];
    const stateLabel = a => {
      if (a.state === 'multiple') return 'Multiple marks — choose one';
      if (a.state === 'blank') return 'No clear mark — confirm blank or choose';
      if (a.state === 'low') return `Light mark detected: ${a.answer || '—'} — confirm`;
      return a.answer ? (a.isCorrect ? '✓ Correct' : `✕ Key: ${a.key}`) : 'Blank';
    };

    $('#scanResult').innerHTML = `
      <div class="scan-section-pill">SECTION: <strong>${esc(r.className)}</strong></div>
      <div class="score-hero"><div><small>SCORE</small><strong id="liveScore">${r.correct}/${r.total}</strong><span id="livePct">${r.percentage}%</span></div><div class="score-ring">${r.percentage}%</div></div>
      <div class="review-help"><strong>Review highlighted items.</strong><span>For Multiple?, Blank?, or Light mark, choose the student's answer and press ✓ Confirm. GradeDock will not save until every highlighted item is checked.</span></div>
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
      <div class="save-scan"><div class="scanned-name-wrap"><input id="scannedStudentName" required placeholder="Student name"><small id="nameOcrStatus">Reading the handwritten name…</small></div><button id="saveScanBtn" class="btn btn-primary" ${r.uncertain ? 'disabled' : ''}>Save to ${esc(r.className)}</button></div>`;

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

    $('#saveScanBtn').onclick = saveScan;
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
      await Store.saveResult(payload, r.answers, state.scanImageBlob);
      state.scan = null;
      state.scanImageBlob = null;
      $('#scanResult').classList.add('hidden');
      $('#scanEmpty').classList.remove('hidden');
      $('#scanStatusText').textContent = `Saved to ${r.className}. Ready for the next paper.`;
      await refresh();
      toast(`Result saved to ${r.className}`);
    } catch (err) { toast(err.message, 'warn'); }
  }

  function exportCsv() {
    const rows = [
      ['Section', 'Grade Level', 'Student', 'Exam', 'Score', 'Total', 'Percentage', 'Review', 'Date'],
      ...state.results.map(r => [
        resultClassLabel(r),
        r.grade_level || state.classes.find(c => c.id === r.class_id)?.grade_level || '',
        r.student_name || 'Unnamed student',
        examTitle(r.exam_id),
        r.score,
        r.total_items,
        r.percentage,
        r.review_count || 0,
        r.created_at
      ])
    ];
    const csv = rows.map(row => row.map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
    const a = document.createElement('a');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    a.href = url;
    a.download = 'gradedock-results-by-section.csv';
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function setCameraQuality(info = {}) {
    const box = $('#cameraQuality');
    const text = $('#cameraQualityText');
    const capture = $('#captureBtn');
    if (!box || !text) return;
    const level = ['good', 'warn', 'neutral'].includes(info.level) ? info.level : 'neutral';
    box.className = `camera-quality ${level}`;
    text.textContent = info.text || 'Align the answer sheet inside the portrait guide.';
    if (capture) capture.classList.toggle('scan-ready', Boolean(info.ready));
  }

  function beginCameraGuidance() {
    const video = $('#cameraVideo');
    window.GradeDockScanner.startGuidance(video, info => {
      setCameraQuality(info);
      if (info.ready) {
        $('#scanStatusText').textContent = 'Ready to scan. Hold steady and capture.';
      }
    });
  }

  function switchScanMode(mode) {
    $('#cameraTab').classList.toggle('active', mode === 'camera');
    $('#uploadTab').classList.toggle('active', mode === 'upload');
    $('#cameraMode').classList.toggle('active', mode === 'camera');
    $('#uploadMode').classList.toggle('active', mode === 'upload');
    if (mode === 'upload') {
      window.GradeDockScanner.stopCamera($('#cameraVideo'));
      setCameraQuality({ level: 'neutral', text: 'Camera off' });
      const torch = $('#torchBtn');
      if (torch) torch.classList.add('hidden');
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
      try {
        await Store.signin({ email: $('#signinEmail').value, password: $('#signinPassword').value });
        await enterApp();
      } catch (err) { toast(err.message, 'warn'); }
    };

    $('#signupForm').onsubmit = async e => {
      e.preventDefault();
      try {
        const d = await Store.signup({ name: $('#signupName').value, email: $('#signupEmail').value, password: $('#signupPassword').value });
        toast(d.session ? 'Account created.' : 'Check your email to confirm the account.');
        if (d.session) await enterApp();
      } catch (err) { toast(err.message, 'warn'); }
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
    $('#exportResultsBtn').onclick = exportCsv;
    $('#menuBtn').onclick = () => $('#sidebar').classList.toggle('open');
    $('#signoutBtn').onclick = async () => {
      window.GradeDockScanner.stopCamera();
      await Store.signout();
      location.reload();
    };

    $('#cameraTab').onclick = () => switchScanMode('camera');
    $('#uploadTab').onclick = () => switchScanMode('upload');

    $('#startCameraBtn').onclick = async () => {
      const context = requireScanContext();
      if (!context) return;
      const startBtn = $('#startCameraBtn');
      const help = $('#cameraHelpText');
      startBtn.disabled = true;
      startBtn.textContent = 'Starting…';
      $('#scanStatusText').textContent = `Opening camera for ${classLabel(context.cls)}…`;
      try {
        const cameraInfo = await window.GradeDockScanner.startCamera($('#cameraVideo'));
        $('#cameraPlaceholder').classList.add('hidden');
        $('#captureBtn').disabled = false;
        startBtn.textContent = 'Restart camera';
        const torch = $('#torchBtn');
        if (torch) {
          torch.classList.toggle('hidden', !cameraInfo?.torchSupported);
          torch.textContent = '🔦 Light';
        }
        if (help) help.textContent = 'Portrait camera ready. Keep the page upright, title at the top, and all four black corner markers visible.';
        $('#scanStatusText').textContent = 'Camera ready. Fit the full answer sheet inside the portrait guide.';
        setCameraQuality({ level: 'neutral', text: 'Checking light, focus, and corner markers…' });
        beginCameraGuidance();
      } catch (err) {
        startBtn.textContent = 'Start camera';
        $('#captureBtn').disabled = true;
        if (help) help.textContent = err.message;
        setCameraQuality({ level: 'warn', text: err.message });
        $('#scanStatusText').textContent = err.message;
        toast(err.message, 'warn');
      } finally {
        startBtn.disabled = false;
      }
    };

    $('#switchCameraBtn').onclick = async () => {
      if (!requireScanContext()) return;
      try {
        const cameraInfo = await window.GradeDockScanner.switchCamera($('#cameraVideo'));
        $('#cameraPlaceholder').classList.add('hidden');
        $('#captureBtn').disabled = false;
        const torch = $('#torchBtn');
        if (torch) {
          torch.classList.toggle('hidden', !cameraInfo?.torchSupported);
          torch.textContent = '🔦 Light';
        }
        $('#scanStatusText').textContent = 'Camera switched. Fit the page inside the portrait guide.';
        setCameraQuality({ level: 'neutral', text: 'Checking light, focus, and corner markers…' });
        beginCameraGuidance();
      } catch (err) {
        $('#scanStatusText').textContent = err.message;
        toast(err.message, 'warn');
      }
    };

    $('#torchBtn').onclick = async () => {
      try {
        const on = await window.GradeDockScanner.toggleTorch();
        $('#torchBtn').textContent = on ? '🔦 Light on' : '🔦 Light';
      } catch (err) {
        toast(err.message, 'warn');
      }
    };

    $('#captureBtn').onclick = async () => {
      if (!requireScanContext()) return;
      try {
        setCameraQuality({ level: 'neutral', text: 'Capturing and checking the paper…' });
        window.GradeDockScanner.stopGuidance();
        const canvas = window.GradeDockScanner.capture($('#cameraVideo'), $('#captureCanvas'));
        const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.94));
        await processCanvas(canvas, blob);
      } finally {
        if (window.GradeDockScanner.stream) beginCameraGuidance();
      }
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
