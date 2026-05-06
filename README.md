# MyResilience — Agentic Disaster Preparedness Guardian

> **Built for the Overclock AI Hackathon 2026** · Malaysia's first AI-native household emergency command system.

[![Python](https://img.shields.io/badge/Python-3.11-blue?logo=python)](https://python.org)
[![FastAPI](https://img.shields.io/badge/FastAPI-0.100-009688?logo=fastapi)](https://fastapi.tiangolo.com)
[![React](https://img.shields.io/badge/React-18-61DAFB?logo=react)](https://react.dev)
[![Groq](https://img.shields.io/badge/LLM-Groq%20Llama--3.1-orange)](https://console.groq.com)
[![MET Malaysia](https://img.shields.io/badge/Data-MET%20Malaysia%20API-green)](https://api.data.gov.my)

---

## 🚨 The Problem

Malaysia experiences flash floods, thunderstorms, and haze events year-round — often with little warning. Most households are **unprepared**: they don't know their current survival window, have no structured evacuation plan, and lack an automated way to notify loved ones when disaster strikes.

**MyResilience** solves this by acting as a persistent, AI-native emergency guardian that thinks, decides, and acts autonomously on behalf of your household — so you don't have to wait until it's too late.

---

## 🧠 System Overview: End-to-End Flow

```
[MET Malaysia API] ──► [Watcher Agent] ──► [Assessor Agent] ──► [Coordinator Agent]
       │                  (Threat Level)       (Survival Days)       (Dispatch Decision)
       │                                                                     │
[Warning API]                                                    [Email / SMS to Contacts]
       │
[Inventory Changes] ──► [Inventory Analyst] ──► [P.A.C.E. Strategist] ──► [Dashboard]
```

### Input → Processing → Decision → Action

| Stage | Source | What Happens |
|---|---|---|
| **Input** | MET Malaysia Forecast + Warning API, User Inventory, Personnel data | Raw data collected on schedule |
| **Processing** | Watcher, Assessor, Inventory Analyst | Threat classified, survival days calculated, readiness scored |
| **Decision** | Coordinator (Playbook) | Selects: Preparedness / Advisory / Emergency mode |
| **Action** | Gmail SMTP + Twilio SMS | Emails user (advisory) or emergency contacts (emergency) with optional SMS dispatch |

---

## 🤖 The Agent Network

MyResilience uses **5 specialised AI agents**, each with a clearly scoped role and strict JSON output contract. No agent does another's job.

### 1. 🔭 The Watcher *(Meteorologist)*
- **Trigger:** Every 5 minutes (Warning API) + Daily (Forecast API)
- **Input:** Raw MET Malaysia weather JSON (Malay + English)
- **Output:** `{ severity, disaster_type, expected_impact, time_to_impact_hours }`
- **Intelligence:** Interprets Malay weather terms (`Ribut petir` = Thunderstorm, `Berjerebu` = Haze), detects official government `OFFICIAL WARNING` prefixes, and escalates to `critical` on confirmed government advisories.

### 2. ⚖️ The Assessor *(Survival Tactician)*
- **Trigger:** After every Watcher run with an active threat
- **Input:** Watcher output + Inventory + Team roster (including age & medical remarks)
- **Output:** `{ survival_score_days, evacuation_urgency, missing_critical_items, reasoning }`
- **Intelligence:** Calculates water survival (3L/person/day) and food survival (2 servings/person/day). Applies a **Mobility Override** — if a team member has critical medical remarks (e.g. asthma, wheelchair), urgency is automatically escalated by one level.

### 3. 📦 The Inventory Analyst *(Preparedness Expert)*
- **Trigger:** Every time inventory or personnel is saved
- **Input:** Full inventory list + Team
- **Output:** Readiness score (0–100), survival days, low-stock items, expiring items, critical gaps, 3 prioritised recommendations
- **Intelligence:** Deducts points from readiness score based on missing categories (Water, Food, Medical, Power, Shelter, Tools), low stock ratios, and expiring items.

### 4. 🗺️ The P.A.C.E. Strategist *(Tactical Planner)*
- **Trigger:** Alongside Inventory Analyst on every save
- **Input:** Inventory + Team + Location
- **Output:** Four-tier plan: `{ primary, alternate, contingency, emergency }`
- **Intelligence:** Each tier assumes the previous has failed. References actual inventory items and accounts for mobility constraints of elderly (>65) or children (<12).

### 5. 📡 The Coordinator *(Emergency Dispatcher)*
- **Trigger:** After Assessor or Inventory Analyst completes
- **Playbook Modes:**
  - **PREPAREDNESS** — Low inventory detected. Sends a structured restocking email to the user *(if enabled in Settings)*.
  - **ADVISORY** — Active non-critical threat. Sends a calm situational briefing to the user *(if enabled in Settings)*.
  - **EMERGENCY** — Critical threat with low survival days. Sends urgent alert to the user **and** all designated Emergency Contacts via email + SMS *(if enabled in Settings)*.
- **Output:** Formatted emails using structured templates with dynamic data injection.

---

## 🔀 Agentic Decision Flow (Minimum 3 Steps)

```
Step 1 — DETECT:   Watcher parses MET API → classifies severity
Step 2 — ASSESS:   Assessor computes survival window + applies mobility override
Step 3 — DECIDE:   Coordinator selects Playbook mode (Preparedness/Advisory/Emergency)
Step 4 — ACT:      Email + optional SMS dispatched autonomously
Step 5 — LOG:      Activity Network records agent reasoning for full transparency
```

All steps execute **without user intervention** after initialization.

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

## 📈 Scalability & Practicality

| Factor | Detail |
|---|---|
| **Cost** | Free tier: Groq (LPU inference, ~150 req/day free), MET API (free, no key required), Gmail SMTP (free) |
| **Token Efficiency** | Forecast fetched once daily. Warning API polled every 5 mins. **Change-detection hash** prevents agents from running if weather hasn't changed — saving ~95% of unnecessary LLM calls |
| **Latency** | Groq Llama-3.1 responses average < 1 second. Full agent chain runs in ~4 seconds |
| **Scalability** | Backend is stateless FastAPI. Can be containerised (Docker) and horizontally scaled. State can be migrated to PostgreSQL for multi-household support |
| **Resilience** | Every agent has a fallback default response. Frontend degrades gracefully on 500 errors with last known state retained |

---

## 🗂️ Project Structure

```
V2-AI-Hackathon-Overclock/
├── backend/
│   ├── app/
│   │   ├── agents/
│   │   │   ├── safesync_agents.py   # All 5 agent prompts + functions
│   │   │   ├── gmail_tools.py       # SMTP email sender
│   │   │   ├── sms_tools.py         # Twilio SMS dispatcher
│   │   │   └── config.py            # Groq client + env loader
│   │   └── routers/
│   │       └── emergency.py         # FastAPI routes + MET API integration
│   ├── main.py                      # FastAPI app entry point
│   ├── requirements.txt
│   ├── .env.example                 # ← Copy this to .env and fill values
│   └── .env                         # ← NOT committed to git
└── frontend/
    └── src/
        ├── App.jsx                  # Main React application (1500+ lines)
        └── App.css                  # Sovereign Tactical dark-mode design system
```

---

## ⚙️ Getting Started

### Prerequisites
- Python 3.11+
- Node.js 18+
- A [Groq API key](https://console.groq.com) (free)
- A Gmail account with [App Password enabled](https://myaccount.google.com/security)
- *(Optional)* A [Twilio account](https://twilio.com) for SMS dispatch

### 1. Clone & Configure Backend

```bash
cd backend
cp .env.example .env
# Edit .env with your credentials
```

```bash
python -m venv venv
venv\Scripts\activate        # Windows
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

| Variable | Description | Required |
|---|---|---|
| `GROQ_API_KEY` | Your Groq LLM API key | ✅ Yes |
| `GROQ_MODEL` | Model to use (default: `llama-3.1-8b-instant`) | ✅ Yes |
| `NOTIFICATION_EMAIL` | Email address that receives Advisory alerts | ✅ Yes |
| `GMAIL_USER` | Gmail address used to send emails | ✅ Yes |
| `GMAIL_APP_PASSWORD` | 16-character Gmail App Password | ✅ Yes |
| `TWILIO_ACCOUNT_SID` | Twilio Account SID for SMS dispatch | Optional |
| `TWILIO_AUTH_TOKEN` | Twilio Auth Token | Optional |
| `TWILIO_PHONE_NUMBER` | Twilio sender phone number | Optional |
| `ALLOWED_ORIGINS` | Frontend CORS origins | Optional |

> **Security Note:** Never commit your `.env` file. The `.gitignore` should include `backend/.env`.

---

## 📡 Live Data Sources

| Source | Endpoint | Refresh Rate |
|---|---|---|
| MET Malaysia Forecast | `api.data.gov.my/weather/forecast` | Daily (24h) |
| MET Malaysia Warnings | `api.data.gov.my/weather/warning` | Every 5 minutes |

Both APIs are **free and require no API key**. The system filters for the Petaling / Selangor region by default, configurable in `emergency.py`.

---

## 🎮 Demo Mode

Toggle **Live Demo Mode** in the dashboard to simulate a critical flash flood scenario (Red Alert, 2.5h impact, 150mm/h rainfall). This guarantees a full agent pipeline trigger for hackathon demonstrations without needing to wait for a real weather event.

---

## 🛡️ Resilience Features

- **Agent-level fallbacks**: Every agent returns a safe default if the LLM call fails
- **Frontend degradation**: Failed API calls retain last known state and log a warning
- **No-guess policy**: Watcher returns `null` for unknown impact times instead of fabricating data
- **Change detection**: Alert hash comparison prevents redundant agent runs
- **Privacy by default**: All location and notification features are OFF by default; user opts in explicitly

---

## 👥 Team

Built for the **Overclock AI Hackathon 2026** — *Agentic AI Track*

---

*Stay prepared. MyResilience is always watching.*
