# WARP.md

This file provides guidance to WARP (warp.dev) when working with code in this repository.

## Project Overview

UAV Log Viewer is a JavaScript-based web application for viewing and analyzing Mavlink telemetry and dataflash logs from unmanned aerial vehicles (UAVs). It provides visualization capabilities including plotting telemetry data and 3D trajectory mapping using Cesium.

The application supports multiple log formats:
- Mavlink telemetry logs (.tlog)
- Dataflash logs (.bin) 
- DJI logs (.txt)

Live demo is available at http://plot.ardupilot.org

## Build and Development Commands

### Initial Setup
The project uses git submodules for the dataflash parser. After cloning, initialize submodules:
```bash
git submodule init
git submodule update
# or in one command:
git submodule update --init
```

### Development Server
```bash
npm run dev
# or
npm start
```
Starts development server at http://localhost:8080 with hot reload enabled.

### Building for Production
```bash
npm run build
```
Builds production-optimized bundle in the `dist/` directory.

### Testing
```bash
# Run unit tests with Jest
npm run unit

# Run end-to-end tests with Nightwatch
npm run e2e

# Run all tests
npm test
```

### Linting and Code Quality
```bash
# Lint and fix issues
npm run lint

# Fix only .js and .vue files in src
npm run lint:fix
```

### Docker Development
```bash
# Build Docker image locally
docker build -t <username>/uavlogviewer .

# Run with development mode
docker run -e VUE_APP_CESIUM_TOKEN=<token> -it -p 8080:8080 -v ${PWD}:/usr/src/app <username>/uavlogviewer

# Use pre-built image
docker run -p 8080:8080 -d ghcr.io/ardupilot/uavlogviewer:latest
```

## Architecture Overview

### Core Components Structure
- **Home.vue**: Main application component that orchestrates data extraction and visualization
- **Plotly.vue**: Handles 2D plotting of telemetry data using Plotly.js
- **CesiumViewer.vue**: Provides 3D mapping and trajectory visualization using Cesium
- **Sidebar.vue**: File management and navigation interface

### Data Processing Pipeline
The application follows a data extraction pattern with specialized extractors:

1. **Log Type Detection**: Automatically identifies log format (tlog, bin, dji)
2. **Parser Selection**: Routes to appropriate parser:
   - `mavlinkParser.js` for .tlog files
   - `dataflashParser.js` for .bin files  
   - `djiParser.js` for DJI logs
3. **Data Extraction**: Specialized extractors process parsed data:
   - `MavlinkDataExtractor` 
   - `DataflashDataExtractor`
   - `DjiDataExtractor`
4. **State Management**: Centralized state in `Globals.js` store

### Key Data Extraction Features
Each extractor handles:
- Flight modes and mode changes
- Vehicle attitude (Euler angles and quaternions)
- GPS trajectory data
- Flight events (armed/disarmed states)
- Mission waypoints
- Parameter values
- Text messages
- Geofences

### Widget Architecture
Modular widget system for specialized analysis:
- **AttitudeWidget.vue**: Real-time attitude display
- **ParamViewer.vue**: Parameter inspection and changes
- **MessageViewer.vue**: Log message browser
- **MagFitTool.vue**: Magnetometer calibration analysis
- **EkfHelperTool.vue**: Extended Kalman Filter diagnostics
- **TxInputs.vue**: Radio control input visualization

All widgets extend `baseWidget.js` for common functionality.

## Development Guidelines

### File Organization
- `/src/components/`: Vue components
- `/src/tools/`: Data processing utilities
- `/src/tools/parsers/`: Log file parsers (run in Web Workers)
- `/src/components/widgets/`: Analysis widgets
- `/src/mavextra/`: MAVLink-specific utilities
- `/test/unit/`: Jest unit tests
- `/test/e2e/`: Nightwatch end-to-end tests

### Testing Strategy
- Unit tests focus on data extraction functions
- Test files should be placed in `/test/testlogfiles/` or `/tmp/testlogs/`
- Each data extractor has corresponding test suites
- Tests verify message parsing, trajectory extraction, and parameter handling

### Web Worker Usage
Log parsing runs in Web Workers for performance:
- `parser.worker.js` coordinates parsing
- Workers communicate via `postMessage()` API
- Main thread receives parsed data via events

### Performance Considerations
- Uses memory-efficient streaming for large log files
- Webpack configured with increased memory allocation (`--max_old_space_size=4096`)
- Cesium and Plotly.js assets are loaded on demand
- Data processing is chunked to prevent UI blocking

### Configuration Notes
- ESLint enforces Standard style with 4-space indentation
- Babel transpiles for browser compatibility
- PostCSS handles CSS processing
- Development proxy configured for backend services on port 8001

## Special Environment Variables

For Cesium functionality, set:
```bash
VUE_APP_CESIUM_TOKEN=<your_cesium_ion_token>
```

## Testing Individual Components

To test specific data extraction functions:
```javascript
import { DataflashDataExtractor } from '@/tools/dataflashDataExtractor'
// Test specific extractor methods
```

To run tests for specific log types:
```bash
# Place test logs in test/testlogfiles/ 
npm run unit -- --testPathPattern=dataflash
npm run unit -- --testPathPattern=mavlink
```
