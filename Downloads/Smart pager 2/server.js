const express = require("express");
const http = require("http");
const path = require("path");
const QRCode = require("qrcode");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3001;
const BASE_URL = process.env.CALL_BASE_URL || "";
const activeCalls = [];
const activeOrders = new Map();
let currentOrderNumber = 100;

const normalizeOutlet = (value, fallback = "Call Demo") => {
  const text = String(value || fallback).trim();
  return text || fallback;
};

const normalizeOutletType = (value) => {
  const type = String(value || "restaurant").trim().toLowerCase();
  return type === "cafe" ? "cafe" : "restaurant";
};

const buildCustomerUrl = ({ table, outletName, outletType, protocol, host }) => {
  const params = new URLSearchParams({
    table: normalizeOutlet(table, "Table 1"),
    outlet: normalizeOutlet(outletName, "Call Demo"),
    type: normalizeOutletType(outletType)
  });

  const root = BASE_URL || `${protocol}://${host}`;
  return `${root}/customer?${params.toString()}`;
};

const getBaseUrl = (req) => BASE_URL || `${req.protocol}://${req.get("host")}`;

app.use(express.static(path.join(__dirname, "public")));
app.use(express.json());

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.get("/cashier", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "cashier.html"));
});

app.get("/customer", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "customer.html"));
});

app.get("/track.html", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "track.html"));
});

app.get("/api/qr/:table", async (req, res) => {
  const table = (req.params.table || "Table 1").trim();
  const outletName = normalizeOutlet(req.query.outlet, "Call Demo");
  const outletType = normalizeOutletType(req.query.type);
  const fullUrl = buildCustomerUrl({
    table,
    outletName,
    outletType,
    protocol: req.protocol,
    host: req.get("host")
  });

  try {
    const qrCode = await QRCode.toDataURL(fullUrl, {
      margin: 1,
      width: 260,
      color: { dark: "#111827", light: "#ffffff" }
    });

    res.json({ table, outletName, outletType, url: fullUrl, qrCode });
  } catch (error) {
    console.error("QR generation failed:", error);
    res.status(500).json({ error: "Failed to generate QR code" });
  }
});

app.get("/api/calls", (req, res) => {
  res.json(activeCalls);
});

app.post('/api/orders/create', async (req, res) => {
    currentOrderNumber++;
    const orderId = String(currentOrderNumber);
    
    const protocol = req.headers['x-forwarded-proto'] || req.protocol;
    const host = req.headers['x-forwarded-host'] || req.get('host');
    
    // Automatically appends bypass query so mobile phones load the page instantly
    const trackingUrl = `${protocol}://${host}/track.html?orderId=${orderId}&bypass-tunnel-reminder=true`;

    try {
        const qrCodeDataUrl = await QRCode.toDataURL(trackingUrl);

        const newOrder = {
            orderId,
            status: 'PREPARING',
            trackingUrl,
            qrCodeDataUrl,
            createdAt: new Date()
        };

        activeOrders.set(orderId, newOrder);

        res.json({
            success: true,
            orderId,
            qrCodeDataUrl,
            trackingUrl
        });
    } catch (err) {
        res.status(500).json({ success: false, error: 'Failed to generate QR Code' });
    }
});
  try {
    const qrCodeDataUrl = await QRCode.toDataURL(trackingUrl);

    const newOrder = {
      orderId,
      status: "PREPARING",
      trackingUrl,
      qrCodeDataUrl,
      outletName,
      outletType,
      createdAt: new Date()
    };

    activeOrders.set(orderId, newOrder);

    io.emit("display_new_qr", {
      orderId,
      qrCodeDataUrl,
      outletName,
      outletType
    });

    res.json({
      success: true,
      orderId,
      qrCodeDataUrl,
      trackingUrl,
      outletName,
      outletType
    });
  } catch (err) {
    console.error("Order creation failed:", err);
    res.status(500).json({ success: false, error: "Failed to generate QR Code" });
  }
});

app.post("/api/orders/call", (req, res) => {
  const { orderId } = req.body;

  if (!activeOrders.has(orderId)) {
    return res.status(404).json({ success: false, message: "Order not found" });
  }

  const order = activeOrders.get(orderId);
  order.status = "READY";
  activeOrders.set(orderId, order);

  io.to(`order_${orderId}`).emit("order_ready", {
    orderId,
    message: "Your order is ready for pickup at the counter!"
  });

  res.json({ success: true, message: `Order #${orderId} called successfully.` });
});

io.on("connection", (socket) => {
  socket.emit("active-calls", activeCalls);

  socket.on("new-call", ({ table, message, type = "service" }) => {
    const record = {
      id: `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
      table: table || "Unknown Table",
      message: message || "Customer needs assistance",
      type,
      createdAt: new Date().toISOString()
    };

    activeCalls.push(record);
    if (activeCalls.length > 25) {
      activeCalls.shift();
    }

    io.emit("call-added", record);
  });

  socket.on("resolve-call", (id) => {
    const index = activeCalls.findIndex((call) => call.id === id);
    if (index !== -1) {
      activeCalls.splice(index, 1);
      io.emit("call-resolved", id);
    }
  });

  socket.on("join_order", (data) => {
    const { orderId } = data || {};
    if (!orderId) return;

    socket.join(`order_${orderId}`);

    const order = activeOrders.get(String(orderId));
    if (order) {
      socket.emit("order_status", { status: order.status });
    } else {
      socket.emit("order_status", { status: "NOT_FOUND" });
    }
  });
});

server.listen(PORT, () => {
  console.log(`===================================================`);
  console.log(` 🚀 Call Core Engine Running on Port ${PORT}`);
  console.log(`===================================================`);
});
