export interface InterviewContext {
  projectId?: string;
  projectName?: string;
  projectDescription?: string;
}

export interface ScreenAnalysis {
  timestamp: number;
  extractedText?: string;
  visualContext?: string;
}

export interface QAExchange {
  id: string;
  timestamp: number;
  question: string;
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
  per_question_feedback: PerQuestionFeedback[];
  overall_feedback: OverallFeedback;
}
