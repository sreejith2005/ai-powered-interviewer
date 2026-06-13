"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { QAExchange, ScreenAnalysis, ScoreBreakdown } from "@/types";
import { RUBRIC } from "@/lib/rubric";
import { Loader2, AlertCircle, Download, FileText, ArrowLeft, CheckCircle2, XCircle } from "lucide-react";

const getScoreLabel = (score: number) => {
  if (score >= 90) return "Excellent";
  if (score >= 75) return "Strong";
  if (score >= 60) return "Good";
  if (score >= 45) return "Developing";
  return "Needs Work";
};

export default function ResultsPage() {
  const router = useRouter();

  const [status, setStatus] = useState<"loading" | "error" | "success">("loading");
  const [loadingStep, setLoadingStep] = useState(0);
  const [errorMsg, setErrorMsg] = useState("");
  const [result, setResult] = useState<ScoreBreakdown | null>(null);
  const [expandedQs, setExpandedQs] = useState<Record<number, boolean>>({});

  // Refs for data to avoid dependency issues in useEffect
  const interviewDataRef = useRef<{
    apiKey: string;
    context: string;
    history: QAExchange[];
    analyses: ScreenAnalysis[];
  } | null>(null);

  useEffect(() => {
    document.title = "Results | AI Interviewer";
    // Only run once on mount
    const loadData = () => {
      const apiKey = sessionStorage.getItem("gemini_api_key");
      const context = sessionStorage.getItem("project_context");
      const historyStr = sessionStorage.getItem("interview_history");
      const analysesStr = sessionStorage.getItem("screen_analyses");

      if (!historyStr || historyStr === "[]") {
        setErrorMsg("No interview data found.");
        setStatus("error");
        return;
      }

      try {
        const history: QAExchange[] = JSON.parse(historyStr);
        const analyses: ScreenAnalysis[] = analysesStr ? JSON.parse(analysesStr) : [];
        
        interviewDataRef.current = {
          apiKey: apiKey || "",
          context: context || "",
          history,
          analyses,
        };

        evaluateInterview();
      } catch (e) {
        console.error("Failed to parse session data", e);
        setErrorMsg("Failed to load interview data. It might be corrupted.");
        setStatus("error");
      }
    };

    loadData();
  }, []);

  const evaluateInterview = async () => {
    if (!interviewDataRef.current) return;
    
    const { apiKey, context, history, analyses } = interviewDataRef.current;
    
    if (!apiKey) {
      setErrorMsg("API key missing. Cannot evaluate.");
      setStatus("error");
      return;
    }

    setStatus("loading");
    setLoadingStep(0);
    setErrorMsg("");

    // Simulate loading steps for better UX
    const stepsInterval = setInterval(() => {
      setLoadingStep(prev => (prev < 2 ? prev + 1 : prev));
    }, 2500);

    try {
      const recentContexts = analyses.map(s => s.visualContext).join(" | ");
      
      const prompt = `You are an expert technical interviewer evaluating a candidate's project presentation.

Project Context: ${context || "Not provided."}

Here is the conversation history:
${history.map((h, i) => `Q${i+1}: ${h.question}\nExpected Points: ${h.expected_points?.join(", ") || "None"}\nCandidate A${i+1}: ${h.answer}`).join("\n\n")}

Here is a summary of what was shown on screen during the interview:
${recentContexts || "No screen analysis available."}

Evaluate the candidate based on this rubric:
${Object.entries(RUBRIC).map(([key, val]) => `- ${val.label} (Weight: ${val.weight}): ${val.description}`).join("\n")}

Return ONLY valid JSON with this exact shape (no markdown fences, just the raw JSON object):
{
  "overall_score": number (0-100),
  "breakdown": {
    "technical_depth": number (0-100),
    "clarity": number (0-100),
    "originality": number (0-100),
    "understanding": number (0-100)
  },
  "per_question_feedback": [
    {
      "question": "string",
      "answer": "string",
      "correctness_percent": number (0-100),
      "points_covered": ["string"],
      "points_missed": ["string"],
      "comment": "1-2 sentence specific feedback"
    }
  ],
  "overall_feedback": {
    "strengths": ["string"],
    "areas_for_improvement": ["string"],
    "suggestions": ["string"]
  }
}`;

      const res = await fetch("/api/gemini", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apiKey, prompt }),
      });

      clearInterval(stepsInterval);

      if (!res.ok) {
        throw new Error("Failed to communicate with the evaluation API.");
      }

      const data = await res.json();
      
      // Defensively parse JSON
      let jsonStr = data.text;
      jsonStr = jsonStr.replace(/^```(json)?\n?/i, "").replace(/```\n?$/i, "").trim();
      
      const parsed = JSON.parse(jsonStr) as ScoreBreakdown;
      
      setResult(parsed);
      setStatus("success");

    } catch (err: any) {
      clearInterval(stepsInterval);
      console.error("Evaluation Error:", err);
      setErrorMsg("Failed to generate evaluation. The model response might have been malformed or the API failed.");
      setStatus("error");
    }
  };

  const handleStartNew = () => {
    sessionStorage.removeItem("interview_history");
    sessionStorage.removeItem("screen_analyses");
    router.push("/");
  };

  const handleDownloadMarkdown = () => {
    if (!result) return;
    
    let md = `# Interview Evaluation Report\n\n`;
    md += `## Overall Score: ${result.overall_score}/100 (${getScoreLabel(result.overall_score)})\n\n`;
    
    md += `### Rubric Breakdown\n`;
    Object.entries(result.breakdown).forEach(([key, score]) => {
      const label = RUBRIC[key as keyof typeof RUBRIC]?.label || key;
      md += `- ${label}: ${score}/100\n`;
    });
    md += `\n`;

    md += `### Overall Feedback\n`;
    md += `#### Strengths\n${result.overall_feedback.strengths.map(s => `- ${s}`).join("\n")}\n\n`;
    md += `#### Areas for Improvement\n${result.overall_feedback.areas_for_improvement.map(s => `- ${s}`).join("\n")}\n\n`;
    md += `#### Suggestions\n${result.overall_feedback.suggestions.map(s => `- ${s}`).join("\n")}\n\n`;

    md += `### Q&A Breakdown\n\n`;
    result.per_question_feedback.forEach((q, i) => {
      md += `#### Q${i+1}: ${q.question}\n`;
      md += `**Answer**: ${q.answer}\n\n`;
      md += `**Score**: ${q.correctness_percent}%\n\n`;
      md += `**Points Covered**: ${q.points_covered.length ? q.points_covered.join(", ") : "None"}\n`;
      md += `**Points Missed**: ${q.points_missed.length ? q.points_missed.join(", ") : "None"}\n\n`;
      md += `**Feedback**: ${q.comment}\n\n`;
    });

    const blob = new Blob([md], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `interview-report-${new Date().toISOString().slice(0,10)}.md`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handlePrintPdf = () => {
    window.print();
  };

  const toggleQuestion = (index: number) => {
    setExpandedQs(prev => ({ ...prev, [index]: !prev[index] }));
  };

  if (status === "loading") {
    const loadingMessages = [
      "Analyzing interview responses...",
      "Evaluating technical depth and clarity...",
      "Generating personalized feedback..."
    ];
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4 animate-in fade-in duration-500">
        <div className="max-w-md w-full bg-card border border-border rounded-xl p-8 text-center space-y-6">
          <Loader2 className="w-10 h-10 animate-spin text-primary mx-auto" />
          <div>
            <h2 className="text-xl font-semibold mb-2 tracking-tight">Evaluating Interview</h2>
            <p className="text-muted-foreground transition-opacity duration-300">
              {loadingMessages[loadingStep] || "Almost done..."}
            </p>
          </div>
          <div className="w-full bg-muted rounded-full h-1.5 mt-4 overflow-hidden">
            <div 
              className="bg-primary h-full transition-all duration-1000 ease-in-out" 
              style={{ width: `${Math.min(100, (loadingStep + 1) * 33.33)}%` }}
            />
          </div>
        </div>
      </div>
    );
  }

  if (status === "error") {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4 animate-in fade-in duration-500">
        <div className="max-w-md w-full bg-card border border-border rounded-xl p-8 text-center space-y-6 shadow-sm">
          <div className="w-12 h-12 bg-red-500/10 text-red-500 rounded-full flex items-center justify-center mx-auto">
            <AlertCircle className="w-6 h-6" />
          </div>
          <div>
            <h2 className="text-xl font-semibold mb-2 tracking-tight">Evaluation Failed</h2>
            <p className="text-muted-foreground text-sm">
              {errorMsg}
            </p>
          </div>
          <div className="flex flex-col gap-3">
            <button
              onClick={evaluateInterview}
              className="w-full bg-primary text-primary-foreground hover:bg-primary/90 h-10 rounded-md font-medium transition-colors"
            >
              Retry Evaluation
            </button>
            <button
              onClick={() => router.push("/")}
              className="w-full bg-secondary text-secondary-foreground hover:bg-secondary/80 h-10 rounded-md font-medium transition-colors"
            >
              Go to Setup
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (!result) return null;

  // Render Success State
  return (
    <div className="min-h-screen bg-background text-foreground print:bg-white print:text-black animate-in fade-in duration-500">
      {/* Header Actions (hidden in print) */}
      <div className="border-b border-border bg-card/50 print:hidden sticky top-0 z-10 backdrop-blur-sm">
        <div className="max-w-5xl mx-auto px-6 py-4 flex items-center justify-between">
          <button 
            onClick={handleStartNew}
            className="text-sm font-medium text-muted-foreground hover:text-foreground flex items-center gap-2 transition-colors"
          >
            <ArrowLeft className="w-4 h-4" /> Start New
          </button>
          <div className="flex items-center gap-3">
            <button
              onClick={handleDownloadMarkdown}
              className="px-4 py-2 bg-secondary text-secondary-foreground hover:bg-secondary/80 rounded-md text-sm font-medium transition-colors flex items-center gap-2"
            >
              <FileText className="w-4 h-4" />
              <span className="hidden sm:inline">Download .md</span>
            </button>
            <button
              onClick={handlePrintPdf}
              className="px-4 py-2 bg-primary text-primary-foreground hover:bg-primary/90 rounded-md text-sm font-medium transition-colors flex items-center gap-2 shadow-sm"
            >
              <Download className="w-4 h-4" />
              <span className="hidden sm:inline">Save PDF</span>
            </button>
          </div>
        </div>
      </div>

      <main className="max-w-5xl mx-auto px-6 py-12 space-y-16 print:py-0 print:space-y-8">
        
        <div className="print:block hidden mb-8 border-b pb-4 pt-8">
          <h1 className="text-3xl font-bold tracking-tight">Interview Evaluation Report</h1>
          <p className="text-sm text-gray-500 mt-2">{new Date().toLocaleDateString()}</p>
        </div>

        {/* Hero Score Section */}
        <section className="flex flex-col md:flex-row items-center gap-12 justify-center">
          <div className="relative w-48 h-48 flex items-center justify-center print:w-32 print:h-32">
            <svg className="w-full h-full transform -rotate-90" viewBox="0 0 100 100">
              {/* Track */}
              <circle
                cx="50"
                cy="50"
                r="44"
                fill="none"
                stroke="currentColor"
                strokeWidth="8"
                className="text-muted/30 print:text-gray-200"
              />
              {/* Progress */}
              <circle
                cx="50"
                cy="50"
                r="44"
                fill="none"
                stroke="currentColor"
                strokeWidth="8"
                strokeDasharray="276.46"
                strokeDashoffset={276.46 - (276.46 * result.overall_score) / 100}
                className="text-primary transition-all duration-1000 ease-out print:text-black"
                strokeLinecap="round"
              />
            </svg>
            <div className="absolute flex flex-col items-center justify-center text-center">
              <span className="text-5xl font-bold tracking-tighter print:text-4xl">{result.overall_score}</span>
              <span className="text-sm font-medium text-muted-foreground mt-1 uppercase tracking-wider print:text-gray-600">
                {getScoreLabel(result.overall_score)}
              </span>
            </div>
          </div>

          {/* Rubric Breakdown */}
          <div className="w-full max-w-md space-y-5">
            <h3 className="text-lg font-semibold tracking-tight print:hidden">Score Breakdown</h3>
            <div className="space-y-4">
              {Object.entries(RUBRIC).map(([key, info]) => {
                const score = result.breakdown[key as keyof typeof result.breakdown] || 0;
                return (
                  <div key={key} className="group relative">
                    <div className="flex justify-between items-end mb-1.5">
                      <span className="text-sm font-medium">
                        {info.label} <span className="text-muted-foreground text-xs font-normal print:text-gray-500">({info.weight * 100}%)</span>
                      </span>
                      <span className="text-sm font-bold">{score}/100</span>
                    </div>
                    <div className="w-full bg-muted rounded-full h-2 overflow-hidden print:bg-gray-200">
                      <div 
                        className="bg-primary h-full rounded-full print:bg-black" 
                        style={{ width: `${score}%` }}
                      />
                    </div>
                    {/* Tooltip for description - hidden on print */}
                    <div className="absolute top-full left-0 mt-1 w-full bg-card border border-border shadow-md rounded p-2 text-xs text-muted-foreground opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all z-10 print:hidden">
                      {info.description}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </section>

        {/* Overall Feedback */}
        <section className="grid md:grid-cols-3 gap-6 print:grid-cols-3 print:break-inside-avoid print:gap-4">
          <div className="bg-green-500/5 border border-green-500/20 rounded-xl p-6 print:border print:border-gray-300 print:p-4">
            <h3 className="text-green-700 dark:text-green-400 font-semibold mb-4 flex items-center gap-2 print:text-black">
              <CheckCircle2 className="w-5 h-5 print:hidden" /> Strengths
            </h3>
            <ul className="space-y-3">
              {result.overall_feedback.strengths.map((item, i) => (
                <li key={i} className="text-sm leading-relaxed text-foreground/80 flex items-start gap-2 print:text-black">
                  <span className="text-green-500 shrink-0 mt-1 print:text-black">•</span> {item}
                </li>
              ))}
            </ul>
          </div>
          
          <div className="bg-orange-500/5 border border-orange-500/20 rounded-xl p-6 print:border print:border-gray-300 print:p-4">
            <h3 className="text-orange-700 dark:text-orange-400 font-semibold mb-4 flex items-center gap-2 print:text-black">
              <AlertCircle className="w-5 h-5 print:hidden" /> Improvements
            </h3>
            <ul className="space-y-3">
              {result.overall_feedback.areas_for_improvement.map((item, i) => (
                <li key={i} className="text-sm leading-relaxed text-foreground/80 flex items-start gap-2 print:text-black">
                  <span className="text-orange-500 shrink-0 mt-1 print:text-black">•</span> {item}
                </li>
              ))}
            </ul>
          </div>

          <div className="bg-blue-500/5 border border-blue-500/20 rounded-xl p-6 print:border print:border-gray-300 print:p-4">
            <h3 className="text-blue-700 dark:text-blue-400 font-semibold mb-4 flex items-center gap-2 print:text-black">
              <FileText className="w-5 h-5 print:hidden" /> Suggestions
            </h3>
            <ul className="space-y-3">
              {result.overall_feedback.suggestions.map((item, i) => (
                <li key={i} className="text-sm leading-relaxed text-foreground/80 flex items-start gap-2 print:text-black">
                  <span className="text-blue-500 shrink-0 mt-1 print:text-black">•</span> {item}
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* Per-Question Breakdown */}
        <section className="space-y-6">
          <h2 className="text-2xl font-semibold tracking-tight print:mt-8">Detailed Q&A Breakdown</h2>
          
          <div className="space-y-4">
            {result.per_question_feedback.map((q, i) => {
              const isExpanded = expandedQs[i] ?? false; 
              return (
                <div key={i} className="border border-border rounded-xl bg-card overflow-hidden print:border-b print:border-gray-300 print:rounded-none print:bg-transparent print:break-inside-avoid print:pb-4">
                  
                  {/* Accordion Header */}
                  <button 
                    onClick={() => toggleQuestion(i)}
                    className="w-full px-6 py-4 flex items-start gap-4 text-left hover:bg-muted/30 transition-colors print:hidden"
                  >
                    <div className="bg-primary/10 text-primary w-8 h-8 rounded-full flex items-center justify-center shrink-0 font-bold text-sm">
                      {i + 1}
                    </div>
                    <div className="flex-1">
                      <p className="font-medium pr-8">{q.question}</p>
                      <p className="text-sm text-muted-foreground mt-1 line-clamp-1">{q.answer}</p>
                    </div>
                    <div className="shrink-0 flex flex-col items-end gap-1">
                      <span className="text-xs font-semibold uppercase text-muted-foreground">Score</span>
                      <span className={`text-sm font-bold ${q.correctness_percent >= 80 ? 'text-green-500' : q.correctness_percent >= 50 ? 'text-orange-500' : 'text-red-500'}`}>
                        {q.correctness_percent}%
                      </span>
                    </div>
                  </button>

                  {/* Print Header */}
                  <div className="hidden print:flex items-start gap-4 pb-2">
                     <div className="font-bold text-lg">{i + 1}.</div>
                     <div>
                       <p className="font-bold">{q.question}</p>
                       <p className="text-sm mt-1 text-gray-700">Score: {q.correctness_percent}%</p>
                     </div>
                  </div>

                  {/* Accordion Body */}
                  <div className={`${isExpanded ? 'block' : 'hidden'} print:block px-6 pb-6 pt-2 border-t border-border print:border-none print:px-8 print:py-2`}>
                    <div className="bg-muted/50 rounded-lg p-4 mb-6 print:bg-gray-50 print:border print:border-gray-200">
                      <p className="text-sm font-semibold mb-2 text-muted-foreground uppercase tracking-wider print:text-gray-600">Candidate Answer</p>
                      <p className="text-sm leading-relaxed">{q.answer}</p>
                    </div>
                    
                    <div className="grid md:grid-cols-2 gap-6 mb-6">
                      {q.points_covered.length > 0 && (
                        <div>
                          <p className="text-sm font-semibold mb-3 flex items-center gap-2 text-green-600 dark:text-green-400 print:text-black">
                            <CheckCircle2 className="w-4 h-4 print:hidden" /> Points Covered
                          </p>
                          <ul className="space-y-2">
                            {q.points_covered.map((p, idx) => (
                              <li key={idx} className="text-sm text-foreground/80 flex items-start gap-2 print:text-black">
                                <span className="text-green-500 shrink-0 mt-1 print:text-black">✓</span> {p}
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                      
                      {q.points_missed.length > 0 && (
                        <div>
                          <p className="text-sm font-semibold mb-3 flex items-center gap-2 text-red-600 dark:text-red-400 print:text-black">
                            <XCircle className="w-4 h-4 print:hidden" /> Points Missed
                          </p>
                          <ul className="space-y-2">
                            {q.points_missed.map((p, idx) => (
                              <li key={idx} className="text-sm text-foreground/80 flex items-start gap-2 print:text-black">
                                <span className="text-red-500 shrink-0 mt-1 print:text-black">✗</span> {p}
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </div>

                    <div className="bg-primary/5 border border-primary/10 rounded-lg p-4 print:bg-transparent print:border-l-4 print:border-l-gray-400 print:border-y-0 print:border-r-0 print:rounded-none">
                      <p className="text-sm font-semibold mb-1 text-primary print:text-black">Feedback</p>
                      <p className="text-sm leading-relaxed text-foreground/90 print:text-black">{q.comment}</p>
                    </div>
                  </div>

                </div>
              );
            })}
          </div>
        </section>

      </main>

      {/* Footer Attribution */}
      <footer className="border-t border-border mt-12 py-6 text-center text-sm text-muted-foreground print:hidden">
        Evaluated using <span className="font-medium text-foreground">Gemini 2.5 Flash</span>
      </footer>
    </div>
  );
}
