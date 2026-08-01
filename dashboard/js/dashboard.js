function formatDMY(dateObj) {
  const d = String(dateObj.getDate()).padStart(2, "0");
  const m = String(dateObj.getMonth() + 1).padStart(2, "0");
  const y = dateObj.getFullYear();
  const time = dateObj.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  return `${d}/${m}/${y} ${time}`;
}

function renderPersonCard(person) {
  const cls = person.status === "IN" ? "in" : "out";
  const lastUpdate = formatDMY(new Date(person.last_event_time));
  const isNight = person.shift_type === "night";
  return `
    <div class="status-card ${cls}">
      ${isNight ? '<span class="night-badge">NIGHT</span>' : ""}
      <div class="name">${person.name}</div>
      <div class="status">${person.status}</div>
      <div class="time">${lastUpdate}</div>
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
