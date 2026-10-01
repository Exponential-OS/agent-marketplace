// Compiled by platforms.test.ts. These errors MUST exist: a single target is
// part of the publishing contract, not merely a runtime convention.
import {
  cascadeComment,
  groupPost,
  type CascadeTarget,
  type GroupTarget,
} from "../platforms/linkedin";
import { explicitlyReuseExistingTarget } from "../platforms/_cdp";
function compileOnly(cascade: CascadeTarget, group: GroupTarget) {
  cascadeComment(cascade);
  groupPost(group);
  // @ts-expect-error cascade requires exactly ONE target
  cascadeComment([cascade]);
  // @ts-expect-error group requires exactly ONE target
  groupPost([group]);
  // @ts-expect-error existing target reuse requires explicit opt-in
  explicitlyReuseExistingTarget({
    id: "x",
    url: "https://x",
    webSocketDebuggerUrl: "ws://x",
  });
}
void compileOnly;
