<template>
    <div :id="getDivName()"
         v-bind:style='{width:  width + "px", height: height + "px", top: top + "px", left: left + "px" }'>
        <div id='paneContent'>
            <span style="float: right; margin: 3px; cursor: pointer;" @click="close()"> X </span>
            <h5>AI Assistant</h5>

            <div class="section">
                <h6>Chat</h6>
                <div class="chat-header">
                    <button @click="clearChat" class="clear-chat-btn">
                        <i class="fa fa-trash"></i> Clear Chat
                    </button>
                    <button @click="clearSession" class="clear-session-btn">
                        <i class="fa fa-refresh"></i> New Session
                    </button>
                </div>
                <div class="chat-container">
                    <div class="chat-messages" ref="chatMessages">
                        <div v-for="(message, index) in messages" :key="index"
                             :class="['message', message.type]">
                            <div class="message-content">
                                <strong v-if="message.type === 'user'">You:</strong>
                                <strong v-else>AI:</strong>
                                {{ message.content }}
                            </div>
                            <div class="message-time">{{ message.timestamp }}</div>
                        </div>

                        <!-- Loading indicator -->
                        <div v-if="isLoading" class="message ai loading">
                            <div class="message-content">
                                <strong>AI:</strong>
                                <span class="loading-dots">
                                    <span class="dot"></span>
                                    <span class="dot"></span>
                                    <span class="dot"></span>
                                </span>
                            </div>
                        </div>
                    </div>

                    <div class="chat-input">
                        <input
                            v-model="currentMessage"
                            @keyup.enter="sendMessage"
                            placeholder="Ask about your UAV log data..."
                            type="text"
                            class="message-input"
                            :disabled="isLoading"
                        />
                        <button @click="sendMessage" class="send-button" :disabled="isLoading">
                            <i class="fa fa-paper-plane"></i>
                        </button>
                    </div>
                </div>
            </div>

            <div class="section">
                <h6>Quick Questions</h6>
                <div class="quick-questions">
                    <button
                        v-for="question in quickQuestions"
                        :key="question"
                        @click="askQuickQuestion(question)"
                        class="quick-question-btn"
                    >
                        {{ question }}
                    </button>
                </div>
            </div>

            <div class="section">
                <h6>Log Status</h6>
                <div class="log-status">
                    <div v-if="state.file">
                        <strong>File:</strong> {{ state.file }}<br>
                        <strong>Type:</strong> {{ state.logType }}<br>
                        <strong>Status:</strong> {{ state.processStatus || 'Ready' }}
                    </div>
                    <div v-else class="no-log">
                        No log file loaded
                    </div>
                </div>
            </div>
        </div>
    </div>
</template>

<script>
import { store } from '../Globals.js'
import { baseWidget } from './baseWidget'

