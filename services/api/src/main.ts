import { createApiServer } from "./server";

const server = createApiServer();
server.listen();
console.log(`Shucamoxa Agent API listening on http://${server.config.host}:${server.config.port}`);
