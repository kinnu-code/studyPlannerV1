/**
 * chart.js — SVG-based topic state timeline (Gantt-style) and summary charts.
 */

const STATE_COLORS = {
  not_started: '#D5D5DC',
  ready:       '#7EB8F7',
  weak:        '#F5A623',
  healthy:     '#4CAF84',
  mastered:    '#2E7D52',
};

const STATE_LABELS = {
  not_started: 'Not Started',
  ready:       'Ready for Practice',
  weak:        'Weak',
  healthy:     'Healthy',
  mastered:    'Mastered',
};

const STATE_MEANINGS = {
  not_started: 'No study activity has been scheduled yet.',
  ready:       'First read is complete and the topic is ready for MCQ practice.',
  weak:        'Early practice stage after first MCQ; more repetitions are needed.',
  healthy:     'Good progress with enough MCQ practice for retention.',
  mastered:    'Target proficiency reached with required MCQ and SR reviews.',
};

const Chart = {

  // ── Timeline (Gantt) ──────────────────────────────────────────────────────

  /**
   * Render the state timeline into `container` (a DOM element).
   * plan.stateTimeline: [{topicId, topicName, timeline: [{date, state, dueReview}]}]
   */
  renderTimeline(plan, container) {
    container.innerHTML = '';

    const { stateTimeline, mockExamDates, examDate, startDate } = plan;
    if (!stateTimeline || stateTimeline.length === 0) return;

    const totalDays  = stateTimeline[0].timeline.length;
    const topicCount = stateTimeline.length;
    const longestTopicName = stateTimeline.reduce((max, t) => Math.max(max, (t.topicName || '').length), 0);

    const ROW_H      = 28;
    const LABEL_W    = Math.min(420, Math.max(220, 170 + longestTopicName * 4));
    const containerW = Chart._resolveContainerWidth(container);
    const DAY_W      = Math.max(2, Math.min(12, Math.floor((containerW - LABEL_W - 20) / totalDays)));
    const CHART_W    = DAY_W * totalDays;
    const HEADER_H   = 40;
    const SVG_W      = LABEL_W + CHART_W + 20;
    const SVG_H      = HEADER_H + topicCount * ROW_H + 30;
    const labelMaxChars = Math.max(16, Math.floor((LABEL_W - 16) / 6.3));

    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('width',  SVG_W);
    svg.setAttribute('height', SVG_H);
    svg.setAttribute('class',  'timeline-svg');

    // Legend at the top for quick reference
    container.appendChild(Chart._buildLegend());

    // ── Background ──────────────────────────────────────────────────────────
    const bg = Chart._rect(0, 0, SVG_W, SVG_H, '#FAFAF8');
    svg.appendChild(bg);

    // ── Date axis labels (every ~14 days) ───────────────────────────────────
    const labelInterval = Math.max(1, Math.round(14 / DAY_W) * Math.round(DAY_W));
    for (let i = 0; i < totalDays; i += Math.max(7, Math.round(totalDays / 10))) {
      const x    = LABEL_W + i * DAY_W;
      const date = stateTimeline[0].timeline[i]?.date || '';
      const label = date.slice(5); // MM-DD
      const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      text.setAttribute('x', x + 2);
      text.setAttribute('y', HEADER_H - 8);
      text.setAttribute('font-size', '10');
      text.setAttribute('fill', '#6B6B80');
      text.setAttribute('font-family', 'Inter, system-ui, sans-serif');
      text.textContent = label;
      svg.appendChild(text);

      const tick = Chart._line(x, HEADER_H - 6, x, HEADER_H, '#C0C0CC');
      svg.appendChild(tick);
    }

    // ── Topic rows ───────────────────────────────────────────────────────────
    stateTimeline.forEach((topic, rowIdx) => {
      const y = HEADER_H + rowIdx * ROW_H;

      // Alternating row background
      if (rowIdx % 2 === 1) {
        svg.appendChild(Chart._rect(0, y, SVG_W, ROW_H, '#F4F4F0'));
      }

      // Topic label
      const label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      label.setAttribute('x', 8);
      label.setAttribute('y', y + ROW_H / 2 + 4);
      label.setAttribute('font-size', '11');
      label.setAttribute('fill', '#1A1A2A');
      label.setAttribute('font-family', 'Inter, system-ui, sans-serif');
      label.textContent = Chart._middleEllipsis(topic.topicName || '', labelMaxChars);
      if ((topic.topicName || '').length > label.textContent.length) {
        label.style.cursor = 'help';
      }
      Chart._addTitle(label, topic.topicName || '');
      svg.appendChild(label);

      // State colour segments — merge consecutive same-state days
      let runStart = 0;
      for (let i = 1; i <= topic.timeline.length; i++) {
        const prev = topic.timeline[i - 1];
        const curr = topic.timeline[i];
        if (!curr || curr.state !== prev.state) {
          const segX = LABEL_W + runStart * DAY_W;
          const segW = (i - runStart) * DAY_W;
          const fill = STATE_COLORS[prev.state] || '#D5D5DC';
          const seg = Chart._rect(segX, y + 4, segW, ROW_H - 8, fill, 2);
          seg.style.cursor = 'help';
          Chart._addTitle(seg, `${STATE_LABELS[prev.state] || prev.state}: ${STATE_MEANINGS[prev.state] || ''}`);
          svg.appendChild(seg);
          runStart = i;
        }
      }

      // SR review markers (small dots on top of segments)
      topic.timeline.forEach((day, di) => {
        if (day.dueReview) {
          const cx = LABEL_W + di * DAY_W + DAY_W / 2;
          const cy = y + 5;
          const dot = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
          dot.setAttribute('cx', cx);
          dot.setAttribute('cy', cy);
          dot.setAttribute('r',  3);
          dot.setAttribute('fill', '#FFFFFF');
          dot.setAttribute('stroke', '#1A1A2A');
          dot.setAttribute('stroke-width', '1');
          dot.style.cursor = 'help';
          Chart._addTitle(dot, 'SR Review: A spaced-repetition review is due on this day.');
          svg.appendChild(dot);
        }
      });
    });

    // ── Mock exam vertical lines ─────────────────────────────────────────────
    if (mockExamDates) {
      const start = new Date(stateTimeline[0].timeline[0]?.date + 'T00:00:00');
      mockExamDates.forEach((md, mi) => {
        const mockD = new Date(md + 'T00:00:00');
        const di    = Math.round((mockD - start) / 86400000);
        if (di < 0 || di >= totalDays) return;
        const x = LABEL_W + di * DAY_W;
        const mockLine = Chart._line(x, HEADER_H, x, SVG_H - 20, '#E85D3E', 2);
        mockLine.style.cursor = 'help';
        Chart._addTitle(mockLine, `Mock Exam ${mi + 1}: Reserved long session for full exam practice.`);
        svg.appendChild(mockLine);
        const mlabel = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        mlabel.setAttribute('x', x + 3);
        mlabel.setAttribute('y', HEADER_H + 12);
        mlabel.setAttribute('font-size', '9');
        mlabel.setAttribute('fill', '#E85D3E');
        mlabel.setAttribute('font-family', 'Inter, system-ui, sans-serif');
        mlabel.textContent = `Mock ${mi + 1}`;
        svg.appendChild(mlabel);
      });
    }

    // ── Exam date line ───────────────────────────────────────────────────────
    const examLine = Chart._line(LABEL_W + (totalDays - 1) * DAY_W, HEADER_H,
      LABEL_W + (totalDays - 1) * DAY_W, SVG_H - 20, '#1A1A2A', 2);
    examLine.style.cursor = 'help';
    Chart._addTitle(examLine, `Exam Day: ${examDate}`);
    svg.appendChild(examLine);

    container.appendChild(svg);

    // Legend at the bottom for easy reference after scrolling through rows
    container.appendChild(Chart._buildLegend());
  },

  // ── Summary donut chart ───────────────────────────────────────────────────

  renderSummary(plan, container) {
    container.innerHTML = '';
    const counts = { not_started: 0, ready: 0, weak: 0, healthy: 0, mastered: 0 };
    plan.topics.forEach(t => { if (counts[t.state] !== undefined) counts[t.state]++; });
    const total = plan.topics.length;
    if (total === 0) return;

    const R = 60, CX = 80, CY = 80, size = 160;
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('width',  size);
    svg.setAttribute('height', size);

    let startAngle = -Math.PI / 2;
    Object.entries(counts).forEach(([state, count]) => {
      if (count === 0) return;
      const angle = (count / total) * 2 * Math.PI;
      const endAngle = startAngle + angle;
      const x1 = CX + R * Math.cos(startAngle);
      const y1 = CY + R * Math.sin(startAngle);
      const x2 = CX + R * Math.cos(endAngle);
      const y2 = CY + R * Math.sin(endAngle);
      const large = angle > Math.PI ? 1 : 0;
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('d', `M${CX},${CY} L${x1},${y1} A${R},${R} 0 ${large},1 ${x2},${y2} Z`);
      path.setAttribute('fill', STATE_COLORS[state]);
      svg.appendChild(path);
      startAngle = endAngle;
    });

    // Centre hole
    const hole = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    hole.setAttribute('cx', CX); hole.setAttribute('cy', CY); hole.setAttribute('r', 36);
    hole.setAttribute('fill', '#FAFAF8');
    svg.appendChild(hole);

    const centreText = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    centreText.setAttribute('x', CX); centreText.setAttribute('y', CY + 5);
    centreText.setAttribute('text-anchor', 'middle');
    centreText.setAttribute('font-size', '14');
    centreText.setAttribute('font-weight', 'bold');
    centreText.setAttribute('fill', '#1A1A2A');
    centreText.setAttribute('font-family', 'Inter, system-ui, sans-serif');
    centreText.textContent = `${counts.mastered}/${total}`;
    svg.appendChild(centreText);

    container.appendChild(svg);
  },

  // ── SVG helpers ───────────────────────────────────────────────────────────

  _rect(x, y, w, h, fill, rx = 0) {
    const r = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    r.setAttribute('x', x); r.setAttribute('y', y);
    r.setAttribute('width', w); r.setAttribute('height', h);
    r.setAttribute('fill', fill);
    if (rx) r.setAttribute('rx', rx);
    return r;
  },

  _line(x1, y1, x2, y2, stroke = '#CCC', width = 1) {
    const l = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    l.setAttribute('x1', x1); l.setAttribute('y1', y1);
    l.setAttribute('x2', x2); l.setAttribute('y2', y2);
    l.setAttribute('stroke', stroke);
    l.setAttribute('stroke-width', width);
    return l;
  },

  _addTitle(el, text) {
    const t = document.createElementNS('http://www.w3.org/2000/svg', 'title');
    t.textContent = text;
    el.appendChild(t);
  },

  _middleEllipsis(text, maxChars = 36) {
    const raw = String(text || '');
    if (raw.length <= maxChars) return raw;

    const keepStart = Math.max(5, Math.floor((maxChars - 3) * 0.58));
    const keepEnd = Math.max(4, maxChars - 3 - keepStart);

    const start = raw.slice(0, Math.max(1, keepStart));
    const end = raw.slice(-Math.max(1, keepEnd));
    return `${start}...${end}`;
  },

  _resolveContainerWidth(container) {
    const c1 = container?.clientWidth || 0;
    const c2 = Math.floor(container?.getBoundingClientRect?.().width || 0);
    const p1 = container?.parentElement?.clientWidth || 0;
    const p2 = Math.floor(container?.parentElement?.getBoundingClientRect?.().width || 0);
    const fallback = Math.floor(window.innerWidth * 0.78);
    return Math.max(c1, c2, p1, p2, fallback, 640);
  },

  _buildLegend() {
    const legend = document.createElement('div');
    legend.className = 'chart-legend';
    Object.entries(STATE_LABELS).forEach(([state, label]) => {
      const item = document.createElement('span');
      item.className = 'legend-item';
      item.title = STATE_MEANINGS[state] || label;
      item.innerHTML = `<span class="legend-dot" style="background:${STATE_COLORS[state]}"></span>${label}`;
      legend.appendChild(item);
    });

    const srItem = document.createElement('span');
    srItem.className = 'legend-item';
    srItem.title = 'A spaced-repetition review that should be completed on or near that day.';
    srItem.innerHTML = `<span class="legend-dot" style="background:#fff;border:2px solid #1A1A2A"></span>SR Review`;
    legend.appendChild(srItem);

    return legend;
  },
};
