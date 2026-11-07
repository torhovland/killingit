/** The longest edge a meal photo keeps after the browser compresses it. */
export const MEAL_PHOTO_MAX_DIMENSION = 1280;

/** The JPEG quality the compressed meal photo is encoded with. */
const MEAL_PHOTO_QUALITY = 0.82;

/** The largest source photo accepted before compression. */
const MAX_SOURCE_BYTES = 15 * 1024 * 1024;

/**
 * Reads a camera or gallery image and returns a smaller JPEG data URL. The
 * upload stays small and every supported model can read it. Runs entirely in
 * the browser, so the server needs no image-processing dependency.
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
    const scale = Math.min(
      1,
      MEAL_PHOTO_MAX_DIMENSION / Math.max(image.width, image.height),
    );
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
    return canvas.toDataURL("image/jpeg", MEAL_PHOTO_QUALITY);
  } finally {
    URL.revokeObjectURL(image.src);
  }
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
