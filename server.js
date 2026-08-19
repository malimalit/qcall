require('dotenv').config();
const express = require('express');
const http = require('http');
const path = require('path');
const QRCode = require('qrcode');
const { Server } = require('socket.io');
const { Pool } = require('pg');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { transports: ["polling", "websocket"], cors: { origin: "*" } });
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

const activeOrders = new Map();
const reminderIntervals = new Map();
let orderCounter = parseInt(process.env.ORDER_COUNTER || "100");
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || "Malit@1972";

let restaurantConfig = {
  instance: process.env.ULTRAMSG_INSTANCE || "",
  token: process.env.ULTRAMSG_TOKEN || "",
  phone: "",
  countryCode: process.env.COUNTRY_CODE || "20"
};

async function initDB() {
  try {
    await pool.query(`CREATE TABLE IF NOT EXISTS clients (
      id TEXT PRIMARY KEY, name TEXT, phone TEXT, instance TEXT,
      token TEXT, plan TEXT, created_at BIGINT, expires_at BIGINT
    )`);
    console.log("DB ready");
    const res = await pool.query("SELECT * FROM clients WHERE expires_at > $1 ORDER BY created_at DESC LIMIT 1", [Date.now()]);
    if (res.rows.length > 0) {
      const c = res.rows[0];
      restaurantConfig.instance = c.instance;
      restaurantConfig.token = c.token;
      restaurantConfig.phone = c.phone;
      console.log("Loaded client:", c.name);
    }
  } catch(e) { console.log("DB init error:", e.message); }
}

function checkAdmin(req, res) {
  if (req.headers["x-admin-token"] !== ADMIN_TOKEN) { res.status(401).json({ error: "Unauthorized" }); return false; }
  return true;
}

function removeOrder(orderId) {
  if (reminderIntervals.has(String(orderId))) { clearInterval(reminderIntervals.get(String(orderId))); reminderIntervals.delete(String(orderId)); }
  activeOrders.delete(String(orderId));
  io.emit("orders_updated", Array.from(activeOrders.values()));
}

async function sendWhatsApp(phone, message) {
  try {
    const axios = require("axios");
    const instance = restaurantConfig.instance || process.env.ULTRAMSG_INSTANCE;
    const token = restaurantConfig.token || process.env.ULTRAMSG_TOKEN;
    if (!instance || !token || !phone) return;
    await axios.post(`https://api.ultramsg.com/${instance}/messages/chat`, { token, to: phone, body: message });
    console.log("WhatsApp sent to", phone);
  } catch(e) { console.log("WhatsApp error:", e.message); }
}

app.use(express.static(path.join(__dirname, "public")));
app.get("/", (req,res) => res.sendFile(path.join(__dirname,"public","index.html")));
app.get(["/customer","/customer.html"], (req,res) => res.sendFile(path.join(__dirname,"public","customer.html")));
app.get(["/archive","/archive.html"], (req,res) => res.sendFile(path.join(__dirname,"public","archive.html")));
app.get(["/setup","/setup.html"], (req,res) => res.sendFile(path.join(__dirname,"public","setup.html")));
app.get(["/admin","/admin.html"], (req,res) => res.sendFile(path.join(__dirname,"public","admin.html")));

app.get(["/cashier","/cashier.html"], async (req,res) => {
  try {
    const result = await pool.query("SELECT * FROM clients WHERE expires_at > $1 LIMIT 1", [Date.now()]);
    if (result.rows.length === 0) return res.sendFile(path.join(__dirname,"public","demo-expired.html"));
    return res.sendFile(path.join(__dirname,"public","cashier.html"));
  } catch(e) { return res.sendFile(path.join(__dirname,"public","cashier.html")); }
});

app.get("/api/admin/clients", async (req,res) => {
  if (!checkAdmin(req,res)) return;
  try {
    const result = await pool.query("SELECT * FROM clients ORDER BY created_at DESC");
    const now = Date.now();
    const list = result.rows.map(r => ({
      id: r.id, name: r.name, phone: r.phone, instance: r.instance,
      token: r.token, plan: r.plan, createdAt: Number(r.created_at),
      expiresAt: Number(r.expires_at),
      status: Number(r.expires_at) > now ? "active" : "expired"
    }));
    const active = list.filter(c => c.status === "active").length;
    res.json({ clients: list, stats: { total: list.length, active, expired: list.length - active } });
  } catch(e) { res.json({ clients: [], stats: { total:0, active:0, expired:0 } }); }
});

