# UAV Log Viewer

![log seeking](preview.gif "Logo Title Text 1")

 This is a Javascript based log viewer for Mavlink telemetry and dataflash logs.
 [Live demo here](http://plot.ardupilot.org).

## Arena Details

For the Arena SWE takehome assessment, I've split up the functionality into a frontend and built out a new backend. I have stubbed out the existing
paths that the client uses to invoke the backend and have added new paths related to the chatbot functionality. The backend handles all the
processing and reasoning about the chats that the user inputs from the frontend.

In my testing, I used OpenAI's gpt-4o-mini as my model. A .env file is required in the backend/ directory with the following

PORT=8001
OPENAI_API_KEY=YOUR_KEY_HERE
NODE_ENV=development

All E2E testing was done via the development server. You can run the whole app by following the instructions below to run the client's dev server,
and also running the backend server in a separate terminal session.

``` bash
cd backend
npm run dev
```

## Build Setup

``` bash
# install dependencies
npm install

# serve with hot reload at localhost:8080
npm run dev

# build for production with minification
npm run build

# run unit tests
npm run unit

# run e2e tests
npm run e2e

# run all tests
npm test

# format code with ESLint
npm run format

# check code formatting
npm run format:check

# Docker

run the prebuilt docker image:

``` bash
docker run -p 8080:8080 -d ghcr.io/ardupilot/uavlogviewer:latest

```

or build the docker file locally:

``` bash

# Build Docker Image
docker build -t <your username>/uavlogviewer .

# Run Docker Image
docker run -e VUE_APP_CESIUM_TOKEN=<Your cesium ion token> -it -p 8080:8080 -v ${PWD}:/usr/src/app <your username>/uavlogviewer

# Navigate to localhost:8080 in your web browser

# changes should automatically be applied to the viewer

```
