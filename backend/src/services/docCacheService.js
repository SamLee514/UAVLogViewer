const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');

class DocCacheService {
    constructor() {
        this.cacheDir = path.join(__dirname, '../../cache');
        this.cacheFile = path.join(this.cacheDir, 'docs-cache.json');
        this.cache = null;
        this.isInitialized = false;
    }

    async initialize() {
        try {
            // Ensure cache directory exists
            await fs.mkdir(this.cacheDir, { recursive: true });
            
            // Load existing cache
            await this.loadCache();
            
            console.log('✅ DocCacheService initialized');
            this.isInitialized = true;
        } catch (error) {
            console.error('❌ Failed to initialize DocCacheService:', error);
            // Create empty cache if loading fails
            this.cache = { docs: {}, lastCheck: null };
        }
    }

    async loadCache() {
        try {
            const data = await fs.readFile(this.cacheFile, 'utf8');
            this.cache = JSON.parse(data);
            console.log(`📚 Loaded ${Object.keys(this.cache.docs).length} cached docs`);
        } catch (error) {
            if (error.code === 'ENOENT') {
                // Cache file doesn't exist, create empty cache
                this.cache = { docs: {}, lastCheck: null };
                console.log('📚 No existing cache found, starting fresh');
            } else {
                throw error;
            }
        }
    }

    async saveCache() {
        try {
            await fs.writeFile(this.cacheFile, JSON.stringify(this.cache, null, 2));
            console.log('💾 Cache saved to disk');
        } catch (error) {
            console.error('❌ Failed to save cache:', error);
        }
    }

    generateContentHash(content) {
        return crypto.createHash('sha256').update(content).digest('hex');
    }

    async getCachedDocs(url) {
        if (!this.isInitialized) {
            await this.initialize();
        }

        const cached = this.cache.docs[url];
        if (!cached) {
            return null;
        }

        // Check if cache is still valid (less than 30 days old)
        const thirtyDaysAgo = Date.now() - (30 * 24 * 60 * 60 * 1000);
        if (cached.lastUpdated < thirtyDaysAgo) {
            console.log(`⏰ Cache for ${url} is expired, will refresh`);
            return null;
        }

        return cached;
    }

    async updateDocs(url, content, embeddings) {
        if (!this.isInitialized) {
            await this.initialize();
        }

        const contentHash = this.generateContentHash(content);
        
        this.cache.docs[url] = {
            url,
            content,
            embeddings,
            contentHash,
            lastUpdated: Date.now(),
            size: content.length,
            embeddingCount: embeddings.length
        };

        this.cache.lastCheck = Date.now();
        
        await this.saveCache();
        console.log(`💾 Updated cache for ${url} (${embeddings.length} embeddings)`);
    }

    async needsUpdate(url, freshContent) {
        const cached = await this.getCachedDocs(url);
        if (!cached) {
            return true; // No cache or expired
        }

        const freshHash = this.generateContentHash(freshContent);
        const hasChanged = freshHash !== cached.contentHash;
        
        if (hasChanged) {
            console.log(`🔄 Content changed for ${url}, will re-embed`);
        } else {
            console.log(`✅ Content unchanged for ${url}, using cached embeddings`);
        }
        
        return hasChanged;
    }

    async getEmbeddings(url) {
        const cached = await this.getCachedDocs(url);
        return cached ? cached.embeddings : null;
    }

    getCacheStatus() {
        if (!this.cache) return { status: 'Not initialized' };

        const docs = Object.keys(this.cache.docs);
        const totalSize = docs.reduce((sum, url) => sum + (this.cache.docs[url].size || 0), 0);
        const totalEmbeddings = docs.reduce((sum, url) => sum + (this.cache.docs[url].embeddingCount || 0), 0);

        return {
            status: 'Ready',
            cachedDocs: docs.length,
            totalContentSize: totalSize,
            totalEmbeddings: totalEmbeddings,
            lastCheck: this.cache.lastCheck ? new Date(this.cache.lastCheck).toISOString() : null,
            cacheFile: this.cacheFile
        };
    }

    async clearCache() {
        try {
            await fs.unlink(this.cacheFile);
            this.cache = { docs: {}, lastCheck: null };
            console.log('🗑️ Cache cleared');
            return { success: true, message: 'Cache cleared successfully' };
        } catch (error) {
            console.error('❌ Failed to clear cache:', error);
            return { success: false, message: error.message };
        }
    }
}

module.exports = DocCacheService;
