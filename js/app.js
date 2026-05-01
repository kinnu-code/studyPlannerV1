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
  _overflowApplying:false,
  _rpNewSchedule:  null,
  _currentView:    '',

  _defaultWeeklySchedule() {
    return {
      0:{short:0,long:0}, 1:{short:2,long:1}, 2:{short:2,long:1},
      3:{short:2,long:1}, 4:{short:2,long:1}, 5:{short:2,long:1}, 6:{short:1,long:0}
    };
  },

  // ── Initialisation ────────────────────────────────────────────────────────

  init() {
    UI.updateApiStatus();

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
    if (saved) App.currentPlan = saved;

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
    App.setupSchedule   = Storage.loadDefaultSchedule() || App._defaultWeeklySchedule();
    UI.showStep(1);
    UI.clearAlert('setup-alert');
    UI.renderScheduleTable('schedule-table-container', App.setupSchedule, sched => {
      App.setupSchedule = sched;
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

    UI.initTabs('plan-tabs-container');

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
        topics = await API.topicsFromExamName(examName, msg => UI.showLoading(msg));
      } else if (mode === 'high-level') {
        const lines = topicText.split('\n').map(l => l.trim()).filter(Boolean);
        topics = await API.topicsFromHighLevel(lines, msg => UI.showLoading(msg));
      } else {
        const lines = topicText.split('\n').map(l => l.trim()).filter(Boolean);
        topics = await API.topicsFromGranularList(lines, msg => UI.showLoading(msg));
      }

      App.setupTopics     = topics;
      App.setupStep       = 2;
      App.setupInProgress = true;  // Fix 1: AI has done work — guard against loss
      App._updateResumeButton();

      UI.showStep(2);
      const rcEl = document.getElementById('review-count');
      if (rcEl) rcEl.textContent = `${topics.length} topics`;
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

        if (action.type !== 'recalc_option' && action.type !== 'reset_option') return;
        const sourcePlan = action.type === 'reset_option'
          ? (App.overflowBasePlan || plan)
          : plan;
        const preview = previewOverflowOption(sourcePlan, {
          type: action.optionType,
          value: action.value,
        });
        App._overflowApplying = true;
        App.currentPlan = preview;
        Storage.savePlan(preview);
        App.showPlan(preview);
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
          const plan = await Storage.uploadJSON('.json');
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
    });
  },

  // ── Settings ──────────────────────────────────────────────────────────────

  renderSettings() {
    const settings = Storage.loadSettings() || DEFAULT_SETTINGS;
    UI.renderSettings(settings, document.getElementById('settings-form'));
    App.settingsSchedule = Storage.loadDefaultSchedule() || App._defaultWeeklySchedule();
    UI.renderScheduleTable('settings-schedule-table', App.settingsSchedule, sched => {
      App.settingsSchedule = sched;
    });
    UI.renderApiPanel(document.getElementById('api-panel'));
  },

  saveSettings() {
    const s = UI.collectSettings(document.getElementById('settings-form'));
    Storage.saveSettings(s);
    Storage.saveDefaultSchedule(App.settingsSchedule || App._defaultWeeklySchedule());
    UI.showAlert('settings-alert', 'Settings saved.', 'success');
  },

  resetSettings() {
    Storage.saveSettings(DEFAULT_SETTINGS);
    Storage.saveDefaultSchedule(App._defaultWeeklySchedule());
    UI.renderSettings(DEFAULT_SETTINGS, document.getElementById('settings-form'));
    App.settingsSchedule = Storage.loadDefaultSchedule() || App._defaultWeeklySchedule();
    UI.renderScheduleTable('settings-schedule-table', App.settingsSchedule, sched => {
      App.settingsSchedule = sched;
    });
    UI.showAlert('settings-alert', 'Settings reset to defaults.', 'info');
  },
};

document.addEventListener('DOMContentLoaded', () => App.init());
