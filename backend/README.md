# UAV Log Viewer Backend

This is the backend API for the UAV Log Viewer application, featuring an OpenAI-powered chatbot for analyzing UAV telemetry logs.

## Setup

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Configure environment variables:**
   - Copy `.env.example` to `.env` (if it exists)
   - Set your `OPENAI_API_KEY` in the `.env` file
   - The server will run on port 8001 by default

3. **Run the server:**
   ```bash
   # Development mode with auto-reload
   npm run dev
   
   # Production mode
   npm start
   ```

## API Endpoints

### Health Check
- `GET /health` - Server status

### Stubbed Endpoints (Not Implemented)
- `/upload/*` - File upload functionality (returns 501)
- `/eniro/*` - Eniro integration (returns 501)  
- `/uploaded/*` - Uploaded files (returns 501)

### Chatbot Endpoints
- `POST /chatbot/init` - Initialize a new chat session with log data
- `POST /chatbot/chat` - Send a message to the chatbot
- `GET /chatbot/docs/status` - Get documentation status and cache information
- `POST /chatbot/docs/refresh` - Refresh documentation from ArduPilot.org
- `POST /chatbot/docs/clear-cache` - Clear the documentation cache

## Documentation Caching

The backend now includes a smart caching system for ArduPilot documentation:

- **Persistent Storage**: Docs and embeddings stored in `backend/cache/docs-cache.json`
- **Smart Updates**: Only re-embeds when content actually changes (SHA256 hash comparison)
- **Server Restart**: Automatically initializes docs on startup
- **Cost Optimization**: Avoids unnecessary OpenAI API calls for unchanged content
- **Cache Management**: 30-day expiration, manual refresh, and cache clearing options

## Session Management

The chatbot now includes intelligent session management:

- **Widget Open/Close**: Sessions persist across widget open/close cycles (same tab)
- **Tab Refresh**: New session created (file state lost anyway)
- **Session Validation**: Backend validates session existence and age
- **File Change Detection**: New session if file content changes significantly
- **Automatic Cleanup**: Old sessions (24+ hours) are automatically removed

## Chatbot Questions

The chatbot can answer questions about UAV logs such as:
- Flight altitude analysis
- GPS signal status
- Battery temperature monitoring
- Flight duration
- Error detection
- RC signal analysis

## Development

- **Port:** 8001 (matches frontend proxy configuration)
- **CORS:** Enabled for frontend integration
- **Environment:** Development mode with hot reload
