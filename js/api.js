/**
 * api.js — OpenAI API integration.
 * All calls are made directly from the browser using the user's stored API key.
 */

const REASONING_MODELS = new Set(['o1', 'o1-mini', 'o3', 'o3-mini', 'o4-mini', 'o1-preview']);

function extractTopicLimit(tips = '') {
  const text = String(tips || '');
  const candidates = [];

  const patterns = [
    /(?:limit|no\s+more\s+than|max(?:imum)?|cap(?:\s+at)?|exactly|keep\s+it\s+to|only|just|at\s+most)\D{0,80}(\d{1,3})/ig,
    /(\d{1,3})\s*(?:topics?|lessons?|units?|chapters?|modules?)\b/ig,
    /(?:topics?|lessons?|units?|chapters?|modules?)\D{0,24}(\d{1,3})/ig,
  ];

  patterns.forEach(rx => {
    let m;
    while ((m = rx.exec(text)) !== null) {
      const n = parseInt(m[1], 10);
      if (Number.isFinite(n) && n > 0 && n <= 300) {
        candidates.push(n);
      }
    }
  });

  if (!candidates.length) return null;
  return Math.min(...candidates);
}

function applyTopicLimit(list, tips = '') {
  const cap = extractTopicLimit(tips);
  if (!cap) return list;
  return list.slice(0, cap);
}

const API = {

  // ── Core call ─────────────────────────────────────────────────────────────

  async call(messages, { model, reasoningEffort = 'medium', maxTokens = 4096 } = {}) {
    const apiKey = Storage.loadApiKey();
    if (!apiKey) throw new Error('No API key set. Please add your OpenAI API key in Settings.');

    const usedModel = model || Storage.loadModel();
    const isReasoning = REASONING_MODELS.has(usedModel);

    const body = {
      model: usedModel,
      messages,
    };

    if (isReasoning) {
      body.reasoning_effort      = reasoningEffort;
      body.max_completion_tokens = maxTokens;
    } else {
      body.temperature = 0.4;
      body.max_tokens  = maxTokens;
    }

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err?.error?.message || `OpenAI API error ${response.status}`);
    }

    const data = await response.json();
    return data.choices[0].message.content;
  },

  /** Parse JSON robustly from a model response (strips markdown fences if present). */
  parseJSON(text) {
    let cleaned = text.trim();
    // Strip ```json ... ``` or ``` ... ``` wrappers
    cleaned = cleaned.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
    return JSON.parse(cleaned);
  },

  // ── Topic generation ──────────────────────────────────────────────────────

  async generateTopicsFromExam(examName, tips = '') {
    const messages = PROMPTS.generateTopicsFromExam(examName, tips);
    const raw = await API.call(messages);
    return API.parseJSON(raw); // string[]
  },

  async expandHighLevelTopics(topicList, tips = '') {
    const messages = PROMPTS.expandHighLevelTopics(topicList, tips);
    const raw = await API.call(messages);
    return API.parseJSON(raw); // string[]
  },

  async sizeTopics(topicList, tips = '') {
    const messages = PROMPTS.sizeTopics(topicList, tips);
    const raw = await API.call(messages);
    const sized = API.parseJSON(raw); // {name, size, justification}[]

    const inputLimited = applyTopicLimit(topicList, tips);
    const expectedCount = inputLimited.length;
    const safeSized = Array.isArray(sized) ? sized : [];
    const cappedSized = safeSized.slice(0, expectedCount);

    // Validate and normalise
    const out = [];
    for (let i = 0; i < expectedCount; i++) {
      const item = cappedSized[i] || {};
      out.push({
        id:            `topic-${Date.now()}-${i}`,
        name:          item.name || inputLimited[i] || `Topic ${i + 1}`,
        size:          ['S', 'M', 'L'].includes(item.size) ? item.size : 'M',
        justification: item.justification || '',
      });
    }
    return out;
  },

  // ── Combined flows ────────────────────────────────────────────────────────

  /** Mode 1: exam name only → granular topics → sized */
  async topicsFromExamName(examName, tips = '', onProgress) {
    onProgress?.('Generating topic list from exam syllabus…');
    const namesRaw = await API.generateTopicsFromExam(examName, tips);
    const names = applyTopicLimit(namesRaw, tips);
    if (names.length !== namesRaw.length) {
      onProgress?.(`Applied topic limit from guidance: ${names.length} topics retained.`);
    }
    onProgress?.(`Generated ${names.length} topics. Sizing each topic…`);
    const sized = await API.sizeTopics(names, tips);
    return sized;
  },

  /** Mode 2: high-level topics → expand → sized */
  async topicsFromHighLevel(highLevelList, tips = '', onProgress) {
    onProgress?.('Expanding high-level topics into granular sub-topics…');
    const namesRaw = await API.expandHighLevelTopics(highLevelList, tips);
    const names = applyTopicLimit(namesRaw, tips);
    if (names.length !== namesRaw.length) {
      onProgress?.(`Applied topic limit from guidance: ${names.length} topics retained.`);
    }
    onProgress?.(`Expanded to ${names.length} topics. Sizing each topic…`);
    const sized = await API.sizeTopics(names, tips);
    return sized;
  },

  /** Mode 3: granular list (strings) → sized only */
  async topicsFromGranularList(nameList, tips = '', onProgress) {
    const limited = applyTopicLimit(nameList, tips);
    if (limited.length !== nameList.length) {
      onProgress?.(`Applied topic limit from guidance: ${limited.length} topics retained.`);
    }
    onProgress?.(`Sizing ${limited.length} topics…`);
    const sized = await API.sizeTopics(limited, tips);
    return sized;
  },

  /** Test that a key is valid with a minimal API call. */
  async validateKey(apiKey) {
    const response = await fetch('https://api.openai.com/v1/models', {
      headers: { 'Authorization': `Bearer ${apiKey}` },
    });
    return response.ok;
  },
};
