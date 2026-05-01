/**
 * prompts.js — All LLM prompt templates for the Smart Study Planner.
 * Edit freely. Each export is a function returning a messages array for the OpenAI API.
 */

const PROMPTS = {

  /**
   * Generate a full granular topic list from an exam name only.
   * Returns JSON array of topic name strings.
   */
  generateTopicsFromExam(examName, tips = '') {
    const tipsBlock = tips && tips.trim()
      ? `\nAdditional user guidance:\n${tips.trim()}\n`
      : '';
    return [
      {
        role: 'system',
        content: `You are an expert study planner with deep knowledge of professional and academic exam syllabuses.
Your task is to generate a comprehensive, granular list of study topics for a given exam.
Topics should be at the level of a single focused study session (not chapters or broad themes).
You MUST follow any explicit user constraints provided under "Additional user guidance" whenever possible.
Respond ONLY with a valid JSON array of strings — no explanation, no markdown, no code fences.`
      },
      {
        role: 'user',
        content: `Generate a complete granular topic list for the following exam: "${examName}".

Requirements:
- Each topic should represent approximately 20–60 minutes of focused study
- Topics should cover the full syllabus with no major gaps
- Use specific, descriptive names (e.g. "Contract Law — Offer and Acceptance" not just "Contracts")
- Aim for 20–80 topics depending on exam scope
- Order topics logically (by subject area then subtopic)

${tipsBlock}

Respond with ONLY a JSON array of strings:
["Topic 1", "Topic 2", ...]`
      }
    ];
  },

  /**
   * Break high-level topics into granular sub-topics.
   * Returns JSON array of topic name strings.
   */
  expandHighLevelTopics(topicList, tips = '') {
    const topicsText = topicList.map((t, i) => `${i + 1}. ${t}`).join('\n');
    const tipsBlock = tips && tips.trim()
      ? `\nAdditional user guidance:\n${tips.trim()}\n`
      : '';
    return [
      {
        role: 'system',
        content: `You are an expert study planner. You break broad subject areas into specific, granular study topics.
Topics should be at the level of a single focused study session.
      You MUST follow any explicit user constraints provided under "Additional user guidance" whenever possible.
Respond ONLY with a valid JSON array of strings — no explanation, no markdown, no code fences.`
      },
      {
        role: 'user',
        content: `Expand each of the following high-level topics into granular sub-topics suitable for individual study sessions (each 20–60 minutes):

${topicsText}

Requirements:
- Each sub-topic should be specific and focused
- Include the parent topic name as a prefix where helpful (e.g. "Contract Law — Offer and Acceptance")
- Aim for 3–8 sub-topics per high-level topic depending on breadth
- Total list should be comprehensive enough to cover the subject fully
- Order logically within each topic area

${tipsBlock}

Respond with ONLY a JSON array of strings:
["Sub-topic 1", "Sub-topic 2", ...]`
      }
    ];
  },

  /**
   * Assign S/M/L size to each topic based on depth and complexity.
   * Returns JSON array of { name, size, justification } objects.
   */
  sizeTopics(topicList, tips = '') {
    const topicsText = topicList.map((t, i) => `${i + 1}. ${t}`).join('\n');
    const tipsBlock = tips && tips.trim()
      ? `\nAdditional user guidance:\n${tips.trim()}\n`
      : '';
    return [
      {
        role: 'system',
        content: `You are an expert study planner. You evaluate study topics and assign a size (S/M/L) based on their depth, complexity, and the likely time needed to learn them.

Size definitions:
- S (Small): single concept, few key points, minimal memorisation required. First read ~20 min.
- M (Medium): moderate depth, typical topic with several sub-concepts. First read ~35 min.
- L (Large): broad topic with many sub-concepts, significant memorisation, or high complexity. First read ~50 min.

You MUST follow any explicit user constraints provided under "Additional user guidance" whenever possible.
Respond ONLY with a valid JSON array — no explanation, no markdown, no code fences.`
      },
      {
        role: 'user',
        content: `Assign a size (S, M, or L) to each of the following study topics:

${topicsText}

For each topic, respond with an object containing:
- "name": the exact topic name as given
- "size": "S", "M", or "L"
- "justification": one short sentence explaining why

${tipsBlock}

Respond with ONLY a JSON array:
[{"name": "Topic 1", "size": "M", "justification": "..."}, ...]`
      }
    ];
  },

  /**
   * Generate a human-readable summary of an overflow situation and recommended actions.
   * Used when the algorithm cannot fit all activities before the exam date.
   */
  summariseOverflow(overflowData) {
    return [
      {
        role: 'system',
        content: `You are a helpful study coach. You communicate study plan shortfalls clearly and constructively.
Keep responses concise — 2–3 sentences maximum. Be specific with numbers.`
      },
      {
        role: 'user',
        content: `My study plan has the following shortfall:

- Target state: ${overflowData.targetState}
- Topics reaching target: ${overflowData.achievable} of ${overflowData.total}
- Shortfall in study hours: approximately ${overflowData.shortfallHours} hours
- Exam date: ${overflowData.examDate}
- Weeks remaining: ${overflowData.weeksRemaining}

Write a brief, encouraging message explaining the shortfall and the most impactful single change to fix it.`
      }
    ];
  }
};

// Make available as module (for environments that support it) and as global
if (typeof module !== 'undefined' && module.exports) {
  module.exports = PROMPTS;
}
