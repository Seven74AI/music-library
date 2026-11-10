import { getFormProps, getInputProps, useForm } from "@conform-to/react";
import { getZodConstraint, parseWithZod } from "@conform-to/zod/v4";
import { type SEOHandle } from "@nasa-gcn/remix-seo";
import { Form, useSearchParams } from "react-router";
import { GeneralErrorBoundary } from "#app/components/error-boundary.tsx";
import { ErrorList, OTPField } from "#app/components/forms.tsx";
import { HoneypotInputs } from "#app/components/honeypot-inputs.tsx";
import { Spacer } from "#app/components/spacer.tsx";
import { StatusButton } from "#app/components/ui/status-button.tsx";
import { checkHoneypot } from "#app/utils/honeypot.server.ts";
import { useIsPending } from "#app/utils/misc.tsx";
import { proxyClientActionToServer } from "#app/utils/server-proxy-client-action.ts";
import { type Route } from "./+types/verify.ts";
import {
  codeQueryParam,
  redirectToQueryParam,
  targetQueryParam,
  typeQueryParam,
  VerificationTypeSchema,
  VerificationTypes,
  VerifySchema,
} from "./verify.shared.ts";
import { validateRequest } from "./verify.server.ts";

export {
  codeQueryParam,
  redirectToQueryParam,
  targetQueryParam,
  typeQueryParam,
  type VerificationTypes,
  VerifySchema,
} from "./verify.shared.ts";

export const handle: SEOHandle = {
  getSitemapEntries: () => null,
};

export async function action({ request }: Route.ActionArgs) {
  const formData = await request.formData();
  await checkHoneypot(formData);
  return validateRequest(request, formData);
}

export async function clientAction(args: Route.ClientActionArgs) {
  return proxyClientActionToServer(args);
}

export default function VerifyRoute({ actionData }: Route.ComponentProps) {
  const [searchParams] = useSearchParams();
  const isPending = useIsPending();
  const parseWithZoddType = VerificationTypeSchema.safeParse(searchParams.get(typeQueryParam));
  const type = parseWithZoddType.success ? parseWithZoddType.data : null;

  const checkEmail = (
    <>
      <h1 className="text-h1">Check your email</h1>
      <p className="text-body-md text-muted-foreground mt-3">
        We've sent you a code to verify your email address.
      </p>
    </>
  );

  const headings: Record<VerificationTypes, React.ReactNode> = {
    onboarding: checkEmail,
    "reset-password": checkEmail,
    "change-email": checkEmail,
    "2fa": (
      <>
        <h1 className="text-h1">Check your 2FA app</h1>
        <p className="text-body-md text-muted-foreground mt-3">
          Please enter your 2FA code to verify your identity.
        </p>
      </>
    ),
  };

  const [form, fields] = useForm({
    id: "verify-form",
    constraint: getZodConstraint(VerifySchema),
    lastResult: actionData?.result,
    onValidate({ formData }) {
      return parseWithZod(formData, { schema: VerifySchema });
    },
    defaultValue: {
      type: type,
      target: searchParams.get(targetQueryParam),
      redirectTo: searchParams.get(redirectToQueryParam),
    },
  });

  return (
    <main className="container flex flex-col justify-center pt-20 pb-32">
      <div className="text-center">{type ? headings[type] : "Invalid Verification Type"}</div>

      <Spacer size="xs" />

      <div className="mx-auto flex w-72 max-w-full flex-col justify-center gap-1">
        <div>
          <ErrorList errors={form.errors} id={form.errorId} />
        </div>
        <div className="flex w-full gap-2">
          <Form method="POST" {...getFormProps(form)} className="flex-1">
            <HoneypotInputs />
            <div className="flex items-center justify-center">
              <OTPField
                labelProps={{
                  htmlFor: fields[codeQueryParam].id,
                  children: "Code",
                }}
                inputProps={{
                  ...getInputProps(fields[codeQueryParam], { type: "text" }),
                  autoComplete: "one-time-code",
                  autoFocus: true,
                }}
                errors={fields[codeQueryParam].errors}
              />
            </div>
            <input {...getInputProps(fields[typeQueryParam], { type: "hidden" })} />
            <input {...getInputProps(fields[targetQueryParam], { type: "hidden" })} />
            <input
              {...getInputProps(fields[redirectToQueryParam], {
                type: "hidden",
              })}
            />
            <StatusButton
              className="w-full"
              status={isPending ? "pending" : (form.status ?? "idle")}
              type="submit"
              disabled={isPending}
            >
              Submit
            </StatusButton>
          </Form>
        </div>
      </div>
    </main>
  );
}

export function ErrorBoundary() {
  return <GeneralErrorBoundary />;
}
