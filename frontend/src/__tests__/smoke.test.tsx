import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";

/**
 * Smoke test: verifies the Vitest + RTL + jsdom pipeline is wired up.
 * If this ever breaks, the whole frontend test suite is unreliable.
 */
describe("vitest smoke", () => {
  it("renders a React element and finds it via RTL queries", () => {
    render(<h1>watchwithmi frontend tests online</h1>);
    expect(
      screen.getByRole("heading", { name: /watchwithmi frontend tests online/i }),
    ).toBeInTheDocument();
  });

  it("has jest-dom matchers available", () => {
    const div = document.createElement("div");
    div.textContent = "hello";
    document.body.appendChild(div);
    expect(div).toHaveTextContent("hello");
  });
});