export default {
    name: 'AIAssistantWidget',
    mixins: [baseWidget],
    data () {
        return {
            name: 'AIAssistantWidget',
            state: store,
            width: 500,
            height: 600,
            left: 50,
            top: 50,
            currentMessage: '',
            isLoading: false,
            quickQuestions: [
                'What was the highest altitude reached?',
                'When did GPS signal first get lost?',
                'What was the maximum battery temperature?',
                'How long was the total flight time?',
                'List all critical errors that happened mid-flight',
                'When was the first instance of RC signal loss?'
            ]
        }
    },
    computed: {
        messages () {
            return this.state.aiAssistantMessages
        },
        sessionId () {
            return this.state.aiAssistantSessionId
        },
        sessionInitialized () {
            return this.state.aiAssistantSessionInitialized
        }
    },
    methods: {
        sendMessage () {
            if (!this.currentMessage.trim() || this.isLoading) return

            // Add user message
            this.addMessage(this.currentMessage, 'user')

            // Set loading state
            this.isLoading = true

            // Send to backend
            this.sendToBackend(this.currentMessage)

            // Clear input
            this.currentMessage = ''
        },

        async sendToBackend (message) {
            try {
                if (!this.state.aiAssistantSessionInitialized || !this.state.aiAssistantSessionId) {
                    this.addMessage('Session not initialized. Please wait a moment and try again.', 'ai')
                    this.isLoading = false
                    return
                }

                const response = await fetch('http://localhost:8001/chatbot/chat', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        message: message,
                        sessionId: this.state.aiAssistantSessionId
                    })
                })

                const data = await response.json()
                this.addMessage(data.response, 'ai')
            } catch (error) {
                this.addMessage(`Error: ${error.message}`, 'ai')
            } finally {
                this.isLoading = false
            }
        },

        addMessage (content, type) {
            this.state.aiAssistantMessages.push({
                content,
                type,
                timestamp: new Date().toLocaleTimeString()
            })

            // Scroll to bottom
            this.$nextTick(() => {
                if (this.$refs.chatMessages) {
                    this.$refs.chatMessages.scrollTop = this.$refs.chatMessages.scrollHeight
                }
            })
        },

        askQuickQuestion (question) {
            this.currentMessage = question
            this.sendMessage()
        },

        clearChat () {
            this.state.aiAssistantMessages = []
        },

        clearSession () {
            this.state.aiAssistantSessionId = null
            this.state.aiAssistantSessionInitialized = false
            console.log('🗑️ Session cleared')
        },

        async setup () {
            // Initialize the widget when it's mounted
            console.log('AI Assistant Widget initialized')

            // Check if we can reuse existing session, otherwise initialize new one
            await this.ensureSession()
        },

        async ensureSession () {
            console.log('🔍 Ensuring session for file:', this.state.file || 'none')

            // Check if we already have a valid session for the current file
            if (this.state.aiAssistantSessionId && this.state.aiAssistantSessionInitialized) {
                console.log('✅ Reusing existing session:', this.state.aiAssistantSessionId)
                return
            }

            // Check if we have a session ID stored in global state
            if (this.state.aiAssistantSessionId && !this.state.aiAssistantSessionInitialized) {
                console.log('🔄 Reconnecting to existing session:', this.state.aiAssistantSessionId)
                // Try to validate the session still exists
                try {
                    const response = await fetch(`http://localhost:8001/chatbot/sessions/${this.state.aiAssistantSessionId}/validate`, {
                        method: 'GET'
                    })
                    if (response.ok) {
                        this.state.aiAssistantSessionInitialized = true
                        console.log('✅ Session reconnected successfully')
                        return
                    } else {
                        console.log('⚠️ Session validation failed (404), will create new session')
                    }
                } catch (error) {
                    console.log('⚠️ Session validation failed (error):', error.message)
                }
            }

            // No valid session found, create a new one
            console.log('🆕 Creating new session...')
            await this.initializeSession()
        },

        async initializeSession () {
            try {
                const logData = this.compressLogData()

                const response = await fetch('http://localhost:8001/chatbot/init', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({ logData })
                })

                if (response.ok) {
                    const data = await response.json()
                    this.state.aiAssistantSessionId = data.sessionId
                    this.state.aiAssistantSessionInitialized = true
                    console.log('✅ Session initialized:', this.state.aiAssistantSessionId)
                } else {
                    console.error('❌ Failed to initialize session')
                }
            } catch (error) {
                console.error('❌ Session initialization error:', error)
            }
        },

        compressLogData () {
            // Compress log data to reduce payload size while keeping essential information
            const compressed = {
                file: this.state.file,
                logType: this.state.logType,
                processStatus: this.state.processStatus,
                metadata: this.state.metadata
            }

            // Add a hash of the file content for change detection
            if (this.state.file) {
                compressed.fileHash = this.generateFileHash()
            }

            // Add message types and counts (not full data)
            if (this.state.messages) {
                compressed.messageTypes = Object.keys(this.state.messages)
                compressed.messageCounts = {}
                Object.keys(this.state.messages).forEach(type => {
                    if (this.state.messages[type] && Array.isArray(this.state.messages[type])) {
                        compressed.messageCounts[type] = this.state.messages[type].length
                    }
                })
            }

            // Add trajectory summary
            if (this.state.trajectories) {
                compressed.trajectorySources = Object.keys(this.state.trajectories)
                compressed.trajectoryCounts = {}
                Object.keys(this.state.trajectories).forEach(source => {
                    if (this.state.trajectories[source] && this.state.trajectories[source].trajectory) {
                        compressed.trajectoryCounts[source] = this.state.trajectories[source].trajectory.length
                    }
                })
            }

            // Add parameters summary
            if (this.state.params && this.state.params.values) {
                compressed.paramCount = Object.keys(this.state.params.values).length
                compressed.paramCategories = Object.keys(this.state.params.values).reduce((cats, param) => {
                    const category = param.split('_')[0]
                    cats[category] = (cats[category] || 0) + 1
                    return cats
                }, {})
            }

            // Add events summary
            if (this.state.events) {
                compressed.eventCount = this.state.events.length
                compressed.eventTypes = this.state.events.reduce((types, event) => {
                    const type = event.id || 'unknown'
                    types[type] = (types[type] || 0) + 1
                    return types
                }, {})
            }

            // Add flight mode changes
            if (this.state.flightModeChanges) {
                compressed.flightModeCount = this.state.flightModeChanges.length
                compressed.flightModes = [...new Set(this.state.flightModeChanges.map(mode => mode[1]))]
            }

            return compressed
        },

        generateFileHash () {
            // Generate a simple hash based on file properties
            // This helps detect if the file content has changed significantly
            const fileData = {
                file: this.state.file,
                logType: this.state.logType,
                messageCount: this.state.messages ? Object.keys(this.state.messages).length : 0,
                trajectoryCount: this.state.trajectories ? Object.keys(this.state.trajectories).length : 0,
                paramCount: this.state.params?.values ? Object.keys(this.state.params.values).length : 0,
                eventCount: this.state.events ? this.state.events.length : 0
            }

            // Simple hash function
            const str = JSON.stringify(fileData)
            let hash = 0
            for (let i = 0; i < str.length; i++) {
                const char = str.charCodeAt(i)
                hash = ((hash << 5) - hash) + char
                hash = hash & hash // Convert to 32-bit integer
            }
            return hash.toString(36)
        }
    }
}
</script>

