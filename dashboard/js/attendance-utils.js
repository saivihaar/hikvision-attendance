// Shared attendance logic used by history.js and monthly.js.
const SUCCESS_TYPES = ["face_success", "card_success", "fingerprint_success"];

function formatDuration(ms) {
  if (ms <= 0) return "0m";
  const totalMin = Math.round(ms / 60000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function parseTimeStr(t) {
  if (!t) return null;
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}

function timeOfDayMinutes(dateObj) {
  return dateObj.getHours() * 60 + dateObj.getMinutes();
}

function formatDMY(dateObj) {
  const d = String(dateObj.getDate()).padStart(2, "0");
  const m = String(dateObj.getMonth() + 1).padStart(2, "0");
  const y = dateObj.getFullYear();
  const time = dateObj.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: true });
  return `${d}/${m}/${y} ${time}`;
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

function lateBadge(eventTime, expectedTimeStr) {
  if (!expectedTimeStr) return "";
  const deadline = parseTimeStr(expectedTimeStr);
  const actual = timeOfDayMinutes(new Date(eventTime));
  return actual > deadline ? '<span class="tl-late">LATE</span>' : "";
}

function renderDaysHtml(days, person) {
  return days.map((day) => {
    const dateLabel = new Date(`${day.dateKey}T00:00:00`).toLocaleDateString(undefined, {
      weekday: "short", month: "short", day: "numeric", year: "numeric",
    });
    const rows = day.pairs.map((p) => {
      const inTime = new Date(p.in.event_time).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: true });
      const inLate = person ? lateBadge(p.in.event_time, person.expected_in_time) : "";
      if (p.out) {
        const outTime = new Date(p.out.event_time).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: true });
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
