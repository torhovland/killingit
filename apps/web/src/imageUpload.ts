/** The thumbnail edge kept for the food log. */
export const MEAL_THUMBNAIL_MAX_DIMENSION = 320;

/**
 * The edge cap for the analysis image. Phone photos are normally well under
 * this, so the coach sees the full image. Re-encoding also strips EXIF data
 * such as the photo's location before it leaves the browser.
 */
export const MEAL_PHOTO_RECODE_MAX_DIMENSION = 8192;

/** The JPEG quality of a re-encoded full-size analysis image. */
const MEAL_PHOTO_QUALITY = 0.92;

/** The JPEG quality of the stored thumbnail. */
const MEAL_THUMBNAIL_QUALITY = 0.75;

/** The largest source photo accepted before preparation. */
const MAX_SOURCE_BYTES = 15 * 1024 * 1024;

/** The full photo for the coach and the small preview stored with the meal. */
export interface PreparedMealPhoto {
  /** Full-resolution image sent to the coach; never stored. */
  photoDataUrl: string;
  /** Small preview kept for the Diet page food log. */
  thumbnailDataUrl: string;
}

/**
 * Prepares a camera or gallery image for a meal log. The coach receives a
 * full-size re-encode (which also strips EXIF metadata), while only a small
 * thumbnail is stored. Runs entirely in the browser, so the server needs no
 * image-processing dependency.
 */
export async function prepareMealPhoto(file: File): Promise<PreparedMealPhoto> {
  if (!file.type.startsWith("image/")) {
    throw new Error("Choose an image file.");
  }
  if (file.size > MAX_SOURCE_BYTES) {
    throw new Error("That image is too large. Choose one under 15 MB.");
  }

  const image = await loadImage(file);
  try {
    const photoDataUrl = analysisImage(image);
    const thumbnailDataUrl = renderImage(
      image,
      MEAL_THUMBNAIL_MAX_DIMENSION,
      MEAL_THUMBNAIL_QUALITY,
    );
    return { photoDataUrl, thumbnailDataUrl };
  } finally {
    URL.revokeObjectURL(image.src);
  }
}

/**
 * The full-resolution analysis image. Re-encoding at the image's own size
 * keeps the detail the coach needs while stripping EXIF metadata.
 */
function analysisImage(image: HTMLImageElement): string {
  return renderImage(
    image,
    MEAL_PHOTO_RECODE_MAX_DIMENSION,
    MEAL_PHOTO_QUALITY,
  );
}

function renderImage(
  image: HTMLImageElement,
  maxDimension: number,
  quality: number,
): string {
  const scale = Math.min(1, maxDimension / Math.max(image.width, image.height));
  const width = Math.max(1, Math.round(image.width * scale));
  const height = Math.max(1, Math.round(image.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (context === null) {
    throw new Error("This browser cannot prepare the photo.");
  }
  // A transparent PNG becomes black in a JPEG without an opaque backdrop.
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, width, height);
  context.drawImage(image, 0, 0, width, height);
  return canvas.toDataURL("image/jpeg", quality);
}

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("This image could not be read."));
    };
    image.src = url;
  });
}
