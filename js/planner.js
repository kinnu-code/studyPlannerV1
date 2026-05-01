/**
 * planner.js — Core scheduling algorithm for the Smart Study Planner.
 *
 * Key concepts:
 *   - SR intervals are SPACING between reviews (not days from day0).
 *     Default [1,6,16,45,131] → cumulative offsets from day0: 1, 7, 23, 68, 199
 *   - First read is the only splittable activity (into P1+P2 across two short sessions).
 *   - States: not_started → ready → weak → healthy → mastered (+ dueReview overlay flag).
 *   - Mock exams are reserved first, then the rest of the schedule fills by priority queue.
 */

// ── Defaults ─────────────────────────────────────────────────────────────────

const DEFAULT_SETTINGS = {
  srIntervals:          [1, 6, 16, 45, 131],  // spacing days between consecutive reviews
  targetState:          'mastered',             // 'healthy' or 'mastered'
  shortSessionMins:     25,
  longSessionMins:      60,
  mcqForHealthy:        2,    // total MCQ sessions to reach Healthy
  mcqForMastery:        3,    // total MCQ sessions to reach Mastery
  srReviewsForMastery:  3,    // min SR reviews required for Mastery
  numberOfMocks:        3,
  activityTimes: {
    firstRead:        { S: 20, M: 35, L: 50 },
    srReview:         { S: 5,  M: 10, L: 15 },
    mcq:              { S: 10, M: 15, L: 30 },
    reRead:           { S: 10, M: 15, L: 20 },
    weaknessReview:   { S: 20, M: 35, L: 50 },
  },
  mockExamMins: 120,  // duration of a mock exam session slot
};

const VALID_STATES = new Set(['not_started', 'ready', 'weak', 'healthy', 'mastered']);

// ── Date helpers ─────────────────────────────────────────────────────────────

