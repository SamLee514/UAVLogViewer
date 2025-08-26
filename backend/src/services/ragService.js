const axios = require('axios');
const cheerio = require('cheerio');
const OpenAI = require('openai');
const DocCacheService = require('./docCacheService');

class RAGService {
    constructor() {
        this.openai = new OpenAI({
            apiKey: process.env.OPENAI_API_KEY
        });
        this.docCache = new DocCacheService();
        this.documentChunks = [];
        this.embeddingsCache = new Map();
        this.isInitialized = false;
    }

    async initialize() {
        if (this.isInitialized) return;
        
        console.log('🔄 Initializing RAG service...');
        
        try {
            // Initialize the doc cache service
            await this.docCache.initialize();
            
            // Check if we can use cached docs or need to fetch fresh ones
            await this.fetchArduPilotDocs();
            
            // Create embeddings for all chunks (or load from cache)
            await this.createEmbeddings();
            
            this.isInitialized = true;
            console.log('✅ RAG service initialized successfully');
        } catch (error) {
            console.error('❌ Failed to initialize RAG service:', error);
            throw error;
        }
    }

    async fetchArduPilotDocs() {
        const url = 'https://ardupilot.org/plane/docs/logmessages.html';
        console.log('📚 Checking ArduPilot documentation...');
        
        try {
            // Fetch the main log messages page
            const response = await axios.get(url);
            const freshContent = response.data;
            
            // Check if we need to update the cache
            if (await this.docCache.needsUpdate(url, freshContent)) {
                console.log('🔄 Content changed, processing fresh documentation...');
                
                const $ = cheerio.load(freshContent);
                
                // Extract relevant content sections
                const content = [];
                
                // Get main content - focus on the documentation sections
                $('body').find('h1, h2, h3, h4, h5, h6, p, pre, code, table, tr').each((i, element) => {
                    const text = $(element).text().trim();
                    if (text && text.length > 20) { // Only keep substantial content
                        content.push({
                            type: element.name,
                            text: text,
                            html: $(element).html()
                        });
                    }
                });

                // Also extract specific message type definitions
                $('h2, h3').each((i, element) => {
                    const heading = $(element).text().trim();
                    if (heading && heading.length > 0) {
                        // Get the next table or content block
                        let nextElement = $(element).next();
                        let messageContent = heading + '\n';
                        
                        // Collect content until next heading
                        while (nextElement.length && nextElement[0].name !== 'h2' && nextElement[0].name !== 'h3') {
                            if (nextElement.text().trim()) {
                                messageContent += nextElement.text().trim() + '\n';
                            }
                            nextElement = nextElement.next();
                        }
                        
                        if (messageContent.length > heading.length + 10) {
                            content.push({
                                type: 'message_definition',
                                text: messageContent.trim(),
                                html: messageContent.trim()
                            });
                        }
                    }
                });

                // Chunk the content into manageable pieces
                this.documentChunks = this.chunkContent(content);
                
                console.log(`📖 Extracted ${this.documentChunks.length} document chunks from ArduPilot docs`);
                
                // Store the fresh content for later embedding
                this.freshContent = freshContent;
            } else {
                console.log('✅ Using cached documentation');
                // We'll load embeddings from cache in createEmbeddings()
            }
            
        } catch (error) {
            console.error('❌ Failed to fetch ArduPilot docs:', error);
            console.log('🔄 Falling back to local knowledge base...');
            // Fallback to local knowledge base if scraping fails
            this.documentChunks = this.getFallbackDocs();
        }
    }

    chunkContent(content) {
        const chunks = [];
        let currentChunk = '';
        let chunkSize = 0;
        const maxChunkSize = 1000; // characters per chunk

        for (const item of content) {
            const itemText = item.text;
            
            if (chunkSize + itemText.length > maxChunkSize && currentChunk) {
                chunks.push({
                    content: currentChunk.trim(),
                    type: 'documentation'
                });
                currentChunk = itemText;
                chunkSize = itemText.length;
            } else {
                currentChunk += (currentChunk ? '\n\n' : '') + itemText;
                chunkSize += itemText.length;
            }
        }

        if (currentChunk) {
            chunks.push({
                content: currentChunk.trim(),
                type: 'documentation'
            });
        }

        return chunks;
    }

