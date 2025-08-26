class SessionManager {
    constructor() {
        // TODO: consider moving to proper persistent session storage in prod 
        this.sessions = new Map();
        this.sessionCounter = 0;
    }

    createSession(logData) {
        const sessionId = `session_${++this.sessionCounter}_${Date.now()}`;
        
        this.sessions.set(sessionId, {
            logData: logData,
            createdAt: new Date(),
            lastAccessed: new Date(),
            messageCount: 0
        });

        console.log(`📝 Created new session: ${sessionId}`);
        return sessionId;
    }

    getSession(sessionId) {
        const session = this.sessions.get(sessionId);
        if (session) {
            session.lastAccessed = new Date();
            session.messageCount++;
            return session;
        }
        return null;
    }

    updateSession(sessionId, logData) {
        const session = this.sessions.get(sessionId);
        if (session) {
            session.logData = logData;
            session.lastAccessed = new Date();
            return true;
        }
        return false;
    }

    removeSession(sessionId) {
        const removed = this.sessions.delete(sessionId);
        if (removed) {
            console.log(`🗑️ Removed session: ${sessionId}`);
        }
        return removed;
    }

    cleanupOldSessions(maxAge = 24 * 60 * 60 * 1000) { // 24 hours
        const now = new Date();
        let cleaned = 0;
        
        for (const [sessionId, session] of this.sessions.entries()) {
            if (now - session.lastAccessed > maxAge) {
                this.sessions.delete(sessionId);
                cleaned++;
            }
        }
        
        if (cleaned > 0) {
            console.log(`🧹 Cleaned up ${cleaned} old sessions`);
        }
    }

    getSessionStats() {
        return {
            totalSessions: this.sessions.size,
            sessions: Array.from(this.sessions.entries()).map(([id, session]) => ({
                id,
                createdAt: session.createdAt,
                lastAccessed: session.lastAccessed,
                messageCount: session.messageCount
            }))
        };
    }
}

module.exports = SessionManager;