function dateStr(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function addDays(d, n) {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}

function daysBetween(a, b) {
  return Math.round((b - a) / 86400000);
}

function parseDate(s) {
  // Parse YYYY-MM-DD as local midnight to avoid timezone shifts
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

function normalizePlannerSettings(settings) {
  const out = { ...settings };
  out.mcqForMastery = Math.max(2, parseInt(out.mcqForMastery) || 2);
  out.mcqForHealthy = Math.max(1, parseInt(out.mcqForHealthy) || 1);

  // Constraint: Healthy threshold must stay strictly below Mastery threshold.
  if (out.mcqForHealthy >= out.mcqForMastery) {
    out.mcqForHealthy = out.mcqForMastery - 1;
  }

  return out;
}

function normalizeStartingState(state) {
  const s = String(state || 'not_started').trim().toLowerCase();
  return VALID_STATES.has(s) ? s : 'not_started';
}

// ── Session grid builder ──────────────────────────────────────────────────────

/**
 * Build the full list of session slots from startDate to examDate (exclusive).
 * weeklySchedule: { 0..6: { short: n, long: m } }  (0=Sunday)
 */
function buildSessionGrid(startDate, examDate, weeklySchedule, settings) {
  const sessions = [];
  let d = new Date(startDate);
  const exam = new Date(examDate);

  while (d < exam) {
    const dow   = d.getDay();
    const sched = weeklySchedule[dow] || { short: 0, long: 0 };
    const ds    = dateStr(d);

    for (let i = 0; i < (sched.long || 0); i++) {
      sessions.push({
        id:              `${ds}-L${i}`,
        date:            ds,
        type:            'long',
        budgetMins:      settings.longSessionMins,
        usedMins:        0,
        activities:      [],
        isMockExam:      false,
        isWeaknessReview:false,
      });
    }
    for (let i = 0; i < (sched.short || 0); i++) {
      sessions.push({
        id:              `${ds}-S${i}`,
        date:            ds,
        type:            'short',
        budgetMins:      settings.shortSessionMins,
        usedMins:        0,
        activities:      [],
        isMockExam:      false,
        isWeaknessReview:false,
      });
    }

    d = addDays(d, 1);
  }
  return sessions;
}

// ── SR date computation ───────────────────────────────────────────────────────

/** Compute cumulative day offsets from day0 for all SR reviews. */
function srCumulativeOffsets(intervals) {
  const offsets = [];
  let cum = 0;
  for (const iv of intervals) {
    cum += iv;
    offsets.push(cum);
  }
  return offsets;
}

/** Return the ideal SR review dates for a topic given its day0 date. */
function computeSRDates(day0Date, intervals) {
  return srCumulativeOffsets(intervals).map(offset => addDays(day0Date, offset));
}

// ── Topic state helpers ───────────────────────────────────────────────────────

function actDuration(type, size, settings) {
  const at = settings.activityTimes;
  switch (type) {
    case 'first_read':
    case 'first_read_p1':
    case 'first_read_p2':   return at.firstRead[size];
    case 'sr_review':       return at.srReview[size];
    case 'mcq':             return at.mcq[size];
    case 're_read':         return at.reRead[size];
    case 'weakness_review': return at.weaknessReview[size];
    default: return 0;
  }
}

function initTopicState(topic, startDate, settings) {
  const useCarry = topic.__carryForward === true;
  const normalizedStartState = normalizeStartingState(topic.startingState);
  const effectiveStartingState = useCarry ? 'not_started' : normalizedStartState;

  const seededMcq = effectiveStartingState === 'mastered'
    ? settings.mcqForMastery
    : (effectiveStartingState === 'healthy'
      ? settings.mcqForHealthy
      : (effectiveStartingState === 'weak' ? 1 : 0));
  const seededSr = effectiveStartingState === 'mastered' ? settings.srReviewsForMastery : 0;
  const seededFirstRead = effectiveStartingState !== 'not_started';

  const carriedMcq = useCarry ? Math.max(0, parseInt(topic.mcqCount) || 0) : 0;
  const carriedSr  = useCarry ? Math.max(0, parseInt(topic.srReviewCount) || 0) : 0;
  const carriedFirstRead = useCarry
    ? (!!topic.firstReadComplete || carriedMcq > 0 || carriedSr > 0 || !!topic.day0)
    : false;
  const { __carryForward, ...cleanTopic } = topic;

  const startDateStr = dateStr(parseDate(startDate));
  const readyDate = useCarry
    ? null
    : (effectiveStartingState === 'ready' || effectiveStartingState === 'weak' || effectiveStartingState === 'healthy' || effectiveStartingState === 'mastered'
      ? startDateStr
      : null);
  const weakDate = useCarry
    ? null
    : (effectiveStartingState === 'weak' || effectiveStartingState === 'healthy' || effectiveStartingState === 'mastered'
      ? startDateStr
      : null);
  const healthyDate = useCarry
    ? null
    : (effectiveStartingState === 'healthy' || effectiveStartingState === 'mastered'
      ? startDateStr
      : null);
  const masteredDate = useCarry
    ? null
    : (effectiveStartingState === 'mastered' ? startDateStr : null);

  return {
    ...cleanTopic,
    startingState:    normalizedStartState,
    state:            useCarry ? 'not_started' : effectiveStartingState,
    dueReview:        false,
    day0:             useCarry ? (topic.day0 || null) : (seededFirstRead ? startDateStr : null),
    readyDate,
    weakDate,
    healthyDate,
    masteredDate,
    firstReadDone:    useCarry ? carriedFirstRead : seededFirstRead,
    firstReadP1Date:  useCarry ? (topic.firstReadP1Date || topic.day0 || null) : (seededFirstRead ? startDateStr : null),
    firstReadComplete:useCarry ? carriedFirstRead : seededFirstRead,
    firstReadCompleteDate: useCarry ? (topic.firstReadCompleteDate || topic.day0 || null) : (seededFirstRead ? startDateStr : null),
    srReviewsDue:     [],     // {num, dueDate, scheduled: false}
    mcqCount:         useCarry ? carriedMcq : seededMcq,
    srReviewCount:    useCarry ? carriedSr : seededSr,
    activities:       [],
  };
}

function scheduleActivity(session, topicState, type, reason, settings, srNum = null) {
  const dur = actDuration(type, topicState.size, settings);
  if (session.usedMins + dur > session.budgetMins) return false;

  const act = {
    topicId:      topicState.id,
    topicName:    topicState.name,
    type,
    date:         session.date,
    sessionId:    session.id,
    durationMins: dur,
    reason,
    srReviewNumber: srNum,
  };

  session.activities.push(act);
  session.usedMins += dur;
  topicState.activities.push(act);
  return true;
}

// ── State transition logic ────────────────────────────────────────────────────

function applyStateTransitions(ts, settings) {
  if (ts.firstReadComplete && ts.state === 'not_started') {
    ts.state     = 'ready';
    ts.readyDate = ts.firstReadCompleteDate || ts.firstReadP1Date;
  }
  if (ts.state === 'ready' && ts.mcqCount >= 1) {
    ts.state    = 'weak';
    ts.weakDate = ts.activities.filter(a => a.type === 'mcq').slice(0, 1)[0]?.date || ts.readyDate;
  }
  if (ts.state === 'weak' && ts.mcqCount >= settings.mcqForHealthy) {
    ts.state       = 'healthy';
    ts.healthyDate = ts.activities.filter(a => a.type === 'mcq')[settings.mcqForHealthy - 1]?.date || ts.weakDate;
  }
  if (
    ts.state === 'healthy' &&
    ts.mcqCount   >= settings.mcqForMastery &&
    ts.srReviewCount >= settings.srReviewsForMastery
  ) {
    ts.state        = 'mastered';
    ts.masteredDate = ts.activities.filter(a => a.type === 'mcq')[settings.mcqForMastery - 1]?.date || ts.healthyDate;
  }
}

// ── Pass 1: Assign Day 0 (first reads) ───────────────────────────────────────

function assignDay0s(topicStates, sessions, settings) {
  const longSessions  = sessions.filter(s => s.type === 'long');
  const shortSessions = sessions.filter(s => s.type === 'short');
  let earliestAllowedDate = null;

  for (const ts of topicStates) {
    if (ts.firstReadComplete) continue;

    const readDur = actDuration('first_read', ts.size, settings);
    let assigned  = false;

    // Prefer a single long session
    for (const sess of longSessions) {
      if (sess.isMockExam) continue;
      if (earliestAllowedDate && sess.date < earliestAllowedDate) continue;
      if (sess.budgetMins - sess.usedMins >= readDur) {
        scheduleActivity(sess, ts, 'first_read',
          `First read — ${ts.name}`, settings);
        ts.day0             = sess.date;
        ts.firstReadDone    = true;
        ts.firstReadComplete= true;
        ts.firstReadP1Date  = sess.date;
        ts.firstReadCompleteDate = sess.date;
        earliestAllowedDate = ts.day0;
        assigned = true;
        break;
      }
    }

    if (assigned) continue;

    // Fall back: two consecutive short sessions (P1 + P2)
    const halfDur = Math.ceil(readDur / 2);
    let p1Session = null;

    for (let i = 0; i < shortSessions.length; i++) {
      const s1 = shortSessions[i];
      if (s1.isMockExam || s1.budgetMins - s1.usedMins < halfDur) continue;
      if (earliestAllowedDate && s1.date < earliestAllowedDate) continue;

      // Find next short session with enough budget
      for (let j = i + 1; j < shortSessions.length; j++) {
        const s2 = shortSessions[j];
        if (s2.isMockExam || s2.budgetMins - s2.usedMins < (readDur - halfDur)) continue;

        // Schedule P1 and P2
        scheduleActivity(s1, ts, 'first_read_p1',
          `First read Part 1 — ${ts.name}`, settings);
        scheduleActivity(s2, ts, 'first_read_p2',
          `First read Part 2 — ${ts.name}`, settings);

        ts.day0              = s1.date;
        ts.firstReadDone     = true;
        ts.firstReadComplete = false;
        ts.firstReadP1Date   = s1.date;
        ts.firstReadCompleteDate = s2.date;
        earliestAllowedDate = ts.day0;
        p1Session            = s1;
        assigned             = true;
        break;
      }
      if (assigned) break;
    }

    if (!assigned) {
      // Record overflow — topic cannot be first-read before exam
      ts.overflowFirstRead = true;
    }
  }
}

// ── Reserve mock exam slots ───────────────────────────────────────────────────

function reserveMockSlots(sessions, eligibilityDate, examDate, settings) {
  if (settings.numberOfMocks === 0) return [];

  const elig = parseDate(eligibilityDate);
  const exam = parseDate(examDate);

  // Candidate long sessions between eligibility and 1 day before exam
  const candidates = sessions.filter(s =>
    s.type === 'long' &&
    !s.isMockExam &&
    s.usedMins === 0 &&
    parseDate(s.date) >= elig &&
    parseDate(s.date) < addDays(exam, -1)
  );

  if (candidates.length === 0) return [];

  const mockDates = [];
  const n         = Math.min(settings.numberOfMocks, candidates.length);
  const step      = Math.floor(candidates.length / (n + 1));

  for (let i = 1; i <= n; i++) {
    const idx  = Math.min(i * step, candidates.length - 1);
    const sess = candidates[idx];
    sess.isMockExam = true;
    sess.activities = [{
      topicId:      null,
      topicName:    'Mock Exam',
      type:         'mock_exam',
      date:         sess.date,
      sessionId:    sess.id,
      durationMins: Math.min(settings.mockExamMins, sess.budgetMins),
      reason:       `Mock exam ${i} of ${n}`,
    }];
    sess.usedMins = sess.activities[0].durationMins;
    mockDates.push(sess.date);
  }

  return mockDates;
}

// ── SR review scheduling helper ───────────────────────────────────────────────

/**
 * For each topic with a day0, compute its SR due dates and build a pending list.
 * Tolerance: schedule up to 2 days early or 1 day late.
 */
function buildSRQueue(topicStates, settings) {
  const queue = [];
  for (const ts of topicStates) {
    if (!ts.day0) continue;
    const day0 = parseDate(ts.day0);
    const dueDates = computeSRDates(day0, settings.srIntervals);
    const useCarry = ts.__carryForward === true;
    ts.srReviewsDue = dueDates.map((d, i) => ({
      topicId:   ts.id,
      reviewNum: i + 1,
      dueDate:   dateStr(d),
      scheduled: useCarry ? (i < ts.srReviewCount) : false,
    }));
    queue.push(...ts.srReviewsDue);
  }
  return queue;
}

// ── Pass 2: Fill sessions by priority ────────────────────────────────────────

function fillSessions(topicStates, sessions, settings, examDate) {
  const srQueue = buildSRQueue(topicStates, settings);
  const tsMap   = Object.fromEntries(topicStates.map(t => [t.id, t]));
  const exam    = parseDate(examDate);

  // Initialize states
  topicStates.forEach(ts => applyStateTransitions(ts, settings));

  for (const sess of sessions) {
    if (sess.isMockExam) continue;

    const sessDate = parseDate(sess.date);
    if (sessDate >= exam) break;

    // Split first reads become "ready" only once Part 2 date is reached.
    topicStates.forEach(ts => {
      if (!ts.firstReadComplete && ts.firstReadCompleteDate && parseDate(ts.firstReadCompleteDate) <= sessDate) {
        ts.firstReadComplete = true;
        applyStateTransitions(ts, settings);
      }
    });

    let keepFilling = true;
    while (keepFilling) {
      keepFilling = false;
      const remaining = sess.budgetMins - sess.usedMins;
      if (remaining <= 0) break;

      // ── Priority 1: SR reviews due within 2 days ──────────────────────────
      const urgentSR = srQueue.find(sr => {
        if (sr.scheduled) return false;
        const ts = tsMap[sr.topicId];
        if (!ts) return false;
        const due = parseDate(sr.dueDate);
        const diff = daysBetween(sessDate, due); // negative = overdue
        return diff >= -2 && diff <= 2;
      });

      if (urgentSR) {
        const ts  = tsMap[urgentSR.topicId];
        const dur = actDuration('sr_review', ts.size, settings);
        if (dur <= remaining) {
          scheduleActivity(sess, ts, 'sr_review',
            `Flashcard review ${urgentSR.reviewNum} of ${settings.srIntervals.length} — ${ts.name}`,
            settings, urgentSR.reviewNum);
          urgentSR.scheduled = true;
          ts.srReviewCount++;
          applyStateTransitions(ts, settings);
          keepFilling = true;
          continue;
        }
      }

      // ── Priority 2: First MCQ on Ready topics ────────────────────────────
      const readyTopic = topicStates.find(ts =>
        ts.state === 'ready' && ts.mcqCount === 0 &&
        actDuration('mcq', ts.size, settings) <= remaining
      );
      if (readyTopic) {
        scheduleActivity(sess, readyTopic, 'mcq',
          `First MCQ session — ${readyTopic.name}`, settings);
        readyTopic.mcqCount++;
        applyStateTransitions(readyTopic, settings);
        keepFilling = true;
        continue;
      }

      // ── Priority 3: MCQ on Weak topics ───────────────────────────────────
      const weakMCQ = topicStates.find(ts =>
        ts.state === 'weak' &&
        actDuration('mcq', ts.size, settings) <= remaining
      );
      if (weakMCQ) {
        scheduleActivity(sess, weakMCQ, 'mcq',
          `MCQ session — ${weakMCQ.name} (Weak, building to Healthy)`, settings);
        weakMCQ.mcqCount++;
        applyStateTransitions(weakMCQ, settings);
        keepFilling = true;
        continue;
      }

      // ── Priority 4: First reads on Not Started topics ────────────────────
      // (These were pre-scheduled in pass 1; this handles any that didn't fit)
      const notStarted = topicStates.find(ts =>
        ts.state === 'not_started' &&
        !ts.overflowFirstRead &&
        !ts.firstReadComplete
      );
      if (notStarted) {
        const dur = actDuration('first_read', notStarted.size, settings);
        if (dur <= remaining) {
          scheduleActivity(sess, notStarted, 'first_read',
            `First read — ${notStarted.name}`, settings);
          notStarted.day0              = sess.date;
          notStarted.firstReadComplete = true;
          notStarted.firstReadP1Date   = sess.date;
          applyStateTransitions(notStarted, settings);
          keepFilling = true;
          continue;
        }
      }

      // ── Priority 5: MCQ on Healthy topics ────────────────────────────────
      const healthyMCQ = topicStates.find(ts =>
        ts.state === 'healthy' &&
        ts.mcqCount < settings.mcqForMastery &&
        actDuration('mcq', ts.size, settings) <= remaining
      );
      if (healthyMCQ) {
        scheduleActivity(sess, healthyMCQ, 'mcq',
          `MCQ session — ${healthyMCQ.name} (Healthy, building to Mastery)`, settings);
        healthyMCQ.mcqCount++;
        applyStateTransitions(healthyMCQ, settings);
        keepFilling = true;
        continue;
      }

      // ── Priority 6: Re-reads on Weak topics (optional) ───────────────────
      const weakReRead = topicStates.find(ts =>
        ts.state === 'weak' &&
        !ts.reReadScheduled &&
        actDuration('re_read', ts.size, settings) <= remaining
      );
      if (weakReRead) {
        scheduleActivity(sess, weakReRead, 're_read',
          `Re-read — ${weakReRead.name} (still Weak)`, settings);
        weakReRead.reReadScheduled = true;
        keepFilling = true;
        continue;
      }

      // ── Weakness reviews (after mocks) ────────────────────────────────────
      if (sess.isWeaknessReview) {
        const stillWeak = topicStates.find(ts =>
          (ts.state === 'weak') &&
          actDuration('weakness_review', ts.size, settings) <= remaining
        );
        if (stillWeak) {
          scheduleActivity(sess, stillWeak, 'weakness_review',
            `Weakness review — ${stillWeak.name}`, settings);
          keepFilling = true;
          continue;
        }
      }
    }
  }
}

// ── Overflow detection ────────────────────────────────────────────────────────

function detectOverflow(topicStates, settings) {
  const target  = settings.targetState;
  const total   = topicStates.length;
  let achievable = 0;
  let achievableHealthy  = 0;
  let achievableMastered = 0;

  for (const ts of topicStates) {
    if (ts.state === 'mastered') { achievableMastered++; achievableHealthy++; }
    else if (ts.state === 'healthy') achievableHealthy++;
  }

  achievable = target === 'mastered' ? achievableMastered : achievableHealthy;

  if (achievable === total) return null; // no overflow

  const shortfall = total - achievable;
  return {
    target,
    total,
    achievable,
    achievableHealthy,
    achievableMastered,
    shortfall,
    shortfallTopics: topicStates
      .filter(ts => target === 'mastered'
        ? ts.state !== 'mastered'
        : ts.state !== 'healthy' && ts.state !== 'mastered')
      .map(ts => ({ id: ts.id, name: ts.name, state: ts.state })),
  };
}

// ── State timeline (for chart) ────────────────────────────────────────────────

/**
 * Build a per-topic array of { date, state } for every day in the plan window.
 * Used by chart.js to colour each day segment.
 */
function buildStateTimeline(topicStates, startDate, examDate) {
  const start = parseDate(startDate);
  const exam  = parseDate(examDate);
  const days  = daysBetween(start, exam);

  return topicStates.map(ts => {
    const timeline = [];

    // Build a map: date → state
    const stateChanges = [
      { date: ts.readyDate,   state: 'ready'   },
      { date: ts.weakDate,    state: 'weak'     },
      { date: ts.healthyDate, state: 'healthy'  },
      { date: ts.masteredDate,state: 'mastered' },
    ]
      .filter(c => c.date)
      .sort((a, b) => a.date.localeCompare(b.date));

    const srReviewDates = new Set(
      (ts.activities || [])
        .filter(a => a.type === 'sr_review')
        .map(a => a.date)
    );

    let currentState = 'not_started';
    for (let i = 0; i <= days; i++) {
      const d = dateStr(addDays(start, i));
      for (const change of stateChanges) {
        if (change.date === d) currentState = change.state;
      }
      timeline.push({
        date:       d,
        state:      currentState,
        dueReview:  srReviewDates.has(d),
      });
    }

    return { topicId: ts.id, topicName: ts.name, timeline };
  });
}

// ── Eligibility date computation ──────────────────────────────────────────────

function computeWeakEligibilityDate(topicStates, examDate) {
  const weakDates = topicStates.map(ts => {
    if (ts.state === 'weak' || ts.state === 'healthy' || ts.state === 'mastered') {
      return ts.weakDate || ts.healthyDate || ts.masteredDate || ts.readyDate || ts.day0;
    }
    return null;
  });

  if (weakDates.some(d => !d)) {
    // If even one topic did not reach weak, no mocks should be scheduled.
    return parseDate(examDate);
  }

  const latest = weakDates.reduce((acc, d) => (d > acc ? d : acc), weakDates[0]);
  return parseDate(latest);
}

// ── Main entry point ──────────────────────────────────────────────────────────

/**
 * generatePlan(config) → Plan object
 *
 * config: {
 *   name: string,
 *   topics: [{id, name, size}],
 *   examDate: 'YYYY-MM-DD',
 *   startDate: 'YYYY-MM-DD',
 *   weeklySchedule: { 0..6: { short, long } },
 *   settings: Settings (optional, defaults used if omitted)
 * }
 */
function generatePlan(config) {
  const settings = normalizePlannerSettings({ ...DEFAULT_SETTINGS, ...config.settings });
  if (config.settings?.activityTimes) {
    settings.activityTimes = {
      ...DEFAULT_SETTINGS.activityTimes,
      ...config.settings.activityTimes,
    };
  }

  const topicStates = config.topics.map(t => initTopicState(t, config.startDate, settings));
  const sessions    = buildSessionGrid(
    parseDate(config.startDate),
    parseDate(config.examDate),
    config.weeklySchedule,
    settings
  );

  // Pass 1: assign Day 0 (first reads) — greedy, earliest available
  assignDay0s(topicStates, sessions, settings);

  // Compute SR due dates for all topics that have a day0
  topicStates.forEach(ts => {
    if (ts.day0) {
      ts.srReviewsDue = computeSRDates(parseDate(ts.day0), settings.srIntervals)
        .map((d, i) => ({ reviewNum: i + 1, dueDate: dateStr(d), scheduled: false }));
    }
  });

  // Pass 2: fill sessions by priority
  fillSessions(topicStates, sessions, settings, config.examDate);

  // Final state transitions
  topicStates.forEach(ts => applyStateTransitions(ts, settings));

  // Solid gating: mocks are allowed only after every topic has reached at least weak.
  const weakEligibilityDate = computeWeakEligibilityDate(topicStates, config.examDate);
  const mockDates = reserveMockSlots(
    sessions,
    dateStr(weakEligibilityDate),
    config.examDate,
    settings
  );

  const overflow = detectOverflow(topicStates, settings);

  // Build state timeline for chart
  const stateTimeline = buildStateTimeline(topicStates, config.startDate, config.examDate);

  // Aggregate schedule into per-day objects for UI
  const sessionsByDate = {};
  for (const s of sessions) {
    if (!sessionsByDate[s.date]) sessionsByDate[s.date] = [];
    sessionsByDate[s.date].push(s);
  }
  const schedule = Object.entries(sessionsByDate)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, daySessions]) => ({ date, sessions: daySessions }));

  return {
    name:           config.name,
    examDate:       config.examDate,
    startDate:      config.startDate,
    weeklySchedule: config.weeklySchedule,
    settings,
    topics:         topicStates,
    schedule,
    mockExamDates:  mockDates,
    eligibilityDate:dateStr(weakEligibilityDate),
    overflow,
    stateTimeline,
    generatedAt:    new Date().toISOString(),
  };
}

