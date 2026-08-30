const express = require('express');
const http = require('http');
const path = require('path');
const QRCode = require('qrcode');
const { Server } = require('socket.io');
const admin = require('firebase-admin');

// Initialize Firebase Admin SDK using your downloaded key
const serviceAccount = require('./serviceAccountKey.json');
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;

const activeOrders = new Map();
const deviceTokens = new Map(); // Stores customer FCM device tokens
const reminderIntervals = new Map();
let orderCounter = 100;

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

app.get('/', (req, res) =>
  res.sendFile(path.join(__dirname, 'public', 'index.html')));

app.get(['/cashier', '/cashier.html'], (req, res) =>
  res.sendFile(path.join(__dirname, 'public', 'cashier.html')));

app.get(['/customer', '/customer.html'], (req, res) =>
  res.sendFile(path.join(__dirname, 'public', 'customer.html')));

app.post('/api/orders/create', async (req, res) => {
  orderCounter++;
  const orderId = String(orderCounter);
  const protocol = req.headers['x-forwarded-proto'] || req.protocol;
  const host = req.headers['x-forwarded-host'] || req.get('host');
  const trackingUrl = `${protocol}://${host}/customer.html?orderId=${orderId}`;

  try {
    const qrCodeDataUrl = await QRCode.toDataURL(trackingUrl, { width: 300 });
    const order = {
      orderId,
      status: 'PREPARING',
      trackingUrl,
      qrCodeDataUrl,
      createdAt: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    };

    activeOrders.set(orderId, order);
    io.emit('orders_updated', getOrdersList());
    res.json({ success: true, ...order });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Failed to generate QR Code' });
  }
});

app.post('/api/orders/call', async (req, res) => {
  const { orderId } = req.body;
  const order = activeOrders.get(String(orderId));

  if (!order) return res.status(404).json({ success: false, message: 'Order not found' });

  order.status = 'READY';
  activeOrders.set(String(orderId), order);

  // 1. Send live socket event
  io.to(`order_${orderId}`).emit('order_ready', {
    orderId,
    message: `Order #${orderId} is ready! Please come pick it up.`
  });

  // 2. Send Firebase Cloud Push Notification (Triggers locked-screen popups)
  const fcmToken = deviceTokens.get(String(orderId));
  if (fcmToken) {
    const message = {
      token: fcmToken,
      notification: {
        title: `Order #${orderId} is Ready! 🎉`,
        body: 'Please come to the counter to pick up your order.'
      },
      webpush: {
        fcmOptions: {
          link: `${req.headers['x-forwarded-proto'] || req.protocol}://${req.headers['x-forwarded-host'] || req.get('host')}/customer.html?orderId=${orderId}`
        }
      }
    };

    try {
      await admin.messaging().send(message);
    } catch (error) {
      console.log('Error sending FCM push notification:', error);
    }
  }

  if (reminderIntervals.has(String(orderId))) {
    clearInterval(reminderIntervals.get(String(orderId)));
  }

  const timer = setInterval(() => {
    io.to(`order_${orderId}`).emit('order_ready', {
      orderId,
      message: `Reminder: Order #${orderId} is still waiting for you!`
    });
  }, 3 * 60 * 1000);

  reminderIntervals.set(String(orderId), timer);
  io.emit('orders_updated', getOrdersList());
  res.json({ success: true, message: `Order #${orderId} called.` });
});

app.get('/api/orders/list', (req, res) => {
  res.json({ success: true, orders: getOrdersList() });
});

function removeOrder(orderId) {
  if (reminderIntervals.has(String(orderId))) {
    clearInterval(reminderIntervals.get(String(orderId)));
    reminderIntervals.delete(String(orderId));
  }
  activeOrders.delete(String(orderId));
  deviceTokens.delete(String(orderId));
  io.emit('orders_updated', getOrdersList());
}

function getOrdersList() {
  return Array.from(activeOrders.values());
}

io.on('connection', (socket) => {
  socket.on('join_order', ({ orderId }) => {
    if (!orderId) return;
    socket.join(`order_${orderId}`);
    const order = activeOrders.get(String(orderId));
    socket.emit('order_status', {
      status: order ? order.status : 'NOT_FOUND'
    });
  });

  // Register customer device token for background push
  socket.on('register_token', ({ orderId, token }) => {
    if (orderId && token) {
      deviceTokens.set(String(orderId), token);
    }
  });

  socket.on('order_acknowledged', ({ orderId }) => {
    if (orderId) removeOrder(String(orderId));
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 QCall Server running on port ${PORT}`);
});