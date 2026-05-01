/**
 * storage.js — localStorage and file I/O utilities.
 */

const KEYS = {
  API_KEY:  'sp_api_key',
  MODEL:    'sp_model',
  SETTINGS: 'sp_settings',
  PLAN:     'sp_current_plan',
  PLAN_NAME:'sp_plan_name',
};

const Storage = {

  // ── Generic ───────────────────────────────────────────────────────────────

  save(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch (e) {
      console.error('Storage.save failed:', e);
    }
  },

  load(key, fallback = null) {
    try {
      const raw = localStorage.getItem(key);
      return raw === null ? fallback : JSON.parse(raw);
    } catch (e) {
      return fallback;
    }
  },

  remove(key) {
    localStorage.removeItem(key);
  },

  // ── API Key ───────────────────────────────────────────────────────────────

  saveApiKey(key)  { localStorage.setItem(KEYS.API_KEY, key); },
  loadApiKey()     { return localStorage.getItem(KEYS.API_KEY) || ''; },
  clearApiKey()    { localStorage.removeItem(KEYS.API_KEY); },

  saveModel(model) { localStorage.setItem(KEYS.MODEL, model); },
  loadModel()      { return localStorage.getItem(KEYS.MODEL) || 'o4-mini'; },

  // ── Settings ──────────────────────────────────────────────────────────────

  saveSettings(settings) { Storage.save(KEYS.SETTINGS, settings); },
  loadSettings()         { return Storage.load(KEYS.SETTINGS, null); },

  // ── Current Plan ──────────────────────────────────────────────────────────

  savePlan(plan)  { Storage.save(KEYS.PLAN, plan); },
  loadPlan()      { return Storage.load(KEYS.PLAN, null); },
  clearPlan()     { Storage.remove(KEYS.PLAN); },

  hasPlan()       { return localStorage.getItem(KEYS.PLAN) !== null; },

  // ── File Download ─────────────────────────────────────────────────────────

  downloadJSON(obj, filename) {
    const blob = new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' });
    Storage._triggerDownload(blob, filename);
  },

  downloadText(text, filename) {
    const blob = new Blob([text], { type: 'text/plain' });
    Storage._triggerDownload(blob, filename);
  },

  _triggerDownload(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a   = document.createElement('a');
    a.href     = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  },

  // ── File Upload ───────────────────────────────────────────────────────────

  /** Opens a file picker and resolves with the parsed JSON object. */
  uploadJSON(accept = '.json,.cfg') {
    return new Promise((resolve, reject) => {
      const input = document.createElement('input');
      input.type   = 'file';
      input.accept = accept;
      input.onchange = (e) => {
        const file = e.target.files[0];
        if (!file) return reject(new Error('No file selected'));
        const reader = new FileReader();
        reader.onload = (ev) => {
          try {
            resolve(JSON.parse(ev.target.result));
          } catch {
            reject(new Error('File is not valid JSON'));
          }
        };
        reader.onerror = () => reject(new Error('Failed to read file'));
        reader.readAsText(file);
      };
      input.click();
    });
  },

  /** Opens a file picker and resolves with raw text (for topic lists). */
  uploadText(accept = '.txt,.csv,.md') {
    return new Promise((resolve, reject) => {
      const input = document.createElement('input');
      input.type   = 'file';
      input.accept = accept;
      input.onchange = (e) => {
        const file = e.target.files[0];
        if (!file) return reject(new Error('No file selected'));
        const reader = new FileReader();
        reader.onload = (ev) => resolve(ev.target.result);
        reader.onerror = () => reject(new Error('Failed to read file'));
        reader.readAsText(file);
      };
      input.click();
    });
  },

  // ── Plan Export ───────────────────────────────────────────────────────────

  /** Download both plan.json and plan.cfg from the given plan object. */
  exportPlan(plan) {
    const safeName = (plan.name || 'study-plan').replace(/[^a-z0-9]/gi, '-').toLowerCase();
    const cfg = {
      name:           plan.name,
      examDate:       plan.examDate,
      startDate:      plan.startDate,
      weeklySchedule: plan.weeklySchedule,
      settings:       plan.settings,
      topics:         plan.topics.map(t => ({ id: t.id, name: t.name, size: t.size })),
      exportedAt:     new Date().toISOString(),
    };
    Storage.downloadJSON(plan, `${safeName}.json`);
    Storage.downloadJSON(cfg,  `${safeName}.cfg`);
  },
};