// ── Replanning ────────────────────────────────────────────────────────────────

/**
 * Rebuild the plan from today, carrying forward the accumulated topic states.
 * replanConfig extends config with: { skippedSessions, aheadSessions, currentDate }
 */
function replan(existingPlan, updates) {
  const today     = updates.currentDate || dateStr(new Date());

  const skippedSessions = Math.max(0, parseInt(updates.skippedSessions) || 0);
  const aheadSessions   = Math.max(0, parseInt(updates.aheadSessions) || 0);
  const carryForward    = extractCarryForwardProgress(existingPlan, today, {
    skippedSessions,
    aheadSessions,
  });

  const requestedTopics = (updates.topics && updates.topics.length)
    ? updates.topics
    : existingPlan.topics.map(t => ({
      id: t.id,
      name: t.name,
      size: t.size,
      startingState: t.startingState || 'not_started',
    }));

  const newConfig = {
    name:           existingPlan.name,
    topics:         requestedTopics.map(t => {
      const carry = carryForward[t.id];
      if (carry) {
        return {
          id:   t.id,
          name: t.name,
          size: t.size,
          startingState: t.startingState || 'not_started',
          __carryForward:    true,
          day0:              carry.day0 || null,
          firstReadP1Date:   carry.firstReadP1Date || null,
          firstReadComplete: !!carry.firstReadComplete,
          mcqCount:          carry.mcqCount || 0,
          srReviewCount:     carry.srReviewCount || 0,
        };
      }

      return {
        id: t.id,
        name: t.name,
        size: t.size,
        startingState: t.startingState || 'not_started',
      };
    }),
    examDate:       updates.examDate       || existingPlan.examDate,
    startDate:      today,
    weeklySchedule: updates.weeklySchedule || existingPlan.weeklySchedule,
    settings: {
      ...existingPlan.settings,
      ...(updates.settings || {}),
      numberOfMocks: updates.numberOfMocks ?? existingPlan.settings.numberOfMocks,
    },
  };

  return generatePlan(newConfig);
}

