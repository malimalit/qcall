require('dotenv').config();
const express = require('express');
const http = require('http');
const path = require('path');
const QRCode = require('qrcode');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { transports: ["polling", "websocket"], cors: { origin: "*" } });
const PORT = process.env.PORT || 3000;


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

  if(order.customerPhone && restaurantConfig && restaurantConfig.instance && restaurantConfig.token){
    sendWhatsApp(order.customerPhone, "🎉 Your Order #"+orderId+" is ready! Please come pick it up at the counter.");
  }

  console.log(`Calling order ${orderId}, room: order_${orderId}`);
  io.to(`order_${orderId}`).emit('order_ready', { orderId, message:`Order #${orderId} is ready!` });
  if (reminderIntervals.has(String(orderId))) clearInterval(reminderIntervals.get(String(orderId)));
  const timer = setInterval(async () => {
    io.to(`order_${orderId}`).emit('order_ready', { orderId, message:`Reminder: Order #${orderId} is still waiting!` });
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
  socket.on('order_acknowledged', ({ orderId, customerPhone }) => {
    if (orderId) {
      const order = activeOrders.get(String(orderId));
      if(order) {
        // Emit to cashier to archive
        io.emit('order_archived', {
          orderId: order.orderId,
          completedAt: new Date().toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'}),
          customerPhone: order.customerPhone || ''
        });
      }
      removeOrder(String(orderId));
    }
  });
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

// WhatsApp notification via UltraMsg
async function sendWhatsApp(phone, message) {
  try {
    const axios = require('axios');
    const instance = restaurantConfig.instance || process.env.ULTRAMSG_INSTANCE;
    const token = restaurantConfig.token || process.env.ULTRAMSG_TOKEN;
    if (!instance || !token || !phone) return;
    await axios.post(`https://api.ultramsg.com/${instance}/messages/chat`, {
      token,
      to: phone,
      body: message
    });
    console.log('WhatsApp sent to', phone);
  } catch(e) {
    console.log('WhatsApp error:', e.message);
  }
}

// Setup storage
let restaurantConfig = { instance: process.env.ULTRAMSG_INSTANCE, token: process.env.ULTRAMSG_TOKEN, phone: '', countryCode: process.env.COUNTRY_CODE || '20' };
console.log('Config loaded:', restaurantConfig.instance, restaurantConfig.token ? 'token-ok' : 'no-token');

app.post('/api/auth', (req, res) => {
  const { password } = req.body;
  const correct = process.env.SETUP_PASSWORD || 'Malit@1972';
  res.json({ success: password === correct });
});

app.get(['/setup', '/setup.html'], (req, res) => res.sendFile(path.join(__dirname, 'public', 'setup.html')));

app.post('/api/setup', (req, res) => {
  const { instance, token, phone, countryCode } = req.body;
  if(instance) restaurantConfig.instance = instance;
  if(token) restaurantConfig.token = token;
  if(phone) restaurantConfig.phone = phone;
  if(countryCode) restaurantConfig.countryCode = countryCode;
  console.log('Setup updated:', restaurantConfig.phone);
  res.json({ success: true });
});

// Save customer phone
app.post('/api/orders/phone', (req, res) => {
  const { orderId, phone } = req.body;
  const order = activeOrders.get(String(orderId));
  if(order && phone) {
    let formattedPhone = phone.replace(/\D/g, '');
    const cc = restaurantConfig.countryCode || '20';
    if(formattedPhone.startsWith('0')) formattedPhone = cc + formattedPhone.slice(1);
    if(!formattedPhone.startsWith('+')) formattedPhone = '+' + formattedPhone;
    order.customerPhone = formattedPhone;
    activeOrders.set(String(orderId), order);
  }
  res.json({ success: true });
});
