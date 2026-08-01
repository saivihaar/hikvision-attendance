function todayStr() {
  return new Date().toISOString().slice(0, 10);
}
function daysAgoStr(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

document.getElementById("fromDate").value = daysAgoStr(30);
document.getElementById("toDate").value = todayStr();

let lastResults = [];
let peopleList = [];
let selectedPerson = null;

async function loadPeopleFilter() {
  const select = document.getElementById("personFilter");
  const { data, error } = await supabaseClient
    .from("people")
    .select("employee_no, name, shift_type, expected_in_time, expected_out_time")
    .order("name");
  if (error || !data) return;
  peopleList = data;

  data.forEach((p) => {
    const opt = document.createElement("option");
    opt.value = p.employee_no;
    opt.textContent = `${p.name} (${p.employee_no})${p.shift_type === "night" ? " - Night" : ""}`;
    select.appendChild(opt);
  });

  const dayPeople = data.filter((p) => p.shift_type !== "night");
  const nightPeople = data.filter((p) => p.shift_type === "night");

  const chipsWrap = document.getElementById("peopleChips");
  let html = `<button type="button" class="chip active" data-emp="">All</button>`;
  if (dayPeople.length) {
    html += `<span class="chip-group-label">Day</span>` +
      dayPeople.map((p) => `<button type="button" class="chip" data-emp="${p.employee_no}">${p.name}</button>`).join("");
  }
  if (nightPeople.length) {
    html += `<span class="chip-group-label">Night</span>` +
      nightPeople.map((p) => `<button type="button" class="chip" data-emp="${p.employee_no}">${p.name}</button>`).join("");
  }
  chipsWrap.innerHTML = html;

  chipsWrap.querySelectorAll(".chip").forEach((chip) => {
    chip.addEventListener("click", () => {
      chipsWrap.querySelectorAll(".chip").forEach((c) => c.classList.remove("active"));
      chip.classList.add("active");
      select.value = chip.dataset.emp;
      runSearch();
    });
  });
}

function nameForEmployee(empNo) {
  const person = peopleList.find((p) => p.employee_no === empNo);
  return person ? person.name : empNo;
}

function renderTrendChart(events) {
  const container = document.getElementById("trendChart");
  const successEvents = events.filter((e) => SUCCESS_TYPES.includes(e.event_type));
  if (successEvents.length === 0) {
    container.innerHTML = "";
    return;
  }

  const byDate = {};
  successEvents.forEach((e) => {
    const key = new Date(e.event_time).toLocaleDateString("en-CA");
    byDate[key] = (byDate[key] || 0) + 1;
  });
  const dates = Object.keys(byDate).sort();
  const maxCount = Math.max(...dates.map((d) => byDate[d]));

  const width = Math.max(container.clientWidth || 600, 300);
  const height = 160;
  const padding = { top: 10, right: 10, bottom: 20, left: 10 };
  const chartW = width - padding.left - padding.right;
  const chartH = height - padding.top - padding.bottom;
  const barSlot = chartW / dates.length;
  const barWidth = Math.max(2, Math.min(24, barSlot - 2));

  const fmtLabel = (d) => new Date(`${d}T00:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric" });

  const bars = dates.map((d, i) => {
    const count = byDate[d];
    const barH = Math.max((count / maxCount) * chartH, 2);
    const x = padding.left + i * barSlot + (barSlot - barWidth) / 2;
    const y = padding.top + (chartH - barH);
    const label = fmtLabel(d);
    return `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${barWidth.toFixed(1)}" height="${barH.toFixed(1)}" rx="4" ry="4" tabindex="0" class="trend-bar"><title>${label}: ${count} scan${count === 1 ? "" : "s"}</title></rect>`;
  }).join("");

  // Sparse x-axis labels: first, middle, last (avoid clutter on long ranges)
  const labelIdx = dates.length <= 3
    ? dates.map((_, i) => i)
    : [0, Math.floor((dates.length - 1) / 2), dates.length - 1];
  const axisLabels = labelIdx.map((i) => {
    const x = padding.left + i * barSlot + barSlot / 2;
    return `<text x="${x.toFixed(1)}" y="${height - 4}" text-anchor="middle" class="trend-axis-label">${fmtLabel(dates[i])}</text>`;
  }).join("");

  container.innerHTML = `
    <div class="card trend-chart-card">
      <h2>Attendance Trend</h2>
      <p class="trend-chart-sub">Successful check-ins per day${dates.length > 1 ? ` (peak: ${maxCount}/day)` : ""}</p>
      <svg viewBox="0 0 ${width} ${height}" width="100%" height="${height}" preserveAspectRatio="none" role="img" aria-label="Daily successful check-in counts">
        <line x1="${padding.left}" y1="${(padding.top + chartH).toFixed(1)}" x2="${width - padding.right}" y2="${(padding.top + chartH).toFixed(1)}" stroke="var(--border)" stroke-width="1"/>
        ${bars}
        ${axisLabels}
      </svg>
    </div>
  `;
}

