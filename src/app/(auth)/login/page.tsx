import { AuthForm } from "@/components/auth/auth-form";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Login" };

export default function LoginPage() {
  return <AuthForm mode="login" />;
}
