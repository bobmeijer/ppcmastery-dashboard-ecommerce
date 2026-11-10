import 'server-only';

// Settings per account that must stay on the server. dashboard.config.ts ships to the
// browser, where anyone can read it, so anything a visitor should not see belongs here.
// The keys are the account labels from dashboard.config.ts.

interface ServerAccountSettings {
  auctionWatchlist?: string[];  // competitor domains to always show in auction insights
  auctionFolderId?: string;     // Google Drive folder with the scheduled auction reports
}

const settings: Record<string, ServerAccountSettings> = {
  shopa: { auctionWatchlist: ['northflame.example', 'emberyard.example'] },
  shopb: { auctionWatchlist: ['loomandlane.example'] },
};

export const serverAccountSettings = (label: string): ServerAccountSettings => settings[label] ?? {};