function renderOverallSummary(events) {
  const wrap = document.getElementById("overallSummary");
  if (!events.length) {
    wrap.innerHTML = "";
    return;
  }
  const successCount = events.filter((e) => SUCCESS_TYPES.includes(e.event_type)).length;
  const failCount = events.filter((e) => e.event_type === "face_fail").length;
  const uniquePeople = new Set(events.map((e) => e.employee_no)).size;

  const byEmployee = {};
  events.forEach((e) => {
    (byEmployee[e.employee_no] = byEmployee[e.employee_no] || []).push(e);
  });
  const totalMs = Object.keys(byEmployee).reduce((sum, empNo) => {
    const person = peopleList.find((p) => p.employee_no === empNo);
    const days = buildTimeline(byEmployee[empNo], person);
    return sum + days.reduce((s, d) => s + d.totalMs, 0);
  }, 0);

  wrap.innerHTML = `
    <div class="summary-stat"><span class="num">${events.length}</span><span class="label">total events</span></div>
    <div class="summary-stat"><span class="num">${successCount}</span><span class="label">successful scans</span></div>
    <div class="summary-stat"><span class="num">${uniquePeople}</span><span class="label">people active</span></div>
    <div class="summary-stat"><span class="num">${formatDuration(totalMs)}</span><span class="label">total hours worked</span></div>
    ${failCount ? `<div class="summary-stat"><span class="num">${failCount}</span><span class="label">failed attempts</span></div>` : ""}
  `;
}

function renderTimeline(days, person) {
  const summary = document.getElementById("personSummary");
  const wrap = document.getElementById("timelineWrap");

  if (!days.length) {
    summary.innerHTML = "";
    wrap.innerHTML = "";
    return;
  }

  const grandTotalMs = days.reduce((s, d) => s + d.totalMs, 0);
  const expectedNote = person && person.shift_type === "night"
    ? `<div class="summary-stat"><span class="num">In by ${person.expected_in_time?.slice(0,5) || "-"}</span><span class="label">Expected in</span></div>
       <div class="summary-stat"><span class="num">Out by ${person.expected_out_time?.slice(0,5) || "-"}</span><span class="label">Expected out</span></div>`
    : "";
  summary.innerHTML = `
    <div class="summary-stat"><span class="num">${days.length}</span><span class="label">day(s) present</span></div>
    <div class="summary-stat"><span class="num">${formatDuration(grandTotalMs)}</span><span class="label">total time (paired scans)</span></div>
    ${expectedNote}
  `;

  wrap.innerHTML = renderDaysHtml(days, person);
}

function renderAllPeopleTimelines(events) {
  const wrap = document.getElementById("timelineWrap");
  const byEmployee = {};
  events.forEach((e) => {
    (byEmployee[e.employee_no] = byEmployee[e.employee_no] || []).push(e);
  });

  const sections = Object.keys(byEmployee).map((empNo) => {
    const person = peopleList.find((p) => p.employee_no === empNo);
    const name = person ? person.name : empNo;
    const days = buildTimeline(byEmployee[empNo], person);
    if (!days.length) return { name, html: "" };
    const grandTotalMs = days.reduce((s, d) => s + d.totalMs, 0);
    const nightTag = person && person.shift_type === "night" ? ` <span class="chip-group-label">Night</span>` : "";
    return {
      name,
      html: `<div class="card person-timeline-card">
        <h3 class="person-timeline-name">${name}${nightTag}<span class="person-timeline-meta">${days.length} day(s) &middot; ${formatDuration(grandTotalMs)}</span></h3>
        ${renderDaysHtml(days, person)}
      </div>`,
    };
  }).filter((s) => s.html).sort((a, b) => a.name.localeCompare(b.name));

  wrap.innerHTML = sections.length
    ? sections.map((s) => s.html).join("")
    : `<p style="color:var(--text-muted);">No successful scans in this range.</p>`;
}

