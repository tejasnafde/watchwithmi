import "@testing-library/jest-dom/vitest";
import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

// Ensure DOM is torn down between tests so RTL queries don't pick up
// nodes from previous renders.
afterEach(() => {
  cleanup();
});
