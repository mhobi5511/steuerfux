import { AuthForm } from "@/components/auth/auth-form";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Konto erstellen" };

export default function RegisterPage() {
  return <AuthForm mode="register" />;
}
