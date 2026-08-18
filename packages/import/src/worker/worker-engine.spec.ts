import { describe, expect, it, vi } from "vitest";
import {
  ConversionCancelledError,
  runConversionInWorker,
  type ConversionWorker,
} from "./worker-engine";
import type { WorkerRequest, WorkerResponse } from "./protocol";

/**
 * A stand-in for a real `Worker`. The pipeline itself is covered by the
 * import specs; what needs testing here is the message plumbing — correlation,
 * transfer, termination — which a fake exercises without a DOM.
 */
class FakeWorker implements ConversionWorker {
  sent: Array<{ message: WorkerRequest; transfer?: Transferable[] }> = [];
  terminated = false;
  private messageListeners: Array<
    (event: MessageEvent<WorkerResponse>) => void
  > = [];
  private errorListeners: Array<(event: unknown) => void> = [];

  postMessage(message: WorkerRequest, transfer?: Transferable[]) {
    this.sent.push({ message, transfer });
  }

  terminate() {
    this.terminated = true;
  }

  addEventListener(type: "message" | "error", listener: never) {
    if (type === "message") {
      this.messageListeners.push(listener);
    } else {
      this.errorListeners.push(listener);
    }
  }

  /** Simulate the worker replying. */
  reply(response: WorkerResponse) {
    for (const listener of this.messageListeners) {
      listener({ data: response } as MessageEvent<WorkerResponse>);
    }
  }

  fail(message: string) {
    for (const listener of this.errorListeners) {
      listener({ message });
    }
  }

  get requestId(): string {
    return this.sent[0].message.requestId;
  }
}

const okResult = { pretextError: "" } as never;

describe("runConversionInWorker", () => {
  it("resolves with the worker's result and shuts the worker down", async () => {
    const worker = new FakeWorker();
    const run = runConversionInWorker(() => worker, { "a.tex": "x" });

    worker.reply({
      type: "result",
      requestId: worker.requestId,
      result: okResult,
    });

    await expect(run.result).resolves.toBe(okResult);
    expect(worker.terminated).toBe(true);
  });

  it("rejects when the worker reports an error", async () => {
    const worker = new FakeWorker();
    const run = runConversionInWorker(() => worker, {});

    worker.reply({
      type: "error",
      requestId: worker.requestId,
      message: "boom",
    });

    await expect(run.result).rejects.toThrow("boom");
    expect(worker.terminated).toBe(true);
  });

  it("rejects when the worker fails to start", async () => {
    const worker = new FakeWorker();
    const run = runConversionInWorker(() => worker, {});

    worker.fail("nope");

    await expect(run.result).rejects.toThrow("nope");
  });

  it("cancels by terminating the worker mid-run", async () => {
    const worker = new FakeWorker();
    const run = runConversionInWorker(() => worker, {});

    run.cancel();

    await expect(run.result).rejects.toBeInstanceOf(ConversionCancelledError);
    expect(worker.terminated).toBe(true);
  });

  it("ignores a reply that arrives after cancellation", async () => {
    const worker = new FakeWorker();
    const run = runConversionInWorker(() => worker, {});
    const rejected = expect(run.result).rejects.toBeInstanceOf(
      ConversionCancelledError,
    );

    run.cancel();
    // A worker terminated mid-post could still have a message in flight; it
    // must not flip an already-settled promise.
    worker.reply({
      type: "result",
      requestId: worker.requestId,
      result: okResult,
    });

    await rejected;
  });

  it("ignores messages from a different request", async () => {
    const worker = new FakeWorker();
    const run = runConversionInWorker(() => worker, {});
    const settled = vi.fn();
    void run.result.then(settled, settled);

    worker.reply({
      type: "result",
      requestId: "someone-else",
      result: okResult,
    });
    await Promise.resolve();

    expect(settled).not.toHaveBeenCalled();
  });

  it("transfers asset buffers instead of copying them", () => {
    const shared = new Uint8Array([1, 2, 3]);
    const worker = new FakeWorker();
    runConversionInWorker(
      () => worker,
      {},
      // Two entries backed by the same buffer: the transfer list must name it
      // once, since a repeat throws DataCloneError in a real postMessage.
      { assets: { "a.png": shared, "b.png": shared } },
    );

    const { message, transfer } = worker.sent[0];
    expect(transfer).toEqual([shared.buffer]);
    expect(message.assets["a.png"]).toBe(shared);
    // Assets travel in their own field so they can be listed as transferables.
    expect("assets" in message.options).toBe(false);
  });
});
