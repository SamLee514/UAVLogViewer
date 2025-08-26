const express = require('express');
const router = express.Router();

// Stub for uploaded functionality - not implemented yet
router.all('/*', (req, res) => {
  res.status(501).json({ 
    error: 'Not Implemented', 
    message: 'Uploaded functionality is not yet implemented',
    endpoint: req.originalUrl,
    method: req.method
  });
});

module.exports = router;
