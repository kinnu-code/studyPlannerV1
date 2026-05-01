# Smart Study Planner — Working Logic Specification v0.2

---

## 1. Overview

A standalone study planning tool. The user provides a topic list (or an exam name and the tool generates one), an exam date, and their weekly study availability. The tool generates an optimized, day-by-day study plan that sequences reading, flashcard reviews, MCQ practice, and mock exams to achieve mastery across all topics by the exam date.

The plan is forward-looking: it predicts when each topic will be in each state based on a standard learning progression, without tracking actual performance. It produces both a visual trajectory and a granular daily schedule.

---

## 2. Inputs

| Input                    | Type                                           | Notes                                                          |
| ------------------------ | ---------------------------------------------- | -------------------------------------------------------------- |
| Topic list               | Three modes (see below)                        | Granular level; each assumed to have flashcards + MCQs         |
| Exam date                | Date                                           | Target date                                                    |
| Study schedule           | Per-weekday: N short sessions, M long sessions | e.g., Mon: 1 long, Tue: 2 short                                |
| spaced repetition intervals           | Configurable                                   | Default: [1, 6, 16, 45, 131] days                              |
| spaced repetition reviews for mastery | Configurable                                   | Default: all achievable before exam; can be set to e.g. 3 of 5 |
| Target state             | Configurable                                   | Default: Mastered; can be lowered to Healthy                   |
| Session durations        | Configurable                                   | Default: short = 25 min, long = 60 min                         |

### Topic input modes

The user can provide topics at three levels of detail:

1. **Exam name only** (e.g., "SQE FLK1", "CFA Level 1") — the AI generates the full granular topic list from its knowledge of the exam syllabus
2. **High-level topics** (e.g., "Contract Law, Tort, Land Law") — the AI breaks each down into granular sub-topics
3. **Granular topic list** — user provides the full list directly; no generation needed

In modes 1 and 2, the user reviews and confirms the generated topic list before the plan is built.

---

## 3. Topic Sizing

On input, the LLM evaluates each topic name and assigns:

- **S (Small)**: single concept, few flashcards, few MCQs
- **M (Medium)**: moderate depth, typical topic
- **L (Large)**: broad topic, many sub-concepts, many cards/MCQs

Size drives time estimates for each activity type:

| Activity                         | S      | M      | L      | Session type               |
| -------------------------------- | ------ | ------ | ------ | -------------------------- |
| First read (inc. new flashcards) | 20 min | 35 min | 50 min | 1 long OR 2 short (see §5) |
| Flashcard review session         | 5 min  | 10 min | 15 min | Either                     |
| MCQ session                      | 10 min | 15 min | 30 min | Either                     |
| Re-read (optional, weak topics)  | 10 min | 15 min | 20 min | Either                     |
| Weakness review                  | 20     | 35     | 50     | 1 long or 2 short          |

*All values configurable. First flashcard pass is embedded in the first read — the two are treated as a single combined activity.*

---

## 4. Topic State Machine

States are **predicted** based on scheduled activities, not actual performance.

| State                  | Meaning                                        | Transition in                                                  |
| ---------------------- | ---------------------------------------------- | -------------------------------------------------------------- |
| **Not started**        | No activity scheduled yet                      | —                                                              |
| **Ready for practice** | First read + new flashcards scheduled          | After Day 0 session(s) complete                                |
| **Weak**               | First MCQ session scheduled                    | After Day 1 review + first MCQ session                         |
| **Healthy**            | Sufficient MCQ sessions accumulated            | After N MCQ sessions (configurable, default: 3)                |
| **Due reviews**        | spaced repetition review due                                | Overlay flag on current state; clears once review is scheduled |
| **Mastered**           | spaced repetition review target met + MCQ threshold reached | After final scheduled review + MCQ count met                   |

**"Due reviews"** is an overlay flag, not a replacement state. A topic can be *Healthy + Due reviews* simultaneously. Once the review is scheduled into a session, the flag clears and the base state resumes.

**"Mastered"** is exam-relative. The required number of spaced repetition reviews to reach mastered is configurable (default: all reviews that fit before the exam date). The planner always reports how many of the 5 full intervals are achievable given the exam date and start date per topic.

---

## 5. Session Model

Each session has a time budget (short or long). The scheduler fills it with activity blocks from one or more topics, subject to the following rules.

### Splittability

**First read is the only activity that can be split across two sessions.** This is because it is the only activity that may exceed a short session's time budget. It can be scheduled as:
- One long session (preferred), or
- Two consecutive or near-consecutive short sessions (Part 1 and Part 2)

The topic does not become *Ready for practice* until both parts are complete.

All other activity blocks are atomic — they are never split.

### Re-read

Re-read is shorter than first read and fits within a short session for all topic sizes. It is optional and lower priority, triggered when a topic remains in *Weak* state.

### Session composition priority