async function runSearch() {
  const from = document.getElementById("fromDate").value;
  const to = document.getElementById("toDate").value;
  const personNo = document.getElementById("personFilter").value;
  const info = document.getElementById("resultsInfo");
  const body = document.getElementById("resultsBody");

  selectedPerson = personNo ? peopleList.find((p) => p.employee_no === personNo) : null;

  const fromIso = new Date(`${from}T00:00:00`).toISOString();
  const toIso = new Date(`${to}T23:59:59`).toISOString();

  let query = supabaseClient
    .from("events")
    .select("event_time, employee_no, event_type, verify_mode, door_no")
    .gte("event_time", fromIso)
    .lte("event_time", toIso)
    .order("event_time", { ascending: false });

  if (personNo) query = query.eq("employee_no", personNo);

  const { data, error } = await query;
  if (error) {
    info.textContent = `Error: ${error.message}`;
    body.innerHTML = "";
    document.getElementById("personSummary").innerHTML = "";
    document.getElementById("timelineWrap").innerHTML = "";
    return;
  }

  lastResults = data || [];

  if (lastResults.length === 0) {
    const { data: { session } } = await supabaseClient.auth.getSession();
    if (!session) {
      info.innerHTML = `<span style="color:var(--danger);">Your login session has expired. <a href="login.html" style="color:var(--gold-bright);">Log in again</a> to see your data.</span>`;
      body.innerHTML = "";
      document.getElementById("personSummary").innerHTML = "";
      document.getElementById("timelineWrap").innerHTML = "";
      document.getElementById("overallSummary").innerHTML = "";
      document.getElementById("trendChart").innerHTML = "";
      return;
    }
  }

  info.textContent = `${lastResults.length} event(s) found`;
  body.innerHTML = lastResults.map((e) => `
    <tr>
      <td>${formatDMY(new Date(e.event_time))}</td>
      <td>${e.employee_no}</td>
      <td>${nameForEmployee(e.employee_no)}</td>
      <td>${eventTypeBadge(e.event_type)}</td>
      <td>${e.verify_mode || ""}</td>
      <td>${e.door_no ?? ""}</td>
    </tr>`).join("");

  renderTrendChart(lastResults);

  if (personNo) {
    document.getElementById("overallSummary").innerHTML = "";
    renderTimeline(buildTimeline(lastResults, selectedPerson), selectedPerson);
  } else {
    document.getElementById("personSummary").innerHTML = "";
    renderOverallSummary(lastResults);
    renderAllPeopleTimelines(lastResults);
  }
}

function applyDatePreset(days) {
  document.getElementById("fromDate").value = days === 0 ? todayStr() : daysAgoStr(days);
  document.getElementById("toDate").value = days === 1 ? daysAgoStr(1) : todayStr();
}

document.querySelectorAll(".preset-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".preset-btn").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    applyDatePreset(Number(btn.dataset.days));
    runSearch();
  });
});
document.getElementById("fromDate").addEventListener("change", () => {
  document.querySelectorAll(".preset-btn").forEach((b) => b.classList.remove("active"));
});
document.getElementById("toDate").addEventListener("change", () => {
  document.querySelectorAll(".preset-btn").forEach((b) => b.classList.remove("active"));
});

document.getElementById("searchBtn").addEventListener("click", runSearch);
document.getElementById("personFilter").addEventListener("change", () => {
  document.querySelectorAll(".chip").forEach((c) => {
    c.classList.toggle("active", c.dataset.emp === document.getElementById("personFilter").value);
  });
  runSearch();
});

loadPeopleFilter().then(runSearch);