function extractCarryForwardProgress(existingPlan, currentDate, adjustments = {}) {
  const skipped = Math.max(0, parseInt(adjustments.skippedSessions) || 0);
  const ahead   = Math.max(0, parseInt(adjustments.aheadSessions) || 0);

  const allSessions = (existingPlan.schedule || [])
    .flatMap(day => day.sessions || [])
    .filter(s => Array.isArray(s.activities) && s.activities.length > 0)
    .sort((a, b) => {
      const byDate = (a.date || '').localeCompare(b.date || '');
      if (byDate !== 0) return byDate;
      return (a.id || '').localeCompare(b.id || '');
    });

  const expectedDone = allSessions.filter(s => (s.date || '') < currentDate).length;
  const actualDone = clamp(expectedDone - skipped + ahead, 0, allSessions.length);
  const completedSessions = allSessions.slice(0, actualDone);

  const progress = {};
  for (const t of existingPlan.topics || []) {
    progress[t.id] = {
      day0: null,
      firstReadP1Date: null,
      firstReadComplete: false,
      _p1: false,
      _p2: false,
      mcqCount: 0,
      srReviewCount: 0,
    };
  }

  completedSessions.forEach(session => {
    (session.activities || []).forEach(act => {
      if (!act.topicId || !progress[act.topicId]) return;
      const p = progress[act.topicId];

      if (act.type === 'first_read') {
        p.firstReadComplete = true;
        p.day0 = p.day0 || act.date;
        p.firstReadP1Date = p.firstReadP1Date || act.date;
      } else if (act.type === 'first_read_p1') {
        p._p1 = true;
        p.day0 = p.day0 || act.date;
        p.firstReadP1Date = p.firstReadP1Date || act.date;
      } else if (act.type === 'first_read_p2') {
        p._p2 = true;
        p.day0 = p.day0 || act.date;
      } else if (act.type === 'mcq') {
        p.mcqCount += 1;
      } else if (act.type === 'sr_review') {
        p.srReviewCount += 1;
      }
    });
  });

  Object.values(progress).forEach(p => {
    if (!p.firstReadComplete && p._p1 && p._p2) {
      p.firstReadComplete = true;
    }
    delete p._p1;
    delete p._p2;
  });

  return progress;
}

// ── Overflow negotiation helpers ──────────────────────────────────────────────

/**
 * Given the current plan and a proposed change, return a preview plan (no side effects).
 */
function previewOverflowOption(plan, option) {
  const updatedSettings = { ...plan.settings };

  switch (option.type) {
    case 'lower_target':
      updatedSettings.targetState = option.value || 'healthy';
      break;
    case 'lower_mcq_healthy':
      updatedSettings.mcqForHealthy = option.value;
      break;
    case 'lower_mcq_mastery':
      updatedSettings.mcqForMastery = option.value;
      break;
    case 'lower_sr_reviews':
      updatedSettings.srReviewsForMastery = option.value;
      break;
    case 'fewer_mocks':
      updatedSettings.numberOfMocks = option.value;
      break;
    case 'add_sessions':
      // Preview with updated schedule — caller passes new weeklySchedule
      return generatePlan({ ...plan, weeklySchedule: option.weeklySchedule, settings: updatedSettings });
    case 'remove_topics':
      return generatePlan({
        ...plan,
        topics: plan.topics.filter(t => !option.removeIds.includes(t.id)),
        settings: updatedSettings,
      });
    default:
      break;
  }

  return generatePlan({ ...plan, settings: updatedSettings });
}
