import { describe, expect, it } from "bun:test";
import { Jimp } from "jimp";
import {
  createMealPhotos,
  MEAL_ANALYSIS_MAX_DIMENSION,
  MEAL_THUMBNAIL_MAX_DIMENSION,
} from "./thumbnail.js";

async function samplePhoto(width = 2000, height = 1500): Promise<string> {
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

describe("createMealPhotos", () => {
  it("bounds the analysis copy and stores a 320 px thumbnail", async () => {
    const photos = await createMealPhotos(await samplePhoto());

    expect(photos.analysisDataUrl.startsWith("data:image/jpeg;base64,")).toBe(
      true,
    );
    expect(await metadata(photos.analysisDataUrl)).toEqual({
      width: MEAL_ANALYSIS_MAX_DIMENSION,
      height: 768,
    });
    expect(await metadata(photos.thumbnailDataUrl)).toEqual({
      width: MEAL_THUMBNAIL_MAX_DIMENSION,
      height: 240,
    });
  });

  it("does not enlarge a smaller photo", async () => {
    const photos = await createMealPhotos(await samplePhoto(200, 100));
    expect(await metadata(photos.analysisDataUrl)).toEqual({
      width: 200,
      height: 100,
    });
    expect(await metadata(photos.thumbnailDataUrl)).toEqual({
      width: 200,
      height: 100,
    });
  });

  it("rejects a data URL that is not a supported image", async () => {
    const error = await createMealPhotos("https://example.com/meal.jpg").then(
      () => null,
      (err: unknown) => err,
    );
    expect(error).toBeInstanceOf(Error);
  });
});
