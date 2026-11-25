// GitHub "star us" badge removed for the white-label build. Kept as a no-op
// component so existing call sites render nothing without code changes.

interface GitHubStarBadgeProps {
  className?: string;
  label?: string;
  showCount?: boolean;
  source?: string;
}

/* eslint-disable @typescript-eslint/no-unused-vars, unused-imports/no-unused-vars */
export function GitHubStarBadge(_props?: GitHubStarBadgeProps): null {
  return null;
}
