import { describe, expect, it } from "bun:test";
import { Jimp } from "jimp";
import { createMealThumbnail } from "./thumbnail.js";

async function samplePhoto(width = 800, height = 600): Promise<string> {
  const image = new Jimp({
    width,
    height,
    color: 0xb4783cff,
  });
  const bytes = await image.getBuffer("image/jpeg", { quality: 80 });
  return `data:image/jpeg;base64,${bytes.toString("base64")}`;
}

async function metadata(dataUrl: string) {
  const image = await Jimp.read(
    Buffer.from(dataUrl.split(",")[1] ?? "", "base64"),
  );
  return { width: image.bitmap.width, height: image.bitmap.height };
}

describe("createMealThumbnail", () => {
  it("turns a full photo into a 320 px JPEG data URL", async () => {
    const thumbnail = await createMealThumbnail(await samplePhoto());
    expect(thumbnail.startsWith("data:image/jpeg;base64,")).toBe(true);
    expect(await metadata(thumbnail)).toEqual({ width: 320, height: 240 });
  });

  it("does not enlarge a smaller photo", async () => {
    const thumbnail = await createMealThumbnail(await samplePhoto(200, 100));
    expect(await metadata(thumbnail)).toEqual({ width: 200, height: 100 });
  });

  it("rejects a data URL that is not a supported image", async () => {
    const error = await createMealThumbnail(
      "https://example.com/meal.jpg",
    ).then(
      () => null,
      (err: unknown) => err,
    );
    expect(error).toBeInstanceOf(Error);
  });
});
