function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

document.getElementById("fromDate").value = todayStr();
document.getElementById("toDate").value = todayStr();

let lastResults = [];

async function loadPeopleFilter() {
  const select = document.getElementById("personFilter");
  const { data, error } = await supabaseClient.from("people").select("employee_no, name").order("name");
  if (error || !data) return;
  data.forEach((p) => {
    const opt = document.createElement("option");
    opt.value = p.employee_no;
    opt.textContent = `${p.name} (${p.employee_no})`;
    select.appendChild(opt);
  });
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

loadPeopleFilter().then(runSearch);