<style scoped>
    div.section {
        border: 1px solid #ccc;
        width: 96%;
        padding: 5px;
        margin-bottom: 10px;
        box-sizing: border-box;
    }

    .chat-header {
        display: flex;
        justify-content: flex-end;
        margin-bottom: 10px;
    }

    .clear-chat-btn {
        padding: 4px 8px;
        background: #dc3545;
        color: white;
        border: none;
        border-radius: 4px;
        cursor: pointer;
        font-size: 11px;
        display: flex;
        align-items: center;
        gap: 4px;
    }

    .clear-chat-btn:hover {
        background: #c82333;
    }

    .clear-session-btn {
        padding: 4px 8px;
        background: #17a2b8;
        color: white;
        border: none;
        border-radius: 4px;
        cursor: pointer;
        font-size: 11px;
        display: flex;
        align-items: center;
        gap: 4px;
        margin-left: 5px;
    }

    .clear-session-btn:hover {
        background: #138496;
    }

    .chat-container {
        width: 100%;
    }

    .chat-messages {
        height: 300px;
        overflow-y: auto;
        border: 1px solid #ddd;
        padding: 10px;
        margin-bottom: 10px;
        background: #f9f9f9;
        border-radius: 4px;
    }

    .message {
        margin-bottom: 10px;
        padding: 8px;
        border-radius: 4px;
    }

    .message.user {
        background: #e3f2fd;
        margin-left: 20px;
    }

    .message.ai {
        background: #f3e5f5;
        margin-right: 20px;
    }

    .message.loading {
        opacity: 0.8;
    }

    .message-content {
        margin-bottom: 4px;
        user-select: text;
        cursor: text;
        padding: 2px;
        border-radius: 2px;
        transition: background-color 0.2s ease;
    }

    .message-content:hover {
        background-color: rgba(0, 0, 0, 0.05);
    }

    .message-time {
        font-size: 0.8em;
        color: #666;
        text-align: right;
    }

    .chat-input {
        display: flex;
        gap: 8px;
    }

    .message-input {
        flex: 1;
        padding: 8px;
        border: 1px solid #ddd;
        border-radius: 4px;
        font-size: 14px;
    }

    .send-button {
        padding: 8px 12px;
        background: rgb(60, 75, 112);
        background: rgb(67, 95, 155);
        color: white;
        border: none;
        border-radius: 4px;
        cursor: pointer;
    }

    .send-button:hover {
        background: rgb(50, 65, 102);
        background: linear-gradient(0deg, rgb(57, 85, 145) 51%, rgb(51, 69, 111) 100%);
    }

    .quick-questions {
        display: flex;
        flex-direction: column;
        gap: 5px;
    }

    .quick-question-btn {
        padding: 6px 10px;
        background: #f8f9fa;
        border: 1px solid #ddd;
        border-radius: 4px;
        cursor: pointer;
        text-align: left;
        font-size: 12px;
        user-select: text;
    }

    .quick-question-btn:hover {
        background: #e9ecef;
    }

    .log-status {
        font-size: 12px;
        line-height: 1.4;
        user-select: text;
        cursor: text;
    }

    .no-log {
        color: #666;
        font-style: italic;
    }

    div #paneAIAssistantWidget {
        padding: 15px;
        min-width: 220px;
        min-height: 150px;
        position: absolute;
        background: rgba(253, 254, 255, 0.856);
        color: #141924;
        font-size: 11px;
        font-weight: 600;
        text-transform: uppercase;
        z-index: 10000;
        box-shadow: 9px 9px 3px -6px rgba(26, 26, 26, 0.699);
        border-radius: 5px;
        user-select: text;
    }

    div #paneAIAssistantWidget::before {
        content: '\25e2';
        color: #ffffff;
        background-color: rgb(38, 53, 71);
        position: absolute;
        bottom: -1px;
        right: 0;
        width: 17px;
        height: 21px;
        padding: 2px 3px;
        border-radius: 10px 0px 1px 0px;
        box-sizing: border-box;
        align-items: center;
        justify-content: center;
        font-size: 10px;
        cursor: se-resize;
    }

    div #paneAIAssistantWidget::after {
        content: '\2725';
        color: #2E3F54;
        position: absolute;
        top: 0;
        left: 0;
        width: 18px;
        height: 17px;
        margin-top: -3px;
        padding: 0px 2px;
        box-sizing: border-box;
        align-items: center;
        justify-content: center;
        font-size: 17px;
        cursor: grab;
    }

    div#paneContent {
        height: 100%;
        overflow: auto;
        -webkit-user-select: text;
        -moz-user-select: text;
        -ms-user-select: text;
        user-select: text;
    }

    div#paneContent ul {
        list-style: none;
        line-height: 22px;
        padding: 16px;
        margin: 0;
    }

    /* Loading dots animation */
    .loading-dots {
        display: inline-block;
    }

    .loading-dots .dot {
        display: inline-block;
        width: 4px;
        height: 4px;
        border-radius: 50%;
        background-color: #666;
        margin: 0 2px;
        animation: loading-dots 1.4s infinite ease-in-out;
    }

    .loading-dots .dot:nth-child(1) {
        animation-delay: -0.32s;
    }

    .loading-dots .dot:nth-child(2) {
        animation-delay: -0.16s;
    }

    @keyframes loading-dots {
        0%, 80%, 100% {
            transform: scale(0);
            opacity: 0.5;
        }
        40% {
            transform: scale(1);
            opacity: 1;
        }
    }

    /* Disabled state styling */
    .message-input:disabled,
    .send-button:disabled {
        opacity: 0.6;
        cursor: not-allowed;
    }
</style>
