const SUCCESS_TYPES = ["face_success", "card_success", "fingerprint_success"];

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

function parseTimeStr(t) {
  if (!t) return null;
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}
function timeOfDayMinutes(dateObj) {
  return dateObj.getHours() * 60 + dateObj.getMinutes();
}

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

function formatDuration(ms) {
  if (ms <= 0) return "0m";
  const totalMin = Math.round(ms / 60000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function shiftDateKey(eventTime, isNight) {
  const d = new Date(eventTime);
  if (isNight && d.getHours() < 12) {
    d.setDate(d.getDate() - 1);
  }
  return d.toLocaleDateString("en-CA");
}

function buildTimeline(events, person) {
  const isNight = person && person.shift_type === "night";
  const successEvents = events
    .filter((e) => SUCCESS_TYPES.includes(e.event_type))
    .slice()
    .sort((a, b) => new Date(a.event_time) - new Date(b.event_time));

  const byDay = {};
  successEvents.forEach((e) => {
    const key = shiftDateKey(e.event_time, isNight);
    (byDay[key] = byDay[key] || []).push(e);
  });

  return Object.keys(byDay).sort().reverse().map((dateKey) => {
    const dayEvents = byDay[dateKey];
    const pairs = [];
    for (let i = 0; i < dayEvents.length; i += 2) {
      pairs.push({ in: dayEvents[i], out: dayEvents[i + 1] || null });
    }
    const totalMs = pairs.reduce((sum, p) => p.out ? sum + (new Date(p.out.event_time) - new Date(p.in.event_time)) : sum, 0);
    return { dateKey, pairs, totalMs };
  });
}

function eventTypeBadge(type) {
  const labels = {
    face_success: "Face",
    card_success: "Card",
    fingerprint_success: "Fingerprint",
    face_fail: "Failed",
    other: "Other",
  };
  const cls = SUCCESS_TYPES.includes(type) ? "success" : (type === "face_fail" ? "fail" : "other");
  return `<span class="event-badge ${cls}">${labels[type] || type}</span>`;
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
  wrap.innerHTML = `
    <div class="summary-stat"><span class="num">${events.length}</span><span class="label">total events</span></div>
    <div class="summary-stat"><span class="num">${successCount}</span><span class="label">successful scans</span></div>
    <div class="summary-stat"><span class="num">${uniquePeople}</span><span class="label">people active</span></div>
    ${failCount ? `<div class="summary-stat"><span class="num">${failCount}</span><span class="label">failed attempts</span></div>` : ""}
  `;
}

function lateBadge(eventTime, expectedTimeStr) {
  if (!expectedTimeStr) return "";
  const deadline = parseTimeStr(expectedTimeStr);
  const actual = timeOfDayMinutes(new Date(eventTime));
  return actual > deadline ? '<span class="tl-late">LATE</span>' : "";
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

  wrap.innerHTML = days.map((day) => {
    const dateLabel = new Date(`${day.dateKey}T00:00:00`).toLocaleDateString(undefined, {
      weekday: "short", month: "short", day: "numeric", year: "numeric",
    });
    const rows = day.pairs.map((p) => {
      const inTime = new Date(p.in.event_time).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
      const inLate = person ? lateBadge(p.in.event_time, person.expected_in_time) : "";
      if (p.out) {
        const outTime = new Date(p.out.event_time).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
        const outLate = person ? lateBadge(p.out.event_time, person.expected_out_time) : "";
        const dur = formatDuration(new Date(p.out.event_time) - new Date(p.in.event_time));
        return `<div class="tl-row">
          <span class="tl-badge in">IN ${inTime}</span>${inLate}
          <span class="tl-arrow">&#8594;</span>
          <span class="tl-badge out">OUT ${outTime}</span>${outLate}
          <span class="tl-dur">${dur}</span>
        </div>`;
      }
      return `<div class="tl-row">
        <span class="tl-badge in">IN ${inTime}</span>${inLate}
        <span class="tl-arrow">&#8594;</span>
        <span class="tl-pending">no checkout recorded</span>
      </div>`;
    }).join("");
    return `<div class="tl-day">
      <div class="tl-date">${dateLabel}<span class="tl-day-total">${formatDuration(day.totalMs)}</span></div>
      ${rows}
    </div>`;
  }).join("");
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
    .select("event_time, employee_no, event_type, verify_mode, door_no, people(name)")
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
  info.textContent = `${lastResults.length} event(s) found`;
  body.innerHTML = lastResults.map((e) => `
    <tr>
      <td>${new Date(e.event_time).toLocaleString()}</td>
      <td>${e.employee_no}</td>
      <td>${e.people ? e.people.name : ""}</td>
      <td>${eventTypeBadge(e.event_type)}</td>
      <td>${e.verify_mode || ""}</td>
      <td>${e.door_no ?? ""}</td>
    </tr>`).join("");

  if (personNo) {
    document.getElementById("overallSummary").innerHTML = "";
    renderTimeline(buildTimeline(lastResults, selectedPerson), selectedPerson);
  } else {
    document.getElementById("personSummary").innerHTML = "";
    document.getElementById("timelineWrap").innerHTML = "";
    renderOverallSummary(lastResults);
  }
}

document.getElementById("searchBtn").addEventListener("click", runSearch);
document.getElementById("personFilter").addEventListener("change", () => {
  document.querySelectorAll(".chip").forEach((c) => {
    c.classList.toggle("active", c.dataset.emp === document.getElementById("personFilter").value);
  });
  runSearch();
});

loadPeopleFilter().then(runSearch);
