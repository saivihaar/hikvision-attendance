function currentMonthStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

document.getElementById("monthPicker").value = currentMonthStr();

function monthBounds(monthStr) {
  const [y, m] = monthStr.split("-").map(Number);
  const from = new Date(y, m - 1, 1);
  const to = new Date(y, m, 0, 23, 59, 59);
  return { from, to };
}

async function generateReport() {
  const monthStr = document.getElementById("monthPicker").value;
  const info = document.getElementById("monthlyInfo");
  const body = document.getElementById("monthlyBody");
  const foot = document.getElementById("monthlyFoot");

  if (!monthStr) return;
  const { from, to } = monthBounds(monthStr);

  const { data: people, error: peopleError } = await supabaseClient
    .from("people")
    .select("employee_no, name, shift_type, expected_in_time, expected_out_time")
    .order("name");

  const { data: events, error: eventsError } = await supabaseClient
    .from("events")
    .select("event_time, employee_no, event_type")
    .gte("event_time", from.toISOString())
    .lte("event_time", to.toISOString());

  if (peopleError || eventsError) {
    info.textContent = `Error: ${(peopleError || eventsError).message}`;
    body.innerHTML = "";
    foot.innerHTML = "";
    return;
  }

  if ((!events || events.length === 0) && (!people || people.length === 0)) {
    const { data: { session } } = await supabaseClient.auth.getSession();
    if (!session) {
      info.innerHTML = `<span style="color:var(--danger);">Your login session has expired. <a href="login.html" style="color:var(--gold-bright);">Log in again</a>.</span>`;
      body.innerHTML = "";
      foot.innerHTML = "";
      return;
    }
  }

  const byEmployee = {};
  (events || []).forEach((e) => {
    (byEmployee[e.employee_no] = byEmployee[e.employee_no] || []).push(e);
  });

  const rows = (people || []).map((person) => {
    const empEvents = byEmployee[person.employee_no] || [];
    const days = buildTimeline(empEvents, person);
    const totalMs = days.reduce((s, d) => s + d.totalMs, 0);
    const avgMs = days.length ? totalMs / days.length : 0;
    return {
      name: person.name,
      shift: person.shift_type === "night" ? "Night" : "Day",
      daysPresent: days.length,
      totalMs,
      avgMs,
    };
  });

  const monthLabel = from.toLocaleDateString(undefined, { month: "long", year: "numeric" });
  info.textContent = `${monthLabel} - ${rows.filter((r) => r.daysPresent > 0).length} of ${rows.length} employee(s) had activity`;

  body.innerHTML = rows.map((r) => `
    <tr>
      <td>${r.name}</td>
      <td>${r.shift}</td>
      <td>${r.daysPresent}</td>
      <td>${formatDuration(r.totalMs)}</td>
      <td>${r.daysPresent ? formatDuration(r.avgMs) : "-"}</td>
    </tr>`).join("") || `<tr><td colspan="5" style="color:var(--text-muted);">No employees enrolled.</td></tr>`;

  const grandTotalMs = rows.reduce((s, r) => s + r.totalMs, 0);
  const totalDays = rows.reduce((s, r) => s + r.daysPresent, 0);
  foot.innerHTML = rows.length ? `
    <tr style="font-weight:600;border-top:2px solid var(--border-strong);">
      <td colspan="2">Total</td>
      <td>${totalDays}</td>
      <td>${formatDuration(grandTotalMs)}</td>
      <td></td>
    </tr>` : "";
}

document.getElementById("generateBtn").addEventListener("click", generateReport);
generateReport();