app.post("/api/admin/clients", async (req,res) => {
  if (!checkAdmin(req,res)) return;
  try {
    const { name, phone, instance, token, plan } = req.body;
    if (!name || !phone || !instance || !token) return res.status(400).json({ error: "Missing fields" });
    const now = Date.now();
    const days = { demo:2, monthly:30, yearly:365 }[plan] || 2;
    const id = "client_" + now;
    await pool.query(
      "INSERT INTO clients (id,name,phone,instance,token,plan,created_at,expires_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT (id) DO UPDATE SET name=$2,phone=$3,instance=$4,token=$5,plan=$6,expires_at=$8",
      [id, name, phone, instance, token, plan||"demo", now, now + days*24*60*60*1000]
    );
    restaurantConfig.instance = instance;
    restaurantConfig.token = token;
    restaurantConfig.phone = phone;
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.delete("/api/admin/clients/:id", async (req,res) => {
  if (!checkAdmin(req,res)) return;
  try {
    await pool.query("DELETE FROM clients WHERE id=$1", [req.params.id]);
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post("/api/admin/extend/:id", async (req,res) => {
  if (!checkAdmin(req,res)) return;
  try {
    const days = req.body.days || 30;
    const r = await pool.query("SELECT expires_at FROM clients WHERE id=$1", [req.params.id]);
    if (!r.rows.length) return res.status(404).json({ error: "Not found" });
    const newExp = Math.max(Number(r.rows[0].expires_at), Date.now()) + days*24*60*60*1000;
    await pool.query("UPDATE clients SET expires_at=$1 WHERE id=$2", [newExp, req.params.id]);
    res.json({ success: true, expiresAt: newExp });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post("/api/orders/create", async (req,res) => {
  orderCounter++;
  const orderId = String(orderCounter);
  const protocol = req.headers["x-forwarded-proto"] || req.protocol;
  const host = req.headers["x-forwarded-host"] || req.get("host");
  const trackingUrl = `${protocol}://${host}/customer.html?orderId=${orderId}`;
  try {
    const qrCodeDataUrl = await QRCode.toDataURL(trackingUrl, { width:300 });
    const order = { orderId, status:"PREPARING", trackingUrl, qrCodeDataUrl, createdAt: new Date().toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"}) };
    activeOrders.set(orderId, order);
    io.emit("orders_updated", Array.from(activeOrders.values()));
    res.json({ success:true, ...order });
  } catch(err) { res.status(500).json({ success:false, error:"QR failed" }); }
});

app.post("/api/orders/call", async (req,res) => {
  const { orderId } = req.body;
  const order = activeOrders.get(String(orderId));
  if (!order) return res.status(404).json({ success:false });
  order.status = "READY";
  activeOrders.set(String(orderId), order);
  if (order.customerPhone && restaurantConfig.instance && restaurantConfig.token) {
    sendWhatsApp(order.customerPhone, "Your Order #" + orderId + " is ready! Come pick it up.\n\nTrack: " + order.trackingUrl);
  }
  io.to("order_" + orderId).emit("order_ready", { orderId, message:"Order #" + orderId + " is ready!" });
  const timer = setInterval(() => {
    io.to("order_" + orderId).emit("order_ready", { orderId, message:"Reminder: Order #" + orderId + " is still waiting!" });
  }, 3*60*1000);
  reminderIntervals.set(String(orderId), timer);
  io.emit("orders_updated", Array.from(activeOrders.values()));
  res.json({ success:true });
});

app.post("/api/orders/phone", (req,res) => {
  const { orderId, phone } = req.body;
  const order = activeOrders.get(String(orderId));
  if (order && phone) {
    let p = phone.replace(/\D/g,"");
    const cc = restaurantConfig.countryCode || "20";
    if (p.startsWith("0")) p = cc + p.slice(1);
    if (!p.startsWith("+")) p = "+" + p;
    order.customerPhone = p;
    activeOrders.set(String(orderId), order);
  }
  res.json({ success:true });
});

app.get("/api/orders/list", (req,res) => res.json({ success:true, orders: Array.from(activeOrders.values()) }));
app.get("/api/orders/status", (req,res) => {
  const o = activeOrders.get(String(req.query.orderId));
  res.json({ status: o ? o.status : "NOT_FOUND" });
});
app.post("/api/orders/acknowledge", (req,res) => { removeOrder(String(req.body.orderId)); res.json({ success:true }); });
app.post("/api/auth", (req,res) => { res.json({ success: req.body.password === (process.env.SETUP_PASSWORD || "Malit@1972") }); });

io.on("connection", (socket) => {
  socket.on("join_order", ({ orderId }) => {
    if (!orderId) return;
    socket.join("order_" + orderId);
    const order = activeOrders.get(String(orderId));
    socket.emit("order_status", { status: order ? order.status : "NOT_FOUND" });
    if (order && order.status === "READY") socket.emit("order_ready", { orderId, message:"Order #" + orderId + " is ready!" });
  });
  socket.on("order_acknowledged", ({ orderId }) => {
    const order = activeOrders.get(String(orderId));
    if (order) io.emit("order_archived", { orderId: order.orderId, completedAt: new Date().toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"}), customerPhone: order.customerPhone || "" });
    removeOrder(String(orderId));
  });
});

server.listen(PORT, "0.0.0.0", () => { console.log("QCall running on port " + PORT); initDB(); });
