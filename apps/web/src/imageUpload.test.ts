import { describe, expect, it } from "bun:test";
import { prepareMealPhoto } from "./imageUpload";

async function rejectionMessage(file: File): Promise<string> {
  try {
    await prepareMealPhoto(file);
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
  throw new Error("expected the file to be rejected");
}

describe("prepareMealPhoto", () => {
  it("rejects a file that is not an image before touching the DOM", async () => {
    const file = new File(["not an image"], "notes.txt", {
      type: "text/plain",
    });
    expect(await rejectionMessage(file)).toBe("Choose an image file.");
  });

  it("rejects a source image over the size limit", async () => {
    const file = new File([new Uint8Array(16 * 1024 * 1024)], "big.jpg", {
      type: "image/jpeg",
    });
    expect(await rejectionMessage(file)).toContain("too large");
  });
});
