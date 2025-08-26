const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');

// Load environment variables
dotenv.config();

const app = express();
const PORT = process.env.PORT || 8001;

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// TODO: Consider adding rate limiting middleware for API protection
// app.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 100 }));

// Import routes
const uploadRoutes = require('./routes/upload');
const eniroRoutes = require('./routes/eniro');
const uploadedRoutes = require('./routes/uploaded');
const chatbotRoutes = require('./routes/chatbot');

// Use routes
app.use('/upload', uploadRoutes);
app.use('/eniro', eniroRoutes);
app.use('/uploaded', uploadedRoutes);
app.use('/chatbot', chatbotRoutes);

// Initialize documentation on server start
console.log('🚀 Initializing documentation cache on server start...');
const ChatbotService = require('./services/chatbotService');
const chatbotService = new ChatbotService();
chatbotService.initialize().catch(error => {
    console.error('❌ Failed to initialize documentation on startup:', error);
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'OK', message: 'UAV Log Viewer Backend is running' });
});

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({ error: 'Endpoint not found' });
});

// Error handler
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Something went wrong!' });
});

app.listen(PORT, () => {
  console.log(`🚀 UAV Log Viewer Backend running on port ${PORT}`);
  console.log(`📡 Health check: http://localhost:${PORT}/health`);
});
