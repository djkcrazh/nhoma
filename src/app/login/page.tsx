import { Suspense } from "react";
import { LoginForm } from "./LoginForm";
import { BrandMark } from "@/components/brand/BrandMark";

export default function LoginPage() {
  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <div className="w-full max-w-sm fade-up">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center text-accent">
            <BrandMark size={56} />
          </div>
          <h1 className="font-display text-2xl font-bold">Nhoma</h1>
          <p className="mt-1 text-sm text-ink-soft">Sign in to manage your herd</p>
        </div>
        <div className="card p-6">
          <Suspense>
            <LoginForm />
          </Suspense>
        </div>
        <p className="mt-4 text-center text-xs text-ink-faint">
          New here?{" "}
          <a className="text-accent" href="/onboarding">
            Create or join a farm →
          </a>
        </p>
      </div>
    </main>
  );
}
