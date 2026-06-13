# AI Interviewer for Project Presentations

An adaptive AI-driven application designed to conduct live, automated interviews for technical project presentations. Built with Next.js, this tool leverages Gemini's multimodal capabilities (vision + language) alongside native browser APIs to evaluate a candidate's project in real-time.

## Features

- **Client-Provided API Key**: Secure, session-based storage of your Gemini API key. No backend database required.
- **Multimodal Understanding**: Captures 15-second interval screenshots of your screen share to provide Gemini with ongoing visual context of your presentation.
- **Voice Interaction**: Uses the browser's native Web Speech API (Speech-to-Text) for candidate answers and Text-to-Speech (TTS) for the interviewer's voice.
- **Adaptive Q&A**: Generates dynamic follow-up questions based on the candidate's previous answer and the current state of their screen.
- **Rubric-Based Evaluation**: At the end of the interview, the entire conversation history and visual context are evaluated against a structured technical rubric (Technical Depth, Clarity, Originality, Understanding).
- **Comprehensive Results**: Generates a detailed score breakdown, per-question feedback, and an actionable summary (Strengths, Improvements, Suggestions) that can be downloaded as Markdown or printed as PDF.

## Tech Stack

- **Framework**: [Next.js 14+](https://nextjs.org/) (App Router)
- **Language**: TypeScript
- **Styling**: Tailwind CSS, lucide-react (icons)
- **AI Integration**: Google Gemini API (`gemini-2.5-flash`) via API routes
- **Browser APIs**: `MediaDevices.getDisplayMedia` (Screen share), `MediaDevices.getUserMedia` (Mic), `SpeechRecognition`, `speechSynthesis`

## Setup Instructions

1. **Clone the repository** (if you haven't already).
2. **Install dependencies**:
   \`\`\`bash
   npm install
   \`\`\`
3. **Run the development server**:
   \`\`\`bash
   npm run dev
   \`\`\`
4. Open [http://localhost:3000](http://localhost:3000) in your browser.

## How to Use (Brief User Flow)

1. **Setup Phase**: Enter your Gemini API key and a brief description of the project you are presenting. You can test your microphone here.
2. **Interview Phase**: Click "Start Interview". You will be prompted to share a specific screen/window and grant microphone access.
3. **The Interview**: 
   - The AI will observe your screen and verbally ask an opening question.
   - Hold the microphone button to answer. Release when done.
   - The AI will generate follow-up questions adaptively.
4. **Conclusion**: Click "End Interview" when you are finished presenting. The AI will process the transcript and screen analysis to generate your final evaluation report.

## Browser Compatibility Note

**Google Chrome or Microsoft Edge are highly recommended.** 

The application relies on the experimental `SpeechRecognition` API (`webkitSpeechRecognition`) for capturing spoken answers. While Firefox and Safari have some implementations, Chrome and Edge currently provide the most stable and accurate experience for this feature.
