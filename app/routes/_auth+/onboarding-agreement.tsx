import { Link } from "react-router";

export function OnboardingAgreementLabel() {
  return (
    <span>
      Do you agree to our{" "}
      <Link to="/tos" className="underline">
        Terms of Service
      </Link>{" "}
      and{" "}
      <Link to="/privacy" className="underline">
        Privacy Policy
      </Link>
      ?
    </span>
  );
}
