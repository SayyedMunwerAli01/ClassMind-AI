# 🧠 ClassMind AI

> **⚠️ IMPORTANT LEGAL NOTICE — READ BEFORE ACCESSING**
> 
> Copyright (c) 2026 ClassMind AI - Made by Sayed Munawer Ali Shah. All Rights Reserved.
> 
> This source code and associated documentation (the "Software") are submitted for evaluation as part of Alibaba Cloud AI Hackathon Pakistan 2026, delivered in Pakistan by Bano Qabil. No permission is granted to any person to use, copy, modify, merge, publish, distribute, sublicense, or sell copies of the Software, in whole or in part, for any purpose, without the express written permission of the copyright holder.
> 
> This repository has been made publicly accessible solely to satisfy the submission and judging requirements of Alibaba Cloud AI Hackathon Pakistan 2026, delivered in Pakistan by Bano Qabil. Public visibility of this repository does not constitute a license grant or waiver of any rights.
> 
> THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
> 
> By viewing this repository, you agree to these terms. See the [LICENSE](./LICENSE) file for full details.

---

## 📖 Overview

**ClassMind AI** is a smart study platform built for universities. It solves one critical problem: students cannot write notes as fast as the teacher speaks, causing them to miss important points in every single class.

The teacher records the lecture inside the app. **Groq Whisper** converts audio to text in real-time, and **Google Gemini** transforms that transcript into clean, structured notes in **both English and Urdu**. After class, students access the notes on their phones, take auto-generated quizzes, view visual mind maps, and ask an AI tutor that answers *only* from that specific lecture—ensuring zero hallucinations.

The entire system is production-ready, built with **React, TypeScript, Tailwind CSS, and Supabase**, running entirely on free tiers.

---

## ✨ Key Features

- **Real-Time Transcription** – Audio is split into 15-second chunks and transcribed live using Groq Whisper.
- **Bilingual Notes** – Gemini generates comprehensive notes in English and Urdu simultaneously.
- **AI Tutor & Quiz** – Students can chat with a context-aware AI tutor and test themselves with auto-generated MCQs.
- **Mind Map Generator** – Automatically visualises key topics and their relationships.
- **Offline Resilience** – Audio chunks are queued in `localStorage` when the internet drops and automatically uploaded when connectivity returns. No data is ever lost.
- **Background Recording** – A Web Worker keeps the segment timer running even if the teacher switches browser tabs.
- **Wake Lock API** – Prevents the device screen from sleeping during live lectures.
- **Smart Inactivity Logout** – Auto-logs out after 15 minutes of inactivity, but **intelligently pauses** while recording is active.
- **Complete Admin Portal** – Manage user approvals, subjects (CRUD), student enrollment (single or by entire year-part), teacher assignments, weekly timetables, and a live classroom monitor.
- **Role-Based Dashboards** – Separate, fully functional dashboards for Students, Teachers, and Admins.

---

## 🛠 Tech Stack

| Category | Technology |
| :--- | :--- |
| **Frontend** | React 18, TypeScript, Vite, Tailwind CSS |
| **Backend / Auth** | Supabase (PostgreSQL, Row Level Security, Authentication) |
| **AI / ML** | Groq Whisper (Speech-to-Text), Google Gemini (Notes, Quiz, Tutor, Mindmap) |
| **Serverless** | Supabase Edge Functions |
| **Deployment** | Vercel (Free Tier) |

---

## 🚀 How to Run Locally (For Judges & Developers)

Follow these steps to get the app running on your machine:

### 1. Clone the Repository
```bash
git clone https://github.com/your-team/your-project.git
cd your-project
2. Install Dependencies
bash
npm install
3. Set Up Environment Variables
Create a .env file in the root directory and add the following keys (you must have your own Supabase, Groq, and Gemini accounts):

env
VITE_SUPABASE_URL=your_supabase_project_url
VITE_SUPABASE_ANON_KEY=your_supabase_anon_key
GROQ_API_KEY=your_groq_api_key
GEMINI_API_KEY=your_google_gemini_api_key
Security Note: Never commit the .env file. It is already ignored via .gitignore.

4. Run the Development Server
bash
npm run dev
The app will be available at http://localhost:3000.

5. Build for Production (Pre-Presentation Check)
bash
npm run build
Ensure this completes with no errors.

🔐 Test Credentials
To quickly test the admin portal:

Email: admin@classmind.com

Password: admin123

(Students and Teachers can register via the sign-up page; their accounts must be approved by the admin.)

🧩 Project Structure (High-Level)
/src/pages – All page views (Landing, Login, Student/Teacher/Admin Dashboards).

/src/components – Reusable UI components (AudioRecorder, AITutorChat, MindMapView).

/src/hooks – Custom React hooks for authentication, role guards, and inactivity logout.

/src/workers – Web Worker for maintaining the 15-second recording timer in background tabs.

/supabase/functions – Edge Functions for processing audio chunks, generating question papers, and powering the AI tutor.

👨‍💻 Author
Sayed Munawer Ali Shah
ClassMind AI o.

📜 License
All Rights Reserved.
This project is submitted for the Alibaba Cloud AI Hackathon Pakistan 2026, delivered by Bano Qabil. No permission is granted to use, copy, modify, or distribute this software without explicit written permission from the copyright holder.
