/**
 * ui.js — DOM rendering for all views.
 */

const UI = {

  // ── View routing ──────────────────────────────────────────────────────────

  showView(id) {
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    const view = document.getElementById(id);
    if (view) view.classList.add('active');
    document.querySelectorAll('.nav-item').forEach(n => {
      n.classList.toggle('active', n.dataset.view === id);
    });
  },

  setTopbarTitle(title, badgeText = '', badgeClass = '') {
    document.getElementById('topbar-title').textContent = title;
    const badge = document.getElementById('topbar-badge');
    if (badgeText) {
      badge.textContent = badgeText;
      badge.className   = `topbar-badge ${badgeClass}`;
      badge.style.display = '';
    } else {
      badge.style.display = 'none';
    }
  },

  // ── API Key indicator ─────────────────────────────────────────────────────

  updateApiStatus() {
    const key   = Storage.loadApiKey();
    const model = Storage.loadModel();
    const el    = document.getElementById('api-status-badge');
    if (el) {
      el.textContent = key ? `${model} ✓` : 'No API key';
      el.className   = `topbar-badge ${key ? 'ok' : 'warn'}`;
    }
  },

  // ── Alerts ────────────────────────────────────────────────────────────────

  showAlert(containerId, message, type = 'info') {
    const el = document.getElementById(containerId);
    if (!el) return;
    el.innerHTML = `<div class="alert alert-${type}">${message}</div>`;
    el.style.display = '';
  },

  clearAlert(containerId) {
    const el = document.getElementById(containerId);
    if (el) el.innerHTML = '';
  },

  // ── Stepper ───────────────────────────────────────────────────────────────

  updateStepper(currentStep) {
    document.querySelectorAll('.step').forEach(s => {
      const n = parseInt(s.dataset.step);
      s.classList.remove('active', 'done');
      if (n < currentStep) s.classList.add('done');
      if (n === currentStep) s.classList.add('active');
    });
    document.querySelectorAll('.step-connector').forEach(c => {
      const n = parseInt(c.dataset.after);
      c.classList.toggle('done', n < currentStep);
    });
  },

  showStep(step) {
    document.querySelectorAll('[data-step-panel]').forEach(p => {
      p.style.display = parseInt(p.dataset.stepPanel) === step ? '' : 'none';
    });
    UI.updateStepper(step);
  },

  // ── Topic list (review screen) ────────────────────────────────────────────

  renderTopicList(topics, container, onChange) {
    container.innerHTML = '';
    topics.forEach((topic, idx) => {
      const row = document.createElement('div');
      row.className = 'topic-item';
      row.dataset.id = topic.id;

      const handle = document.createElement('span');
      handle.textContent = '⠿';
      handle.style.cssText = 'color:var(--muted);cursor:grab;font-size:16px;';

      const nameInput = document.createElement('input');
      nameInput.type      = 'text';
      nameInput.className = 'topic-item-edit';
      nameInput.value     = topic.name;
      nameInput.addEventListener('change', () => {
        topic.name = nameInput.value;
        onChange?.(topics);
      });

      const sizeSelect = document.createElement('select');
      sizeSelect.className = 'topic-size-select';
      ['S', 'M', 'L'].forEach(sz => {
        const opt = document.createElement('option');
        opt.value       = sz;
        opt.textContent = sz === 'S' ? 'S – Small' : sz === 'M' ? 'M – Medium' : 'L – Large';
        opt.selected    = topic.size === sz;
        sizeSelect.appendChild(opt);
      });
      sizeSelect.addEventListener('change', () => {
        topic.size = sizeSelect.value;
        onChange?.(topics);
      });

      const justif = document.createElement('span');
      justif.className = 'text-xs text-muted';
      justif.textContent = topic.justification || '';

      const removeBtn = document.createElement('button');
      removeBtn.className   = 'topic-remove';
      removeBtn.textContent = '×';
      removeBtn.title       = 'Remove topic';
      removeBtn.addEventListener('click', () => {
        topics.splice(idx, 1);
        UI.renderTopicList(topics, container, onChange);
        onChange?.(topics);
      });

      row.append(handle, nameInput, sizeSelect, removeBtn);
      container.appendChild(row);
    });

    // Add topic button
    const addBtn = document.createElement('button');
    addBtn.className   = 'btn btn-ghost btn-sm mt-8';
    addBtn.textContent = '+ Add topic';
    addBtn.addEventListener('click', () => {
      topics.push({ id: `manual-${Date.now()}`, name: 'New Topic', size: 'M', justification: '' });
      UI.renderTopicList(topics, container, onChange);
      onChange?.(topics);
      container.lastElementChild?.previousElementSibling?.querySelector('input')?.focus();
    });
    container.appendChild(addBtn);
  },

  // ── Weekly schedule table ─────────────────────────────────────────────────

  renderScheduleTable(containerId, schedule, onChange) {
    const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const container = document.getElementById(containerId);
    container.innerHTML = '';
    const grid = document.createElement('div');
    grid.className = 'schedule-table';

    // Header
    const blank = document.createElement('div');
    grid.appendChild(blank);
    DAYS.forEach(d => {
      const h = document.createElement('div');
      h.className   = 'sh';
      h.textContent = d;
      grid.appendChild(h);
    });

    // Short row
    ['short', 'long'].forEach(type => {
      const lbl = document.createElement('div');
      lbl.className   = 'row-label';
      lbl.textContent = type === 'short' ? 'Short sessions' : 'Long sessions';
      grid.appendChild(lbl);

      for (let dow = 0; dow < 7; dow++) {
        const inp = document.createElement('input');
        inp.type      = 'number';
        inp.min       = 0;
        inp.max       = 10;
        inp.value     = (schedule[dow]?.[type]) ?? 0;
        inp.addEventListener('change', () => {
          if (!schedule[dow]) schedule[dow] = { short: 0, long: 0 };
          schedule[dow][type] = Math.max(0, parseInt(inp.value) || 0);
          onChange?.(schedule);
        });
        grid.appendChild(inp);
      }
    });

    container.appendChild(grid);
  },

  // ── Day-by-day plan ───────────────────────────────────────────────────────

  renderDayPlan(plan, container) {
    container.innerHTML = '';

    const activityTypeLabel = {
      first_read:       'First Read',
      first_read_p1:    'First Read (Part 1)',
      first_read_p2:    'First Read (Part 2)',
      sr_review:        'Flashcard Review',
      mcq:              'MCQ Session',
      re_read:          'Re-read',
      weakness_review:  'Weakness Review',
      mock_exam:        'Mock Exam',
    };

    plan.schedule.forEach(day => {
      if (day.sessions.every(s => s.activities.length === 0)) return;

      const block = document.createElement('div');
      block.className = 'day-block';

      const totalActs = day.sessions.reduce((n, s) => n + s.activities.length, 0);
      const isMock    = day.sessions.some(s => s.isMockExam);

      const header = document.createElement('div');
      header.className = 'day-header';
      const formatted = new Date(day.date + 'T00:00:00').toLocaleDateString('en-GB', {
        weekday: 'short', day: 'numeric', month: 'short'
      });
      header.innerHTML = `
        <span class="day-date">${formatted}</span>
        <span class="day-summary">${isMock ? '📝 Mock Exam day' : `${totalActs} activit${totalActs === 1 ? 'y' : 'ies'}`}</span>
        <span class="day-chevron">▶</span>
      `;
      header.addEventListener('click', () => block.classList.toggle('open'));
      block.appendChild(header);

      const body = document.createElement('div');
      body.className = 'day-body';

      day.sessions.forEach((sess, si) => {
        if (sess.activities.length === 0) return;

        const sb = document.createElement('div');
        sb.className = 'session-block';

        const typeClass = sess.isMockExam ? 'mock' : sess.type;
        const typeLabel = sess.isMockExam ? 'Mock Exam' : (sess.type === 'long' ? 'Long' : 'Short');
        sb.innerHTML = `<div class="session-label">Session ${si + 1} <span class="session-type-badge ${typeClass}">${typeLabel} · ${sess.budgetMins} min</span></div>`;

        sess.activities.forEach(act => {
          const row = document.createElement('div');
          row.className = 'activity-row';
          row.innerHTML = `
            <span class="activity-type">${activityTypeLabel[act.type] || act.type}</span>
            <span class="activity-topic">${act.topicName || ''}</span>
            <span class="activity-time">${act.durationMins} min</span>
          `;
          if (act.reason) {
            const reason = document.createElement('div');
            reason.className    = 'activity-reason';
            reason.style.paddingLeft = '130px';
            reason.textContent  = act.reason;
            sb.appendChild(row);
            sb.appendChild(reason);
          } else {
            sb.appendChild(row);
          }
        });

        body.appendChild(sb);
      });

      block.appendChild(body);
      container.appendChild(block);
    });
  },

  // ── Plan summary stats ────────────────────────────────────────────────────

  renderPlanStats(plan, container) {
    const counts = { mastered: 0, healthy: 0, weak: 0, ready: 0, not_started: 0 };
    plan.topics.forEach(t => { if (counts[t.state] !== undefined) counts[t.state]++; });
    const total = plan.topics.length;

    const daysLeft = Math.ceil(
      (new Date(plan.examDate) - new Date()) / 86400000
    );

    container.innerHTML = `
      <div class="card-row">
        <div class="card" style="flex:0 0 auto;min-width:120px;text-align:center;">
          <div style="font-size:28px;font-weight:700;color:var(--state-mastered)">${counts.mastered}</div>
          <div class="text-sm text-muted">Mastered</div>
        </div>
        <div class="card" style="flex:0 0 auto;min-width:120px;text-align:center;">
          <div style="font-size:28px;font-weight:700;color:var(--state-healthy)">${counts.healthy}</div>
          <div class="text-sm text-muted">Healthy</div>
        </div>
        <div class="card" style="flex:0 0 auto;min-width:120px;text-align:center;">
          <div style="font-size:28px;font-weight:700;color:var(--state-weak)">${counts.weak}</div>
          <div class="text-sm text-muted">Weak</div>
        </div>
        <div class="card" style="flex:0 0 auto;min-width:120px;text-align:center;">
          <div style="font-size:28px;font-weight:700;color:var(--primary)">${daysLeft}</div>
          <div class="text-sm text-muted">Days to exam</div>
        </div>
        <div class="card" style="flex:0 0 auto;min-width:120px;text-align:center;">
          <div style="font-size:28px;font-weight:700;">${total}</div>
          <div class="text-sm text-muted">Topics total</div>
        </div>
      </div>
    `;
  },

  // ── Overflow banner ───────────────────────────────────────────────────────

  renderOverflowBanner(overflow, container) {
    if (!overflow) { container.innerHTML = ''; return; }
    container.innerHTML = `
      <div class="overflow-banner">
        <div class="overflow-icon">⚠️</div>
        <div class="overflow-text">
          <h3>Plan Shortfall Detected</h3>
          <p>With your current schedule, ${overflow.achievable} of ${overflow.total} topics will reach
             <strong>${overflow.target}</strong> by exam day.
             ${overflow.shortfall} topic${overflow.shortfall === 1 ? '' : 's'} fall short.</p>
        </div>
      </div>
    `;
  },

  // ── Overflow negotiation options ──────────────────────────────────────────

  renderOverflowOptions(plan, container, onSelect) {
    const opts = [
      {
        type:  'lower_target',
        title: 'Lower target state to Healthy',
        desc:  'Accept Healthy instead of Mastered for all topics.',
        value: 'healthy',
        impact: () => {
          const p = previewOverflowOption(plan, { type: 'lower_target', value: 'healthy' });
          return p.overflow ? `Still ${p.overflow.shortfall} short` : 'Resolves shortfall ✓';
        },
      },
      {
        type:  'lower_mcq_healthy',
        title: 'Reduce MCQ sessions needed for Healthy',
        desc:  `Currently ${plan.settings.mcqForHealthy} — reduce to ${plan.settings.mcqForHealthy - 1}`,
        value: plan.settings.mcqForHealthy - 1,
        show:  plan.settings.mcqForHealthy > 1,
      },
      {
        type:  'lower_mcq_mastery',
        title: 'Reduce MCQ sessions needed for Mastery',
        desc:  `Currently ${plan.settings.mcqForMastery} — reduce to ${plan.settings.mcqForMastery - 1}`,
        value: plan.settings.mcqForMastery - 1,
        show:  plan.settings.mcqForMastery > 2,
      },
      {
        type:  'lower_sr_reviews',
        title: 'Reduce SR reviews required for Mastery',
        desc:  `Currently ${plan.settings.srReviewsForMastery} — reduce to ${plan.settings.srReviewsForMastery - 1}`,
        value: plan.settings.srReviewsForMastery - 1,
        show:  plan.settings.srReviewsForMastery > 1,
      },
      {
        type:  'fewer_mocks',
        title: 'Reduce number of mock exams',
        desc:  `Currently ${plan.settings.numberOfMocks} — reduce to ${plan.settings.numberOfMocks - 1}`,
        value: plan.settings.numberOfMocks - 1,
        show:  plan.settings.numberOfMocks > 0,
      },
    ];

    container.innerHTML = '<p class="text-sm text-muted mb-16">Choose one or more adjustments to resolve the shortfall:</p>';

    opts.filter(o => o.show !== false).forEach(opt => {
      const card = document.createElement('div');
      card.className = 'option-card';
      card.innerHTML = `
        <div class="option-title">${opt.title}</div>
        <div class="option-desc">${opt.desc}</div>
      `;
      card.addEventListener('click', () => onSelect(opt));
      container.appendChild(card);
    });
  },

  // ── Topic table (in plan view) ────────────────────────────────────────────

  renderTopicTable(topics, container) {
    const stateLabel = {
      not_started: 'Not Started',
      ready:       'Ready',
      weak:        'Weak',
      healthy:     'Healthy',
      mastered:    'Mastered',
    };
    container.innerHTML = `
      <table class="data-table">
        <thead>
          <tr>
            <th>Topic</th>
            <th>Size</th>
            <th>State</th>
            <th>Day 0</th>
            <th>MCQs</th>
            <th>SR Reviews</th>
          </tr>
        </thead>
        <tbody>
          ${topics.map(t => `
            <tr>
              <td>${t.name}</td>
              <td><span class="chip chip-${t.size}">${t.size}</span></td>
              <td><span class="state-badge ${t.state}">${stateLabel[t.state] || t.state}</span></td>
              <td class="text-sm text-muted">${t.day0 || '—'}</td>
              <td class="text-sm">${t.mcqCount}</td>
              <td class="text-sm">${t.srReviewCount} / ${t.srReviewsDue?.length || 0}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;
  },

  // ── Settings form ─────────────────────────────────────────────────────────

  renderSettings(settings, container) {
    const s = { ...DEFAULT_SETTINGS, ...settings };

    container.innerHTML = `
      <div class="settings-grid">
        <div>
          <div class="form-group">
            <label>Spaced Repetition Intervals (days between reviews)</label>
            <input type="text" id="setting-sr-intervals" value="${s.srIntervals.join(', ')}" />
            <div class="input-hint">Comma-separated. These are gaps between consecutive reviews, not days from Day 0.</div>
          </div>
          <div class="form-group">
            <label>Target State</label>
            <select id="setting-target">
              <option value="healthy"  ${s.targetState === 'healthy'  ? 'selected' : ''}>Healthy — completed reading and a few MCQ sessions</option>
              <option value="mastered" ${s.targetState === 'mastered' ? 'selected' : ''}>Mastered — full spaced repetition + MCQ threshold met</option>
            </select>
          </div>
          <div class="inline-fields">
            <div class="form-group">
              <label>Short session (min)</label>
              <input type="number" id="setting-short-mins" value="${s.shortSessionMins}" min="10" max="60" />
            </div>
            <div class="form-group">
              <label>Long session (min)</label>
              <input type="number" id="setting-long-mins" value="${s.longSessionMins}" min="30" max="180" />
            </div>
            <div class="form-group">
              <label>Mock exam (min)</label>
              <input type="number" id="setting-mock-mins" value="${s.mockExamMins}" min="30" max="360" />
            </div>
          </div>
          <div class="inline-fields">
            <div class="form-group">
              <label>MCQ sessions → Healthy</label>
              <input type="number" id="setting-mcq-healthy" value="${s.mcqForHealthy}" min="1" max="10" />
            </div>
            <div class="form-group">
              <label>MCQ sessions → Mastery</label>
              <input type="number" id="setting-mcq-mastery" value="${s.mcqForMastery}" min="1" max="15" />
            </div>
            <div class="form-group">
              <label>Min SR reviews → Mastery</label>
              <input type="number" id="setting-sr-mastery" value="${s.srReviewsForMastery}" min="1" max="5" />
            </div>
          </div>
          <div class="form-group">
            <label>Number of mock exams</label>
            <input type="number" id="setting-mocks" value="${s.numberOfMocks}" min="0" max="10" />
          </div>
        </div>

        <div>
          <div class="card-title">Activity time estimates (minutes)</div>
          <table class="time-table">
            <thead>
              <tr><th>Activity</th><th>S</th><th>M</th><th>L</th></tr>
            </thead>
            <tbody>
              ${Object.entries(s.activityTimes).map(([act, times]) => `
                <tr>
                  <td>${act.replace(/([A-Z])/g, ' $1').trim()}</td>
                  ${['S','M','L'].map(sz => `
                    <td><input type="number" data-act="${act}" data-sz="${sz}" value="${times[sz]}" min="1" max="180" /></td>
                  `).join('')}
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>
    `;
  },

  collectSettings(container) {
    const get = id => document.getElementById(id);
    const s = { ...DEFAULT_SETTINGS };

    const intervalsRaw = get('setting-sr-intervals')?.value || '';
    s.srIntervals = intervalsRaw.split(',').map(n => parseInt(n.trim())).filter(n => !isNaN(n));
    s.targetState          = get('setting-target')?.value || 'mastered';
    s.shortSessionMins     = parseInt(get('setting-short-mins')?.value) || 25;
    s.longSessionMins      = parseInt(get('setting-long-mins')?.value) || 60;
    s.mockExamMins         = parseInt(get('setting-mock-mins')?.value) || 120;
    s.mcqForHealthy        = parseInt(get('setting-mcq-healthy')?.value) || 3;
    s.mcqForMastery        = parseInt(get('setting-mcq-mastery')?.value) || 5;
    s.srReviewsForMastery  = parseInt(get('setting-sr-mastery')?.value) || 3;
    s.numberOfMocks        = parseInt(get('setting-mocks')?.value) || 3;

    // Activity times
    s.activityTimes = { ...DEFAULT_SETTINGS.activityTimes };
    container.querySelectorAll('[data-act][data-sz]').forEach(inp => {
      const act = inp.dataset.act;
      const sz  = inp.dataset.sz;
      if (!s.activityTimes[act]) s.activityTimes[act] = {};
      s.activityTimes[act][sz] = parseInt(inp.value) || DEFAULT_SETTINGS.activityTimes[act]?.[sz] || 10;
    });

    return s;
  },

  // ── API / Model settings panel ────────────────────────────────────────────

  renderApiPanel(container) {
    const key   = Storage.loadApiKey();
    const model = Storage.loadModel();

    container.innerHTML = `
      <div class="api-setup-panel">
        <div class="form-group">
          <label>OpenAI API Key</label>
          <div class="api-key-input-row">
            <input type="password" id="api-key-input" value="${key}" placeholder="sk-..." autocomplete="off" />
            <button class="btn btn-outline btn-sm" id="toggle-key-vis">Show</button>
            <button class="btn btn-primary btn-sm" id="save-api-key">Save</button>
          </div>
          <div class="input-hint">Stored only in your browser's local storage. Never sent to any server other than OpenAI.</div>
        </div>
        <div class="form-group">
          <label>Model</label>
          <select id="model-select">
            <option value="o4-mini"       ${model === 'o4-mini'       ? 'selected' : ''}>o4-mini (medium reasoning) — recommended</option>
            <option value="o3-mini"       ${model === 'o3-mini'       ? 'selected' : ''}>o3-mini (medium reasoning)</option>
            <option value="o3"            ${model === 'o3'            ? 'selected' : ''}>o3 (high reasoning)</option>
            <option value="gpt-4o"        ${model === 'gpt-4o'        ? 'selected' : ''}>gpt-4o</option>
            <option value="gpt-4.1"       ${model === 'gpt-4.1'       ? 'selected' : ''}>gpt-4.1</option>
            <option value="gpt-4.5-preview"${model==='gpt-4.5-preview'? 'selected' : ''}>gpt-4.5-preview</option>
            <option value="gpt-4o-mini"   ${model === 'gpt-4o-mini'   ? 'selected' : ''}>gpt-4o-mini (fast, low cost)</option>
            <option value="custom"        ${!['o4-mini','o3-mini','o3','gpt-4o','gpt-4.1','gpt-4.5-preview','gpt-4o-mini'].includes(model) ? 'selected' : ''}>Custom…</option>
          </select>
        </div>
        <div class="form-group" id="custom-model-group" style="display:none;">
          <label>Custom model name</label>
          <input type="text" id="custom-model-input" value="${['o4-mini','o3-mini','o3','gpt-4o','gpt-4.1','gpt-4.5-preview','gpt-4o-mini'].includes(model) ? '' : model}" placeholder="e.g. gpt-4o-2024-11-20" />
        </div>
        <div id="api-test-result"></div>
      </div>
    `;

    // Show/hide custom model input
    document.getElementById('model-select').addEventListener('change', e => {
      document.getElementById('custom-model-group').style.display =
        e.target.value === 'custom' ? '' : 'none';
    });
    if (!['o4-mini','o3-mini','o3','gpt-4o','gpt-4.1','gpt-4.5-preview','gpt-4o-mini'].includes(model)) {
      document.getElementById('custom-model-group').style.display = '';
    }

    // Toggle visibility
    document.getElementById('toggle-key-vis').addEventListener('click', () => {
      const inp = document.getElementById('api-key-input');
      inp.type = inp.type === 'password' ? 'text' : 'password';
    });

    // Save
    document.getElementById('save-api-key').addEventListener('click', async () => {
      const newKey   = document.getElementById('api-key-input').value.trim();
      const modelSel = document.getElementById('model-select').value;
      const newModel = modelSel === 'custom'
        ? (document.getElementById('custom-model-input').value.trim() || 'gpt-4o')
        : modelSel;

      if (!newKey) { UI.showAlert('api-test-result', 'Please enter an API key.', 'warn'); return; }

      const btn = document.getElementById('save-api-key');
      btn.disabled = true;
      btn.innerHTML = '<span class="spinner"></span> Validating…';

      try {
        const valid = await API.validateKey(newKey);
        if (!valid) throw new Error('Key rejected by OpenAI');
        Storage.saveApiKey(newKey);
        Storage.saveModel(newModel);
        UI.showAlert('api-test-result', 'API key saved and validated. Model set to ' + newModel, 'success');
        UI.updateApiStatus();
      } catch (e) {
        UI.showAlert('api-test-result', `Validation failed: ${e.message}`, 'danger');
      } finally {
        btn.disabled = false;
        btn.textContent = 'Save';
      }
    });
  },

  // ── Replan form ───────────────────────────────────────────────────────────

  renderReplanForm(plan, container, onReplan) {
    container.innerHTML = `
      <div class="card">
        <div class="card-title">Update existing plan</div>
        <div class="alert alert-info">
          Current plan: <strong>${plan.name}</strong> — Exam: ${plan.examDate}
        </div>

        <div class="form-group mt-16">
          <label>What needs updating?</label>
          <div id="replan-checkboxes">
            ${[
              { id: 'rp-skipped', label: 'I skipped some sessions' },
              { id: 'rp-ahead',   label: 'I am ahead of schedule' },
              { id: 'rp-schedule',label: 'Update my weekly schedule' },
              { id: 'rp-mocks',   label: 'Change number of mock exams' },
              { id: 'rp-settings',label: 'Update settings' },
              { id: 'rp-exam',    label: 'Exam date changed' },
            ].map(opt => `
              <label style="display:flex;align-items:center;gap:8px;margin-bottom:8px;font-size:13px;font-weight:400;text-transform:none;letter-spacing:0;color:var(--text);">
                <input type="checkbox" id="${opt.id}" />
                ${opt.label}
              </label>
            `).join('')}
          </div>
        </div>

        <div id="rp-skipped-panel" class="form-group" style="display:none;">
          <label>Number of sessions skipped</label>
          <input type="number" id="rp-skip-count" value="0" min="0" />
        </div>
        <div id="rp-ahead-panel" class="form-group" style="display:none;">
          <label>Ahead by how many sessions?</label>
          <input type="number" id="rp-ahead-count" value="0" min="0" />
        </div>
        <div id="rp-mocks-panel" class="form-group" style="display:none;">
          <label>New number of mock exams</label>
          <input type="number" id="rp-mocks-count" value="${plan.settings.numberOfMocks}" min="0" max="10" />
        </div>
        <div id="rp-exam-panel" class="form-group" style="display:none;">
          <label>New exam date</label>
          <input type="date" id="rp-exam-date" value="${plan.examDate}" />
        </div>
        <div id="rp-schedule-panel" style="display:none;">
          <label class="mb-4">New weekly schedule</label>
          <div id="rp-schedule-table"></div>
        </div>

        <div class="btn-group mt-16">
          <button class="btn btn-primary" id="rp-generate">Recalculate Plan</button>
          <button class="btn btn-outline" id="rp-cancel">Cancel</button>
        </div>
      </div>
    `;

    // Show/hide panels
    ['skipped','ahead','schedule','mocks','settings','exam'].forEach(key => {
      document.getElementById(`rp-${key}`)?.addEventListener('change', e => {
        const panel = document.getElementById(`rp-${key}-panel`);
        if (panel) panel.style.display = e.target.checked ? '' : 'none';
        if (key === 'schedule' && e.target.checked) {
          const newSched = JSON.parse(JSON.stringify(plan.weeklySchedule));
          UI.renderScheduleTable('rp-schedule-table', newSched, () => {});
          App._rpNewSchedule = newSched;
        }
      });
    });

    document.getElementById('rp-generate').addEventListener('click', () => {
      const updates = {
        currentDate:    new Date().toISOString().split('T')[0],
        examDate:       document.getElementById('rp-exam')?.checked
          ? document.getElementById('rp-exam-date').value
          : plan.examDate,
        weeklySchedule: App._rpNewSchedule || plan.weeklySchedule,
        numberOfMocks:  document.getElementById('rp-mocks')?.checked
          ? parseInt(document.getElementById('rp-mocks-count').value)
          : plan.settings.numberOfMocks,
      };
      onReplan(updates);
    });

    document.getElementById('rp-cancel').addEventListener('click', () => {
      App.showPlan(App.currentPlan);
    });
  },

  // ── Modal helpers ─────────────────────────────────────────────────────────

  showModal(title, bodyHTML, onConfirm, confirmLabel = 'Confirm') {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
      <div class="modal">
        <div class="modal-title">${title}</div>
        <div class="modal-body">${bodyHTML}</div>
        <div class="modal-footer">
          <button class="btn btn-outline" id="modal-cancel">Cancel</button>
          <button class="btn btn-primary" id="modal-confirm">${confirmLabel}</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
    overlay.querySelector('#modal-cancel').addEventListener('click', () => overlay.remove());
    overlay.querySelector('#modal-confirm').addEventListener('click', () => {
      onConfirm?.();
      overlay.remove();
    });
    overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
    return overlay;
  },

  // ── Loading overlay ───────────────────────────────────────────────────────

  showLoading(message = 'Working…') {
    let el = document.getElementById('loading-overlay');
    if (!el) {
      el = document.createElement('div');
      el.id = 'loading-overlay';
      el.style.cssText = 'position:fixed;inset:0;background:rgba(255,255,255,0.85);display:flex;flex-direction:column;align-items:center;justify-content:center;z-index:2000;gap:16px;';
      document.body.appendChild(el);
    }
    el.innerHTML = `
      <div class="spinner dark" style="width:32px;height:32px;border-width:4px;"></div>
      <div style="font-size:14px;font-weight:500;color:var(--text);">${message}</div>
    `;
    el.style.display = 'flex';
  },

  hideLoading() {
    const el = document.getElementById('loading-overlay');
    if (el) el.style.display = 'none';
  },

  // ── Tabs ──────────────────────────────────────────────────────────────────

  initTabs(containerId) {
    const container = document.getElementById(containerId);
    if (!container) return;
    container.querySelectorAll('.tab').forEach(tab => {
      tab.addEventListener('click', () => {
        container.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
        container.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
        tab.classList.add('active');
        const panel = document.getElementById(tab.dataset.panel);
        if (panel) panel.classList.add('active');
      });
    });
  },
};
