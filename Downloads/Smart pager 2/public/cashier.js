const socket = io();
const callList = document.getElementById("callList");
const requestCount = document.getElementById("requestCount");

const renderCalls = (calls) => {
  if (!callList || !requestCount) return;

  if (!calls.length) {
    callList.className = "call-list empty-list";
    callList.innerHTML = "<p>No customer requests yet.</p>";
    requestCount.textContent = "0 requests";
    return;
  }

  callList.className = "call-list";
  callList.innerHTML = calls
    .slice()
    .reverse()
    .map(
      (call) => `
        <div class="call-item ${call.type}">
          <div class="call-body">
            <span class="call-table">${call.table}</span>
            <span class="call-type">${call.type}</span>
            <div class="call-message">${call.message}</div>
            <div class="call-time">${new Date(call.createdAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</div>
          </div>
          <button class="resolve-button" data-id="${call.id}">Resolved</button>
        </div>
      `
    )
    .join("");

  requestCount.textContent = `${calls.length} request${calls.length === 1 ? "" : "s"}`;

  callList.querySelectorAll(".resolve-button").forEach((button) => {
    button.addEventListener("click", () => {
      socket.emit("resolve-call", button.dataset.id);
    });
  });
};

socket.on("active-calls", (calls) => {
  window._calls = calls;
  renderCalls(calls);
});

socket.on("call-added", (call) => {
  const currentCalls = [...(window._calls || [])];
  const updated = [...currentCalls, call];
  window._calls = updated;
  renderCalls(updated);
});

socket.on("call-resolved", (id) => {
  const current = [...(window._calls || [])].filter((call) => call.id !== id);
  window._calls = current;
  renderCalls(current);
});

window._calls = [];