When filling a session slot, activities are selected in this order:

1. spaced repetition reviews due within the next 1–2 days (time-sensitive, highest priority)
2. MCQ sessions on Ready for practice topics (first MCQ session)
3. MCQ sessions on Weak topics
4. First reads of Not started topics (any session type; split into 2 short if no long available)
5. MCQ sessions on Healthy topics
6. Re-reads on Weak topics (lower priority, optional)

Mixing topics within a session is encouraged (interleaving). The time budget is the binding constraint.

---

## 6. Per-Topic Timeline (the pipeline)

Each topic has an independent timeline from its Day 0 (when first read begins):

| Day offset | Activity                                        | Resulting state                                  |
| ---------- | ----------------------------------------------- | ------------------------------------------------ |
| Day 0      | First read + new flashcards (1 long or 2 short) | Ready for practice                               |
| Day 1      | Flashcard review 1                              | Ready for practice                               |
| Day 1–2    | First MCQ session                               | Weak                                             |
| Day 7      | Flashcard review 2                              | Weak (or Healthy if MCQ target met)              |
| Day 7+     | MCQ sessions continue                           | Weak → Healthy                                   |
| Day 23     | Flashcard review 3                              | Mastered (if Flashcards and MCQ target also met) |
| Day 68     | Flashcard review 4                              | Mastered (if MCQ target also met)                |
| Day 199    | Flashcard review 5                              | Mastered (if MCQ target also met)                |

Topics enter the pipeline at different times. The scheduler assigns a Day 0 for each topic and fits all downstream activities into available session slots.

**Day 0 assignment strategy**: spread first reads as early as possible, constrained by session availability. Goal: get all topics to *Ready for practice* as early as feasible, while spacing them to reduce review collisions downstream.

---

## 7. Mock Exams and Weakness Review

Default number of mock exams is 3, but the user can configure this number.

### Eligibility trigger

The first mock exam is scheduled only after **all topics** have had at least:
- One first read + flashcard session
- One MCQ session

i.e., every topic is at least in *Weak* state.

### Mock exam slots

1–3 mock exams scheduled between the eligibility date and the exam date. Each mock occupies a dedicated long session (or configurable exam-length slot). The number of mocks is either user-specified or determined by available time.

### Weakness review

One long or two short sessions after each mock, targeting topics still in *Weak* state at that point in the plan.

### Placement logic

Mock exam slots are reserved first, before the rest of the schedule is filled.

---

## 8. Overflow Negotiation

If the algorithm cannot fit all required activities before the exam date, it reports a shortfall and enters a structured negotiation.

**Shortfall report format:**
> "With your current schedule, you can reach *Healthy* on all topics but *Mastered* on only 6 of 14. To reach full mastery, you need approximately 3 more hours per week."

**Options presented to user (in order of impact):**

1. Add study time — how many sessions per week, and which type
2. Lower the target — accept *Healthy* instead of *Mastered* for some or all topics
3. Reduce the topic list — remove or de-prioritise specific topics
4. Expand spaced repetition intervals — stretch the review schedule (fewer total sessions required)
5. Reduce MCQ sessions per topic — lower the *Weak → Healthy* threshold
6. Lower the mastered spaced repetition review count — e.g., treat 3 reviews as sufficient for mastery
7. Lower the number of mock exams

Each option shows the projected impact before the user confirms. Negotiation is iterative — options can be combined until the plan is feasible.

---

## 9. Output

### 9a. Visual trajectory

A timeline view with:
- **Horizontal axis**: dates from today to exam day
- **Vertical axis**: topics (ordered by scheduled start date)
- **Color bands per topic**: state at each point in time — Not started → Ready for practice → Weak → Healthy → Mastered — with Due reviews shown as a marker/stripe overlay
- **Mock exam markers**: vertical lines on the timeline

This gives the user a "regions changing in space" view of their full learning journey at a glance.

### 9b. Day-by-day plan

For each day:
- List of sessions (short/long)
- For each session: ordered activity blocks with topic name, activity type, and estimated time
- One-line reason per block (e.g., "Flashcard review due — Land Law, interval 2 of 5")

The plan is **regeneratable**: if the user changes spaced repetition intervals, session schedule, target state, or mastery threshold, the plan rebuilds from scratch.

---

## 10. Re-planing
The user can open the planner and select from a number of options such as
1. I skiped sessions x to y
2. I am ahead by n sessions
3. Update my weekly schedule
4. Add n mock exams
5. Remove n mock exams
6. Update settings
After which the planner will recalculate based on the current date, exam date and the updated information and will go to ##8 if there is overflow
---

## 11. Open questions

1. **Day 0 spread vs. backwards scheduling**: the spec uses earliest-possible first reads. An alternative is working backwards from the exam to maximise retention at exam time. Worth evaluating which produces better outcomes for short prep windows.