    getFallbackDocs() {
        // Local knowledge base with actual ArduPilot documentation
        return [
            {
                content: `ArduPilot Log Messages Documentation

ACC - IMU accelerometer data
TimeUS: Time since system startup (μs)
I: Accelerometer sensor instance number
SampleUS: Time since system startup this sample was taken (μs)
AccX: Acceleration along X axis (m/s/s)
AccY: Acceleration along Y axis (m/s/s)
AccZ: Acceleration along Z axis (m/s/s)

ADSB - Automatic Dependent Surveillance - Broadcast detected vehicle information
TimeUS: Time since system startup (μs)
ICAO_address: Transponder address
Lat: Vehicle latitude (1e-7 deg latitude)
Lng: Vehicle longitude (1e-7 deg longitude)
Alt: Vehicle altitude (mm)
Heading: Vehicle heading (cdeg heading)
Hor_vel: Vehicle horizontal velocity (mm/s)
Ver_vel: Vehicle vertical velocity (mm/s)
Squark: Transponder squawk code

AETR - Normalised pre-mixer control surface outputs
TimeUS: Time since system startup (μs)
Ail: Pre-mixer value for aileron output (between -4500 and 4500)
Elev: Pre-mixer value for elevator output (between -4500 and 4500)
Thr: Pre-mixer value for throttle output (between -100 and 100)
Rudd: Pre-mixer value for rudder output (between -4500 and 4500)
Flap: Pre-mixer value for flaps output (between 0 and 100)
Steer: Pre-mixer value for steering output (between -4500 and 4500)
SS: Surface movement / airspeed scaling value

AHR2 - Backup AHRS data
TimeUS: Time since system startup (μs)
Roll: Estimated roll (deg)
Pitch: Estimated pitch (deg)
Yaw: Estimated yaw (deg heading)
Alt: Estimated altitude (m)
Lat: Estimated latitude (deg latitude)
Lng: Estimated longitude (deg longitude)
Q1-Q4: Estimated attitude quaternion components

ANG - Attitude control attitude
TimeUS: Timestamp of the current Attitude loop (μs)
Roll: Roll angle (deg)
Pitch: Pitch angle (deg)
Yaw: Yaw angle (deg heading)

GPS - GPS data
TimeUS: Time since system startup (μs)
Status: GPS status
GMS: GPS milliseconds since start of day
GWk: GPS week number
NSats: Number of satellites visible
HDop: Horizontal dilution of precision
VDop: Vertical dilution of precision
Lat: Latitude (deg latitude)
Lng: Longitude (deg longitude)
Alt: Altitude (m)
Spd: Ground speed (m/s)
GCrs: Ground course (deg heading)

IMU - Inertial Measurement Unit data
TimeUS: Time since system startup (μs)
GyrX: Gyroscope X axis (rad/s)
GyrY: Gyroscope Y axis (rad/s)
GyrZ: Gyroscope Z axis (rad/s)
AccX: Accelerometer X axis (m/s/s)
AccY: Accelerometer Y axis (m/s/s)
AccZ: Accelerometer Z axis (m/s/s)

MODE - Flight mode changes
TimeUS: Time since system startup (μs)
Mode: Flight mode name
Rsn: Reason for mode change

EV - Event messages
TimeUS: Time since system startup (μs)
Id: Event ID
Data: Event data

PARM - Vehicle parameters
TimeUS: Time since system startup (μs)
Name: Parameter name
Value: Parameter value

This documentation covers the most common log message types used in ArduPilot systems for analyzing flight data, detecting anomalies, and understanding vehicle performance.`,
                type: 'documentation'
            },
            {
                content: `Advanced ArduPilot Log Message Types

EKF (Extended Kalman Filter) Messages:
XKQ - EKF3 quaternion defining rotation from NED to XYZ axes
XKT - EKF3 timing information
XKTV - EKF3 Yaw Estimator States
XKV1 - EKF3 State variances (primary core)
XKV2 - More EKF3 State Variances
XKY0 - EKF Yaw Estimator States
XKY1 - EKF Yaw Estimator Innovations

Navigation and Control:
CTUN - Control tuning
NTUN - Navigation tuning
PSCE - Position control error
PSCD - Position control target
PSCA - Position control actual

Sensor Data:
BARO - Barometer data
COMPASS - Compass/magnetometer data
MAG - Magnetometer data
OPTFLOW - Optical flow sensor data
RANGEFINDER - Distance sensor data

System Status:
HEART - System heartbeat
MSG - Text messages
STAT - System status
FMT - Message format
FMTU - Message format update

Communication:
RADIO - Radio control data
RSSI - Signal strength indicators
TEL - Telemetry data

Mission and Waypoints:
CMD - Mission commands
MISSION - Mission items
NAV - Navigation data
WP - Waypoint data

This comprehensive knowledge base enables the AI to understand and analyze complex UAV telemetry data from ArduPilot systems.`,
                type: 'documentation'
            }
        ];
    }

