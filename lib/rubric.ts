export const RUBRIC = {
  technical_depth: {
    weight: 0.30,
    label: "Technical Depth",
    description: "Depth and accuracy of implementation explanation"
  },
  clarity: {
    weight: 0.25,
    label: "Clarity",
    description: "Structure, articulation, and confidence of communication"
  },
  originality: {
    weight: 0.25,
    label: "Originality",
    description: "Uniqueness of approach and creative problem-solving"
  },
  understanding: {
    weight: 0.20,
    label: "Understanding",
    description: "Conceptual grasp and ability to reason about decisions"
  }
} as const;
