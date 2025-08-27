const express = require('express');
const router = express.Router();
const ChatbotService = require('../services/chatbotService');

// Initialize the chatbot service
const chatbotService = new ChatbotService();

// Initialize the service when the route is first accessed
chatbotService.initialize().catch(console.error);

// Get documentation status
router.get('/docs/status', async (req, res) => {
    try {
        const status = chatbotService.ragService.getDocumentationStatus();
        res.json(status);
    } catch (error) {
        res.status(500).json({ error: 'Failed to get documentation status' });
    }
});

// Refresh documentation
router.post('/docs/refresh', async (req, res) => {
    try {
        await chatbotService.ragService.refreshDocumentation();
        res.json({ message: 'Documentation refreshed successfully' });
    } catch (error) {
        res.status(500).json({ error: 'Failed to refresh documentation' });
    }
});

// Clear documentation cache
router.post('/docs/clear-cache', async (req, res) => {
    try {
        await chatbotService.ragService.clearCache();
        res.json({ message: 'Documentation cache cleared successfully' });
    } catch (error) {
        res.status(500).json({ error: 'Failed to clear documentation cache' });
    }
});

// Validate existing session
router.get('/sessions/:sessionId/validate', async (req, res) => {
    try {
        const { sessionId } = req.params;
        const session = await chatbotService.validateSession(sessionId);
        
        if (session) {
            res.json({ 
                valid: true, 
                sessionId: sessionId,
                message: 'Session is valid'
            });
        } else {
            res.status(404).json({ 
                valid: false, 
                message: 'Session not found or expired'
            });
        }
    } catch (error) {
        res.status(500).json({ error: 'Failed to validate session' });
    }
});

// Initialize a new session with log data
router.post('/init', async (req, res) => {
  try {
    const { logData } = req.body;
    
    if (!logData) {
      return res.status(400).json({ 
        error: 'Bad Request', 
        message: 'Log data is required for session initialization' 
      });
    }

    const result = await chatbotService.initializeSession(logData);
    
    if (result.success) {
      res.json({
        sessionId: result.sessionId,
        message: 'Session initialized successfully',
        timestamp: new Date().toISOString()
      });
    } else {
      res.status(500).json({
        error: 'Session Initialization Failed',
        message: result.error
      });
    }

  } catch (error) {
    console.error('Session initialization error:', error);
    res.status(500).json({ 
      error: 'Internal Server Error', 
      message: 'Failed to initialize session' 
    });
  }
});

// Chat endpoint for asking questions about UAV logs
router.post('/chat', async (req, res) => {
  try {
    const { message, sessionId } = req.body;
    
    if (!message) {
      return res.status(400).json({ 
        error: 'Bad Request', 
        message: 'Message is required' 
      });
    }

    if (!sessionId) {
      return res.status(400).json({ 
        error: 'Bad Request', 
        message: 'Session ID is required' 
      });
    }

    // Process the message using the session
    const result = await chatbotService.processMessage(message, sessionId);
    
    res.json({
      response: result.response,
      thinking: result.thinking,
      relevantDocs: result.relevantDocs,
      dataSchema: result.dataSchema,
      availableTables: result.availableTables,
      queryValidation: result.queryValidation,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Chatbot error:', error);
    res.status(500).json({ 
      error: 'Internal Server Error', 
      message: 'Failed to process chat message' 
    });
  }
});

// Get session statistics
router.get('/sessions/stats', async (req, res) => {
  try {
    const stats = chatbotService.getSessionStats();
    res.json(stats);
  } catch (error) {
    res.status(500).json({ error: 'Failed to get session stats' });
  }
});

// Get available data schema for a session
router.get('/sessions/:sessionId/schema', async (req, res) => {
  try {
    const { sessionId } = req.params;
    const session = await chatbotService.validateSession(sessionId);
    
    if (!session) {
      return res.status(404).json({ 
        error: 'Session not found', 
        message: 'Session not found or expired' 
      });
    }

    const dataSchema = await chatbotService.logDataProcessor.getDataSchema();
    const availableTables = await chatbotService.logDataProcessor.getAvailableTables();
    
    res.json({
      sessionId,
      dataSchema,
      availableTables,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Schema retrieval error:', error);
    res.status(500).json({ 
      error: 'Internal Server Error', 
      message: 'Failed to retrieve data schema' 
    });
  }
});

// Execute a direct SQL query (for debugging/testing)
router.post('/sessions/:sessionId/query', async (req, res) => {
  try {
    const { sessionId } = req.params;
    const { sql } = req.body;
    
    if (!sql) {
      return res.status(400).json({ 
        error: 'Bad Request', 
        message: 'SQL query is required' 
      });
    }

    const session = await chatbotService.validateSession(sessionId);
    if (!session) {
      return res.status(404).json({ 
        error: 'Session not found', 
        message: 'Session not found or expired' 
      });
    }

    const result = await chatbotService.logDataProcessor.query(sql);
    
    res.json({
      sessionId,
      sql,
      result,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Query execution error:', error);
    res.status(500).json({ 
      error: 'Internal Server Error', 
      message: 'Failed to execute query',
      details: error.message
    });
  }
});

// Get query validation history for a session
router.get('/sessions/:sessionId/validation-history', async (req, res) => {
  try {
    const { sessionId } = req.params;
    const session = await chatbotService.validateSession(sessionId);
    
    if (!session) {
      return res.status(404).json({ 
        error: 'Session not found', 
        message: 'Session not found or expired' 
      });
    }

    const history = chatbotService.queryValidator.getQueryHistory();
    
    res.json({
      sessionId,
      queryHistory: history,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Validation history error:', error);
    res.status(500).json({ 
      error: 'Internal Server Error', 
      message: 'Failed to retrieve validation history' 
    });
  }
});

module.exports = router;