    async createEmbeddings() {
        const url = 'https://ardupilot.org/plane/docs/logmessages.html';
        
        // Check if we can load embeddings from cache
        const cachedEmbeddings = await this.docCache.getEmbeddings(url);
        
        if (cachedEmbeddings && !this.freshContent) {
            console.log('🧠 Loading embeddings from cache...');
            
            // Load cached embeddings into memory
            this.embeddingsCache.clear();
            cachedEmbeddings.forEach((cached, index) => {
                this.embeddingsCache.set(index, {
                    content: cached.content,
                    embedding: cached.embedding,
                    type: cached.type
                });
            });
            
            // Also load the document chunks from cache
            this.documentChunks = cachedEmbeddings.map(cached => ({
                content: cached.content,
                type: cached.type
            }));
            
            console.log(`✅ Loaded ${this.embeddingsCache.size} embeddings from cache`);
            return;
        }
        
        // Need to create new embeddings
        console.log('🧠 Creating embeddings for document chunks...');
        
        try {
            const totalChunks = this.documentChunks.length;
            const interval = Math.floor(totalChunks / 20);
            
            for (let i = 0; i < this.documentChunks.length; i++) {
                if (i % interval === 0) {
                    const progress = Math.round((i / totalChunks) * 100);
                    console.log(`... ${progress}% complete`);
                }

                const chunk = this.documentChunks[i];
                const response = await this.openai.embeddings.create({
                    model: "text-embedding-ada-002",
                    input: chunk.content
                });
                
                this.embeddingsCache.set(i, {
                    content: chunk.content,
                    embedding: response.data[0].embedding,
                    type: chunk.type
                });
            }
            
            console.log(`✅ Created embeddings for ${this.documentChunks.length} chunks`);
            
            // Cache the new embeddings for future use
            if (this.freshContent) {
                const embeddingsArray = Array.from(this.embeddingsCache.values());
                await this.docCache.updateDocs(url, this.freshContent, embeddingsArray);
                this.freshContent = null; // Clear the reference
            }
            
        } catch (error) {
            console.error('❌ Failed to create embeddings:', error);
            throw error;
        }
    }

    async searchRelevantDocs(query, topK = 3) {
        if (!this.isInitialized) {
            await this.initialize();
        }

        try {
            // Create embedding for the query
            const response = await this.openai.embeddings.create({
                model: "text-embedding-ada-002",
                input: query
            });
            const queryEmbedding = response.data[0].embedding;
            
            // Calculate similarities and find top matches
            const similarities = [];
            
            for (const [index, doc] of this.embeddingsCache) {
                const similarity = this.cosineSimilarity(queryEmbedding, doc.embedding);
                similarities.push({
                    index,
                    similarity,
                    content: doc.content,
                    type: doc.type
                });
            }
            
            // Sort by similarity and return top K
            similarities.sort((a, b) => b.similarity - a.similarity);
            
            return similarities.slice(0, topK);
        } catch (error) {
            console.error('❌ Search failed:', error);
            return [];
        }
    }

    cosineSimilarity(vecA, vecB) {
        if (vecA.length !== vecB.length) return 0;
        
        let dotProduct = 0;
        let normA = 0;
        let normB = 0;
        
        for (let i = 0; i < vecA.length; i++) {
            dotProduct += vecA[i] * vecB[i];
            normA += vecA[i] * vecA[i];
            normB += vecB[i] * vecB[i];
        }
        
        if (normA === 0 || normB === 0) return 0;
        
        return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
    }

    getRelevantContext(query) {
        return this.searchRelevantDocs(query);
    }

    async refreshDocumentation() {
        console.log('🔄 Refreshing ArduPilot documentation...');
        this.isInitialized = false;
        this.documentChunks = [];
        this.embeddingsCache.clear();
        await this.initialize();
    }

    async clearCache() {
        console.log('🗑️ Clearing documentation cache...');
        await this.docCache.clearCache();
        this.isInitialized = false;
        this.documentChunks = [];
        this.embeddingsCache.clear();
        console.log('✅ Cache cleared, will re-fetch on next initialization');
    }

    getDocumentationStatus() {
        const cacheStatus = this.docCache.getCacheStatus();
        return {
            isInitialized: this.isInitialized,
            totalChunks: this.documentChunks.length,
            totalEmbeddings: this.embeddingsCache.size,
            source: this.isInitialized ? 'ArduPilot.org (live)' : 'Local knowledge base (fallback)',
            cache: cacheStatus
        };
    }
}

module.exports = RAGService;
