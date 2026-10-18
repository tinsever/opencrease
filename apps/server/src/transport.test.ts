import { expect, it } from "vitest";
import { remoteCallTool } from "./stdio";
import { startTestServer } from "./test-utils";
import { userConfigDir } from "./config";

it("the stdio HTTP proxy reads the token automatically with no setup", async () => {
  const server = await startTestServer({ auth: true, userConfigDir: userConfigDir() });
  try {
    const call = remoteCallTool({ port: server.port });
    const result = await call("list_resources", {}, { name: "stdio-test" });
    expect(result.isError).toBeFalsy();
    expect(result.content[0]).toMatchObject({ type: "text", text: expect.stringContaining('"resources"') });
  } finally { await server.stop(); }
});
