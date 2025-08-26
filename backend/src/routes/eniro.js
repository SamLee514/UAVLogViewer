const express = require('express');
const router = express.Router();

// Stub for eniro functionality - not implemented yet
router.all('/*', (req, res) => {
  res.status(501).json({ 
    error: 'Not Implemented', 
    message: 'Eniro functionality is not yet implemented',
    endpoint: req.originalUrl,
    method: req.method
  });
});

module.exports = router;
