// Create a connection for the server, using Node's IPC as a transport.

import { createConnection, ProposedFeatures } from "vscode-languageserver/node";

// Also include all preview / proposed LSP features.
export const connection = createConnection(ProposedFeatures.all);
