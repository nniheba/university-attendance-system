import "server-only";

import type { User } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/server";
import {
  defaultTeacherDisplayName,
  type TeacherAvatarKey,
  type TeacherProfile,
} from "@/lib/teacher-profile";

export async function getOrCreateTeacherProfile(user: User): Promise<TeacherProfile> {
  const admin = createAdminClient();
  const { data: existing, error: readError } = await admin
    .from("teacher_profiles")
    .select("user_id, display_name, avatar_key, created_at, updated_at")
    .eq("user_id", user.id)
    .maybeSingle();
  if (readError) throw readError;
  if (existing) return existing as TeacherProfile;

  const { error: insertError } = await admin
    .from("teacher_profiles")
    .upsert(
      {
        user_id: user.id,
        display_name: defaultTeacherDisplayName(user),
        avatar_key: "avatar_01",
      },
      { onConflict: "user_id", ignoreDuplicates: true },
    );
  if (insertError) throw insertError;

  const { data, error } = await admin
    .from("teacher_profiles")
    .select("user_id, display_name, avatar_key, created_at, updated_at")
    .eq("user_id", user.id)
    .single();
  if (error) throw error;
  return data as TeacherProfile;
}

export async function updateTeacherProfile(
  user: User,
  avatarKey: TeacherAvatarKey,
): Promise<TeacherProfile> {
  await getOrCreateTeacherProfile(user);
  const { data, error } = await createAdminClient()
    .from("teacher_profiles")
    .update({
      avatar_key: avatarKey,
      updated_at: new Date().toISOString(),
    })
    .eq("user_id", user.id)
    .select("user_id, display_name, avatar_key, created_at, updated_at")
    .single();
  if (error) throw error;
  return data as TeacherProfile;
}
