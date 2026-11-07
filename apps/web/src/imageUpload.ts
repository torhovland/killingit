/**
 * The edge cap for the analysis image. A normal phone photo (around 4032 px)
 * keeps its full size; the cap only bounds very large images so the pure-JS
 * thumbnail decoder stays within the API's memory. Re-encoding also strips EXIF
 * data such as the photo's location before it leaves the browser.
 */
export const MEAL_PHOTO_RECODE_MAX_DIMENSION = 4096;

/** The JPEG quality of the full-size analysis image. */
const MEAL_PHOTO_QUALITY = 0.92;

/** The largest source photo accepted before preparation. */
const MAX_SOURCE_BYTES = 15 * 1024 * 1024;

/**
 * Prepares a camera or gallery image for a meal log. The browser sends one
 * full-size image to the API; the API sends it to the coach and derives the
 * stored thumbnail from it. Runs entirely in the browser so the upload is a
 * normal, readable JPEG even when the source is HEIC.
 */
export async function prepareMealPhoto(file: File): Promise<string> {
  if (!file.type.startsWith("image/")) {
    throw new Error("Choose an image file.");
  }
  if (file.size > MAX_SOURCE_BYTES) {
    throw new Error("That image is too large. Choose one under 15 MB.");
  }

  const image = await loadImage(file);
  try {
    return renderImage(
      image,
      MEAL_PHOTO_RECODE_MAX_DIMENSION,
      MEAL_PHOTO_QUALITY,
    );
  } finally {
    URL.revokeObjectURL(image.src);
  }
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
