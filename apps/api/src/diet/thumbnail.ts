import { Jimp } from "jimp";

/** The longest edge of the thumbnail stored for the food log. */
export const MEAL_THUMBNAIL_MAX_DIMENSION = 320;

/** The JPEG quality of the stored thumbnail. */
const THUMBNAIL_QUALITY = 75;

const PHOTO_DATA_URL = /^data:image\/(?:jpeg|png|webp);base64,(.+)$/;

/**
 * Turns the full meal photo into the small JPEG thumbnail kept for the food
 * log. Runs on the API so the stored image is always derived from the same
 * bytes the coach saw. A pure-JavaScript decoder keeps the API's single-file
 * deployment intact; a malformed or unreadable image still throws.
 */
export async function createMealThumbnail(
  photoDataUrl: string,
): Promise<string> {
  const match = PHOTO_DATA_URL.exec(photoDataUrl);
  if (match?.[1] === undefined) {
    throw new Error("The photo is not a supported image.");
  }
  const image = await Jimp.read(Buffer.from(match[1], "base64"));
  const width = image.bitmap.width;
  const height = image.bitmap.height;
  const scale = Math.min(
    1,
    MEAL_THUMBNAIL_MAX_DIMENSION / Math.max(width, height),
  );
  if (scale < 1) {
    image.resize({
      w: Math.max(1, Math.round(width * scale)),
      h: Math.max(1, Math.round(height * scale)),
    });
  }
  const thumbnail = await image.getBuffer("image/jpeg", {
    quality: THUMBNAIL_QUALITY,
  });
  return `data:image/jpeg;base64,${thumbnail.toString("base64")}`;
}
