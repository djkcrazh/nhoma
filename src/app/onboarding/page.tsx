import { Suspense } from "react";
import { OnboardingForm } from "./OnboardingForm";
import { BrandMark } from "@/components/brand/BrandMark";

export default function OnboardingPage() {
  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <div className="w-full max-w-sm fade-up">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center text-accent">
            <BrandMark size={56} />
          </div>
          <h1 className="font-display text-2xl font-bold">Set up your farm</h1>
          <p className="mt-1 text-sm text-ink-soft">Redeem your invite code to get started</p>
        </div>
        <div className="card p-6">
          <Suspense>
            <OnboardingForm />
          </Suspense>
        </div>
        <p className="mt-4 text-center text-xs text-ink-faint">
          Already have an account?{" "}
          <a className="text-accent" href="/login">
            Sign in
          </a>
        </p>
      </div>
    </main>
  );
}
