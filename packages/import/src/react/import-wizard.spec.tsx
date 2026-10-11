/**
 * @vitest-environment jsdom
 *
 * An experimental engine: its notice before any file is chosen and beside what
 * it produced, and the host's offer to receive that conversion — made after the
 * fact, so the author decides having seen the result.
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { handleImportUploadFile } from "../lib/upload";
import type { ImportedProjectResult } from "../lib/types";
import {
  ImportWizard,
  type ConversionShare,
  type ImportEngine,
  type ShareConversionOffer,
} from "./import-wizard";

const NOTICE = "Conversion from Word uses Pandoc and is still experimental.";

const builtin: ImportEngine = {
  id: "builtin",
  label: "Built-in converter",
  acceptExtensions: [".md"],
  convertFile: (file, options) => handleImportUploadFile(file, options),
};

/**
 * An experimental engine for Word files. It converts a little Markdown in the
 * file's place, so the review step has a real result to show.
 */
const wordEngine = (result?: Promise<ImportedProjectResult>): ImportEngine => ({
  id: "pandoc",
  label: "Pandoc",
  acceptExtensions: [".docx"],
  experimentalNotice: NOTICE,
  convertFile: (_file, options) =>
    result ??
    handleImportUploadFile(
      new File(["# Report\n\nBody text.\n"], "report.md"),
      options,
    ),
});

const failure = (message: string): Promise<ImportedProjectResult> =>
  Promise.resolve({ pretextError: message, statusMessages: [], warnings: [] });

const renderWizard = (
  engines: ImportEngine[],
  shareConversion?: ShareConversionOffer,
) =>
  render(
    <ImportWizard
      engines={engines}
      onConfirm={() => {}}
      shareConversion={shareConversion}
    />,
  );

const chooseFile = (container: HTMLElement, file: File) =>
  fireEvent.change(container.querySelector('input[type="file"]')!, {
    target: { files: [file] },
  });

const offer = (
  onShare: ShareConversionOffer["onShare"] = vi.fn(),
): ShareConversionOffer => ({
  label: "Share with the developers",
  description: "Sends this file and its conversion to the developers.",
  onShare,
});

const shareButton = () =>
  screen.queryByRole("button", { name: "Share with the developers" });

describe("ImportWizard with an experimental engine", () => {
  it("announces it before any file is chosen, with nothing to share yet", () => {
    renderWizard([builtin, wordEngine()], offer());

    expect(screen.getByTestId("experimental-notice").textContent).toBe(NOTICE);
    expect(shareButton()).toBeNull();
  });

  it("says nothing when no engine is experimental", () => {
    renderWizard([builtin], offer());

    expect(screen.queryByTestId("experimental-notice")).toBeNull();
  });

  it("shares the file and its conversion once the author asks", async () => {
    const onShare = vi.fn<(share: ConversionShare) => Promise<void>>(
      async () => {},
    );
    const { container } = renderWizard([builtin, wordEngine()], offer(onShare));
    const file = new File(["binary"], "report.docx");

    chooseFile(container, file);
    const button = await screen.findByRole("button", {
      name: "Share with the developers",
    });
    expect(screen.getByTestId("experimental-notice").textContent).toContain(
      NOTICE,
    );
    expect(onShare).not.toHaveBeenCalled();

    fireEvent.click(button);

    expect(await screen.findByText("Shared. Thank you!")).toBeTruthy();
    expect(onShare).toHaveBeenCalledTimes(1);
    const share = onShare.mock.calls[0][0];
    expect(share.file).toBe(file);
    expect(share.engineId).toBe("pandoc");
    expect(share.engineLabel).toBe("Pandoc");
    expect(share.pretext).toContain("Body text.");
    expect(share.error).toBeUndefined();
  });

  it("shares a failed conversion with its error", async () => {
    const onShare = vi.fn();
    const { container } = renderWizard(
      [builtin, wordEngine(failure("Pandoc could not read this file."))],
      offer(onShare),
    );
    const file = new File(["x"], "report.docx");

    chooseFile(container, file);
    fireEvent.click(
      await screen.findByRole("button", { name: "Share with the developers" }),
    );

    await waitFor(() => expect(onShare).toHaveBeenCalledTimes(1));
    expect(onShare.mock.calls[0][0]).toEqual({
      file,
      engineId: "pandoc",
      engineLabel: "Pandoc",
      error: "Pandoc could not read this file.",
    });
  });

  it("reports a share that failed and lets the author try again", async () => {
    const onShare = vi
      .fn()
      .mockRejectedValueOnce(new Error("Network down"))
      .mockResolvedValueOnce(undefined);
    const { container } = renderWizard([builtin, wordEngine()], offer(onShare));

    chooseFile(container, new File(["binary"], "report.docx"));
    fireEvent.click(
      await screen.findByRole("button", { name: "Share with the developers" }),
    );

    expect((await screen.findByRole("alert")).textContent).toBe(
      "Could not share: Network down",
    );
    fireEvent.click(shareButton()!);
    expect(await screen.findByText("Shared. Thank you!")).toBeTruthy();
    expect(onShare).toHaveBeenCalledTimes(2);
  });

  it("makes no offer for a result a dependable engine produced", async () => {
    const onShare = vi.fn();
    const { container } = renderWizard([builtin, wordEngine()], offer(onShare));

    chooseFile(container, new File(["# Notes\n\nPlain.\n"], "notes.md"));

    await screen.findByText("Import Summary");
    expect(screen.queryByTestId("experimental-notice")).toBeNull();
    expect(shareButton()).toBeNull();
  });

  // An unreadable file never reached an engine, so there is no conversion to
  // share — even when the last one was experimental.
  it("makes no offer when no engine read the file", async () => {
    const { container } = renderWizard([builtin, wordEngine()], offer());

    chooseFile(container, new File(["x"], "slides.key"));

    await screen.findByText("Import failed");
    expect(screen.queryByTestId("experimental-notice")).toBeNull();
  });

  it("shows the notice beside the result without an offer when the host takes none", async () => {
    const { container } = renderWizard([builtin, wordEngine()]);

    chooseFile(container, new File(["binary"], "report.docx"));

    await screen.findByText("Import Summary");
    expect(screen.getByTestId("experimental-notice").textContent).toBe(NOTICE);
    expect(screen.queryByRole("button", { name: /share/i })).toBeNull();
  });
});
