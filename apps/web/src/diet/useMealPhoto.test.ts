import { afterAll, afterEach, describe, expect, it, mock } from "bun:test";
import { act, renderHook } from "@testing-library/react";

/**
 * The real preparation, captured before the module is replaced. A test that
 * sets `prepare` uses its own promise; otherwise the mock falls through to the
 * real browser preparation, so a suite loading the module later still works.
 */
const realImageUpload = { ...(await import("../imageUpload")) };
let prepare: ((file: File) => Promise<string>) | null = null;

await mock.module("../imageUpload", () => ({
  ...realImageUpload,
  prepareMealPhoto: (file: File) =>
    prepare === null ? realImageUpload.prepareMealPhoto(file) : prepare(file),
}));

afterAll(() => {
  mock.restore();
});

afterEach(() => {
  prepare = null;
});

const { useMealPhoto } = await import("./useMealPhoto");

const meal = new File(["photo"], "lunch.jpg", { type: "image/jpeg" });

describe("useMealPhoto", () => {
  it("prepares the chosen photo, clears the error slot and records its name", async () => {
    prepare = () => Promise.resolve("data:image/jpeg;base64,prepared");
    const setError = mock((_message: string | null) => undefined);
    const onPhotoChosen = mock(() => undefined);
    const { result } = renderHook(() =>
      useMealPhoto({ setError, onPhotoChosen }),
    );

    await act(async () => {
      await result.current.choosePhoto(meal);
    });

    expect(result.current.photoDataUrl).toBe("data:image/jpeg;base64,prepared");
    expect(result.current.photoName).toBe("lunch.jpg");
    expect(result.current.preparingPhoto).toBe(false);
    expect(setError).toHaveBeenCalledWith(null);
    expect(onPhotoChosen).toHaveBeenCalledTimes(1);
  });

  it("marks the photo as preparing until the image is ready", async () => {
    let finish: ((url: string) => void) | undefined;
    prepare = () =>
      new Promise<string>((resolve) => {
        finish = resolve;
      });
    const setError = mock((_message: string | null) => undefined);
    const { result } = renderHook(() => useMealPhoto({ setError }));

    let choosing: Promise<void> | undefined;
    act(() => {
      choosing = result.current.choosePhoto(meal);
    });
    expect(result.current.preparingPhoto).toBe(true);

    await act(async () => {
      finish?.("data:image/jpeg;base64,late");
      await choosing;
    });

    expect(result.current.preparingPhoto).toBe(false);
    expect(result.current.photoDataUrl).toBe("data:image/jpeg;base64,late");
  });

  it("reports a failed preparation through the form's error setter", async () => {
    prepare = () => Promise.reject(new Error("This image could not be read."));
    const setError = mock((_message: string | null) => undefined);
    const onPhotoChosen = mock(() => undefined);
    const { result } = renderHook(() =>
      useMealPhoto({ setError, onPhotoChosen }),
    );

    await act(async () => {
      await result.current.choosePhoto(meal);
    });

    expect(setError).toHaveBeenCalledWith(null);
    expect(setError).toHaveBeenLastCalledWith("This image could not be read.");
    expect(result.current.photoDataUrl).toBeNull();
    expect(result.current.photoName).toBeNull();
    expect(result.current.preparingPhoto).toBe(false);
    expect(onPhotoChosen).not.toHaveBeenCalled();
  });

  it("ignores a picker closed without a file", async () => {
    const setError = mock((_message: string | null) => undefined);
    const onPhotoChosen = mock(() => undefined);
    const { result } = renderHook(() =>
      useMealPhoto({ setError, onPhotoChosen }),
    );

    await act(async () => {
      await result.current.choosePhoto(undefined);
    });

    expect(setError).not.toHaveBeenCalled();
    expect(onPhotoChosen).not.toHaveBeenCalled();
    expect(result.current.preparingPhoto).toBe(false);
  });

  it("clears the attached photo when the athlete removes it", async () => {
    prepare = () => Promise.resolve("data:image/jpeg;base64,prepared");
    const setError = mock((_message: string | null) => undefined);
    const { result } = renderHook(() => useMealPhoto({ setError }));

    await act(async () => {
      await result.current.choosePhoto(meal);
    });
    act(() => result.current.clearPhoto());

    expect(result.current.photoDataUrl).toBeNull();
    expect(result.current.photoName).toBeNull();
  });
});
