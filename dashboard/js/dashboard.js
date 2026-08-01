function timeOfDayMinutes(dateObj) {
  return dateObj.getHours() * 60 + dateObj.getMinutes();
}

function parseTimeStr(t) {
  if (!t) return null;
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}

function isLate(person) {
  const eventMinutes = timeOfDayMinutes(new Date(person.last_event_time));
  if (person.status === "IN" && person.expected_in_time) {
    return eventMinutes > parseTimeStr(person.expected_in_time);
  }
  if (person.status === "OUT" && person.expected_out_time) {
    return eventMinutes > parseTimeStr(person.expected_out_time);
  }
  return false;
}

function renderPersonCard(person) {
  const cls = person.status === "IN" ? "in" : "out";
  const time = new Date(person.last_event_time).toLocaleString();
  const late = isLate(person);
  return `
    <div class="status-card ${cls}${late ? " late" : ""}">
      ${late ? '<span class="late-badge">LATE</span>' : ""}
      <div class="name">${person.name}</div>
      <div class="status">${person.status}</div>
      <div class="time">since ${time}</div>
    </div>`;
}

async function loadStatus() {
  const grid = document.getElementById("statusGrid");
  const { data, error } = await supabaseClient
    .from("current_status")
    .select("*")
    .order("name", { ascending: true });

  if (error) {
    grid.innerHTML = `<p style="color:#b91c1c;">Failed to load status: ${error.message}</p>`;
    return;
  }

  if (!data || data.length === 0) {
    const { data: { session } } = await supabaseClient.auth.getSession();
    if (!session) {
      grid.innerHTML = `<p style="color:var(--danger);">Your login session has expired. <a href="login.html" style="color:var(--gold-bright);">Log in again</a> to see live status.</p>`;
      return;
    }
    grid.innerHTML = "<p>No attendance events synced yet.</p>";
    return;
  }

  const dayShift = data.filter((p) => p.shift_type !== "night");
  const nightShift = data.filter((p) => p.shift_type === "night");

  let html = "";
  if (dayShift.length > 0) {
    html += `<div class="shift-section-label">Day Shift</div>
      <div class="status-grid">${dayShift.map(renderPersonCard).join("")}</div>`;
  }
  if (nightShift.length > 0) {
    html += `<div class="shift-section-label">Night Shift <span class="shift-hint">(in by 7:00 PM, out by 9:30 AM)</span></div>
      <div class="status-grid">${nightShift.map(renderPersonCard).join("")}</div>`;
  }
  grid.innerHTML = html;
}

async function loadStaleness() {
  const note = document.getElementById("staleNote");
  const { data, error } = await supabaseClient
    .from("sync_state")
    .select("last_synced_time")
    .order("last_synced_time", { ascending: false })
    .limit(1);

  if (error || !data || data.length === 0) {
    note.textContent = "";
    return;
  }

  const lastSync = new Date(data[0].last_synced_time);
  const minutesAgo = Math.round((Date.now() - lastSync.getTime()) / 60000);
  note.textContent = `Last synced from device: ${lastSync.toLocaleString()} (${minutesAgo} min ago)`;
  if (minutesAgo > 15) {
    note.textContent += " - office PC may be offline or the sync task may have stopped.";
  }
}

loadStatus();
loadStaleness();

supabaseClient
  .channel("events-live")
  .on("postgres_changes", { event: "INSERT", schema: "public", table: "events" }, () => {
    loadStatus();
    loadStaleness();
  })
  .subscribe();

setInterval(() => {
  loadStatus();
  loadStaleness();
}, 30000);
