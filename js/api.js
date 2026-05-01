/**
 * api.js — OpenAI API integration.
 * All calls are made directly from the browser using the user's stored API key.
 */

const REASONING_MODELS = new Set(['o1', 'o1-mini', 'o3', 'o3-mini', 'o4-mini', 'o1-preview']);

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

  async generateTopicsFromExam(examName) {
    const messages = PROMPTS.generateTopicsFromExam(examName);
    const raw = await API.call(messages);
    return API.parseJSON(raw); // string[]
  },

  async expandHighLevelTopics(topicList) {
    const messages = PROMPTS.expandHighLevelTopics(topicList);
    const raw = await API.call(messages);
    return API.parseJSON(raw); // string[]
  },

  async sizeTopics(topicList) {
    const messages = PROMPTS.sizeTopics(topicList);
    const raw = await API.call(messages);
    const sized = API.parseJSON(raw); // {name, size, justification}[]

    // Validate and normalise
    return sized.map((item, i) => ({
      id:            `topic-${Date.now()}-${i}`,
      name:          item.name || topicList[i] || `Topic ${i + 1}`,
      size:          ['S', 'M', 'L'].includes(item.size) ? item.size : 'M',
      justification: item.justification || '',
    }));
  },

  // ── Combined flows ────────────────────────────────────────────────────────

  /** Mode 1: exam name only → granular topics → sized */
  async topicsFromExamName(examName, onProgress) {
    onProgress?.('Generating topic list from exam syllabus…');
    const names = await API.generateTopicsFromExam(examName);
    onProgress?.(`Generated ${names.length} topics. Sizing each topic…`);
    const sized = await API.sizeTopics(names);
    return sized;
  },

  /** Mode 2: high-level topics → expand → sized */
  async topicsFromHighLevel(highLevelList, onProgress) {
    onProgress?.('Expanding high-level topics into granular sub-topics…');
    const names = await API.expandHighLevelTopics(highLevelList);
    onProgress?.(`Expanded to ${names.length} topics. Sizing each topic…`);
    const sized = await API.sizeTopics(names);
    return sized;
  },

  /** Mode 3: granular list (strings) → sized only */
  async topicsFromGranularList(nameList, onProgress) {
    onProgress?.(`Sizing ${nameList.length} topics…`);
    const sized = await API.sizeTopics(nameList);
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
