// Create a connection for the server: Node IPC on the desktop host, the
// worker's message port on the web host (see platform.ts).

import { createServerConnection } from "./platform";

export const connection = createServerConnection();
