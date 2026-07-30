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
    grid.innerHTML = "<p>No attendance events synced yet.</p>";
    return;
  }

  grid.innerHTML = data.map((person) => {
    const cls = person.status === "IN" ? "in" : "out";
    const time = new Date(person.last_event_time).toLocaleString();
    return `
      <div class="status-card ${cls}">
        <div class="name">${person.name}</div>
        <div class="status">${person.status}</div>
        <div class="time">since ${time}</div>
      </div>`;
  }).join("");
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

// Live updates: refetch whenever a new event lands.
supabaseClient
  .channel("events-live")
  .on("postgres_changes", { event: "INSERT", schema: "public", table: "events" }, () => {
    loadStatus();
    loadStaleness();
  })
  .subscribe();

// Fallback poll in case a realtime message is ever missed.
setInterval(() => {
  loadStatus();
  loadStaleness();
}, 30000);
