import { z } from "zod";

export const tableLayoutSchema = z.object({
  widths: z.record(z.string(), z.number().min(40).max(1400)).default({}),
  order: z.array(z.string()).max(500).default([]),
  hidden: z.array(z.string()).max(500).default([]),
  pinned: z.array(z.string()).max(500).default([]),
  expanded: z.array(z.string()).max(500).default([]),
  remember: z.boolean().default(false),
});
export type TableLayout = z.infer<typeof tableLayoutSchema>;
export type TabState = {
  filter: string;
  sort: string;
  projection: string;
  queryWidths?: number[];
  queryOptionsExpanded?: boolean;
  resultFocus?: boolean;
  resultLayout?: "vertical" | "horizontal";
  batchSize: number;
  view: "table" | "tree" | "json";
  code: string;
  freeMode: boolean;
  outputHeight: number;
  outputCollapsed: boolean;
  layout?: TableLayout;
};
export const workspaceSchema = z.object({
  version: z.literal(1).default(1),
  sidebarWidth: z.number().min(180).max(800).default(270),
  jobsHeight: z.number().min(100).max(1200).default(220),
  historyHeight: z.number().min(100).max(1200).default(260),
});
