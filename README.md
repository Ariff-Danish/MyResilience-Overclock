# MyResilience — Agentic Disaster Preparedness Guardian

> **Built for the Overclock AI Hackathon 2026** · Malaysia's first AI-native household emergency command system.

[![Python](https://img.shields.io/badge/Python-3.11-blue?logo=python)](https://python.org)
[![FastAPI](https://img.shields.io/badge/FastAPI-0.100-009688?logo=fastapi)](https://fastapi.tiangolo.com)
[![React](https://img.shields.io/badge/React-18-61DAFB?logo=react)](https://react.dev)
[![Groq](https://img.shields.io/badge/LLM-Groq%20Llama--3.3-orange)](https://console.groq.com)
[![MET Malaysia](https://img.shields.io/badge/Data-MET%20Malaysia%20API-green)](https://api.data.gov.my)

---

## 🚨 The Problem

Malaysia experiences flash floods, thunderstorms, and haze events year-round — often with little warning. Most households are **unprepared**: they don't know their current survival window, have no structured evacuation plan, and lack an automated way to notify loved ones when disaster strikes.

**MyResilience** solves this by acting as a persistent, AI-native emergency guardian that thinks, decides, and acts autonomously on behalf of your household — so you don't have to wait until it's too late.

---

## 🧠 System Overview: End-to-End Flow

```
[MET Malaysia API] ──► [ThreatAssessor Agent] ──────────────────────────────►
                        (Weather + Survival in 1 call)                        │
                                                                              │
[Inventory + Team] ──► [PreparednessBriefing Agent] ────────────────────────►│
                        (Inventory Audit + PACE in 1 call)                    │
                                                                              ▼
                                                              [Coordinator Agent]
                                                              (Playbook: Preparedness
                                                               / Advisory / Emergency)
                                                                              │
                                                              ┌───────────────┘
                                                              ▼
                                                   [Email / SMS Dispatch]
                                                              │
                                                              ▼
                                                   [Local JSON Storage]
```

### Input → Processing → Decision → Action

| Stage | Source | What Happens |
|---|---|---|
| **Input** | MET Malaysia Forecast + Warning API, User Inventory, Personnel data | Raw data collected on schedule or user action |
| **Processing** | ThreatAssessor, PreparednessBriefing | Threat classified, survival days calculated, readiness scored |
| **Decision** | Coordinator (Playbook) | Selects: Preparedness / Advisory / Emergency mode |
| **Action** | Gmail SMTP + Twilio SMS | Emails user (advisory) or emergency contacts (emergency) with optional SMS dispatch |

---

## 🤖 The Agent Network (V2 Optimised)

MyResilience uses **5 specialised AI agents**, each with a clearly scoped role and strict JSON output contract. No agent does another's job. In V2, we merged several agents to drastically reduce API tokens while maintaining discrete reasoning.

### 1. 🔭 The ThreatAssessor *(Meteorologist + Survival Tactician)*
- **Trigger:** Real-time weather polling
- **Input:** Raw MET Malaysia weather JSON (Malay + English) + Inventory + Team Roster
- **Output:** Weather severity, expected impact, survival score, and evacuation urgency.
- **Intelligence:** Interprets Malay weather terms, calculates water survival (3L/person/day) and food survival (2 servings/person/day). Applies a **Mobility Override** — if a team member has critical medical remarks (e.g. asthma, wheelchair), urgency is automatically escalated.

### 2. 📦 The PreparednessBriefing Agent *(Inventory + PACE)*
- **Trigger:** Every time inventory or personnel is saved
- **Input:** Full inventory list + Team
- **Output:** Readiness score (0–100), low-stock items, expiring items, critical gaps, and a Four-tier P.A.C.E. plan `{ primary, alternate, contingency, emergency }`.
- **Intelligence:** Each tier of the P.A.C.E. plan assumes the previous has failed. References actual inventory items and accounts for mobility constraints of elderly (>65) or children (<12).

### 3. 📡 The Coordinator *(Emergency Dispatcher)*
- **Trigger:** After ThreatAssessor or PreparednessBriefing completes
- **Playbook Modes:**
  - **PREPAREDNESS** — Low inventory detected. Sends a structured restocking email.
  - **ADVISORY** — Active non-critical threat. Sends a calm situational briefing.
  - **EMERGENCY** — Critical threat with low survival days. Sends urgent alert to the user **and** all designated Emergency Contacts via email + SMS.

### 4. 🗺️ The Evacuation Advisor
- **Trigger:** Active emergency alert in the user's vicinity
- **Input:** OpenStreetMap (Overpass API) real-time data
- **Intelligence:** Queries actual shelters, hospitals, and police stations within a 15km radius. Generates contextual evasion routes without hallucinating GPS coordinates.



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

## 💾 Hackathon Mode: Local JSON Storage

For the Overclock Hackathon, we bypassed external databases (TiDB/PostgreSQL) to guarantee 100% uptime and zero connection timeouts during the demo.

- All state is persisted to **Local JSON files** in `backend/app/data/`.
- **Mock Authentication** is enabled. Any email/password combination automatically logs you into the persistent "Demo User" account.
- To **reset** your demo data, simply delete the files in the `backend/app/data/` folder.

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
python main.py               # Starts on port 8000
```

### 2. Start Frontend

Open a new terminal:
```bash
cd frontend
npm install
npm run dev
```

Open [http://localhost:5173](http://localhost:5173). Log in with **any** credentials.

---

## 🔑 Environment Variables

| Variable | Description | Required |
|---|---|---|
| `GROQ_API_KEY` | Your Groq LLM API key | ✅ Yes |
| `GROQ_MODEL` | Model to use (default: `llama-3.3-70b-versatile`) | ✅ Yes |
| `NOTIFICATION_EMAIL` | Email address that receives Advisory alerts | ✅ Yes |
| `GMAIL_USER` | Gmail address used to send emails | ✅ Yes |
| `GMAIL_APP_PASSWORD` | 16-character Gmail App Password | ✅ Yes |
| `TWILIO_ACCOUNT_SID` | Twilio Account SID for SMS dispatch | Optional |
| `TWILIO_AUTH_TOKEN` | Twilio Auth Token | Optional |
| `TWILIO_PHONE_NUMBER` | Twilio sender phone number | Optional |

> **Security Note:** Never commit your `.env` file.

---

## 📡 Live Data Sources

| Source | Endpoint | Refresh Rate |
|---|---|---|
| MET Malaysia Forecast | `api.data.gov.my/weather/forecast` | Daily (24h) |
| MET Malaysia Warnings | `api.data.gov.my/weather/warning` | Every 5 minutes |
| OpenStreetMap Overpass | `overpass-api.de/api/interpreter` | On Demand |

All external APIs are **free and require no API keys**.

---

## 🎮 Demo Mode

Toggle **Live Demo Mode** in the dashboard to simulate a critical flash flood scenario (Red Alert, 2.5h impact, 150mm/h rainfall). This guarantees a full agent pipeline trigger for hackathon demonstrations without needing to wait for a real weather event.

---

## 🛡️ Resilience Features

- **Agent-level fallbacks**: Every agent returns a safe default if the LLM call fails
- **Tiered Model Cascade**: Automatically falls back from Llama 3.3 -> Qwen -> Llama 3.1 if rate limits are hit.
- **Frontend degradation**: Failed API calls retain last known state and log a warning
- **No-guess policy**: ThreatAssessor returns `null` for unknown impact times instead of fabricating data
- **Privacy by default**: All location and notification features are OFF by default; user opts in explicitly

---

Developed for the **Overclock AI Hackathon 2026** — *Agentic AI Track*.

*Stay prepared. MyResilience is always watching.*
