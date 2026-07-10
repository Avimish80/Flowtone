// Package photo upload to the Supabase Storage "package-photos" bucket.
// Photos are resized client-side before upload so the public enquiry page
// stays fast. Path convention: <user_id>/<uuid>.jpg — the first path segment
// is what the storage RLS policies check for ownership.

import { getSupabaseClient, isPreviewModeEnabled } from "./supabaseClient";

const MAX_DIMENSION = 1280;
const JPEG_QUALITY = 0.82;

function resizeImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      let { width, height } = img;
      if (width > MAX_DIMENSION || height > MAX_DIMENSION) {
        const scale = MAX_DIMENSION / Math.max(width, height);
        width = Math.round(width * scale);
        height = Math.round(height * scale);
      }
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      canvas.getContext("2d").drawImage(img, 0, 0, width, height);
      canvas.toBlob(
        (blob) => (blob ? resolve(blob) : reject(new Error("Could not process image"))),
        "image/jpeg",
        JPEG_QUALITY
      );
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Could not read image"));
    };
    img.src = url;
  });
}

export function isPhotoUploadAvailable() {
  return !isPreviewModeEnabled();
}

export async function uploadPackagePhoto(file) {
  if (isPreviewModeEnabled()) {
    throw new Error("Photo upload needs a signed-in account");
  }
  const supabase = getSupabaseClient();
  const { data: userData, error: userErr } = await supabase.auth.getUser();
  if (userErr || !userData?.user?.id) throw new Error("Not signed in");

  const blob = await resizeImage(file);
  const path = `${userData.user.id}/${crypto.randomUUID()}.jpg`;
  const { error } = await supabase.storage
    .from("package-photos")
    .upload(path, blob, { contentType: "image/jpeg", upsert: false });
  if (error) throw error;

  const { data } = supabase.storage.from("package-photos").getPublicUrl(path);
  return data.publicUrl;
}

export async function deletePackagePhoto(photoUrl) {
  if (!photoUrl || isPreviewModeEnabled()) return;
  try {
    const marker = "/package-photos/";
    const idx = photoUrl.indexOf(marker);
    if (idx < 0) return;
    const path = decodeURIComponent(photoUrl.slice(idx + marker.length));
    const supabase = getSupabaseClient();
    await supabase.storage.from("package-photos").remove([path]);
  } catch {
    // best-effort — an orphaned photo is not worth surfacing an error
  }
}
