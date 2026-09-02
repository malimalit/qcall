const express = require('express');
const http = require('http');
const path = require('path');
const QRCode = require('qrcode');
const { Server } = require('socket.io');
const admin = require('firebase-admin');

// Initialize Firebase Admin SDK safely (supports Railway env variable or local file)
let serviceAccount;
if (process.env.FIREBASE_SERVICE_ACCOUNT) {
  serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
} else {
  serviceAccount = require('./serviceAccountKey.json');
}

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Add your admin route right here alongside your other route definitions
app.get(['/admin', '/admin.html'], (req, res) =>
  res.sendFile(path.join(__dirname, 'public', 'admin.html')));

// ... (rest of your app.use, routes, and socket logic)