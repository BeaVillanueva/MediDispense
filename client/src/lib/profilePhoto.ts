const MAX_PROFILE_PHOTO_BYTES = 2 * 1024 * 1024;
const PROFILE_PHOTO_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;

export async function encodeProfilePhoto(file: File) {
  if (!PROFILE_PHOTO_TYPES.includes(file.type as (typeof PROFILE_PHOTO_TYPES)[number])) throw new Error("Choose a JPG, PNG, or WebP image.");
  if (file.size === 0 || file.size > MAX_PROFILE_PHOTO_BYTES) throw new Error("Profile photos must be no larger than 2 MB.");
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Could not read the selected image."));
    reader.onload = () => typeof reader.result === "string" ? resolve(reader.result) : reject(new Error("Could not read the selected image."));
    reader.readAsDataURL(file);
  });
  return { contentType: file.type as (typeof PROFILE_PHOTO_TYPES)[number], dataBase64: dataUrl.slice(dataUrl.indexOf(",") + 1) };
}
