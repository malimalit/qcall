require('dotenv').config();
const express = require('express');
const http = require('http');
const path = require('path');
const QRCode = require('qrcode');
const { Server } = require('socket.io');
const webpush = require('web-push');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { transports: ["polling", "websocket"], cors: { origin: "*" } });
const PORT = process.env.PORT || 3000;

webpush.setVapidDetails('mailto:admin@qcall.app', process.env.VAPID_PUBLIC_KEY, process.env.VAPID_PRIVATE_KEY);

const activeOrders = new Map();
const reminderIntervals = new Map();
const pushSubscriptions = new Map();
let orderCounter = 100;

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

app.get('/', (req,res) => res.sendFile(path.join(__dirname,'public','index.html')));
app.get(['/cashier','/cashier.html'], (req,res) => res.sendFile(path.join(__dirname,'public','cashier.html')));
app.get(['/customer','/customer.html'], (req,res) => res.sendFile(path.join(__dirname,'public','customer.html')));
app.get(['/archive','/archive.html'], (req,res) => res.sendFile(path.join(__dirname,'public','archive.html')));

app.get('/api/vapidPublicKey', (req,res) => res.json({ publicKey: process.env.VAPID_PUBLIC_KEY }));

app.post('/api/subscribe', (req,res) => {
  const { orderId, subscription } = req.body;
  console.log('SUB HIT orderId='+orderId, !!subscription);
  if (orderId && subscription) pushSubscriptions.set(String(orderId), subscription);
  res.json({ success: true });
});

app.post('/api/orders/create', async (req,res) => {
  orderCounter++;
  const orderId = String(orderCounter);
  const protocol = req.headers['x-forwarded-proto'] || req.protocol;
  const host = req.headers['x-forwarded-host'] || req.get('host');
  const trackingUrl = `${protocol}://${host}/customer.html?orderId=${orderId}`;
  try {
    const qrCodeDataUrl = await QRCode.toDataURL(trackingUrl, { width: 300 });
    const order = { orderId, status:'PREPARING', trackingUrl, qrCodeDataUrl, createdAt: new Date().toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'}) };
    activeOrders.set(orderId, order);
    io.emit('orders_updated', getOrdersList());
    res.json({ success:true, ...order });
  } catch(err) {
    res.status(500).json({ success:false, error:'Failed to generate QR Code' });
  }
});

app.post('/api/orders/call', async (req,res) => {
  const { orderId } = req.body;
  const order = activeOrders.get(String(orderId));
  if (!order) return res.status(404).json({ success:false, message:'Order not found' });

  order.status = 'READY';
  activeOrders.set(String(orderId), order);

  console.log(`Calling order ${orderId}, room: order_${orderId}`);
  io.to(`order_${orderId}`).emit('order_ready', { orderId, message:`Order #${orderId} is ready!` });

  const subscription = pushSubscriptions.get(String(orderId));
  if (subscription) {
    try {
      await webpush.sendNotification(subscription, JSON.stringify({ title:'🎉 Your order is ready!', body:`Order #${orderId} is waiting at the counter!`, orderId }));
    } catch(e) { console.log('Push failed:', e.message); }
  }

  if (reminderIntervals.has(String(orderId))) clearInterval(reminderIntervals.get(String(orderId)));
  const timer = setInterval(async () => {
    io.to(`order_${orderId}`).emit('order_ready', { orderId, message:`Reminder: Order #${orderId} is still waiting!` });
    const sub = pushSubscriptions.get(String(orderId));
    if (sub) {
      try { await webpush.sendNotification(sub, JSON.stringify({ title:'⏰ Reminder', body:`Order #${orderId} is still waiting!`, orderId })); } catch(e) {}
    }
  }, 3*60*1000);
  reminderIntervals.set(String(orderId), timer);

  io.emit('orders_updated', getOrdersList());
  res.json({ success:true, message:`Order #${orderId} called.` });
});

app.get('/api/orders/list', (req,res) => res.json({ success:true, orders:getOrdersList() }));

function removeOrder(orderId) {
  if (reminderIntervals.has(String(orderId))) { clearInterval(reminderIntervals.get(String(orderId))); reminderIntervals.delete(String(orderId)); }
  pushSubscriptions.delete(String(orderId));
  activeOrders.delete(String(orderId));
  io.emit('orders_updated', getOrdersList());
}

function getOrdersList() { return Array.from(activeOrders.values()); }

io.on('connection', (socket) => {
  console.log('Socket connected:', socket.id);
  socket.on('join_order', ({ orderId }) => {
    if (!orderId) return;
    socket.join(`order_${orderId}`);
    console.log(`Socket ${socket.id} joined order_${orderId}`);
    const order = activeOrders.get(String(orderId));
    const status = order ? order.status : 'NOT_FOUND';
    console.log(`Sending order_status: ${status} to ${socket.id}`);
    socket.emit('order_status', { status });
    if (order && order.status === 'READY') {
      socket.emit('order_ready', { orderId, message:`Order #${orderId} is ready!` });
    }
  });
  socket.on('order_acknowledged', ({ orderId }) => { if (orderId) removeOrder(String(orderId)); });
  socket.on('disconnect', () => console.log('Socket disconnected:', socket.id));
});


app.get('/api/orders/status', (req, res) => {
  const o = activeOrders.get(String(req.query.orderId));
  res.json({ status: o ? o.status : 'NOT_FOUND' });
});

app.post('/api/orders/acknowledge', (req, res) => {
  removeOrder(String(req.body.orderId));
  res.json({ success: true });
});

server.listen(PORT, '0.0.0.0', () => console.log('🚀 QCall Server running on port ' + PORT));
