export const feedbackCategories = {
  thanks: 'Thank you',
  review: 'Review',
  issue: 'Report an issue',
} as const;

export type FeedbackCategory = keyof typeof feedbackCategories;
export const feedbackSubjectLimit = 120;
export const feedbackMessageLimit = 2000;
