import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

// Compact Y.Doc state nightly to prevent unbounded growth
crons.interval("compact-yjs", { hours: 24 }, internal.compact.compactYjsState);

export default crons;
