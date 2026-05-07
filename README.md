# MyResilience — Agentic Disaster Preparedness Guardian

> **Built for the Overclock AI Hackathon 2026** · Malaysia's first AI-native household emergency command system.

[![Python](https://img.shields.io/badge/Python-3.12-blue?logo=python)](https://python.org)
[![FastAPI](https://img.shields.io/badge/FastAPI-0.100-009688?logo=fastapi)](https://fastapi.tiangolo.com)
[![React](https://img.shields.io/badge/React-19-61DAFB?logo=react)](https://react.dev)
[![Vite](https://img.shields.io/badge/Vite-8-646CFF?logo=vite)](https://vitejs.dev)
[![Groq](https://img.shields.io/badge/LLM-Groq%20Llama--3.3-orange)](https://console.groq.com)
[![Vercel](https://img.shields.io/badge/Deployed-Vercel-black?logo=vercel)](https://vercel.com)

**🌐 Live Production Endpoints:**
- **Frontend Dashboard:** [https://myresilience-overclock-web.vercel.app](https://myresilience-overclock-web.vercel.app)
- **Backend API:** [https://myresilience-overclock-api.vercel.app](https://myresilience-overclock-api.vercel.app)

---

## 🚨 The Problem

Malaysia experiences flash floods, thunderstorms, and haze events year-round — often with little warning. Most households are **unprepared**: they don't know their current survival window, have no structured evacuation plan, and lack an automated way to notify loved ones when disaster strikes.

**MyResilience** solves this by acting as a persistent, AI-native emergency guardian that thinks, decides, and acts autonomously on behalf of your household — so you don't have to wait until it's too late.

---

## 🧠 System Architecture & Vercel Infrastructure

The application runs a decoupled frontend-backend architecture perfectly suited for edge deployments.

```text
[MET Malaysia API] —► [Watcher Agent] —► [Assessor Agent] —► [Coordinator Agent]
       │                  (Threat Level)       (Survival Days)       (Dispatch Decision)
       │                                                                     │
[Warning API]                                             [SMS via Twilio / Email to Contacts]
       │
[Inventory Changes] —► [Inventory Analyst] —► [P.A.C.E. Strategist] —► [Dashboard]
       │
[User GPS / OSM] —► [Evacuation Advisor] —► [Threat Map: Shelters, Routes, Avoidance Zones]
```

### ⚡ Infrastructure Highlights
- **Serverless FastAPI:** The Python backend is fully mapped to Vercel's edge network using a custom `vercel.json` router.
- **Node 22 Engine:** The Vite 8 frontend leverages high-performance React 19 standards, statically generated and delivered via Vercel Edge Cache.
- **Universal CORS Matrix:** Configured with `allow_origins=["*"]` to ensure stable cross-platform communication.
- **Model Cascading:** Driven by Groq's blazing-fast `llama-3.3-70b-versatile` with automatic retries and fallback reasoning loops to circumvent rate limits.

---

## 🤖 The Agent Network (4 Runtime Nodes)

MyResilience features **6 specialised conceptual roles**, which have been structurally merged into **4 High-Density API Nodes** to drastically reduce Groq LLM token usage and circumvent API rate limits. Each node adheres to a strict JSON output contract.

### Node 1: The Threat Assessor (Watcher + Assessor Merged)
- **Trigger:** Every 1 minute (Warning API) + Daily (Forecast API)
- **Intelligence:** Interprets Malay weather terms, detects official government warnings, and calculates immediate survival capacity (Water/Food/Mobility) in a single LLM pass. Output dictates the exact `evacuation_urgency`.

### Node 2: The Preparedness Briefing (Inventory + P.A.C.E. Merged)
- **Trigger:** Debounced auto-sync when inventory changes.
- **Intelligence:** Simultaneously calculates readiness score, flags low stock, and writes the 4-tier P.A.C.E. (Primary, Alternate, Contingency, Emergency) tactical doctrine in a single massive prompt execution.

### Node 3: The Coordinator *(Emergency Dispatcher)*
- **Trigger:** Threat detected by the Threat Assessor.
- **Autonomous Dispatch:** Upgraded logic decouples alert sending from inventory checks. The system will **automatically trigger alerts** the moment any active MET Malaysia threat is detected in the user's immediate vicinity.

### Node 4: The Evacuation Advisor *(Field Commander)*
- **Trigger:** Auto-triggered on live threat or manual click.
- **Output:** `{ shelter_locations[], enforcement_agencies[], routes_to_take[], areas_to_avoid }`
- **Intelligence:** Integrates **OpenStreetMap (Nominatim)** reverse-geocoding to fetch *real-world* locations for shelters, PDRM, Bomba, and hospitals across Malaysia.

---

## 🔒 Data Security & Privacy (Zero-Retention Architecture)

The system is designed with a strict **Local-First, Privacy-by-Design** security model to comply with the Personal Data Protection Act (PDPA) of Malaysia:

- **No Remote Database:** There is **no centralised database** storing your personal information. All sensitive data — including your household inventory, medical remarks, ages of family members, and GPS coordinates — is stored exclusively in your browser's `localStorage`.
- **Stateless Backend:** The FastAPI backend is entirely stateless. When the frontend requests an AI evaluation, it securely transmits the current state to the edge function. The Groq agent processes the request in-memory, returns the result, and immediately discards the payload. 
- **Geolocation Security:** Your GPS coordinates are never saved. They are used momentarily for reverse-geocoding (via OpenStreetMap) and proximity calculations, then purged.

---

## 🔄 System Workflow & Lifecycle (Detailed)

1. **Initialization:** The user loads the dashboard. The frontend loads the persistent state (`inventory`, `team`) from `localStorage` and establishes the initial API connection.
2. **Threat Polling:** Every 1 minute, the frontend silently polls the `/api/weather/live` endpoint. The backend pulls data from MET Malaysia, filters it by proximity using the Haversine formula against the user's GPS, and returns the threat status.
3. **State Change Detection:** If the threat hash changes (e.g., a new warning appears), the frontend automatically calls `/api/evaluate_risk`.
4. **Agentic Evaluation (The Brains):** 
   - The *Threat Assessor Agent* analyzes the severity of the storm against the household's actual supplies.
   - The *Evacuation Advisor Agent* uses Nominatim to locate real-world shelters and generates a safe routing plan.
5. **Autonomous Dispatch:** If a nearby threat is confirmed, the *Coordinator Agent* bypasses human intervention and immediately dispatches an emergency SMS (via Twilio) to all listed household contacts with the safe routing plan.
6. **UI Reflection:** The React frontend updates the Leaflet Threat Map, switches to Red Alert status, and displays the AI's reasoning chain in the Activity Network logs for complete transparency.

---

## 🖥️ Dashboard Features

| Module | Description |
|---|---|
| **⚡ Command Dashboard** | Real-time tactical overview with live MYT clock, threat status, and location detection |
| **🛡️ Asset Readiness** | Category radar chart + readiness score trend history embedded in a single panel |
| **🌤️ Tactical Intel** | Merged weather + threat panel — glows red on active alerts, shows MET forecast + official warning link |
| **📦 Asset Inventory** | Full CRUD for household supplies with colour-coded categories, stock bars, and expiry tracking |
| **👥 Personnel & Comms** | Editable team roster with role colour-coding (family / emergency contact / useful contact) |
| **🗺️ Threat Map** | Leaflet.js live map with proximity shelter routing, SMS copy, and evacuation advisory download |
| **📡 Activity Network** | Expandable accordion log of every agent run — shows triggers, reasoning, and agent chain |
| **⚙️ Settings** | Centralised preferences for GPS location tracking and per-category email notification control |
| **🛡️ Admin Panel** | Role-based admin dashboard with user management, system stats, and health monitoring |
| **💬 AI Chatbot** | Floating chatbot widget for navigation help, inventory queries, and emergency guidance |
| **🎙️ Voice Commands** | Voice-controlled inventory management — add, update, search, and delete items by speaking |
| **📸 Smart Scanner** | AI-powered image recognition with auto-categorization, drag-and-drop, and batch scanning |

---

## 🆕 New Features (Mentor Feedback Implementation)

### 🛡️ Role-Based Access Control (RBAC)

The application now supports two user roles with distinct capabilities:

| Role | Capabilities |
|---|---|
| **User** (default) | Standard inventory management, threat monitoring, evacuation planning |
| **Admin** | All user features + user management, system analytics, role assignment, health monitoring |

**How it works:**
- Roles are stored in Supabase `user_metadata` (separate from Supabase's built-in JWT role)
- Admin users see an additional **🛡️ Admin** tab in the sidebar
- Admin panel provides: user list with role management, system-wide statistics, category breakdown charts, and environment health checks
- All admin endpoints are protected by `require_admin` middleware

**Admin API Endpoints:**
- `GET /api/admin/users` — List all users with roles and activity counts
- `PUT /api/admin/users/{user_id}/role` — Promote/demote user roles
- `GET /api/admin/stats` — System-wide analytics
- `GET /api/admin/health` — Detailed system health check

### 💬 AI Chatbot Integration

A floating chatbot widget provides contextual assistance throughout the app:

- **Multi-turn conversations** with full message history
- **Context-aware responses** — the chatbot receives current inventory, threat status, and readiness score
- **Quick-action suggestions** — role-aware contextual buttons for common queries
- **Intent detection** — understands inventory queries, navigation help, emergency guidance, voice command help, and admin assistance
- **Typing indicators** and auto-scroll for smooth UX

**API Endpoint:**
- `POST /api/chatbot/message` — Send message with conversation history, get AI response
- `GET /api/chatbot/suggestions` — Get contextual quick-action suggestions

### 🎙️ Voice Recognition for Inventory Management

Voice-controlled inventory management using the Web Speech API:

- **Supported commands:** "Add 5 bottles of water", "Update rice to 10 packs", "Delete expired medicine", "Search for flashlight"
- **Smart category mapping** — understands synonyms (e.g., "drink" → water, "medicine" → medical)
- **Confidence-based execution** — high confidence (≥70%) auto-executes, medium confidence shows confirmation button
- **Visual feedback** — microphone button with listening wave animation, live transcript display
- **Quick command hints** — clickable examples for easy onboarding

**API Endpoint:**
- `POST /api/voice/process` — Parse transcribed voice text into structured inventory action
- `GET /api/voice/commands` — List supported voice command examples

### 📸 Enhanced Image Recognition

The asset scanner has been significantly enhanced:

- **Auto-categorization** — AI-detected item types are automatically mapped to valid inventory categories (water, food, medical, tools, documents, clothing, communication, lighting, sanitation, other)
- **Drag-and-drop upload** — drop single or multiple images directly onto the scanner
- **Batch scanning** — scan up to 5 items simultaneously with individual result cards
- **Smart unit detection** — automatically suggests appropriate units (liters for water, packs for food, etc.)
- **Tag extraction** — AI generates relevant tags for each scanned item
- **Multiple input modes** — Camera capture, file upload, or batch scan

**API Endpoints:**
- `POST /api/scan/asset` — Single image scan with auto-categorization
- `POST /api/scan/asset/batch` — Batch scan up to 5 images

---

## ⚙️ Settings & Preferences

The **Settings** tab gives users full control over notification behaviour:

| Toggle | Description |
|---|---|
| 📍 **GPS Location Tracking** | Auto-fetches browser location for proximity-based threat detection. Off by default. |
| ✉️ **Preparedness Emails** | Allow the agent to send restocking/audit emails when inventory is low. |
| ✉️ **Advisory Emails** | Allow the agent to send weather briefings when a non-critical threat is detected. |
| 🚨 **Emergency Emails** | Allow the agent to email emergency contacts during a critical disaster event. |

> All toggles default to **OFF**. Settings are persisted to `localStorage` and passed to the backend on every agent run.

---

## 🌍 Real-World Applicability

| Context | Application |
|---|---|
| **Residential Households** | Persistent background guardian for families in flood-prone areas |
| **NGOs & Community Centres** | Mass notification system for community emergency coordinators |
| **Corporate BCP** | Business continuity preparedness tracker for remote/field teams |
| **Public Sector** | Integration with Jabatan Bomba or NADMA to extend official alerts with household-level action plans |

---

## 🗺️ Threat Map & Geolocation Features

The **Threat Map** tab provides a real-time geospatial evacuation interface:

- **Leaflet Engine:** Interactive OpenStreetMap with emoji markers: 🏠 Shelter · 🚔 Police · 🚒 Bomba · 🏥 Hospital · 🏛️ NADMA
- **📍 Locate Me:** Detects GPS coordinates via browser API and reverse-geocodes the user's city/state.
- **Nearest Shelter Routing:** Haversine distance calculation ranks all shelters by proximity. Draws a dashed routing line to the absolute nearest safe point.
- **SMS Alert Text:** Pre-formatted 160-char SMS generated for broadcast.

---

## ⚙️ Getting Started

### Prerequisites
- Node.js `^22.0.0`
- Python `3.11+`
- A [Groq API key](https://console.groq.com)
- Vercel CLI (optional for deployment)

### 1. Clone & Configure Backend

```bash
cd backend
cp .env.example .env
# Edit .env with your credentials
```

```bash
python -m venv venv
# Windows: venv\Scripts\activate | Mac/Linux: source venv/bin/activate
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```

### 2. Start Frontend

```bash
cd frontend
npm install
npm run dev
```

Open [http://localhost:5173](http://localhost:5173)

---

## 🔑 Environment Variables

| Variable | Description | Required | Location |
|---|---|---|---|
| `VITE_API_URL` | Override backend URL | No | Frontend `.env` |
| `VITE_SUPABASE_URL` | Supabase project URL | ✅ Yes | Frontend `.env` |
| `VITE_SUPABASE_ANON_KEY` | Supabase anonymous key | ✅ Yes | Frontend `.env` |
| `GROQ_API_KEY` | Your Groq LLM API key | ✅ Yes | Backend `.env` |
| `GROQ_MODEL` | Set to `llama-3.3-70b-versatile` | ✅ Yes | Backend `.env` |
| `SUPABASE_URL` | Supabase project URL (backend) | ✅ Yes | Backend `.env` |
| `SUPABASE_SERVICE_KEY` | Supabase service role key (admin operations) | ✅ Yes | Backend `.env` |
| `SUPABASE_JWT_SECRET` | Supabase JWT secret for token verification | ✅ Yes | Backend `.env` |
| `NOTIFICATION_EMAIL` | Email address that receives Advisory alerts | ✅ Yes | Backend `.env` |
| `GMAIL_USER` / `APP_PASSWORD` | Gmail SMTP credentials | Optional | Backend `.env` |
| `TWILIO_ACCOUNT_SID` | Twilio Account SID for SMS dispatch | Optional | Backend `.env` |
| `ALLOWED_ORIGINS` | `*` or comma separated URLs | Optional | Backend `.env` |

> **Vercel Deployments:** Environment variables must be explicitly set in the Vercel Dashboard for both `myresilience-overclock-web` and `myresilience-overclock-api` projects.

---

---

## 🚀 Deployment (Vercel)

This project is configured for easy deployment as a monorepo on **Vercel**.

### Configuration
- **Frontend**: React (Vite)
- **Backend**: FastAPI (Python Serverless)
- **Routing**: `vercel.json` manages API routing to the serverless function.

### Steps
1. Push your code to GitHub.
2. Connect the repository to Vercel.
3. In **Project Settings > Environment Variables**, add all keys from `.env.example`.
4. Set the **Build Command** to: `cd frontend && npm install && npm run build`
5. Set the **Output Directory** to: `frontend/dist`
6. Deploy. Vercel will automatically detect the `vercel.json` and `api/index.py` for your backend.

---

## 🛡️ Resilience Features

- **Decoupled Autonomous Trigger:** Evacuation alerts trigger purely on localized weather threats, preventing "analysis paralysis" from empty inventories.
- **Agent-level fallbacks**: Every agent returns a safe default if the LLM call fails.
- **Change detection**: Alert hash comparison prevents redundant agent runs, saving ~95% of unnecessary LLM calls.
- **Geolocation fallback**: Location denied → error bar shown, map defaults to National view.

---

## 👥 Team

Built for the **Overclock AI Hackathon 2026** — *Agentic AI Track*  
*Forged by the Dukelove MemoryCore v8.1 Sovereign*

*Stay prepared. MyResilience is always watching.* 🛡️
