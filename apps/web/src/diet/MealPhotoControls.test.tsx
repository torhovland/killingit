import { describe, expect, it, mock, spyOn } from "bun:test";
import { createRef } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MealPhotoControls } from "./MealPhotoControls";
import type { MealPhoto } from "./useMealPhoto";

function mealPhoto(overrides: Partial<MealPhoto> = {}): MealPhoto {
  return {
    photoDataUrl: null,
    photoName: null,
    preparingPhoto: false,
    cameraInput: createRef<HTMLInputElement>(),
    uploadInput: createRef<HTMLInputElement>(),
    choosePhoto: mock((_file: File | undefined) => Promise.resolve()),
    clearPhoto: mock(() => undefined),
    ...overrides,
  };
}

function renderControls(photo: MealPhoto) {
  return render(
    <MealPhotoControls
      photo={photo}
      cameraTestId="edit-meal-photo-camera"
      uploadTestId="edit-meal-photo-upload"
    >
      <p>The form&apos;s own preview</p>
    </MealPhotoControls>,
  );
}

describe("MealPhotoControls", () => {
  it("offers a camera and an upload picker with the form's own preview", () => {
    renderControls(mealPhoto());

    expect(
      screen.getByTestId("edit-meal-photo-camera").getAttribute("capture"),
    ).toBe("environment");
    expect(
      screen.getByTestId("edit-meal-photo-upload").getAttribute("accept"),
    ).toBe("image/*");
    expect(screen.getByText("The form's own preview")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Take photo" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Upload image" })).toBeTruthy();
  });

  it("opens the camera and the picker from their own buttons", async () => {
    const user = userEvent.setup();
    const photo = mealPhoto();
    renderControls(photo);
    const cameraClick = spyOn(photo.cameraInput.current!, "click");
    const uploadClick = spyOn(photo.uploadInput.current!, "click");

    await user.click(screen.getByRole("button", { name: "Take photo" }));
    await user.click(screen.getByRole("button", { name: "Upload image" }));

    expect(cameraClick).toHaveBeenCalledTimes(1);
    expect(uploadClick).toHaveBeenCalledTimes(1);
  });

  it("prepares a chosen file and empties the picker for the next choice", async () => {
    const user = userEvent.setup();
    const choosePhoto = mock((_file: File | undefined) => Promise.resolve());
    renderControls(mealPhoto({ choosePhoto }));
    const upload = screen.getByTestId<HTMLInputElement>(
      "edit-meal-photo-upload",
    );
    const file = new File(["photo"], "lunch.jpg", { type: "image/jpeg" });

    await user.upload(upload, file);

    expect(choosePhoto).toHaveBeenCalledWith(file);
    expect(upload.value).toBe("");
  });

  it("shows the preparation line and disables both pickers while it runs", () => {
    renderControls(mealPhoto({ preparingPhoto: true }));

    expect(screen.getByText("Preparing photo…")).toBeTruthy();
    expect(
      screen.getByRole<HTMLButtonElement>("button", { name: "Take photo" })
        .disabled,
    ).toBe(true);
    expect(
      screen.getByRole<HTMLButtonElement>("button", { name: "Upload image" })
        .disabled,
    ).toBe(true);
  });

  it("names the chosen file only while its photo is attached", () => {
    const { rerender } = renderControls(
      mealPhoto({
        photoDataUrl: "data:image/jpeg;base64,prepared",
        photoName: "lunch.jpg",
      }),
    );
    expect(screen.getByText("lunch.jpg")).toBeTruthy();

    rerender(
      <MealPhotoControls
        photo={mealPhoto({ photoName: "lunch.jpg" })}
        cameraTestId="edit-meal-photo-camera"
        uploadTestId="edit-meal-photo-upload"
      >
        <p>The form&apos;s own preview</p>
      </MealPhotoControls>,
    );
    expect(screen.queryByText("lunch.jpg")).toBeNull();
  });
});
