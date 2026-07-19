import { AuthenticatedUser } from "../auth.types";
import { getCurrentUserFromRequest } from "./current-user.decorator";

describe("getCurrentUserFromRequest", () => {
  it("returns request user", () => {
    const user: AuthenticatedUser = {
      id: "user-1",
      email: "admin@example.com",
      role: "ADMIN",
    };
    const ctx = {
      switchToHttp: () => ({
        getRequest: () => ({ user }),
      }),
    };

    expect(getCurrentUserFromRequest(undefined, ctx as never)).toBe(user);
  });
});
