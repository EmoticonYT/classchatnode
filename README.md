# 💬 ClassChat Framework 4.0 Plus

**ClassChat** is an open-source, extensible communication and community framework built for schools, student organizations, and educational networks. Designed for high performance, easy customization, and self-hosted deployments, the ClassChat Framework provides a turnkey foundation for real-time messaging, Discord-style community servers, WebRTC calling, and comprehensive school-level moderation.

---

## 🏗️ Architecture & Framework Modules

### 🏰 1. ClassChat Plus Community Engine
* **Self-Hosted Community Servers:** Full server creation framework supporting custom icons, cover banners, and privacy controls (discoverable public communities or invite-only).
* **Topic Channel Router:** Hierarchical channel routing system (`#general`, `#homework-help`, `#announcements`, etc.) per server.
* **WebSocket Real-Time Messaging Core:** Low-latency event-driven engine powering instant message delivery, live typing bubbles, and dynamic emoji reactions.
* **Content Persistence & Organization:** In-channel keyword search engine, pinned message drawer with jump-to-target scrolling, and in-place message editing.
* **Role & Member Mini-Profiles:** Extensible permissions framework (Server Owner, Admin, Member) and member mini-card modals with presence detection and direct communication shortcuts.
* **Universal Invitation System:** Dynamic Discord-style invite landing pages (`/plus/invite/:code`) with metadata preview cards and one-click onboarding.

### 📱 2. Social & School Collaboration Suite
* **Subject-Segmented Feed:** Class filtering pipeline (Math, Science, English, History, Electives) with rich media and image attachment support.
* **1-on-1 Direct Messaging:** Private messaging module featuring real-time typing indicators, unread activity badges, and read receipts.
* **WebRTC Voice & Video:** Peer-to-peer audio and video calling subsystem integrated directly in-browser.
* **Campus Chatrooms:** Lightweight real-time discussion rooms for broader school interactions.
* **RGB Theming Engine:** Dynamic CSS custom properties generator allowing users to configure platform accent colors via interactive RGB sliders or preset palettes.
* **Identity & Profiles:** Custom avatars, bio markdown, and class schedule displays.

### 🛡️ 3. Safety, Moderation & Administration Framework
* **Moderator Audit Log:** Tamper-evident administrative audit logging tracking staff interventions (timeouts, bans, user edits, server moderation).
* **Sanctions & Automated Appeals:** User timeout mechanisms paired with live countdowns and integrated appeal ticket workflows.
* **Help Desk & Ticketing:** Multi-tier support ticketing system with priority escalation.
* **Feature Flagging System:** Decoupled runtime toggles (`feature_flags.txt`) enabling seamless activation/deactivation of modules (Plus, chatrooms, etc.) without downtime.

---

## 🚀 Getting Started

> [!NOTE]
> Ensure you have **Node.js (v18+)** and **Git** installed on your host system.

### Installation

1. **Clone the repository:**
   ```bash
   git clone https://github.com/emoticonyt/classchatnode.git
   cd classchatnode
   ```

2. **Install dependencies:**
   ```bash
   npm install
   ```

3. **Configure Environment & Flags:**
   Adjust runtime capabilities in `feature_flags.txt` and set custom ports or secrets via environment variables:
   ```bash
   export PORT=5000
   export SESSION_SECRET="your-secure-session-secret"
   ```

4. **Launch the Framework:**
   ```bash
   node server.js
   ```
   Or manage with a process manager like `pm2`:
   ```bash
   pm2 start server.js --name classchat
   ```

5. **Access the Instance:**
   Navigate to `http://localhost:5000` (or your configured port).

---

## 🛠️ Customization & Extending the Framework

* **Templates & Views:** Modular EJS templates in [`views/`](views/) structured into `views/plus/`, `views/staff/`, and `views/support/`.
* **Styling System:** Modern CSS design tokens located in [`public/css/style.css`](public/css/style.css) and [`public/css/plus.css`](public/css/plus.css).
* **Database Layer:** Atomic SQLite operations powered by `better-sqlite3` in [`db.js`](db.js), supporting automatic schema initialization and migrations.
