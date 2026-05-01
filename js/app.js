/**
 * app.js — Main application controller and state manager.
 */

const App = {
  currentPlan:    null,
  setupTopics:    [],
  setupSchedule:  { 0:{short:0,long:0},1:{short:2,long:1},2:{short:2,long:1},3:{short:2,long:1},4:{short:2,long:1},5:{short:2,long:1},6:{short:1,long:0} },
  setupStep:      1,
  _rpNewSchedule: null,

  // ── Initialisation ────────────────────────────────────────────────────────

  init() {
    UI.updateApiStatus();

    // Nav
    document.querySelectorAll('.nav-item').forEach(item => {
      item.addEventListener('click', () => {
        const view = item.dataset.view;
        if (view) App.navigate(view);
      });
    });

    // Load saved plan
    const saved = Storage.loadPlan();
    if (saved) {
      App.currentPlan = saved;
    }

    App.navigate('view-home');
    App.setupListeners();
  },

  navigate(viewId) {
    UI.showView(viewId);

    switch (viewId) {
      case 'view-home':
        UI.setTopbarTitle('Smart Study Planner');
        App.renderHome();
        break;
      case 'view-setup':
        UI.setTopbarTitle('New Plan', 'Step 1', '');
        App.startSetup();
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

    document.getElementById('home-has-plan').style.display  = hasPlan ? '' : 'none';
    document.getElementById('home-no-plan').style.display   = hasPlan ? 'none' : '';
    if (hasPlan) {
      document.getElementById('home-plan-name').textContent  = App.currentPlan.name;
      document.getElementById('home-plan-exam').textContent  = App.currentPlan.examDate;
      const counts = { mastered: 0, healthy: 0, weak: 0 };
      App.currentPlan.topics.forEach(t => { if (counts[t.state] !== undefined) counts[t.state]++; });
      document.getElementById('home-plan-stats').textContent =
        `${counts.mastered} mastered · ${counts.healthy} healthy · ${counts.weak} weak`;
    }
  },

  // ── Setup wizard ──────────────────────────────────────────────────────────

  startSetup() {
    App.setupStep    = 1;
    App.setupTopics  = [];
    App.setupSchedule = {
      0:{short:0,long:0}, 1:{short:2,long:1}, 2:{short:2,long:1},
      3:{short:2,long:1}, 4:{short:2,long:1}, 5:{short:2,long:1}, 6:{short:1,long:0}
    };
    UI.showStep(1);
    UI.clearAlert('setup-alert');
    UI.renderScheduleTable('schedule-table-container', App.setupSchedule, sched => {
      App.setupSchedule = sched;
    });
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

    // ── Step 2: dates + schedule ─────────────────────────────────────────

    document.getElementById('btn-step2-back')?.addEventListener('click', () => {
      App.setupStep = 1; UI.showStep(1);
    });
    document.getElementById('btn-step2-next')?.addEventListener('click', () => App.step2Next());

    // ── Step 3: review topics ─────────────────────────────────────────────

    document.getElementById('btn-step3-back')?.addEventListener('click', () => {
      App.setupStep = 2; UI.showStep(2);
    });
    document.getElementById('btn-step3-generate')?.addEventListener('click', () => App.generatePlan());
    document.getElementById('btn-step3-back')?.addEventListener('click', () => {
      App.setupStep = 2; UI.showStep(2);
    });

    // ── Home buttons ──────────────────────────────────────────────────────

    document.getElementById('btn-view-plan')?.addEventListener('click', () => App.navigate('view-plan'));
    document.getElementById('btn-update-plan')?.addEventListener('click', () => App.navigate('view-update'));
    document.getElementById('btn-new-plan')?.addEventListener('click', () => App.navigate('view-setup'));
    document.getElementById('btn-new-plan-2')?.addEventListener('click', () => App.navigate('view-setup'));

    // ── Plan view buttons ─────────────────────────────────────────────────

    document.getElementById('btn-export-plan')?.addEventListener('click', () => {
      if (App.currentPlan) Storage.exportPlan(App.currentPlan);
    });
    document.getElementById('btn-replan')?.addEventListener('click', () => {
      UI.showView('view-update');
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

    const mode = document.querySelector('input[name="topic-mode"]:checked')?.value || 'exam';
    const examName = document.getElementById('exam-name-input')?.value?.trim();
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

      App.setupTopics = topics;
      App.setupStep   = 2;
      UI.showStep(2);
      const rcEl = document.getElementById('review-count');
      if (rcEl) rcEl.textContent = `${topics.length} topics`;
      UI.renderTopicList(
        App.setupTopics,
        document.getElementById('topic-review-list'),
        updated => { App.setupTopics = updated; }
      );
      UI.showAlert('setup-alert-2',
        `${topics.length} topics ready. Review and adjust sizes before continuing.`, 'success');

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
      UI.showAlert('setup-alert', 'Please set both start and exam dates.', 'warn');
      return;
    }
    if (new Date(examDate) <= new Date(startDate)) {
      UI.showAlert('setup-alert', 'Exam date must be after start date.', 'warn');
      return;
    }
    if (!planName) {
      UI.showAlert('setup-alert', 'Please give your plan a name.', 'warn');
      return;
    }

    App.planName   = planName;
    App.startDate  = startDate;
    App.examDate   = examDate;
    App.setupStep  = 3;
    UI.showStep(3);
  },

  // ── Generate plan ─────────────────────────────────────────────────────────

  async generatePlan() {
    const settings = Storage.loadSettings() || {};

    UI.showLoading('Building your study plan…');

    try {
      // Small async pause so the loading UI renders
      await new Promise(r => setTimeout(r, 60));

      const plan = generatePlan({
        name:           App.planName,
        topics:         App.setupTopics,
        examDate:       App.examDate,
        startDate:      App.startDate,
        weeklySchedule: App.setupSchedule,
        settings,
      });

      App.currentPlan = plan;
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
    UI.showView('view-plan');
    UI.setTopbarTitle(plan.name, 'Active Plan', 'ok');

    // Stats
    UI.renderPlanStats(plan, document.getElementById('plan-stats'));

    // Overflow banner
    UI.renderOverflowBanner(plan.overflow, document.getElementById('plan-overflow-banner'));

    // If overflow, show negotiation options
    const overflowOpts = document.getElementById('plan-overflow-options');
    if (plan.overflow && overflowOpts) {
      overflowOpts.style.display = '';
      UI.renderOverflowOptions(plan, overflowOpts, opt => {
        const preview = previewOverflowOption(plan, opt);
        App.currentPlan = preview;
        Storage.savePlan(preview);
        App.showPlan(preview);
      });
    } else if (overflowOpts) {
      overflowOpts.style.display = 'none';
    }

    // Timeline chart
    const chartContainer = document.getElementById('timeline-chart');
    if (chartContainer) Chart.renderTimeline(plan, chartContainer);

    // Summary donut
    const summaryChart = document.getElementById('summary-chart');
    if (summaryChart) Chart.renderSummary(plan, summaryChart);

    // Day-by-day
    const dayPlan = document.getElementById('day-plan-list');
    if (dayPlan) UI.renderDayPlan(plan, dayPlan);

    // Topic table
    const topicTable = document.getElementById('topic-table');
    if (topicTable) UI.renderTopicTable(plan.topics, topicTable);

    // Happy/update prompt
    const promptBanner = document.getElementById('plan-happy-prompt');
    if (promptBanner) {
      promptBanner.innerHTML = `
        <div class="alert alert-info" style="margin-top:16px;">
          <span>Happy with this plan?</span>
          <button class="btn btn-primary btn-sm" style="margin-left:16px;" onclick="Storage.exportPlan(App.currentPlan)">Download Plan</button>
          <button class="btn btn-outline btn-sm" style="margin-left:8px;" onclick="App.navigate('view-update')">Update Plan</button>
        </div>
      `;
    }
  },

  // ── Update / replan entry ─────────────────────────────────────────────────

  renderUpdateEntry() {
    const container = document.getElementById('update-content');
    if (!container) return;

    if (!App.currentPlan) {
      // Ask user to upload
      container.innerHTML = `
        <div class="card">
          <div class="card-title">Load existing plan</div>
          <p class="text-sm text-muted mb-16">No plan is currently in memory. Upload your saved plan files to continue.</p>
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
      document.getElementById('btn-start-fresh').addEventListener('click', () => App.navigate('view-setup'));
      return;
    }

    UI.renderReplanForm(App.currentPlan, container, updates => {
      UI.showLoading('Recalculating plan…');
      setTimeout(() => {
        try {
          const newPlan = replan(App.currentPlan, updates);
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
    UI.renderApiPanel(document.getElementById('api-panel'));
  },

  saveSettings() {
    const s = UI.collectSettings(document.getElementById('settings-form'));
    Storage.saveSettings(s);
    UI.showAlert('settings-alert', 'Settings saved.', 'success');
  },

  resetSettings() {
    Storage.saveSettings(DEFAULT_SETTINGS);
    UI.renderSettings(DEFAULT_SETTINGS, document.getElementById('settings-form'));
    UI.showAlert('settings-alert', 'Settings reset to defaults.', 'info');
  },
};

// Boot when DOM ready
document.addEventListener('DOMContentLoaded', () => App.init());
