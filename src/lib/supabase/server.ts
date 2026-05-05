import { cookies } from "next/headers";
import type { CookieOptions } from "@supabase/ssr";
import { createServerClient } from "@supabase/ssr";

export function createSupabaseServerClient() {
  const cookieStore = cookies();

  function trySetCookie(name: string, value: string, options: CookieOptions) {
    try {
      cookieStore.set({ name, value, ...options });
    } catch {
      // Server Components can read cookies but cannot always write them.
      // Middleware and Server Actions handle the writable auth cookie flow.
    }
  }

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get(name: string) {
          return cookieStore.get(name)?.value;
        },
        set(name: string, value: string, options: CookieOptions) {
          trySetCookie(name, value, options);
        },
        remove(name: string, options: CookieOptions) {
          trySetCookie(name, "", options);
        }
      }
    }
  );
}
