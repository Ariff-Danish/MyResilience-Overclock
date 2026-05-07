# MyResilience — Mentor Feedback Roadmap

> **Date:** 2026-05-07  
> **Source:** Mentor Review — Overclock AI Hackathon 2026  
> **Status:** In Progress

---

## 📋 Current Issue

The inventory system is currently static, requiring users to manually update items, which results in a poor user experience and inefficient workflow.

---

## 🎯 Suggested Improvements (Prioritized)

### Priority 1: Role-Based Access Control (RBAC)
**Impact:** High | **Feasibility:** High | **Effort:** Medium

Implement separate user and admin interfaces with distinct views, permissions, and functionalities tailored to each role.

**Implementation Plan:**
- **Backend:** Add `role` field to user profiles in Supabase (`admin`, `user`). Create role-checking middleware and admin-only endpoints for user management, system analytics, and bulk operations.
- **Frontend:** Conditional rendering based on role — admin gets User Management panel, System Health dashboard, and Audit Log viewer. Regular users get standard inventory + emergency features.
- **Files Modified:**
  - `backend/app/auth/__init__.py` — Add `require_admin` dependency
  - `backend/app/routers/admin.py` — New admin router (user management, analytics)
  - `frontend/src/lib/AuthContext.jsx` — Expose user role
  - `frontend/src/components/Sidebar.jsx` — Role-aware navigation
  - `frontend/src/App.jsx` — Admin dashboard tab

---

### Priority 2: Chatbot Integration
**Impact:** High | **Feasibility:** High | **Effort:** Medium

Add an interactive chatbot to assist users with navigation, inventory queries, and general support within the application.

**Implementation Plan:**
- **Backend:** New `/api/chatbot` endpoint using Groq LLM with system context about the user's inventory, threat status, and app navigation.
- **Frontend:** Floating `ChatbotWidget` component with conversation history, quick-action buttons, and contextual responses.
- **Files Modified:**
  - `backend/app/routers/chatbot.py` — New chatbot router
  - `frontend/src/components/chatbot/ChatbotWidget.jsx` — New chatbot UI
  - `frontend/src/App.jsx` — Mount chatbot widget globally

---

### Priority 3: Voice Recognition for Inventory Management
**Impact:** Medium | **Feasibility:** Medium | **Effort:** Medium

Enable users to add, update, or search inventory items using voice commands for a hands-free and more accessible experience.

**Implementation Plan:**
- **Backend:** New `/api/voice/process` endpoint that accepts transcribed text, uses Groq to parse intent (add/update/search/delete), and executes the corresponding inventory action.
- **Frontend:** `VoiceCommand` component using Web Speech API (`SpeechRecognition`) with visual feedback (mic indicator, waveform), command confirmation, and error handling.
- **Files Modified:**
  - `backend/app/routers/voice.py` — New voice command router
  - `frontend/src/components/voice/VoiceCommand.jsx` — New voice UI
  - `frontend/src/App.jsx` — Mount voice command in inventory tab

---

### Priority 4: Image Recognition Enhancement
**Impact:** Medium | **Feasibility:** High | **Effort:** Low

Allow users to capture or upload images of items, which the system will automatically identify and categorize to streamline the inventory listing process.

**Implementation Plan:**
- **Backend:** Enhance existing `/api/scan/asset` endpoint with better category mapping, auto-quantity detection, and batch upload support.
- **Frontend:** Enhance `AssetScanner` with drag-and-drop upload, batch scanning, and auto-fill into inventory form.
- **Files Modified:**
  - `backend/app/routers/scan.py` — Enhanced asset recognition
  - `frontend/src/components/scan/AssetScanner.jsx` — Enhanced UI with batch support

---

## 📊 Implementation Order

| Phase | Feature | Est. Time |
|-------|---------|-----------|
| Phase 1 | RBAC Backend + Frontend | 2-3 hours |
| Phase 2 | Chatbot Backend + Frontend | 2-3 hours |
| Phase 3 | Voice Recognition | 2-3 hours |
| Phase 4 | Image Recognition Enhancement | 1-2 hours |

---

## 🔗 Dependencies

- **Groq API Key** — Required for chatbot and voice intent parsing
- **Supabase** — Required for RBAC role storage and user management
- **Web Speech API** — Browser-native, no additional dependencies
- **Web Speech API** — Browser-native, no additional dependencies
