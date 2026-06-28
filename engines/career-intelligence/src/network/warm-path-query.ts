import {
  defaultPeopleDir,
  findWarmPathsToCompany,
  loadWarmPathGraph,
  type WarmPathEventSink,
  type WarmPathQueryResult,
} from "./warm-path-graph";

export interface WarmPathQueryOptions {
  eventSink?: WarmPathEventSink;
  peopleDir?: string;
  now?: Date;
}

export function warmPathsToCompany(
  company: string,
  opts: WarmPathQueryOptions = {},
): WarmPathQueryResult {
  const graph = loadWarmPathGraph(opts.peopleDir ?? defaultPeopleDir(), {
    eventSink: opts.eventSink,
    now: opts.now,
  });
  return findWarmPathsToCompany(graph, company);
}

export type { WarmPath, WarmPathEvent, WarmPathQueryResult } from "./warm-path-graph";
