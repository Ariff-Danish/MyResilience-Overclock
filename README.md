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

## 🤖 The Agent Network

MyResilience uses **6 specialised AI agents**, each with a clearly scoped role and strict JSON output contract. 

### 1. 🔭 The Watcher *(Meteorologist)*
- **Trigger:** Every 5 minutes (Warning API) + Daily (Forecast API)
- **Output:** `{ severity, disaster_type, expected_impact, time_to_impact_hours }`
- **Intelligence:** Interprets Malay weather terms (`Ribut petir`, `Berjerebu`), detects official government `OFFICIAL WARNING` prefixes, and uses spatial proximity filtering to suppress warnings that are >150km away from the user.

### 2. ⚖️ The Assessor *(Survival Tactician)*
- **Trigger:** After every Watcher run with an active threat
- **Output:** `{ survival_score_days, evacuation_urgency, missing_critical_items }`
- **Intelligence:** Calculates water survival (3L/person/day) and food survival. Applies a **Mobility Override** — if a team member has critical medical remarks (e.g. asthma, wheelchair), urgency is escalated.

### 3. 📦 The Inventory Analyst *(Preparedness Expert)*
- **Trigger:** Debounced auto-sync when inventory changes
- **Output:** Readiness score (0–100), low-stock warnings, expiring items, 3 prioritised recommendations.

### 4. 🗺️ The P.A.C.E. Strategist *(Tactical Planner)*
- **Trigger:** Merged with Inventory Analyst to save tokens.
- **Output:** Four-tier plan: `{ primary, alternate, contingency, emergency }`

### 5. 📡 The Coordinator *(Emergency Dispatcher)*
- **Trigger:** Threat detected by Watcher.
- **Autonomous Dispatch:** Upgraded logic decouples alert sending from inventory checks. The system will **automatically trigger alerts** the moment any active MET Malaysia threat is detected in the user's immediate vicinity.

### 6. 🗺️ The Evacuation Advisor *(Field Commander)*
- **Trigger:** Auto-triggered on live threat or manual click.
- **Output:** `{ shelter_locations[], enforcement_agencies[], routes_to_take[], areas_to_avoid }`
- **Intelligence:** Integrates **OpenStreetMap (Nominatim)** reverse-geocoding to fetch *real-world* locations for shelters, PDRM, Bomba, and hospitals across Malaysia (verified for Peninsula, Sabah, and Sarawak).

---

## 🔒 Data Security & Privacy (Zero-Retention Architecture)

The system is designed with a strict **Local-First, Privacy-by-Design** security model to comply with the Personal Data Protection Act (PDPA) of Malaysia:

- **No Remote Database:** There is **no centralised database** storing your personal information. All sensitive data — including your household inventory, medical remarks, ages of family members, and GPS coordinates — is stored exclusively in your browser's `localStorage`.
- **Stateless Backend:** The FastAPI backend is entirely stateless. When the frontend requests an AI evaluation, it securely transmits the current state to the edge function. The Groq agent processes the request in-memory, returns the result, and immediately discards the payload. 
- **Geolocation Security:** Your GPS coordinates are never saved. They are used momentarily for reverse-geocoding (via OpenStreetMap) and proximity calculations, then purged.

---

## 🔄 System Workflow & Lifecycle (Detailed)

1. **Initialization:** The user loads the dashboard. The frontend loads the persistent state (`inventory`, `team`) from `localStorage` and establishes the initial API connection.
2. **Threat Polling:** Every 5 minutes, the frontend silently polls the `/api/weather/live` endpoint. The backend pulls data from MET Malaysia, filters it by proximity using the Haversine formula against the user's GPS, and returns the threat status.
3. **State Change Detection:** If the threat hash changes (e.g., a new warning appears), the frontend automatically calls `/api/evaluate_risk`.
4. **Agentic Evaluation (The Brains):** 
   - The *Threat Assessor Agent* analyzes the severity of the storm against the household's actual supplies.
   - The *Evacuation Advisor Agent* uses Nominatim to locate real-world shelters and generates a safe routing plan.
5. **Autonomous Dispatch:** If a nearby threat is confirmed, the *Coordinator Agent* bypasses human intervention and immediately dispatches an emergency SMS (via Twilio) to all listed household contacts with the safe routing plan.
6. **UI Reflection:** The React frontend updates the Leaflet Threat Map, switches to Red Alert status, and displays the AI's reasoning chain in the Activity Network logs for complete transparency.

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
| `GROQ_API_KEY` | Your Groq LLM API key | ✅ Yes | Backend `.env` |
| `GROQ_MODEL` | Set to `llama-3.3-70b-versatile` | ✅ Yes | Backend `.env` |
| `NOTIFICATION_EMAIL` | Email address that receives Advisory alerts | ✅ Yes | Backend `.env` |
| `GMAIL_USER` / `APP_PASSWORD` | Gmail SMTP credentials | Optional | Backend `.env` |
| `TWILIO_ACCOUNT_SID` | Twilio Account SID for SMS dispatch | Optional | Backend `.env` |
| `ALLOWED_ORIGINS` | `*` or comma separated URLs | Optional | Backend `.env` |

> **Vercel Deployments:** Environment variables must be explicitly set in the Vercel Dashboard for both `myresilience-overclock-web` and `myresilience-overclock-api` projects.

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
