const express = require('express');
const router = express.Router();

// Stub for upload functionality - not implemented yet
router.all('/*', (req, res) => {
  res.status(501).json({ 
    error: 'Not Implemented', 
    message: 'Upload functionality is not yet implemented',
    endpoint: req.originalUrl,
    method: req.method
  });
});

module.exports = router;
