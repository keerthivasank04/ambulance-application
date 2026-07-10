# Ambulance App — E2E Smoke Suite

Selenium WebDriver end-to-end tests for the TN 108 Ambulance app, run with Mocha (+ Chai assertions) using a Page Object Model. Targets Microsoft Edge by default via Selenium Manager (bundled with `selenium-webdriver`), which auto-downloads the matching driver binary — no manual driver setup.

> Originally scoped as Selenium + TestNG. TestNG is Java-only and this repo is Node/React, so this suite uses Selenium's JS bindings with Mocha as the test runner (TestNG's closest JS equivalent) so it can actually be built and run in this environment. A Java module using Selenium + TestNG against the same running app is a natural follow-up if you want that combination specifically for a resume line.

## Prerequisites

- Backend running on `http://localhost:5000` (`cd ../backend && npm run dev`)
- Frontend running on `http://localhost:5173` (`cd ../frontend && npm run dev`)
- Microsoft Edge installed (or set `BROWSER=chrome` if you have Chrome instead)

## Setup

```
cd testing
npm install
```

## Run

```
npm test
```

Runs headless by default. For a visible browser window:

```
npm run test:headed
```

An HTML report is written to `testing/report/index.html` after each run.

## Structure

- `config/env.js` — base URL, browser, and demo credentials
- `drivers/driverFactory.js` — WebDriver instance builder
- `pages/` — Page Object Model classes (one per screen)
- `tests/` — Mocha specs, one file per feature area

## Coverage

- Landing page load + navbar navigation
- Theme toggle (light/dark)
- Admin login (invalid + valid credentials)
- Admin route guard (unauthenticated redirect)
- Driver login (invalid + valid credentials)
- Driver online/offline availability toggle
- Request Emergency form — location permission error path
