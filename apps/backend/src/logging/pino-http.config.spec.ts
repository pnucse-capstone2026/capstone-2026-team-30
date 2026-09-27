import {
  createPinoHttpConfig,
  SENSITIVE_HTTP_LOG_PATHS,
} from "./pino-http.config";

describe("createPinoHttpConfig", () => {
  it("redacts authentication, cookie, and API key headers", () => {
    const config = createPinoHttpConfig();

    expect(config).toEqual(
      expect.objectContaining({
        redact: {
          paths: [...SENSITIVE_HTTP_LOG_PATHS],
          censor: "[REDACTED]",
        },
      }),
    );
  });
});
