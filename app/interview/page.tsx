"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Mic, Video, MicOff, AlertCircle, Loader2, Eye, EyeOff, Volume2, VolumeX, MessageSquare, Brain, Clock, ChevronDown, ChevronUp, Flag, Target, Bug } from "lucide-react";
import { QAExchange, ScreenAnalysis, ActivityEvent, InterviewPhase } from "@/types";

// Type definitions for Web Speech API
declare global {
  interface Window {
    SpeechRecognition: any;
    webkitSpeechRecognition: any;
  }
}

const SILENCE_MS = 1500;
const STT_START_DELAY_MS = 400;
const MAX_LISTEN_MS = 45000;
const CHECK_INTERVAL_MS = 300;

export default function InterviewPage() {
  const router = useRouter();

  // Core state
  const [status, setStatus] = useState<"idle" | "requesting_permissions" | "interviewing" | "ending">("idle");
  const [phase, setPhase] = useState<InterviewPhase>("intro");
  const [errorMsg, setErrorMsg] = useState("");
  const [sttSupported, setSttSupported] = useState<boolean>(true);
  
  // Data state
  const [apiKey, setApiKey] = useState("");
  const [projectContext, setProjectContext] = useState("");
  
  // Interview state
  const [currentQuestion, setCurrentQuestion] = useState<{ question: string; expected_points?: string[]; rationale?: string } | null>(null);
  const [history, setHistory] = useState<QAExchange[]>([]);
  const [screenAnalyses, setScreenAnalyses] = useState<ScreenAnalysis[]>([]);
  const [targetQuestions, setTargetQuestions] = useState(5);
  const [activityLog, setActivityLog] = useState<ActivityEvent[]>([]);
  
  // UX state
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isGeneratingNext, setIsGeneratingNext] = useState(false);
  const [showReasoning, setShowReasoning] = useState(false);
  
  // Modals & transient errors
  const [showEndConfirm, setShowEndConfirm] = useState(false);
  const [showScreenStopModal, setShowScreenStopModal] = useState(false);
  const [showTargetReachedModal, setShowTargetReachedModal] = useState(false);
  const [sttError, setSttError] = useState("");
  
  // TTS State
  const [ttsEnabled, setTtsEnabled] = useState(true);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);

  // STT & VAD State
  const [isListening, setIsListening] = useState(false);
  const [transcript, setTranscript] = useState("");
  
  // Debug State
  const [showDebug, setShowDebug] = useState(false);
  const [debugEvents, setDebugEvents] = useState<{time: number, event: string}[]>([]);

  // Refs
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const recognitionRef = useRef<any>(null);
  const screenStreamRef = useRef<MediaStream | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const captureIntervalRef = useRef<NodeJS.Timeout | null>(null);
  
  // VAD refs
  const lastSpeechTimestampRef = useRef<number>(0);
  const accumulatedTranscriptRef = useRef<string>("");
  const listenStartTimeRef = useRef<number>(0);
  const silenceCheckIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const startDelayTimerRef = useRef<NodeJS.Timeout | null>(null);
  
  const transcriptRef = useRef("");
  const isListeningRef = useRef(false);
  const isSpeakingRef = useRef(false);
  
  const historyLenRef = useRef(0);
  const latestScreenContextRef = useRef<string>("");
  const phaseRef = useRef<InterviewPhase>("intro");

  useEffect(() => { historyLenRef.current = history.length; }, [history]);
  useEffect(() => { transcriptRef.current = transcript; }, [transcript]);
  useEffect(() => { isListeningRef.current = isListening; }, [isListening]);
  useEffect(() => { phaseRef.current = phase; }, [phase]);
  useEffect(() => { isSpeakingRef.current = isSpeaking; }, [isSpeaking]);

  // Load context on mount
  useEffect(() => {
    document.title = "Interview in Progress | AI Interviewer";
    const key = sessionStorage.getItem("gemini_api_key");
    const ctx = sessionStorage.getItem("project_context") || "";
    const targetQ = sessionStorage.getItem("target_questions");
    
    if (!key) {
      router.push("/");
      return;
    }
    
    setApiKey(key);
    setProjectContext(ctx);
    if (targetQ) setTargetQuestions(Number(targetQ));

    // Check Speech Recognition support
    if (typeof window !== "undefined") {
      const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
      if (!SpeechRecognition) {
        setSttSupported(false);
      } else {
        if (!recognitionRef.current) {
          recognitionRef.current = new SpeechRecognition();
          recognitionRef.current.continuous = true;
          recognitionRef.current.interimResults = true;
          recognitionRef.current.lang = 'en-US';

          const logSpeech = (event: string, details?: any) => {
            const ts = new Date().toISOString().split('T')[1];
            console.log(`[SPEECH ${ts}] ${event}`, details || "");
            setDebugEvents(prev => [{time: Date.now(), event: `SPEECH: ${event}`}, ...prev].slice(0, 5));
          };

          recognitionRef.current.onstart = () => {
            logSpeech('onstart fired');
          };

          recognitionRef.current.onresult = (event: any) => {
            let combined = "";
            let latestIsFinal = false;
            for (let i = 0; i < event.results.length; ++i) {
               combined += event.results[i][0].transcript;
               if (i === event.results.length - 1) {
                 latestIsFinal = event.results[i].isFinal;
               }
            }
            logSpeech('onresult fired', { transcript: combined, isFinal: latestIsFinal });

            accumulatedTranscriptRef.current = combined;
            setTranscript(combined);

            if (combined.trim().length > 0) {
              lastSpeechTimestampRef.current = Date.now();
            }
          };

          recognitionRef.current.onerror = (event: any) => {
            logSpeech(`onerror fired: ${event.error}`);
            if (event.error === 'no-speech' || event.error === 'network') {
              // Silently ignore in continuous mode. 
            } else if (event.error !== 'aborted') {
              console.error("Speech recognition error", event.error);
              setErrorMsg(`Microphone error: ${event.error}`);
            }
          };

          recognitionRef.current.onend = () => {
            logSpeech('onend fired');
            window.dispatchEvent(new Event('app-recognition-end'));
          };
        }
      }

      // Load TTS Voices
      const loadVoices = () => {
        setVoices(window.speechSynthesis.getVoices());
      };
      loadVoices();
      if (window.speechSynthesis.onvoiceschanged !== undefined) {
        window.speechSynthesis.onvoiceschanged = loadVoices;
      }
    }

    return () => {
      endInterviewCleanup();
    };
  }, [router]);

  const stopListening = useCallback(() => {
    if (silenceCheckIntervalRef.current) {
      clearInterval(silenceCheckIntervalRef.current);
      silenceCheckIntervalRef.current = null;
    }
    if (recognitionRef.current) {
      try {
        console.log(`[SPEECH ${new Date().toISOString().split('T')[1]}] recognition.stop() called`);
        recognitionRef.current.stop(); 
      } catch(e) {}
    }
    setIsListening(false);
  }, []);

  // Unified Answer Completion Handler
  const handleAnswerComplete = useCallback(async (answerText: string) => {
    if (!currentQuestion) return;

    setIsGeneratingNext(true);
    stopListening();
    
    const exchangeId = Math.random().toString(36).substring(7);
    
    const newExchange: QAExchange = {
      id: exchangeId,
      timestamp: Date.now(),
      question: currentQuestion.question,
      rationale: currentQuestion.rationale,
      answer: answerText,
      expected_points: currentQuestion.expected_points,
    };

    const newHistory = [...history, newExchange];
    setHistory(newHistory);
    setCurrentQuestion(null);
    setTranscript("");

    setActivityLog(prev => [...prev, { id: Date.now().toString() + Math.random(), type: 'answer', timestamp: Date.now(), content: answerText }]);

    if (newHistory.length >= targetQuestions) {
      setShowTargetReachedModal(true);
      setIsGeneratingNext(false);
      return;
    }

    if (phase === 'intro') {
      if (newHistory.length === 1) {
        const q = "Thanks! Now tell me about your project — what does it do and what problem does it solve?";
        setCurrentQuestion({ question: q, expected_points: ["Project purpose"], rationale: "Gathering context" });
        speak(q);
        setIsGeneratingNext(false);
        return;
      } else {
        setPhase('transition');
        const q = "Awesome, that gives me a good sense of it. Go ahead and click 'Share Screen' below so I can see what you've built.";
        setCurrentQuestion({ question: q, expected_points: [], rationale: "Transitioning" });
        speak(q);
        setIsGeneratingNext(false);
        return;
      }
    }

    if (phase === 'transition') {
      const q = "I'm ready when you are! Just click 'Share Screen' whenever you're set.";
      setCurrentQuestion({ question: q, expected_points: [], rationale: "Waiting for screen" });
      speak(q);
      setIsGeneratingNext(false);
      return;
    }

    await generateFollowUp(newHistory);
  }, [currentQuestion, history, phase, targetQuestions, stopListening]);

  const finalizeAnswer = useCallback((finalText: string) => {
    console.log(`[SPEECH ${new Date().toISOString().split('T')[1]}] finalizeAnswer called with: "${finalText}"`);
    stopListening();
    handleAnswerComplete(finalText);
  }, [handleAnswerComplete, stopListening]);

  const startListening = useCallback(() => {
    if (!sttSupported || !recognitionRef.current) return;
    try {
      accumulatedTranscriptRef.current = "";
      lastSpeechTimestampRef.current = Date.now();
      listenStartTimeRef.current = Date.now();
      
      console.log(`[SPEECH ${new Date().toISOString().split('T')[1]}] recognition.start() called`);
      recognitionRef.current.start();
      setIsListening(true);
      
      if (silenceCheckIntervalRef.current) clearInterval(silenceCheckIntervalRef.current);
      
      console.log(`[SPEECH ${new Date().toISOString().split('T')[1]}] Started silence interval`);
      silenceCheckIntervalRef.current = setInterval(() => {
        if (!isListeningRef.current) return;
        
        const now = Date.now();
        const silenceDuration = now - lastSpeechTimestampRef.current;
        const listenDuration = now - listenStartTimeRef.current;
        const words = accumulatedTranscriptRef.current.trim().split(/\s+/).length;
        
        if (silenceDuration > SILENCE_MS && words >= 2) {
          console.log(`[SPEECH ${new Date().toISOString().split('T')[1]}] Finalizing due to silence (${silenceDuration}ms, ${words} words)`);
          finalizeAnswer(accumulatedTranscriptRef.current);
        } else if (listenDuration > MAX_LISTEN_MS) {
          console.log(`[SPEECH ${new Date().toISOString().split('T')[1]}] Finalizing due to MAX_LISTEN_MS (${listenDuration}ms)`);
          finalizeAnswer(accumulatedTranscriptRef.current || "[No response detected]");
        }
      }, CHECK_INTERVAL_MS);
      
    } catch (e) {
      console.log(`[SPEECH ${new Date().toISOString().split('T')[1]}] start error`, e);
      setIsListening(true); // Might already be running
    }
  }, [sttSupported, finalizeAnswer]);

  // Handle continuous listening auto-start
  useEffect(() => {
    if (currentQuestion && !isGeneratingNext && !isSpeaking && !isListening && sttSupported && recognitionRef.current && phase !== 'transition') {
      if (startDelayTimerRef.current) clearTimeout(startDelayTimerRef.current);
      startDelayTimerRef.current = setTimeout(() => {
         if (!isSpeakingRef.current && !isListeningRef.current) {
           startListening();
         }
      }, STT_START_DELAY_MS);
    }
    return () => {
       if (startDelayTimerRef.current) clearTimeout(startDelayTimerRef.current);
    };
  }, [currentQuestion, isGeneratingNext, isSpeaking, isListening, sttSupported, phase, startListening]);

  // Strict Turn-Taking: Force mic OFF if AI is thinking or speaking
  useEffect(() => {
    if ((isGeneratingNext || isSpeaking) && isListening) {
      stopListening();
    }
  }, [isGeneratingNext, isSpeaking, isListening, stopListening]);

  // Handle custom events
  useEffect(() => {
    const handleRecEnd = () => {
      if (isListeningRef.current) {
        // Stopped unexpectedly while we thought we were listening
        console.log(`[SPEECH ${new Date().toISOString().split('T')[1]}] Auto-restarting due to unexpected onend`);
        try {
          recognitionRef.current.start();
        } catch(e) {}
      } else {
        setIsListening(false);
      }
    };

    window.addEventListener('app-recognition-end', handleRecEnd);
    return () => {
      window.removeEventListener('app-recognition-end', handleRecEnd);
    };
  }, []);


  const requestScreenShare = async () => {
    try {
      const screen = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
      screenStreamRef.current = screen;
      if (videoRef.current) videoRef.current.srcObject = screen;
      
      screen.getVideoTracks()[0].onended = () => {
        setShowScreenStopModal(true);
        if (captureIntervalRef.current) clearInterval(captureIntervalRef.current);
      };
      
      setPhase('walkthrough');
      startScreenAnalysisLoop();

      setIsGeneratingNext(true);
      setTimeout(async () => {
        const frameBase64 = captureFrame();
        if (frameBase64) {
          analyzeScreen();
        }
        await generateFollowUp(history, true);
      }, 1000);
      
    } catch (err) {
      setErrorMsg("Screen share failed. Please click 'Share Screen' to try again.");
    }
  };

  const endInterviewCleanup = useCallback(() => {
    if (captureIntervalRef.current) clearInterval(captureIntervalRef.current);
    if (silenceCheckIntervalRef.current) clearInterval(silenceCheckIntervalRef.current);
    if (startDelayTimerRef.current) clearTimeout(startDelayTimerRef.current);
    if (screenStreamRef.current) screenStreamRef.current.getTracks().forEach(t => t.stop());
    if (micStreamRef.current) micStreamRef.current.getTracks().forEach(t => t.stop());
    if (recognitionRef.current) {
        try { recognitionRef.current.stop(); } catch(e) {}
    }
    window.speechSynthesis.cancel();
  }, []);

  const fetchGeminiWithRetry = async (payload: any, retries = 1): Promise<any> => {
    try {
      const res = await fetch("/api/gemini", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error("HTTP " + res.status);
      return await res.json();
    } catch (err) {
      if (retries > 0) {
        console.warn("Gemini fetch failed, retrying...", err);
        await new Promise(r => setTimeout(r, 1000));
        return fetchGeminiWithRetry(payload, retries - 1);
      }
      throw err;
    }
  };

  const requestPermissionsAndStart = async () => {
    setStatus("requesting_permissions");
    setErrorMsg("");

    try {
      const mic = await navigator.mediaDevices.getUserMedia({ 
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        }, 
        video: false 
      });
      micStreamRef.current = mic;
      
      setStatus("interviewing");
      generateInitialQuestion();

    } catch (err: any) {
      console.error("Permission error:", err);
      setErrorMsg("Failed to access screen or microphone. Please allow permissions to continue.");
      setStatus("idle");
    }
  };

  const resumeScreenShare = async () => {
    setShowScreenStopModal(false);
    try {
      const screen = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
      screenStreamRef.current = screen;
      if (videoRef.current) videoRef.current.srcObject = screen;
      
      screen.getVideoTracks()[0].onended = () => {
        setShowScreenStopModal(true);
        if (captureIntervalRef.current) clearInterval(captureIntervalRef.current);
      };
      startScreenAnalysisLoop();
    } catch (err) {
      setErrorMsg("Failed to resume screen share.");
      setShowScreenStopModal(true); // Re-show if they cancelled
    }
  };

  const captureFrame = useCallback((): string | null => {
    if (!videoRef.current || !canvasRef.current) return null;
    const video = videoRef.current;
    const canvas = canvasRef.current;
    
    if (video.videoWidth === 0 || video.videoHeight === 0) return null;

    // Set canvas dimensions to match video, max 1024 width
    const scale = Math.min(1, 1024 / video.videoWidth);
    canvas.width = video.videoWidth * scale;
    canvas.height = video.videoHeight * scale;
    
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", 0.8);
  }, []);

  const analyzeScreen = useCallback(async () => {
    const frameBase64 = captureFrame();
    if (!frameBase64 || !apiKey) return;

    setIsAnalyzing(true);
    try {
      const data = await fetchGeminiWithRetry({
        apiKey,
        prompt: "Briefly describe what's currently visible on this screen (e.g. code, UI, slides). Keep it to 2-3 sentences. Focus on the main content. Return ONLY valid JSON in this format: { \"description\": \"your description\", \"contentType\": \"code\" | \"UI\" | \"slides\" | \"terminal\" | \"browser\" | \"unclear\" }",
        imageBase64: frameBase64,
      });

      let description = data.text;
      let contentType = "unclear";
      try {
        const jsonStr = data.text.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
        const parsed = JSON.parse(jsonStr);
        description = parsed.description || description;
        contentType = parsed.contentType || "unclear";
      } catch (e) {
        console.warn("Could not parse analyzeScreen JSON", e);
      }

      const analysis: ScreenAnalysis = {
        timestamp: Date.now(),
        visualContext: description,
        contentType: contentType,
      };
      
      setScreenAnalyses(prev => [...prev, analysis]);
      latestScreenContextRef.current = analysis.visualContext || "";

      setActivityLog(prev => [...prev, { id: Date.now().toString() + Math.random(), type: 'analysis', timestamp: Date.now(), content: description }]);
    } catch (err) {
      console.error("Screen analysis error:", err);
    } finally {
      setIsAnalyzing(false);
    }
  }, [apiKey, captureFrame]);

  const startScreenAnalysisLoop = useCallback(() => {
    // Then every 15s
    captureIntervalRef.current = setInterval(analyzeScreen, 15000);
  }, [analyzeScreen]);

  const speak = useCallback((text: string) => {
    if (!ttsEnabled || !("speechSynthesis" in window)) return;
    
    window.speechSynthesis.cancel(); // cancel any ongoing speech
    const utterance = new SpeechSynthesisUtterance(text);
    
    if (voices.length > 0) {
      // Prefer natural sounding English voices
      const preferred = voices.find(v => v.lang.startsWith('en') && (
        v.name.includes('Natural') || 
        v.name.includes('Google') || 
        v.name.includes('Premium') || 
        v.name.includes('Zira') || 
        v.name.includes('Samantha')
      ));
      if (preferred) {
        utterance.voice = preferred;
      } else {
        const eng = voices.find(v => v.lang.startsWith('en'));
        if (eng) utterance.voice = eng;
      }
    }
    
    // Slight tweak to sound less robotic
    utterance.rate = 1.05; 
    utterance.pitch = 1.0;

    utterance.onstart = () => setIsSpeaking(true);
    utterance.onend = () => setIsSpeaking(false);
    utterance.onerror = () => setIsSpeaking(false);
    
    window.speechSynthesis.speak(utterance);
  }, [ttsEnabled, voices]);

  const generateInitialQuestion = async () => {
    setIsGeneratingNext(true);
    setErrorMsg("");
    
    const q = "Hi! Before we get started, could you introduce yourself briefly?";
    setCurrentQuestion({ question: q, expected_points: ["Candidate's name", "Candidate background"], rationale: "Breaking the ice" });
    speak(q);
    setActivityLog(prev => [...prev, { id: Date.now().toString() + Math.random(), type: 'question', timestamp: Date.now(), content: q }]);
    
    setIsGeneratingNext(false);
  };

  const handleStartAnswering = () => {
    if (!sttSupported || !recognitionRef.current) return;
    
    window.speechSynthesis.cancel();
    setIsSpeaking(false);
    setTranscript("");
    setErrorMsg("");
    startListening();
  };

  const generateFollowUp = async (currentHistory: QAExchange[], justSharedScreen = false) => {
    setIsGeneratingNext(true);
    try {
      const recentContext = latestScreenContextRef.current || "No screen content detected yet.";
      
      let suggestNavigation = false;
      if (screenAnalyses.length >= 3) {
        const last3 = screenAnalyses.slice(-3).map(s => s.visualContext);
        if (last3[0] === last3[1] && last3[1] === last3[2]) {
          suggestNavigation = true;
        }
      }

      const prompt = `You are an expert technical interviewer having a real conversation.
Project Context: ${projectContext || "Not provided."}

Here is the conversation so far:
${currentHistory.slice(-3).map(h => `Q: ${h.question}\nA: ${h.answer}`).join("\n\n")}

Current screen context: ${recentContext}

Based on the candidate's last answer and the screen context, generate the NEXT question.

CRITICAL INSTRUCTIONS:
1. FIRST, briefly react to the candidate's previous answer in 1 short sentence (e.g. "Oh nice, using a queue for that makes sense.").
2. THEN, ask your next technical question. 
3. Combine your reaction and question into a SINGLE spoken response in the 'question' field.
4. Keep your entire response brief and conversational — 2-3 sentences maximum. Real interviewers don't monologue.
5. Vary your phrasing. Don't start every reaction with "That's interesting" or "Got it." Use natural variations ("Makes sense", "Oh I see", "Clever approach", etc.).
${justSharedScreen ? "6. The candidate JUST started sharing their screen. Acknowledge it and ask them to walk you through what's currently visible." : "6. Ask a specific question about what is visible on the screen or what they just said."}
${suggestNavigation ? "7. The candidate has been on the same screen for a while. explicitly ask them to navigate (e.g., 'Can you scroll down?' or 'Could you open the file where you handle X?')." : ""}

Return ONLY valid JSON in this format:
{
  "question": "your brief reaction AND your next question",
  "expected_points": ["point 1", "point 2"],
  "rationale": "reason for asking"
}`;

      const data = await fetchGeminiWithRetry({ apiKey, prompt });
      
      try {
        const jsonStr = data.text.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
        const parsed = JSON.parse(jsonStr);
        setCurrentQuestion({ question: parsed.question, expected_points: parsed.expected_points, rationale: parsed.rationale });
        speak(parsed.question);
        setActivityLog(prev => [...prev, { id: Date.now().toString() + Math.random(), type: 'question', timestamp: Date.now(), content: parsed.question }]);
      } catch (e) {
        console.error("JSON parse error:", e, "Raw text:", data.text);
        const q = "Could you tell me more about the technical challenges you faced here?";
        setCurrentQuestion({ question: q, expected_points: ["Challenge description", "Solution"], rationale: "Standard fallback follow-up." });
        speak(q);
        setActivityLog(prev => [...prev, { id: Date.now().toString() + Math.random(), type: 'question', timestamp: Date.now(), content: q }]);
      }

    } catch (err: any) {
      console.error(err);
      setErrorMsg("Failed to generate next question.");
      setCurrentQuestion({ question: "What else would you like to highlight about the project?", expected_points: [] });
    } finally {
      setIsGeneratingNext(false);
    }
  };

  const handleEndInterview = () => {
    setStatus("ending");
    endInterviewCleanup();
    
    sessionStorage.setItem("interview_history", JSON.stringify(history));
    sessionStorage.setItem("screen_analyses", JSON.stringify(screenAnalyses));
    
    router.push("/results");
  };

  const tryEndInterview = () => {
    if (history.length === 0) {
      setShowEndConfirm(true);
    } else {
      handleEndInterview();
    }
  };

  if (status === "idle") {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <div className="max-w-md w-full bg-card border border-border rounded-xl p-8 text-center space-y-6">
          <h2 className="text-2xl font-semibold tracking-tight">Ready to Start?</h2>
          <p className="text-muted-foreground">
            The interview requires access to your screen and microphone. Ensure your project is ready to present.
          </p>
          
          {!sttSupported && (
            <div className="p-4 bg-orange-500/10 border border-orange-500/20 text-orange-600 dark:text-orange-400 rounded-md text-sm text-left flex items-start gap-3">
              <AlertCircle className="w-5 h-5 shrink-0" />
              <p>Your browser does not support Speech Recognition. Please use Chrome or Edge for the best experience.</p>
            </div>
          )}

          {errorMsg && (
            <div className="p-3 bg-red-500/10 border border-red-500/20 text-red-600 dark:text-red-400 rounded-md text-sm text-left">
              {errorMsg}
            </div>
          )}

          <button
            onClick={requestPermissionsAndStart}
            className="w-full bg-primary text-primary-foreground hover:bg-primary/90 h-11 rounded-md font-medium flex items-center justify-center gap-2 transition-colors"
          >
            <Video className="w-4 h-4" />
            Grant Access & Start
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background flex flex-col animate-in fade-in duration-500">
      {/* Header */}
      <header className="border-b border-border bg-card/50 px-6 py-4 flex items-center justify-between sticky top-0 z-10 backdrop-blur-sm">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <div className="w-2.5 h-2.5 rounded-full bg-red-500 animate-pulse" />
            <span className="font-medium text-sm">Interview Live</span>
          </div>
          
          <div className="h-4 w-px bg-border" />
          
          <span className="text-sm font-medium text-muted-foreground hidden sm:inline-block">
            Question {history.length + (currentQuestion ? 1 : 0)} of {targetQuestions}
          </span>
          
          <div className="h-4 w-px bg-border hidden sm:block" />

          <button 
            onClick={() => {
              setTtsEnabled(!ttsEnabled);
              if (ttsEnabled) window.speechSynthesis.cancel();
            }}
            className="text-muted-foreground hover:text-foreground transition-colors flex items-center gap-2 text-sm"
          >
            {ttsEnabled ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4" />}
            {ttsEnabled ? "Voice On" : "Voice Off"}
          </button>
        </div>

        <div className="flex items-center gap-2">
          <button 
            onClick={() => setShowDebug(!showDebug)}
            className={`p-2 rounded-md transition-colors ${showDebug ? "bg-muted text-foreground" : "text-muted-foreground hover:bg-muted"}`}
            title="Toggle Debug Panel"
          >
            <Bug className="w-4 h-4" />
          </button>
          <button
            onClick={tryEndInterview}
            className="bg-destructive/10 text-destructive hover:bg-destructive/20 px-4 py-2 rounded-md text-sm font-medium transition-colors"
          >
            End Interview
          </button>
        </div>
      </header>

      {/* Main Content */}
      <div className="flex-1 w-full max-w-7xl mx-auto flex flex-col lg:flex-row">
        {/* Main Center Area */}
        <main className="flex-1 p-6 flex flex-col gap-8 relative">
        
        {/* Error Banner */}
        {errorMsg && (
          <div className="p-4 bg-red-500/10 border border-red-500/20 text-red-600 dark:text-red-400 rounded-md text-sm flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <p>{errorMsg}</p>
          </div>
        )}

        {/* Current Question Area */}
        <div className="flex-1 flex flex-col items-center justify-center text-center space-y-8 min-h-[40vh] relative">
          
          {currentQuestion && !isGeneratingNext && (
             <div className="absolute top-0 right-0 max-w-sm text-left hidden sm:block z-10">
               <button 
                 onClick={() => setShowReasoning(!showReasoning)}
                 className="flex items-center gap-2 text-xs font-medium bg-muted hover:bg-muted/80 text-muted-foreground px-3 py-1.5 rounded-full transition-colors ml-auto"
               >
                 <Brain className="w-3.5 h-3.5" />
                 AI Reasoning
                 {showReasoning ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
               </button>
               {showReasoning && (
                 <div className="mt-2 p-4 bg-card border border-border shadow-lg rounded-xl text-sm space-y-3 animate-in slide-in-from-top-2 w-72">
                   <div>
                     <span className="text-[10px] font-semibold uppercase text-muted-foreground mb-1 block">Visual Context</span>
                     <p className="text-muted-foreground leading-relaxed line-clamp-2 text-xs">
                       {screenAnalyses.length > 0 ? screenAnalyses[screenAnalyses.length - 1].visualContext : "None"}
                     </p>
                   </div>
                   <div>
                     <span className="text-[10px] font-semibold uppercase text-muted-foreground mb-1 block">Why this question?</span>
                     <p className="text-muted-foreground leading-relaxed text-xs">
                       {currentQuestion.rationale || "Following up based on the presentation flow."}
                     </p>
                   </div>
                 </div>
               )}
             </div>
          )}

          {isGeneratingNext ? (
            <div className="flex flex-col items-center gap-4 text-muted-foreground">
              <Loader2 className="w-8 h-8 animate-spin text-primary" />
              <p>AI is thinking...</p>
            </div>
          ) : currentQuestion ? (
            <div className="space-y-6 max-w-3xl">
              <div className="flex items-center justify-center gap-2 text-primary text-sm font-medium mb-4 h-6">
                {isSpeaking ? (
                   <span className="flex items-center gap-2 bg-primary/10 text-primary px-3 py-1 rounded-full animate-pulse">
                     <Volume2 className="w-4 h-4" /> Speaking...
                   </span>
                ) : (
                   <MessageSquare className="w-5 h-5 opacity-50" />
                )}
              </div>
              <h2 className="text-3xl sm:text-4xl font-semibold tracking-tight leading-tight">
                {currentQuestion.question}
              </h2>
            </div>
          ) : null}
        </div>

        {/* Share Screen Button for Transition Phase */}
        {phase === 'transition' && !isGeneratingNext && (
          <div className="flex flex-col items-center gap-6 pb-12">
            <button
              onClick={requestScreenShare}
              className="px-8 py-4 bg-primary text-primary-foreground hover:bg-primary/90 rounded-full text-lg font-semibold flex items-center gap-3 shadow-lg transition-transform hover:scale-105"
            >
              <Video className="w-6 h-6" />
              Share Screen to Continue
            </button>
          </div>
        )}

        {/* Answer Capture Area */}
        {phase !== 'transition' && currentQuestion && !isGeneratingNext && (
          <div className="flex flex-col items-center gap-6 pb-12 w-full max-w-2xl mx-auto">
            <div className="w-full bg-muted/50 rounded-lg p-6 min-h-[120px] flex flex-col border border-border">
              {transcript ? (
                <p className="text-lg text-foreground">{transcript}</p>
              ) : (
                <div className="text-center my-auto flex flex-col items-center gap-2">
                  <p className="text-muted-foreground">
                    {isListening ? "Listening..." : "Your answer will appear here..."}
                  </p>
                  {sttError && (
                    <span className="text-xs font-medium text-orange-500 bg-orange-500/10 px-2 py-1 rounded animate-in fade-in zoom-in">
                      {sttError}
                    </span>
                  )}
                </div>
              )}
            </div>

            <div className="flex items-center justify-center">
              <div
                className={`
                  w-16 h-16 rounded-full flex flex-col items-center justify-center gap-1 transition-all select-none
                  ${isListening 
                    ? transcript.trim().length > 0
                      ? "bg-red-500 text-white shadow-[0_0_20px_rgba(239,68,68,0.5)] animate-pulse" 
                      : "bg-red-500/90 text-white"
                    : "bg-muted text-muted-foreground"}
                  ${!sttSupported && "opacity-50 cursor-not-allowed"}
                `}
              >
                {isListening ? <Mic className="w-6 h-6" /> : <MicOff className="w-6 h-6 opacity-70" />}
              </div>
            </div>
          </div>
        )}

        {/* History Accordion (Simple) */}
        {history.length > 0 && (
          <div className="mt-8 border border-border rounded-xl bg-card overflow-hidden">
            <div className="px-6 py-4 bg-muted/30 border-b border-border flex items-center gap-2">
              <MessageSquare className="w-4 h-4 text-muted-foreground" />
              <h3 className="font-medium text-sm">Conversation History</h3>
              <span className="ml-auto text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded-full">
                {history.length}
              </span>
            </div>
            <div className="max-h-64 overflow-y-auto p-6 space-y-6">
              {history.map((item, i) => (
                <div key={item.id} className="space-y-2">
                  <p className="font-medium text-sm text-primary">Q: {item.question}</p>
                  <p className="text-sm text-muted-foreground bg-muted/50 p-3 rounded-md">
                    {item.answer}
                  </p>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Debug Panel */}
        {showDebug && (
          <div className="absolute bottom-6 left-6 w-72 bg-black/80 backdrop-blur-md text-white border border-white/20 rounded-lg p-4 z-50 text-xs font-mono shadow-2xl">
            <div className="flex justify-between items-center mb-2 pb-2 border-b border-white/20">
              <span className="font-bold flex items-center gap-1.5"><Bug className="w-3.5 h-3.5 text-green-400" /> DEBUG PANEL</span>
              <button onClick={() => setShowDebug(false)} className="text-white/50 hover:text-white">✕</button>
            </div>
            <div className="space-y-2">
              <div className="flex justify-between">
                <span className="text-white/50">Phase:</span>
                <span className="text-blue-300">{phase}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-white/50">Listening:</span>
                <span className={isListening ? "text-red-400 font-bold" : "text-white/50"}>{isListening ? "TRUE" : "FALSE"}</span>
              </div>
              <div className="flex flex-col">
                <span className="text-white/50 mb-1">Transcript Preview:</span>
                <span className="truncate bg-white/10 px-1.5 py-0.5 rounded text-white/80">
                  {transcript ? `"${transcript}"` : "(empty)"}
                </span>
              </div>
              <div className="flex flex-col">
                <span className="text-white/50 mb-1 mt-1">Recent Events:</span>
                <div className="space-y-1">
                  {debugEvents.map((e, i) => (
                    <div key={i} className="flex items-center gap-2 text-[10px]">
                      <span className="text-white/30">{new Date(e.time).toLocaleTimeString()}</span>
                      <span className="text-yellow-300">{e.event}</span>
                    </div>
                  ))}
                  {debugEvents.length === 0 && <span className="text-white/30 text-[10px]">No events yet</span>}
                </div>
              </div>
            </div>
          </div>
        )}
        </main>

        {/* Sidebar: Timeline */}
        <aside className="w-full lg:w-80 border-l border-border bg-card/30 p-6 flex-col hidden lg:flex">
          <div className="flex items-center gap-2 mb-6 shrink-0">
            <Clock className="w-4 h-4 text-primary" />
            <h3 className="font-semibold tracking-tight text-sm uppercase">Activity Log</h3>
          </div>
          <div className="flex-1 overflow-y-auto pr-2 space-y-4">
            {activityLog.map((log) => (
               <div key={log.id} className="flex gap-3">
                 <div className="flex flex-col items-center mt-1">
                   <div className={`w-2 h-2 rounded-full shrink-0 ${
                      log.type === 'question' ? 'bg-blue-500' : 
                      log.type === 'answer' ? 'bg-green-500' : 
                      'bg-muted-foreground'
                   }`} />
                   <div className="w-px h-full bg-border mt-1" />
                 </div>
                 <div className="pb-4 flex-1">
                   <span className="text-[10px] text-muted-foreground uppercase tracking-wider font-medium">{log.type}</span>
                   <p className="text-sm mt-0.5 line-clamp-3 text-foreground/80">{log.content}</p>
                 </div>
               </div>
            ))}
          </div>
        </aside>
      </div>

      {/* Floating Elements: Screen Preview & Analysis Indicator */}
      <div className="fixed bottom-6 right-6 flex flex-col items-end gap-4 pointer-events-none z-40">
        
        {/* Analysis Status */}
        <div className="bg-card/90 backdrop-blur border border-border shadow-lg rounded-lg p-3 w-64 pointer-events-auto">
          <div className="flex items-center gap-2 mb-2">
            {isAnalyzing ? (
              <Eye className="w-4 h-4 text-primary animate-pulse" />
            ) : (
              <EyeOff className="w-4 h-4 text-muted-foreground" />
            )}
            <span className="text-xs font-medium">
              {isAnalyzing ? "Analyzing screen..." : "Vision active"}
            </span>
          </div>
          {screenAnalyses.length > 0 ? (
            <p className="text-[10px] text-muted-foreground line-clamp-2 leading-relaxed">
              Latest context: {screenAnalyses[screenAnalyses.length - 1].visualContext}
            </p>
          ) : (
            <p className="text-[10px] text-muted-foreground">Waiting for analysis...</p>
          )}
        </div>

        {/* Screen Preview */}
        <div className="w-60 aspect-video bg-black rounded-lg overflow-hidden border-2 border-border shadow-xl relative pointer-events-auto">
          <video 
            ref={videoRef} 
            autoPlay 
            playsInline 
            muted 
            className="w-full h-full object-cover"
          />
          <div className="absolute top-2 left-2 flex gap-2">
            <div className="bg-black/60 backdrop-blur-sm px-2 py-1 rounded text-[10px] font-medium text-white flex items-center gap-1.5 shadow-sm">
              <Video className="w-3 h-3" />
              Live Preview
            </div>
            {screenAnalyses.length > 0 && screenAnalyses[screenAnalyses.length - 1].contentType && screenAnalyses[screenAnalyses.length - 1].contentType !== "unclear" && (
              <div className="bg-primary/90 backdrop-blur-sm px-2 py-1 rounded text-[10px] font-medium text-primary-foreground flex items-center gap-1.5 shadow-sm">
                <Flag className="w-3 h-3" />
                {screenAnalyses[screenAnalyses.length - 1].contentType}
              </div>
            )}
          </div>
        </div>
      </div>

      <canvas ref={canvasRef} className="hidden" />

      {/* Modals */}
      {showEndConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-200">
          <div className="bg-card w-full max-w-sm rounded-xl p-6 shadow-xl border border-border flex flex-col gap-4 animate-in zoom-in-95 duration-200">
            <h3 className="text-xl font-semibold tracking-tight">End without answering?</h3>
            <p className="text-sm text-muted-foreground">
              You haven't answered any questions yet. The results page requires at least one answer to be meaningful.
            </p>
            <div className="flex gap-3 justify-end mt-2">
              <button onClick={() => setShowEndConfirm(false)} className="px-4 py-2 rounded-md text-sm font-medium hover:bg-muted transition-colors">
                Cancel
              </button>
              <button onClick={handleEndInterview} className="px-4 py-2 bg-destructive text-destructive-foreground hover:bg-destructive/90 rounded-md text-sm font-medium transition-colors">
                End Anyway
              </button>
            </div>
          </div>
        </div>
      )}

      {showScreenStopModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-200">
          <div className="bg-card w-full max-w-sm rounded-xl p-6 shadow-xl border border-border flex flex-col gap-4 animate-in zoom-in-95 duration-200">
            <div className="flex items-center gap-2 text-orange-500">
              <AlertCircle className="w-5 h-5" />
              <h3 className="text-xl font-semibold tracking-tight text-foreground">Screen Share Stopped</h3>
            </div>
            <p className="text-sm text-muted-foreground">
              Your screen share was stopped. The AI needs to see your project to continue asking relevant questions.
            </p>
            <div className="flex gap-3 flex-col mt-2">
              <button onClick={resumeScreenShare} className="w-full px-4 py-2 bg-primary text-primary-foreground hover:bg-primary/90 rounded-md text-sm font-medium transition-colors flex items-center justify-center gap-2">
                <Video className="w-4 h-4" />
                Resume Screen Share
              </button>
              <button onClick={handleEndInterview} className="w-full px-4 py-2 bg-muted hover:bg-muted/80 text-foreground rounded-md text-sm font-medium transition-colors">
                End Interview Now
              </button>
            </div>
          </div>
        </div>
      )}

      {showTargetReachedModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-200">
          <div className="bg-card w-full max-w-sm rounded-xl p-6 shadow-xl border border-border flex flex-col gap-4 animate-in zoom-in-95 duration-200">
            <div className="flex items-center gap-2 text-primary">
              <Target className="w-5 h-5" />
              <h3 className="text-xl font-semibold tracking-tight text-foreground">Target Reached</h3>
            </div>
            <p className="text-sm text-muted-foreground">
              You've completed the target of ${targetQuestions} questions. Do you want to finish the interview and see your results, or continue for one more question?
            </p>
            <div className="flex gap-3 flex-col mt-2">
              <button 
                onClick={handleEndInterview} 
                className="w-full px-4 py-2 bg-primary text-primary-foreground hover:bg-primary/90 rounded-md text-sm font-medium transition-colors"
              >
                Finish & See Results
              </button>
              <button 
                onClick={() => {
                  setShowTargetReachedModal(false);
                  setTargetQuestions(prev => prev + 1);
                  generateFollowUp(history);
                }} 
                className="w-full px-4 py-2 bg-muted hover:bg-muted/80 text-foreground rounded-md text-sm font-medium transition-colors"
              >
                Ask One More
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
