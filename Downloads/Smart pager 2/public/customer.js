const socket = typeof io !== "undefined" ? io() : null;

const urlParams = new URLSearchParams(window.location.search);
const tableName = urlParams.get("table") || "Table 1";
const outletName = urlParams.get("outlet") || "Call Demo";
const outletType = (urlParams.get("type") || "restaurant").toLowerCase();
const tableTitle = document.getElementById("tableTitle");
const statusBox = document.getElementById("status");
const outletBadge = document.getElementById("outletBadge");
const outletNameNode = document.getElementById("outletName");
const buttons = document.querySelectorAll("button[data-kind]");

if (outletBadge) {
  outletBadge.textContent = outletType === "cafe" ? "☕ Cafe" : "🍽️ Restaurant";
}

if (outletNameNode) {
  outletNameNode.textContent = outletName;
}

if (tableTitle) {
  tableTitle.textContent = tableName;
}

const actionLabels = {
  waiter: "Waiter",
  cashier: "Cashier",
  order: "Order Help"
};

if (socket && buttons.length) {
  buttons.forEach((button) => {
    button.addEventListener("click", () => {
      const kind = button.dataset.kind;
      const message = `${actionLabels[kind]} requested for ${tableName}`;

      socket.emit("new-call", {
        table: tableName,
        message,
        type: kind
      });

      if (statusBox) {
        statusBox.textContent = `Request sent: ${actionLabels[kind]}. Staff has been notified.`;
      }
    });
  });
}

const tableNameInput = document.getElementById("tableName");
const outletNameInput = document.getElementById("outletNameInput");
const outletTypeSelect = document.getElementById("outletType");
const generateQrBtn = document.getElementById("generateQrBtn");
const qrDisplay = document.getElementById("qrDisplay");
const customerLink = document.getElementById("customerLink");
const tableResultTitle = document.getElementById("tableResultTitle");

if (generateQrBtn && tableNameInput) {
  generateQrBtn.addEventListener("click", async () => {
    const table = tableNameInput.value.trim() || "Table 1";
    const outlet = (outletNameInput && outletNameInput.value.trim()) || "Call Demo";
    const type = (outletTypeSelect && outletTypeSelect.value) || "restaurant";
    const response = await fetch(`/api/qr/${encodeURIComponent(table)}?outlet=${encodeURIComponent(outlet)}&type=${encodeURIComponent(type)}`);
    const data = await response.json();

    if (tableResultTitle) {
      tableResultTitle.textContent = `${data.outletName} • ${data.table}`;
    }

    if (customerLink) {
      customerLink.href = data.url;
      customerLink.textContent = data.url;
    }

    if (qrDisplay) {
      qrDisplay.classList.remove("empty");
      qrDisplay.innerHTML = `<img src="${data.qrCode}" alt="QR code for ${data.table} at ${data.outletName}" />`;
    }
  });
}
