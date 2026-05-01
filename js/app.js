/**
 * app.js — Main application controller and state manager.
 */

const App = {
  currentPlan:     null,
  setupTopics:     [],
  setupSchedule:   { 0:{short:0,long:0},1:{short:2,long:1},2:{short:2,long:1},3:{short:2,long:1},4:{short:2,long:1},5:{short:2,long:1},6:{short:1,long:0} },
  setupStep:       1,
  setupInProgress: false,   // Fix 1: true once AI topics are generated
  replanContext:   'full',  // Fix 3: 'full' | 'schedule_only'
  settingsSchedule:null,
  overflowBasePlan:null,
  updateOptionsBasePlan:null,
  _overflowApplying:false,
  _updateApplying:false,
  _rpNewSchedule:  null,
  _currentView:    '',

  _defaultWeeklySchedule() {
    return {
      0:{short:0,long:0}, 1:{short:2,long:1}, 2:{short:2,long:1},
      3:{short:2,long:1}, 4:{short:2,long:1}, 5:{short:2,long:1}, 6:{short:1,long:0}
    };
  },

  _cloneSchedule(schedule) {
    return JSON.parse(JSON.stringify(schedule || App._defaultWeeklySchedule()));
  },

  _syncDefaultSchedule(schedule, { persist = true, updateSetup = true } = {}) {
    const normalized = App._cloneSchedule(schedule);
    App.settingsSchedule = App._cloneSchedule(normalized);
    if (updateSetup) {
      App.setupSchedule = App._cloneSchedule(normalized);
    }
    if (persist) {
      Storage.saveDefaultSchedule(App.settingsSchedule);
    }
  },

  _buildAdjustedPlan(sourcePlan, options = {}) {
    let next = sourcePlan;
    if (typeof options.targetState === 'string') {
      next = previewOverflowOption(next, { type: 'lower_target', value: options.targetState });
    }
    if (Number.isFinite(parseInt(options.mcqForHealthy))) {
      next = previewOverflowOption(next, { type: 'lower_mcq_healthy', value: parseInt(options.mcqForHealthy) });
    }
    if (Number.isFinite(parseInt(options.mcqForMastery))) {
      next = previewOverflowOption(next, { type: 'lower_mcq_mastery', value: parseInt(options.mcqForMastery) });
    }
    if (Number.isFinite(parseInt(options.srReviewsForMastery))) {
      next = previewOverflowOption(next, { type: 'lower_sr_reviews', value: parseInt(options.srReviewsForMastery) });
    }
    if (Number.isFinite(parseInt(options.numberOfMocks))) {
      next = previewOverflowOption(next, { type: 'fewer_mocks', value: parseInt(options.numberOfMocks) });
    }
    return next;
  },

  _hasDay0OrderingAnomaly(plan) {
    const topics = plan?.topics || [];
    for (let i = 1; i < topics.length; i++) {
      const prev = topics[i - 1];
      const curr = topics[i];
      if (prev?.day0 && curr?.day0 && curr.day0 < prev.day0) {
        return true;
      }
    }
    return false;
  },

  _rebuildPlanWithLatestLogic(plan) {
    return generatePlan({
      name: plan.name,
      topics: (plan.topics || []).map(t => ({
        id: t.id,
        name: t.name,
        size: t.size,
        startingState: t.startingState || 'not_started',
      })),
      examDate: plan.examDate,
      startDate: plan.startDate,
      weeklySchedule: plan.weeklySchedule,
      settings: plan.settings,
    });
  },

  _normalizeLoadedPlan(plan) {
    if (!plan) return plan;
    if (!App._hasDay0OrderingAnomaly(plan)) return plan;

    const repaired = App._rebuildPlanWithLatestLogic(plan);
    repaired._autoRepaired = true;
    return repaired;
  },

  clearCachedPlans() {
    UI.showModal(
      'Clear Cached Plans',
      '<p>This will remove all cached plans from app memory and browser local storage.</p><p class="text-sm text-muted mt-8">Downloaded files on your local drive are not deleted.</p>',
      () => {
        Storage.clearCachedPlans();
        App.currentPlan = null;
        App.setupTopics = [];
        App.setupInProgress = false;
        App.setupStep = 1;
        App.replanContext = 'full';
        App.overflowBasePlan = null;
        App.updateOptionsBasePlan = null;
        App.renderHome();
        UI.showAlert('home-content', 'Cached plans cleared. Downloaded files on your drive were not changed.', 'success');
      },
      'Clear Cache'
    );
  },

  editTopicsFromUpdate() {
    if (!App.currentPlan) return;

    const draftTopics = App.currentPlan.topics.map(t => ({
      id: t.id,
      name: t.name,
      size: t.size,
      startingState: t.startingState || 'not_started',
      justification: t.justification || '',
    }));

    const modal = UI.showModal(
      'Update Topics',
      '<div class="text-sm text-muted mb-8">Edit, reorder, resize, or adjust starting state. Saving recalculates the plan.</div><div id="update-topic-editor"></div>',
      () => {
        if (!draftTopics.length) {
          UI.showAlert('update-alert', 'Please keep at least one topic.', 'warn');
          return;
        }

        UI.showLoading('Updating topics and recalculating plan…');
        setTimeout(() => {
          try {
            const updated = replan(App.currentPlan, {
              currentDate: new Date().toISOString().split('T')[0],
              examDate: App.currentPlan.examDate,
              weeklySchedule: App.currentPlan.weeklySchedule,
              skippedSessions: 0,
              aheadSessions: 0,
              topics: draftTopics,
            });
            App.currentPlan = updated;
            Storage.savePlan(updated);
            App._updateApplying = true;
            App.renderUpdateEntry();
            UI.showAlert('update-alert', 'Topics updated successfully.', 'success');
          } catch (e) {
            UI.showAlert('update-alert', `Failed to update topics: ${e.message}`, 'danger');
          } finally {
            UI.hideLoading();
          }
        }, 60);
      },
      'Save Topics'
    );

    const editor = modal.querySelector('#update-topic-editor');
    UI.renderTopicList(draftTopics, editor, updated => {
      draftTopics.splice(0, draftTopics.length, ...updated);
    });
  },

  // ── Initialisation ────────────────────────────────────────────────────────

  init() {
    UI.updateApiStatus();
    App.settingsSchedule = Storage.loadDefaultSchedule() || App._defaultWeeklySchedule();

    // Nav items
    document.querySelectorAll('.nav-item').forEach(item => {
      item.addEventListener('click', () => {
        const view = item.dataset.view;
        if (!view) return;
        // Fix 1: sidebar "New Plan" click while setup is in progress → resume, don't reset
        if (view === 'view-setup' && App.setupInProgress) {
          App._resumeSetup();
          return;
        }
        App.navigate(view);
      });
    });

    // Fix 1: Resume Setup button in topbar
    document.getElementById('btn-resume-setup')?.addEventListener('click', () => {
      App._resumeSetup();
    });

    // Load saved plan
    const saved = Storage.loadPlan();
    if (saved) {
      const normalized = App._normalizeLoadedPlan(saved);
      App.currentPlan = normalized;
      if (normalized !== saved) {
        Storage.savePlan(normalized);
      }
    }

    App.navigate('view-home');
    App.setupListeners();
  },

  // Fix 1: return to setup view at the exact step the user was on
  _resumeSetup() {
    UI.showView('view-setup');
    App._currentView = 'view-setup';
    UI.setTopbarTitle('New Plan', `Step ${App.setupStep}`, '');
    UI.showStep(App.setupStep);
    // Re-render the topic list in case DOM was wiped
    if (App.setupStep >= 2 && App.setupTopics.length) {
      const rcEl = document.getElementById('review-count');
      if (rcEl) rcEl.textContent = `${App.setupTopics.length} topics`;
      UI.renderTopicList(
        App.setupTopics,
        document.getElementById('topic-review-list'),
        updated => { App.setupTopics = updated; }
      );
    }
    App._updateResumeButton();
  },

  // Fix 1: show/hide the "Resume Setup" topbar button
  _updateResumeButton() {
    const btn = document.getElementById('btn-resume-setup');
    if (!btn) return;
    btn.style.display = (App.setupInProgress && App._currentView !== 'view-setup') ? '' : 'none';
  },

  navigate(viewId) {
    UI.showView(viewId);
    App._currentView = viewId;
    App._updateResumeButton();  // Fix 1

    switch (viewId) {
      case 'view-home':
        UI.setTopbarTitle('Smart Study Planner');
        App.renderHome();
        break;
      case 'view-setup':
        // Fix 1: only reset if no in-progress work
        if (!App.setupInProgress) {
          UI.setTopbarTitle('New Plan', 'Step 1', '');
          App.startSetup();
        } else {
          App._resumeSetup();
        }
        break;
      case 'view-plan':
        UI.setTopbarTitle(App.currentPlan?.name || 'Study Plan', 'Active', 'ok');
        App.showPlan(App.currentPlan);
        break;
      case 'view-settings':
        UI.setTopbarTitle('Settings');
        App.renderSettings();
        break;
      case 'view-update':
        UI.setTopbarTitle('Update Plan');
        App.updateOptionsBasePlan = null;
        App._updateApplying = false;
        App.renderUpdateEntry();
        break;
    }
  },

  // ── Home ──────────────────────────────────────────────────────────────────

  renderHome() {
    const hasPlan = !!App.currentPlan;
    const el = document.getElementById('home-content');
    if (!el) return;

    if (!Storage.loadApiKey()) {
      el.innerHTML = `
        <div class="alert alert-warn">
          <strong>No API key set.</strong> Add your OpenAI API key in Settings before generating a plan.
        </div>
      `;
    } else {
      el.innerHTML = '';
    }

    document.getElementById('home-has-plan').style.display = hasPlan ? '' : 'none';
    document.getElementById('home-no-plan').style.display  = hasPlan ? 'none' : '';
    if (hasPlan) {
      document.getElementById('home-plan-name').textContent = App.currentPlan.name;
      document.getElementById('home-plan-exam').textContent = App.currentPlan.examDate;
      const counts = { mastered: 0, healthy: 0, weak: 0 };
      App.currentPlan.topics.forEach(t => { if (counts[t.state] !== undefined) counts[t.state]++; });
      document.getElementById('home-plan-stats').textContent =
        `${counts.mastered} mastered · ${counts.healthy} healthy · ${counts.weak} weak`;
    }
  },

  // ── Setup wizard ──────────────────────────────────────────────────────────

  startSetup() {
    App.setupStep       = 1;
    App.setupTopics     = [];
    App.setupInProgress = false;  // Fix 1: fresh start clears flag
    App._syncDefaultSchedule(Storage.loadDefaultSchedule() || App._defaultWeeklySchedule(), { persist: false, updateSetup: true });
    UI.showStep(1);
    UI.clearAlert('setup-alert');
    UI.renderScheduleTable('schedule-table-container', App.setupSchedule, sched => {
      App._syncDefaultSchedule(sched, { persist: true, updateSetup: true });
    });
    App._updateResumeButton();
  },

  setupListeners() {

    // ── Step 1: topic mode ────────────────────────────────────────────────

    document.querySelectorAll('.radio-card').forEach(card => {
      card.querySelector('input[type=radio]')?.addEventListener('change', () => {
        document.querySelectorAll('.radio-card').forEach(c => c.classList.remove('selected'));
        card.classList.add('selected');
      });
      card.addEventListener('click', () => {
        const radio = card.querySelector('input[type=radio]');
        if (radio) { radio.checked = true; radio.dispatchEvent(new Event('change')); }
      });
    });

    document.getElementById('btn-upload-topics')?.addEventListener('click', async () => {
      try {
        const text = await Storage.uploadText('.txt,.csv,.md');
        document.getElementById('topic-textarea').value = text;
      } catch (e) {
        UI.showAlert('setup-alert', e.message, 'warn');
      }
    });

    document.getElementById('btn-step1-next')?.addEventListener('click', () => App.step1Next());

    // ── Step 2: review + dates + schedule ────────────────────────────────

    document.getElementById('btn-step2-back')?.addEventListener('click', () => {
      App.setupStep = 1; UI.showStep(1);
    });
    document.getElementById('btn-step2-next')?.addEventListener('click', () => App.step2Next());

    // ── Step 3: generate ──────────────────────────────────────────────────

    document.getElementById('btn-step3-back')?.addEventListener('click', () => {
      App.setupStep = 2; UI.showStep(2);
    });
    document.getElementById('btn-step3-generate')?.addEventListener('click', () => App.generatePlan());

    // Fix 1: Settings shortcut from step 3 — user returns here after editing settings
    document.getElementById('btn-goto-settings')?.addEventListener('click', () => {
      App.navigate('view-settings');
    });

    // ── Home buttons ──────────────────────────────────────────────────────

    document.getElementById('btn-view-plan')?.addEventListener('click', () => App.navigate('view-plan'));
    document.getElementById('btn-update-plan')?.addEventListener('click', () => {
      App.replanContext = 'full';
      App.navigate('view-update');
    });
    document.getElementById('btn-clear-cached-plan')?.addEventListener('click', () => App.clearCachedPlans());
    document.getElementById('btn-clear-cached-plan-empty')?.addEventListener('click', () => App.clearCachedPlans());
    document.getElementById('btn-new-plan')?.addEventListener('click', () => {
      App.setupInProgress = false;  // explicit new plan from home resets
      App.navigate('view-setup');
    });

    // ── Plan view buttons ─────────────────────────────────────────────────

    document.getElementById('btn-export-plan')?.addEventListener('click', () => {
      if (App.currentPlan) Storage.exportPlan(App.currentPlan);
    });
    document.getElementById('btn-replan')?.addEventListener('click', () => {
      App.replanContext = 'full';   // Fix 3: schedule tab button → full form
      UI.showView('view-update');
      App._currentView = 'view-update';
      App._updateResumeButton();
      App.renderUpdateEntry();
    });

    // ── Plan tabs ─────────────────────────────────────────────────────────

    UI.initTabs('plan-tabs-container', panelId => {
      if (panelId === 'tab-timeline' && App.currentPlan) {
        requestAnimationFrame(() => {
          const chartContainer = document.getElementById('timeline-chart');
          if (chartContainer) Chart.renderTimeline(App.currentPlan, chartContainer);
          const summaryChart = document.getElementById('summary-chart');
          if (summaryChart) Chart.renderSummary(App.currentPlan, summaryChart);
        });
      }
    });

    // ── Settings ──────────────────────────────────────────────────────────

    document.getElementById('btn-save-settings')?.addEventListener('click', () => App.saveSettings());
    document.getElementById('btn-reset-settings')?.addEventListener('click', () => App.resetSettings());
  },

  // ── Step 1: resolve topics ────────────────────────────────────────────────

  async step1Next() {
    if (!Storage.loadApiKey()) {
      UI.showAlert('setup-alert', 'Please set your OpenAI API key in Settings first.', 'warn');
      return;
    }

    const mode      = document.querySelector('input[name="topic-mode"]:checked')?.value || 'exam';
    const examName  = document.getElementById('exam-name-input')?.value?.trim();
    const topicText = document.getElementById('topic-textarea')?.value?.trim();
    const tips      = document.getElementById('topic-generator-tips')?.value?.trim() || '';

    if (mode === 'exam' && !examName) {
      UI.showAlert('setup-alert', 'Please enter the exam name.', 'warn');
      return;
    }
    if ((mode === 'high-level' || mode === 'granular') && !topicText) {
      UI.showAlert('setup-alert', 'Please enter or upload your topic list.', 'warn');
      return;
    }

    UI.showLoading('Generating topic list…');
    UI.clearAlert('setup-alert');

    try {
      let topics;
      if (mode === 'exam') {
        topics = await API.topicsFromExamName(examName, tips, msg => UI.showLoading(msg));
      } else if (mode === 'high-level') {
        const lines = topicText.split('\n').map(l => l.trim()).filter(Boolean);
        topics = await API.topicsFromHighLevel(lines, tips, msg => UI.showLoading(msg));
      } else {
        const lines = topicText.split('\n').map(l => l.trim()).filter(Boolean);
        topics = await API.topicsFromGranularList(lines, tips, msg => UI.showLoading(msg));
      }

      App.setupTopics     = topics.map(t => ({ ...t, startingState: t.startingState || 'not_started' }));
      App.setupStep       = 2;
      App.setupInProgress = true;  // Fix 1: AI has done work — guard against loss
      App._updateResumeButton();

      UI.showStep(2);
      const rcEl = document.getElementById('review-count');
      if (rcEl) rcEl.textContent = `${App.setupTopics.length} topics`;
      UI.renderTopicList(
        App.setupTopics,
        document.getElementById('topic-review-list'),
        updated => { App.setupTopics = updated; }
      );
      UI.showAlert('setup-alert-2',
        `${topics.length} topics ready. Review and adjust sizes, then set your dates and schedule below.`, 'success');

    } catch (e) {
      UI.showAlert('setup-alert', `Error: ${e.message}`, 'danger');
    } finally {
      UI.hideLoading();
    }
  },

  // ── Step 2: dates + schedule ──────────────────────────────────────────────

  step2Next() {
    const startDate = document.getElementById('start-date')?.value;
    const examDate  = document.getElementById('exam-date')?.value;
    const planName  = document.getElementById('plan-name')?.value?.trim();

    if (!startDate || !examDate) {
      UI.showAlert('setup-alert-2', 'Please set both start and exam dates.', 'warn');
      return;
    }
    if (new Date(examDate) <= new Date(startDate)) {
      UI.showAlert('setup-alert-2', 'Exam date must be after start date.', 'warn');
      return;
    }
    if (!planName) {
      UI.showAlert('setup-alert-2', 'Please give your plan a name.', 'warn');
      return;
    }

    App.planName  = planName;
    App.startDate = startDate;
    App.examDate  = examDate;
    App.setupStep = 3;
    UI.showStep(3);
  },

  // ── Generate plan ─────────────────────────────────────────────────────────

  async generatePlan() {
    const settings = Storage.loadSettings() || {};

    UI.showLoading('Building your study plan…');

    try {
      await new Promise(r => setTimeout(r, 60));

      const plan = generatePlan({
        name:           App.planName,
        topics:         App.setupTopics,
        examDate:       App.examDate,
        startDate:      App.startDate,
        weeklySchedule: App.setupSchedule,
        settings,
      });

      App.currentPlan     = plan;
      App.setupInProgress = false;  // Fix 1: work is complete, button gone
      App._updateResumeButton();
      Storage.savePlan(plan);

      UI.hideLoading();
      App.showPlan(plan);

    } catch (e) {
      UI.hideLoading();
      UI.showAlert('setup-alert-3', `Plan generation failed: ${e.message}`, 'danger');
    }
  },

  // ── Show plan ─────────────────────────────────────────────────────────────

  showPlan(plan) {
    if (!plan) { App.navigate('view-home'); return; }

    // Keep a stable baseline while iterating through overflow adjustments.
    if (!App._overflowApplying) {
      App.overflowBasePlan = plan?.overflow ? JSON.parse(JSON.stringify(plan)) : null;
    }
    App._overflowApplying = false;

    UI.showView('view-plan');
    App._currentView = 'view-plan';
    App._updateResumeButton();
    UI.setTopbarTitle(plan.name, 'Active Plan', 'ok');

    if (plan._autoRepaired) {
      UI.showAlert(
        'update-alert',
        'This plan was automatically refreshed with the latest planning logic to fix legacy topic-order timing anomalies.',
        'info'
      );
      delete plan._autoRepaired;
      Storage.savePlan(plan);
    }

    UI.renderPlanStats(plan, document.getElementById('plan-stats'));
    UI.renderOverflowBanner(plan.overflow, document.getElementById('plan-overflow-banner'));

    // Fix 2 + Fix 3: overflow options include schedule editor; overflow "update" → schedule_only form
    const overflowOpts = document.getElementById('plan-overflow-options');
    if (plan.overflow && overflowOpts) {
      overflowOpts.style.display = '';
      UI.renderOverflowOptions(plan, App.overflowBasePlan || plan, overflowOpts, action => {
        if (action.type === 'update_schedule_nav') {
          // Fix 3: navigate to update view but only show schedule controls
          App.replanContext = 'schedule_only';
          App.navigate('view-update');
          return;
        }

        if (action.type === 'reset_all_overflow') {
          if (!App.overflowBasePlan) return;
          const restored = JSON.parse(JSON.stringify(App.overflowBasePlan));
          App.currentPlan = restored;
          Storage.savePlan(restored);
          App.showPlan(restored);
          return;
        }

        if (action.type === 'recalculate_all' || action.type === 'view_updated_plan') {
          const preview = App._buildAdjustedPlan(plan, action.options || {});
          App._overflowApplying = true;
          App.currentPlan = preview;
          Storage.savePlan(preview);
          App.showPlan(preview);
        }
      });
    } else if (overflowOpts) {
      overflowOpts.style.display = 'none';
    }

    const chartContainer = document.getElementById('timeline-chart');
    if (chartContainer) Chart.renderTimeline(plan, chartContainer);

    const summaryChart = document.getElementById('summary-chart');
    if (summaryChart) Chart.renderSummary(plan, summaryChart);

    const dayPlan = document.getElementById('day-plan-list');
    if (dayPlan) UI.renderDayPlan(plan, dayPlan);

    const topicTable = document.getElementById('topic-table');
    if (topicTable) UI.renderTopicTable(plan.topics, topicTable);

    const promptBanner = document.getElementById('plan-happy-prompt');
    if (promptBanner) {
      promptBanner.innerHTML = `
        <div class="alert alert-info" style="margin-top:16px;">
          <span>Happy with this plan?</span>
          <button class="btn btn-primary btn-sm" style="margin-left:16px;"
            onclick="Storage.exportPlan(App.currentPlan)">⬇ Download Plan</button>
          <button class="btn btn-outline btn-sm" style="margin-left:8px;"
            onclick="App.replanContext='full';App.navigate('view-update')">Update Plan</button>
        </div>
      `;
    }
  },

  // ── Update / replan entry ─────────────────────────────────────────────────

  renderUpdateEntry() {
    const container = document.getElementById('update-content');
    if (!container) return;

    if (!App.currentPlan) {
      container.innerHTML = `
        <div class="card">
          <div class="card-title">Load existing plan</div>
          <p class="text-sm text-muted mb-16">No plan is in memory. Upload your saved plan files to continue.</p>
          <div class="btn-group">
            <button class="btn btn-primary" id="btn-upload-plan">Upload plan.json</button>
            <button class="btn btn-outline" id="btn-start-fresh">Start a new plan instead</button>
          </div>
          <div id="upload-alert" class="mt-16"></div>
        </div>
      `;
      document.getElementById('btn-upload-plan').addEventListener('click', async () => {
        try {
          const uploaded = await Storage.uploadJSON('.json');
          const plan = App._normalizeLoadedPlan(uploaded);
          App.currentPlan = plan;
          Storage.savePlan(plan);
          App.renderUpdateEntry();
        } catch (e) {
          UI.showAlert('upload-alert', e.message, 'danger');
        }
      });
      document.getElementById('btn-start-fresh').addEventListener('click', () => {
        App.setupInProgress = false;
        App.navigate('view-setup');
      });
      return;
    }

    if (!App._updateApplying) {
      App.updateOptionsBasePlan = JSON.parse(JSON.stringify(App.currentPlan));
    }
    App._updateApplying = false;

    // Fix 3: pass context so the form shows/hides the right sections
    UI.renderReplanForm(App.currentPlan, container, App.replanContext, updates => {
      UI.showLoading('Recalculating plan…');
      setTimeout(() => {
        try {
          const payload = { ...updates };
          if (updates.useLatestSettings) {
            payload.settings = Storage.loadSettings() || App.currentPlan.settings;
          }
          const newPlan = replan(App.currentPlan, payload);
          App.currentPlan = newPlan;
          Storage.savePlan(newPlan);
          UI.hideLoading();
          App.showPlan(newPlan);
        } catch (e) {
          UI.hideLoading();
          UI.showAlert('update-alert', `Replan failed: ${e.message}`, 'danger');
        }
      }, 60);
    }, () => App.editTopicsFromUpdate());

    const shortcutsWrap = document.createElement('div');
    shortcutsWrap.className = 'card';
    shortcutsWrap.innerHTML = `
      <div class="card-title">Quick Plan-Fit Adjustments</div>
      <div class="input-hint mb-16">Same flexibility as shortfall controls. Adjust fields, then recalculate once.</div>
      <div id="update-overflow-controls"></div>
      <div class="btn-group mt-16">
        <button class="btn btn-outline" id="btn-update-open-settings">Update Settings</button>
      </div>
    `;
    container.appendChild(shortcutsWrap);

    document.getElementById('btn-update-open-settings')?.addEventListener('click', () => {
      App.navigate('view-settings');
    });

    const controlsEl = document.getElementById('update-overflow-controls');
    UI.renderOverflowOptions(
      App.currentPlan,
      App.updateOptionsBasePlan || App.currentPlan,
      controlsEl,
      action => {
        if (action.type === 'update_schedule_nav') {
          App.replanContext = 'schedule_only';
          App.renderUpdateEntry();
          return;
        }

        if (action.type === 'reset_all_overflow') {
          if (!App.updateOptionsBasePlan) return;
          const restored = JSON.parse(JSON.stringify(App.updateOptionsBasePlan));
          App.currentPlan = restored;
          Storage.savePlan(restored);
          App._updateApplying = true;
          App.renderUpdateEntry();
          UI.showAlert('update-alert', 'Adjustment reset to original values.', 'info');
          return;
        }

        if (action.type !== 'recalculate_all' && action.type !== 'view_updated_plan') return;
        const preview = App._buildAdjustedPlan(App.currentPlan, action.options || {});
        App.currentPlan = preview;
        Storage.savePlan(preview);

        if (action.type === 'view_updated_plan') {
          App.showPlan(preview);
          return;
        }

        App._updateApplying = true;
        App.renderUpdateEntry();
        UI.showAlert('update-alert', 'Plan recalculated with the selected adjustments.', 'success');
      }
    );
  },

  // ── Settings ──────────────────────────────────────────────────────────────

  renderSettings() {
    const settings = Storage.loadSettings() || DEFAULT_SETTINGS;
    UI.renderSettings(settings, document.getElementById('settings-form'));
    App._syncDefaultSchedule(Storage.loadDefaultSchedule() || App.settingsSchedule || App._defaultWeeklySchedule(), { persist: false, updateSetup: true });
    UI.renderScheduleTable('settings-schedule-table', App.settingsSchedule, sched => {
      App._syncDefaultSchedule(sched, { persist: true, updateSetup: true });
    });
    UI.renderApiPanel(document.getElementById('api-panel'));
  },

  saveSettings() {
    const s = UI.collectSettings(document.getElementById('settings-form'));
    Storage.saveSettings(s);
    App._syncDefaultSchedule(App.settingsSchedule || App._defaultWeeklySchedule(), { persist: true, updateSetup: true });
    UI.showAlert('settings-alert', 'Settings saved.', 'success');
  },

  resetSettings() {
    Storage.saveSettings(DEFAULT_SETTINGS);
    App._syncDefaultSchedule(App._defaultWeeklySchedule(), { persist: true, updateSetup: true });
    UI.renderSettings(DEFAULT_SETTINGS, document.getElementById('settings-form'));
    UI.renderScheduleTable('settings-schedule-table', App.settingsSchedule, sched => {
      App._syncDefaultSchedule(sched, { persist: true, updateSetup: true });
    });
    UI.showAlert('settings-alert', 'Settings reset to defaults.', 'info');
  },
};

document.addEventListener('DOMContentLoaded', () => App.init());
