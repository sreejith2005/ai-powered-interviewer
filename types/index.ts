export type InterviewPhase = 'intro' | 'transition' | 'walkthrough' | 'wrapup';

export interface InterviewContext {
  projectId?: string;
  projectName?: string;
  projectDescription?: string;
}

export interface ScreenAnalysis {
  timestamp: number;
  extractedText?: string;
  visualContext?: string;
  contentType?: string;
}

export interface QAExchange {
  id: string;
  timestamp: number;
  question: string;
  rationale?: string;
  answer: string;
  expected_points?: string[];
  aiFeedback?: string;
}

export interface PerQuestionFeedback {
  question: string;
  answer: string;
  correctness_percent: number;
  points_covered: string[];
  points_missed: string[];
  comment: string;
}

export interface OverallFeedback {
  strengths: string[];
  areas_for_improvement: string[];
  suggestions: string[];
}

export interface ScoreBreakdown {
  overall_score: number;
  breakdown: {
    technical_depth: number;
    clarity: number;
    originality: number;
    understanding: number;
  };
  topics_covered?: string[];
  per_question_feedback: PerQuestionFeedback[];
  overall_feedback: OverallFeedback;
}

export interface ActivityEvent {
  id: string;
  type: 'system' | 'analysis' | 'question' | 'answer';
  timestamp: number;
  content: string;
}
