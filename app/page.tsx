"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { KeyRound, Video, Mic, ArrowRight, CheckCircle2, AlertCircle, Loader2, Info, FileText } from "lucide-react";

export default function SetupPage() {
  const router = useRouter();
  const [apiKey, setApiKey] = useState("");
  const [projectContext, setProjectContext] = useState("");
  const [isTestingKey, setIsTestingKey] = useState(false);
  const [testResult, setTestResult] = useState<{ status: "idle" | "success" | "error"; message: string }>({ status: "idle", message: "" });
  const [isStarting, setIsStarting] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");

  // Mic test state
  const [micTestStatus, setMicTestStatus] = useState<"idle" | "testing" | "success" | "error">("idle");
  const [audioLevel, setAudioLevel] = useState(0);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const animationFrameRef = useRef<number | null>(null);

  useEffect(() => {
    document.title = "Setup | AI Interviewer";
    const storedKey = sessionStorage.getItem("gemini_api_key");
    const storedContext = sessionStorage.getItem("project_context");
    if (storedKey) setApiKey(storedKey);
    if (storedContext) setProjectContext(storedContext);

    return () => {
      stopMicTest();
    };
  }, []);

  const handleTestKey = async () => {
    if (!apiKey.trim()) {
      setTestResult({ status: "error", message: "Please enter an API key first." });
      return;
    }

    setIsTestingKey(true);
    setTestResult({ status: "idle", message: "" });

    try {
      const res = await fetch("/api/gemini", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          apiKey,
          prompt: "Say hello in 5 words",
        }),
      });

      const data = await res.json();

      if (res.ok) {
        setTestResult({ status: "success", message: "Key verified successfully!" });
        sessionStorage.setItem("gemini_api_key", apiKey);
      } else {
        setTestResult({ status: "error", message: data.error || "Failed to verify key." });
      }
    } catch (err: any) {
      setTestResult({ status: "error", message: "Network error occurred." });
    } finally {
      setIsTestingKey(false);
    }
  };

  const startMicTest = async () => {
    setMicTestStatus("testing");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      micStreamRef.current = stream;
      
      const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
      const audioContext = new AudioContextClass();
      audioContextRef.current = audioContext;
      
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 256;
      analyserRef.current = analyser;
      
      const source = audioContext.createMediaStreamSource(stream);
      source.connect(analyser);
      
      const dataArray = new Uint8Array(analyser.frequencyBinCount);
      
      const updateLevel = () => {
        analyser.getByteFrequencyData(dataArray);
        const average = dataArray.reduce((acc, val) => acc + val, 0) / dataArray.length;
        setAudioLevel(average);
        animationFrameRef.current = requestAnimationFrame(updateLevel);
      };
      
      updateLevel();

      setTimeout(() => {
        stopMicTest();
        setMicTestStatus("success");
      }, 4000);

    } catch (err) {
      console.error(err);
      setMicTestStatus("error");
    }
  };

  const stopMicTest = () => {
    if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
    if (audioContextRef.current && audioContextRef.current.state !== "closed") {
      audioContextRef.current.close().catch(console.error);
    }
    if (micStreamRef.current) micStreamRef.current.getTracks().forEach(t => t.stop());
    setAudioLevel(0);
  };

  const handleStartInterview = async () => {
    setErrorMsg("");
    if (!apiKey.trim()) {
      setErrorMsg("Please enter your Gemini API key.");
      return;
    }

    setIsStarting(true);

    try {
      sessionStorage.setItem("gemini_api_key", apiKey);
      sessionStorage.setItem("project_context", projectContext);
      router.push("/interview");
    } catch (err: any) {
      console.error("Navigation error:", err);
      setErrorMsg("An error occurred: " + err.message);
      setIsStarting(false);
    }
  };

  return (
    <div className="min-h-screen bg-background text-foreground flex items-center justify-center p-4 sm:p-8 animate-in fade-in duration-500">
      <div className="max-w-5xl w-full grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
        
        {/* Left Column - Instructions */}
        <div className="lg:col-span-5 flex flex-col gap-6 order-2 lg:order-1">
          <div className="bg-muted/30 border border-border rounded-xl p-6">
            <h2 className="text-lg font-semibold flex items-center gap-2 mb-4">
              <Info className="h-5 w-5 text-primary" />
              How It Works
            </h2>
            <ol className="space-y-4 text-sm text-muted-foreground relative pl-2">
              <div className="absolute left-[15px] top-4 bottom-4 w-px bg-border -z-10" />
              {[
                "Share your screen and grant microphone access when prompted.",
                "The AI visually analyzes your screen and listens as you present your project.",
                "Answer dynamic follow-up questions generated in real-time.",
                "Get a detailed evaluation report based on a structured rubric."
              ].map((step, i) => (
                <li key={i} className="flex gap-4 items-start bg-muted/30 p-1 rounded">
                  <div className="w-6 h-6 rounded-full bg-background border border-border flex items-center justify-center shrink-0 font-medium text-xs text-foreground shadow-sm">
                    {i + 1}
                  </div>
                  <span className="pt-0.5">{step}</span>
                </li>
              ))}
            </ol>
          </div>

          {/* Pre-flight Checks */}
          <div className="bg-card border border-border rounded-xl p-6 space-y-4">
            <h3 className="font-medium text-sm text-muted-foreground uppercase tracking-wider">Pre-flight Checks</h3>
            
            {/* Mic Test */}
            <div className="flex flex-col gap-3">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium flex items-center gap-2">
                  <Mic className="h-4 w-4" /> Microphone
                </span>
                {micTestStatus === "idle" && (
                  <button onClick={startMicTest} className="text-xs text-primary hover:underline font-medium">Test Mic</button>
                )}
                {micTestStatus === "success" && (
                  <span className="text-xs text-green-500 font-medium flex items-center gap-1"><CheckCircle2 className="h-3 w-3"/> Working</span>
                )}
                {micTestStatus === "error" && (
                  <span className="text-xs text-red-500 font-medium">Permission Denied</span>
                )}
              </div>
              {micTestStatus === "testing" && (
                <div className="flex items-center gap-2 p-3 bg-muted/50 rounded-md border border-border">
                  <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
                    <div 
                      className="h-full bg-primary transition-all duration-75" 
                      style={{ width: `${Math.min(100, (audioLevel / 128) * 100)}%` }} 
                    />
                  </div>
                  <span className="text-xs text-muted-foreground whitespace-nowrap animate-pulse">Speak now...</span>
                </div>
              )}
            </div>

            {/* Screen Share Guide */}
            <div className="flex flex-col gap-2 pt-2 border-t border-border">
              <span className="text-sm font-medium flex items-center gap-2">
                <Video className="h-4 w-4" /> Screen Share
              </span>
              <p className="text-xs text-muted-foreground leading-relaxed">
                When you click "Start Interview", your browser will ask you to select a screen or window to share. Choose the one displaying your project code or UI.
              </p>
            </div>
          </div>
        </div>

        {/* Right Column - Form Container */}
        <div className="lg:col-span-7 flex flex-col gap-6 order-1 lg:order-2">
          <div className="flex flex-col gap-2">
            <h1 className="text-3xl sm:text-4xl font-bold tracking-tight text-foreground">
              AI Interviewer Setup
            </h1>
            <p className="text-muted-foreground text-lg">
              Configure your session to begin the live project evaluation.
            </p>
          </div>

          <div className="bg-card border border-border rounded-xl p-6 sm:p-8 shadow-sm flex flex-col gap-6">
            
            {/* API Key Section */}
            <div className="flex flex-col gap-3">
              <label htmlFor="api-key" className="text-sm font-medium">
                Gemini API Key
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-muted-foreground">
                  <KeyRound className="h-4 w-4" />
                </div>
                <input
                  id="api-key"
                  type="password"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder="AIzaSy..."
                  className="flex w-full rounded-md border border-input bg-background px-3 py-2.5 pl-10 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-not-allowed disabled:opacity-50 transition-shadow"
                />
              </div>
              <div className="flex items-center justify-between mt-1">
                <p className="text-xs text-muted-foreground">
                  Stored locally in your browser session.
                </p>
                <button
                  onClick={handleTestKey}
                  disabled={isTestingKey || !apiKey}
                  className="text-xs font-medium text-primary hover:underline disabled:opacity-50 flex items-center gap-1"
                >
                  {isTestingKey ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
                  Test API Key
                </button>
              </div>
              
              {testResult.status !== "idle" && (
                <div className={`flex items-center gap-2 text-sm p-3 rounded-md border ${
                  testResult.status === "success" 
                    ? "bg-green-50/50 border-green-200 text-green-700 dark:bg-green-950/20 dark:border-green-900/50 dark:text-green-400" 
                    : "bg-red-50/50 border-red-200 text-red-700 dark:bg-red-950/20 dark:border-red-900/50 dark:text-red-400"
                }`}>
                  {testResult.status === "success" ? <CheckCircle2 className="h-4 w-4" /> : <AlertCircle className="h-4 w-4" />}
                  <p>{testResult.message}</p>
                </div>
              )}
            </div>

            {/* Project Context Section */}
            <div className="flex flex-col gap-3">
              <label htmlFor="context" className="text-sm font-medium flex justify-between">
                <span>Project Context</span>
                <span className="text-muted-foreground font-normal">(Optional)</span>
              </label>
              <textarea
                id="context"
                value={projectContext}
                onChange={(e) => setProjectContext(e.target.value)}
                placeholder="e.g. A Next.js dashboard for managing remote teams. Built with Tailwind and Supabase..."
                className="flex min-h-[120px] w-full rounded-md border border-input bg-background px-3 py-3 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-not-allowed disabled:opacity-50 resize-y transition-shadow"
              />
            </div>

            {errorMsg && (
              <div className="flex items-start gap-2 text-sm p-3 rounded-md border bg-red-50/50 border-red-200 text-red-700 dark:bg-red-950/20 dark:border-red-900/50 dark:text-red-400">
                <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
                <p>{errorMsg}</p>
              </div>
            )}

            {/* Actions */}
            <div className="pt-4 mt-2 border-t border-border flex justify-end">
              <button
                onClick={handleStartInterview}
                disabled={isStarting}
                className="w-full sm:w-auto inline-flex items-center justify-center whitespace-nowrap rounded-md text-sm font-medium ring-offset-background transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 bg-primary text-primary-foreground hover:bg-primary/90 h-11 px-8 py-2 gap-2 shadow-sm"
              >
                {isStarting ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Preparing Setup...
                  </>
                ) : (
                  <>
                    Start Interview
                    <ArrowRight className="h-4 w-4" />
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
