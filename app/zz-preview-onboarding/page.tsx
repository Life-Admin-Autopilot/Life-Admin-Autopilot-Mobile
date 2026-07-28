import { OnboardingIsland } from '@/components/onboarding/OnboardingIsland'

// Throwaway preview route — the onboarding island without the RouteGuard, so
// the flow can be eyeballed on an already-onboarded session. Delete when done.
export default function PreviewOnboardingPage() {
  return <OnboardingIsland />
}
