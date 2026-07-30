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

async function loadPeopleFilter() {
  const select = document.getElementById("personFilter");
  const { data, error } = await supabaseClient.from("people").select("employee_no, name").order("name");
  if (error || !data) return;
  peopleList = data;

  data.forEach((p) => {
    const opt = document.createElement("option");
    opt.value = p.employee_no;
    opt.textContent = `${p.name} (${p.employee_no})`;
    select.appendChild(opt);
  });

  const chipsWrap = document.getElementById("peopleChips");
  chipsWrap.innerHTML = `<button type="button" class="chip active" data-emp="">All</button>` +
    data.map((p) => `<button type="button" class="chip" data-emp="${p.employee_no}">${p.name}</button>`).join("");

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

function buildTimeline(events) {
  const successEvents = events
    .filter((e) => SUCCESS_TYPES.includes(e.event_type))
    .slice()
    .sort((a, b) => new Date(a.event_time) - new Date(b.event_time));

  const byDay = {};
  successEvents.forEach((e) => {
    const key = new Date(e.event_time).toLocaleDateString("en-CA");
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

function renderTimeline(days) {
  const summary = document.getElementById("personSummary");
  const wrap = document.getElementById("timelineWrap");

  if (!days.length) {
    summary.innerHTML = "";
    wrap.innerHTML = "";
    return;
  }

  const grandTotalMs = days.reduce((s, d) => s + d.totalMs, 0);
  summary.innerHTML = `
    <div class="summary-stat"><span class="num">${days.length}</span><span class="label">day(s) present</span></div>
    <div class="summary-stat"><span class="num">${formatDuration(grandTotalMs)}</span><span class="label">total time (paired scans)</span></div>
  `;

  wrap.innerHTML = days.map((day) => {
    const dateLabel = new Date(`${day.dateKey}T00:00:00`).toLocaleDateString(undefined, {
      weekday: "short", month: "short", day: "numeric", year: "numeric",
    });
    const rows = day.pairs.map((p) => {
      const inTime = new Date(p.in.event_time).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
      if (p.out) {
        const outTime = new Date(p.out.event_time).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
        const dur = formatDuration(new Date(p.out.event_time) - new Date(p.in.event_time));
        return `<div class="tl-row">
          <span class="tl-badge in">IN ${inTime}</span>
          <span class="tl-arrow">&#8594;</span>
          <span class="tl-badge out">OUT ${outTime}</span>
          <span class="tl-dur">${dur}</span>
        </div>`;
      }
      return `<div class="tl-row">
        <span class="tl-badge in">IN ${inTime}</span>
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
      <td>${e.event_type}</td>
      <td>${e.verify_mode || ""}</td>
      <td>${e.door_no ?? ""}</td>
    </tr>`).join("");

  if (personNo) {
    renderTimeline(buildTimeline(lastResults));
  } else {
    document.getElementById("personSummary").innerHTML = "";
    document.getElementById("timelineWrap").innerHTML = "";
  }
}

function exportCsv() {
  if (lastResults.length === 0) {
    alert("Run a search first.");
    return;
  }
  const header = ["Time", "Employee No", "Name", "Event", "Verify Mode", "Door"];
  const rows = lastResults.map((e) => [
    new Date(e.event_time).toLocaleString(),
    e.employee_no,
    e.people ? e.people.name : "",
    e.event_type,
    e.verify_mode || "",
    e.door_no ?? "",
  ]);
  const csv = [header, ...rows]
    .map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(","))
    .join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `attendance-${document.getElementById("fromDate").value}-to-${document.getElementById("toDate").value}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

document.getElementById("searchBtn").addEventListener("click", runSearch);
document.getElementById("exportBtn").addEventListener("click", exportCsv);
document.getElementById("personFilter").addEventListener("change", () => {
  document.querySelectorAll(".chip").forEach((c) => {
    c.classList.toggle("active", c.dataset.emp === document.getElementById("personFilter").value);
  });
  runSearch();
});

loadPeopleFilter().then(runSearch);
