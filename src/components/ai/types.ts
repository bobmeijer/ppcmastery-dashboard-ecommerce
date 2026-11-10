// AI analysis and chat. Shapes shared by the
// insight panels and the chat side panel.
import type { Source } from '@/lib/insightSources';

// auto: published by the nightly run, label "AI analysis". approved: Admin edited it,
// label "Reviewed analysis". hidden: Admin withdrew it; never sent to `client`.
export type InsightStatus = 'auto' | 'approved' | 'hidden';

// The analysis as a story: a headline plus 3-4 points of evidence the
// page itself does not show. Interpretation is labelled, never advice.
export interface StoryPoint {
  text: string;
  type: 'fact' | 'interpretation';
  link?: { path: string; params?: Record<string, string> };   // the page that shows it, filters kept
  sources?: Source[];   // "Source": the data table or finding the point rests on (insightSources.ts)
}

export interface Insight {
  id: string;
  page: string;
  status: InsightStatus;
  generatedAt: string;   // ISO timestamp
  story: { headline: string; points: StoryPoint[] };
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  questionId?: string | null;   // assistant: the logged question it answers, for "Ask Admin"
  suggestAdmin?: boolean;         // assistant: the question is Admin's to answer (decision, advice, unsure)
  escalated?: boolean;          // assistant: the reader put the question to Admin
  escalateFailed?: boolean;
  answerId?: string | null;     // assistant: the logged answer, for the rating
  rating?: 1 | -1;              // assistant: the reader's rating
}
