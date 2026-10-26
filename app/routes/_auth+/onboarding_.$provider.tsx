import { getFormProps, getInputProps, useForm, type SubmissionResult } from "@conform-to/react";
import { getZodConstraint, parseWithZod } from "@conform-to/zod/v4";
import { redirect, data, type Params, Form, useSearchParams } from "react-router";
import { z } from "zod";
import { CheckboxField, ErrorList, Field } from "#app/components/forms.tsx";
import { Spacer } from "#app/components/spacer.tsx";
import { StatusButton } from "#app/components/ui/status-button.tsx";
import { signupWithConnection } from "#app/utils/auth.server.ts";
import { ProviderNameSchema } from "#app/utils/connections.tsx";
import { useIsPending } from "#app/utils/misc.tsx";
import { proxyClientActionToServer } from "#app/utils/server-proxy-client-action.ts";
import { verifySessionStorage } from "#app/utils/verification.server.ts";
import { type Route } from "./+types/onboarding_.$provider.ts";
import { OnboardingAgreementLabel } from "./onboarding-agreement.tsx";
import { SignupFormBaseSchema } from "./onboarding-shared.ts";
import {
  commitOnboardingSession,
  requireOnboardingEmail,
  usernameExists,
} from "./onboarding-shared.server.ts";

export const providerIdKey = "providerId";
export const providerNameKey = "providerName";
export const prefilledProfileKey = "prefilledProfile";

const SignupFormSchema = SignupFormBaseSchema.extend({
  imageUrl: z.string().optional(),
});

async function requireData({ request, params }: { request: Request; params: Params }) {
  const { email, verifySession } = await requireOnboardingEmail(request);
  const providerId = verifySession.get(providerIdKey);
  const sessionProviderName = verifySession.get(providerNameKey);
  // The provider in the URL must match the provider that issued the providerId
  // stored in the session. Without this cross-check a user could navigate to
  // /onboarding/<other-provider> after the OAuth callback and signupWithConnection
  // would persist a Connection with mismatched providerName/providerId.
  if (sessionProviderName && sessionProviderName !== params.provider) {
    throw redirect("/signup");
  }
  const providerName = sessionProviderName ?? params.provider;
  const result = z
    .object({
      email: z.string(),
      providerName: ProviderNameSchema,
      providerId: z.string().or(z.number()),
    })
    .safeParse({ email, providerName, providerId });
  if (result.success) {
    return result.data;
  } else {
    console.error(result.error);
    throw redirect("/signup");
  }
}

export async function loader({ request, params }: Route.LoaderArgs) {
  const { email } = await requireData({ request, params });

  const verifySession = await verifySessionStorage.getSession(request.headers.get("cookie"));
  const prefilledProfile = verifySession.get(prefilledProfileKey);

  return {
    email,
    status: "idle",
    submission: {
      initialValue: prefilledProfile ?? {},
    } as SubmissionResult,
  };
}

export async function action({ request, params }: Route.ActionArgs) {
  const { email, providerId, providerName } = await requireData({
    request,
    params,
  });
  const formData = await request.formData();

  const submission = await parseWithZod(formData, {
    schema: SignupFormSchema.superRefine(async (formValues, ctx) => {
      if (await usernameExists(formValues.username)) {
        ctx.addIssue({
          path: ["username"],
          code: z.ZodIssueCode.custom,
          message: "A user already exists with this username",
        });
        return;
      }
    }).transform(async (formValues) => {
      const session = await signupWithConnection({
        ...formValues,
        email,
        providerId: String(providerId),
        providerName,
        request,
      });
      return { ...formValues, session };
    }),
    async: true,
  });

  if (submission.status !== "success") {
    return data(
      { result: submission.reply() },
      { status: submission.status === "error" ? 400 : 200 },
    );
  }

  const { session, remember, redirectTo } = submission.value;
  return commitOnboardingSession({ session, remember, redirectTo, request });
}

export const meta: Route.MetaFunction = () => {
  return [{ title: "Setup Music Library Account" }];
};

export async function clientAction(args: Route.ClientActionArgs) {
  return proxyClientActionToServer(args);
}

export default function OnboardingProviderRoute({ loaderData, actionData }: Route.ComponentProps) {
  const isPending = useIsPending();
  const [searchParams] = useSearchParams();
  const redirectTo = searchParams.get("redirectTo");

  const [form, fields] = useForm({
    id: "onboarding-provider-form",
    constraint: getZodConstraint(SignupFormSchema),
    lastResult: actionData?.result ?? loaderData.submission,
    onValidate({ formData }) {
      return parseWithZod(formData, { schema: SignupFormSchema });
    },
    shouldRevalidate: "onBlur",
  });

  return (
    <div className="container flex min-h-full flex-col justify-center pt-20 pb-32">
      <div className="mx-auto w-full max-w-lg">
        <div className="flex flex-col gap-3 text-center">
          <h1 className="text-h1">Welcome aboard {loaderData.email}!</h1>
          <p className="text-body-md text-muted-foreground">Please enter your details.</p>
        </div>
        <Spacer size="xs" />
        <Form
          method="POST"
          className="mx-auto max-w-sm min-w-full sm:min-w-[368px]"
          {...getFormProps(form)}
        >
          {fields.imageUrl.initialValue ? (
            <div className="mb-4 flex flex-col items-center justify-center gap-4">
              <img
                src={fields.imageUrl.initialValue}
                alt="Profile"
                className="size-24 rounded-full"
              />
              <p className="text-body-sm text-muted-foreground">You can change your photo later</p>
              <input {...getInputProps(fields.imageUrl, { type: "hidden" })} />
            </div>
          ) : null}
          <Field
            labelProps={{ htmlFor: fields.username.id, children: "Username" }}
            inputProps={{
              ...getInputProps(fields.username, { type: "text" }),
              autoComplete: "username",
              className: "lowercase",
            }}
            errors={fields.username.errors}
          />
          <Field
            labelProps={{ htmlFor: fields.name.id, children: "Name" }}
            inputProps={{
              ...getInputProps(fields.name, { type: "text" }),
              autoComplete: "name",
            }}
            errors={fields.name.errors}
          />

          <CheckboxField
            labelProps={{
              htmlFor: fields.agreeToTermsOfServiceAndPrivacyPolicy.id,
              children: <OnboardingAgreementLabel />,
            }}
            buttonProps={getInputProps(fields.agreeToTermsOfServiceAndPrivacyPolicy, {
              type: "checkbox",
            })}
            errors={fields.agreeToTermsOfServiceAndPrivacyPolicy.errors}
          />
          <CheckboxField
            labelProps={{
              htmlFor: fields.remember.id,
              children: "Remember me",
            }}
            buttonProps={getInputProps(fields.remember, { type: "checkbox" })}
            errors={fields.remember.errors}
          />

          {redirectTo ? <input type="hidden" name="redirectTo" value={redirectTo} /> : null}

          <ErrorList errors={form.errors} id={form.errorId} />

          <div className="flex items-center justify-between gap-6">
            <StatusButton
              className="w-full"
              status={isPending ? "pending" : (form.status ?? "idle")}
              type="submit"
              disabled={isPending}
            >
              Create an account
            </StatusButton>
          </div>
        </Form>
      </div>
    </div>
  );
}
