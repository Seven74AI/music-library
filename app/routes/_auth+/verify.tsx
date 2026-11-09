import { invariant } from "@epic-web/invariant";
import { getFormProps, getInputProps, useForm } from "@conform-to/react";
import { getZodConstraint, parseWithZod } from "@conform-to/zod/v4";
import { type SEOHandle } from "@nasa-gcn/remix-seo";
import { Form, redirect, useSearchParams } from "react-router";
import { authSessionStorage } from "#app/utils/session.server.ts";
import { combineHeaders } from "#app/utils/misc.tsx";
import { z } from "zod";
import { GeneralErrorBoundary } from "#app/components/error-boundary.tsx";
import { ErrorList, OTPField } from "#app/components/forms.tsx";
import { HoneypotInputs } from "#app/components/honeypot-inputs.tsx";
import { Spacer } from "#app/components/spacer.tsx";
import { StatusButton } from "#app/components/ui/status-button.tsx";
import { checkHoneypot } from "#app/utils/honeypot.server.ts";
import { useIsPending } from "#app/utils/misc.tsx";
import {
  clearPendingVerification,
  getPendingVerification,
  handleVerifyLoader,
  mergePendingVerificationIntoFormData,
} from "./verify-pending.server.ts";
import { proxyClientActionToServer } from "#app/utils/server-proxy-client-action.ts";
import { type Route } from "./+types/verify.ts";
import { validateRequest } from "./verify.server.ts";

export const handle: SEOHandle = {
  getSitemapEntries: () => null,
};

export const codeQueryParam = "code";
export const targetQueryParam = "target";
export const typeQueryParam = "type";
export const redirectToQueryParam = "redirectTo";
const types = ["onboarding", "reset-password", "change-email", "2fa"] as const;
export const VerificationTypeSchema = z.enum(types);
export type VerificationTypes = z.infer<typeof VerificationTypeSchema>;

export const VerifySchema = z.object({
  [codeQueryParam]: z.string().min(6).max(6),
  [typeQueryParam]: VerificationTypeSchema,
  [targetQueryParam]: z.string(),
  [redirectToQueryParam]: z.string().optional(),
});

export async function loader({ request }: Route.LoaderArgs) {
  return handleVerifyLoader(request);
}

export async function action({ request }: Route.ActionArgs) {
  const formData = await request.formData();
  await checkHoneypot(formData);
  const authSession = await authSessionStorage.getSession(request.headers.get("cookie"));
  const pending = getPendingVerification(authSession);
  if (pending) {
    for (const key of [codeQueryParam, typeQueryParam, targetQueryParam, redirectToQueryParam]) {
      formData.delete(key);
    }
    mergePendingVerificationIntoFormData(formData, pending);
    formData.set(codeQueryParam, pending.code);
  }
  try {
    const response = await validateRequest(request, formData);
    if (response instanceof Response && response.status >= 300 && response.status < 400) {
      const location = response.headers.get("Location");
      invariant(location, "Expected redirect Location header");
      if (pending) {
        clearPendingVerification(authSession);
        return redirect(location, {
          headers: combineHeaders(response.headers, {
            "Set-Cookie": await authSessionStorage.commitSession(authSession),
          }),
        });
      }
      return redirect(location, { headers: response.headers });
    }
    return response;
  } catch (error) {
    if (error instanceof Response && error.status >= 300 && error.status < 400) {
      const location = error.headers.get("Location");
      invariant(location, "Expected redirect Location header");
      if (pending) {
        clearPendingVerification(authSession);
        return redirect(location, {
          headers: combineHeaders(error.headers, {
            "Set-Cookie": await authSessionStorage.commitSession(authSession),
          }),
        });
      }
      return redirect(location, { headers: error.headers });
    }
    throw error;
  }
}

export async function clientAction(args: Route.ClientActionArgs) {
  return proxyClientActionToServer(args);
}

export default function VerifyRoute({ actionData, loaderData }: Route.ComponentProps) {
  const [searchParams] = useSearchParams();
  const isPending = useIsPending();
  const sessionBacked = loaderData.hasPendingVerification === true;
  const typeParam = loaderData.type ?? searchParams.get(typeQueryParam);
  const parseWithZoddType = VerificationTypeSchema.safeParse(typeParam);
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
    defaultValue: sessionBacked
      ? {
          type: type ?? undefined,
          redirectTo: loaderData.redirectTo,
        }
      : {
          type: type,
          target: searchParams.get(targetQueryParam) ?? undefined,
          redirectTo: searchParams.get(redirectToQueryParam) ?? undefined,
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
            {sessionBacked ? (
              <p className="text-body-sm text-muted-foreground text-center mb-3">
                Confirm to continue with your pending verification.
              </p>
            ) : (
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
            )}
            {!sessionBacked ? (
              <>
                <input {...getInputProps(fields[typeQueryParam], { type: "hidden" })} />
                <input {...getInputProps(fields[targetQueryParam], { type: "hidden" })} />
                <input
                  {...getInputProps(fields[redirectToQueryParam], {
                    type: "hidden",
                  })}
                />
              </>
            ) : null}
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
