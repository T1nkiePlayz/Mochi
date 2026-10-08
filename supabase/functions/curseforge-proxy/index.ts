// Entry point. The logic lives in handler.ts so tests can import it without starting a server.
import { handle } from "./handler.ts";

Deno.serve((req) => handle(req));
