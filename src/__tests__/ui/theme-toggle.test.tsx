import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, beforeEach } from "vitest";
import ThemeToggle from "@/components/theme-toggle";

describe("ThemeToggle Component", () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.classList.remove("dark");
    window.matchMedia = (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    });
  });

  it("renders default Light mode when no theme is stored in localStorage", () => {
    render(<ThemeToggle />);
    expect(screen.getByRole("button", { name: /light mode/i })).toBeDefined();
    expect(screen.getByText("Light mode")).toBeDefined();
    expect(screen.getByText("☀️")).toBeDefined();
  });

  it("renders Dark mode when localStorage has dark theme stored", () => {
    localStorage.setItem("mediq-theme", "dark");
    render(<ThemeToggle />);
    expect(screen.getByRole("button", { name: /dark mode/i })).toBeDefined();
    expect(screen.getByText("Dark mode")).toBeDefined();
    expect(screen.getByText("🌙")).toBeDefined();
  });

  it("toggles theme from light to dark when button is clicked", () => {
    render(<ThemeToggle />);
    const button = screen.getByRole("button");
    expect(button.textContent).toContain("Light mode");

    fireEvent.click(button);

    expect(localStorage.getItem("mediq-theme")).toBe("dark");
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(button.textContent).toContain("Dark mode");
  });

  it("toggles theme from dark to light when button is clicked in dark mode", () => {
    localStorage.setItem("mediq-theme", "dark");
    document.documentElement.classList.add("dark");

    render(<ThemeToggle />);
    const button = screen.getByRole("button");
    expect(button.textContent).toContain("Dark mode");

    fireEvent.click(button);

    expect(localStorage.getItem("mediq-theme")).toBe("light");
    expect(document.documentElement.classList.contains("dark")).toBe(false);
    expect(button.textContent).toContain("Light mode");
  });

  it("honors OS dark mode preference when no saved preference exists", () => {
    window.matchMedia = (query: string) => ({
      matches: query.includes("prefers-color-scheme: dark"),
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    });

    render(<ThemeToggle />);
    expect(screen.getByText("Dark mode")).toBeDefined();
    expect(screen.getByText("🌙")).toBeDefined();
  });
});
