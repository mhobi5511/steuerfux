import { redirect } from "next/navigation";
import { cache } from "react";
import { createSupabaseServerClient } from "@/lib/supabase/server";

async function loadAuthenticatedUser() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  return { supabase, user };
}

// React's cache is request-local during Server Component rendering. It avoids
// repeated auth round trips from the protected layout and the page below it
// without ever sharing one user's session with another request.
export const requireUser = cache(loadAuthenticatedUser);
