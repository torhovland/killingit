import { Jimp } from "jimp";

/** The longest edge of the thumbnail stored for the food log. */
export const MEAL_THUMBNAIL_MAX_DIMENSION = 320;

/**
 * The longest edge of the photo sent to the model. A phone photo can be many
 * megapixels, and image tokens grow with its dimensions; a bounded copy keeps
 * the analysis cheap without losing what the meal looks like.
 */
export const MEAL_ANALYSIS_MAX_DIMENSION = 1024;

/** The JPEG quality of the stored thumbnail. */
const THUMBNAIL_QUALITY = 75;

/** The JPEG quality of the analysis copy. */
const ANALYSIS_QUALITY = 85;

const PHOTO_DATA_URL = /^data:image\/(?:jpeg|png|webp);base64,(.+)$/;

type JimpImage = Awaited<ReturnType<typeof Jimp.read>>;

/** The two derived copies of one meal photo. */
export interface MealPhotos {
  /** The bounded JPEG sent to the coach for analysis. */
  analysisDataUrl: string;
  /** The small JPEG kept with the meal for display. */
  thumbnailDataUrl: string;
}

/**
 * Turns the full meal photo into the bounded analysis copy and the small
 * thumbnail kept for the food log. Both are derived from one decode, so the
 * coach and the stored thumbnail always describe the same image. A
 * pure-JavaScript decoder keeps the API's single-file deployment intact; a
 * malformed or unreadable image still throws.
 */
export async function createMealPhotos(
  photoDataUrl: string,
): Promise<MealPhotos> {
  const match = PHOTO_DATA_URL.exec(photoDataUrl);
  if (match?.[1] === undefined) {
    throw new Error("The photo is not a supported image.");
  }
  const image = await Jimp.read(Buffer.from(match[1], "base64"));

  // Downscale to the analysis ceiling first, then reuse that image for the
  // much smaller thumbnail. The order means a small original is never enlarged.
  resizeToFit(image, MEAL_ANALYSIS_MAX_DIMENSION);
  const analysisDataUrl = await toJpegDataUrl(image, ANALYSIS_QUALITY);

  resizeToFit(image, MEAL_THUMBNAIL_MAX_DIMENSION);
  const thumbnailDataUrl = await toJpegDataUrl(image, THUMBNAIL_QUALITY);

  return { analysisDataUrl, thumbnailDataUrl };
}

function resizeToFit(image: JimpImage, maxDimension: number): void {
  const width = image.bitmap.width;
  const height = image.bitmap.height;
  const scale = Math.min(1, maxDimension / Math.max(width, height));
  if (scale < 1) {
    image.resize({
      w: Math.max(1, Math.round(width * scale)),
      h: Math.max(1, Math.round(height * scale)),
    });
  }
}

async function toJpegDataUrl(
  image: JimpImage,
  quality: number,
): Promise<string> {
  const bytes = await image.getBuffer("image/jpeg", { quality });
  return `data:image/jpeg;base64,${bytes.toString("base64")}`;
}
