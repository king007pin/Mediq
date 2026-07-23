import React from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import CollapsibleSection from "@/components/collapsible-section";

describe("CollapsibleSection", () => {
  it("does not wrap interactive preview elements in a top-level button", () => {
    const previewElement = React.createElement(
      "button",
      { id: "interactive-preview-btn" },
      "Interactive Action"
    );

    const html = renderToString(
      React.createElement(
        CollapsibleSection,
        {
          title: "Test Section",
          preview: previewElement,
          defaultOpen: false,
        },
        React.createElement("p", null, "Body Content")
      )
    );

    // Verify preview button exists in rendered HTML
    expect(html).toContain('id="interactive-preview-btn"');

    // Verify that interactive preview element is not nested inside another button element
    // Nested buttons mean an unclosed <button> tag contains another <button> tag before closing </button>
    const nestedButtonRegex = /<button(?:\s[^>]*)?>(?:(?!<\/button>)[\s\S])*?<button id="interactive-preview-btn"/;
    expect(html).not.toMatch(nestedButtonRegex);
  });

  it("renders a dedicated toggle button with aria-expanded and aria-controls", () => {
    const html = renderToString(
      React.createElement(
        CollapsibleSection,
        {
          title: "Test Section",
          defaultOpen: false,
        },
        React.createElement("p", null, "Body Content")
      )
    );

    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain('aria-controls=');
    expect(html).toContain('type="button"');
  });

  it("updates aria-expanded when defaultOpen is true", () => {
    const html = renderToString(
      React.createElement(
        CollapsibleSection,
        {
          title: "Test Section",
          defaultOpen: true,
        },
        React.createElement("p", null, "Body Content")
      )
    );

    expect(html).toContain('aria-expanded="true"');
  });
});
