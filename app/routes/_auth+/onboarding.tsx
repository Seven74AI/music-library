import { getFormProps, getInputProps, useForm } from "@conform-to/react";
import { getZodConstraint, parseWithZod } from "@conform-to/zod/v4";
import { data, Form, useSearchParams } from "react-router";
import { HoneypotInputs } from "remix-utils/honeypot/react";
import { z } from "zod";
import { CheckboxField, ErrorList, Field } from "#app/components/forms.tsx";
import { Spacer } from "#app/components/spacer.tsx";
import { StatusButton } from "#app/components/ui/status-button.tsx";
import { signup } from "#app/utils/auth.server.ts";
import { checkHoneypot } from "#app/utils/honeypot.server.ts";
import { useIsPending } from "#app/utils/misc.tsx";
import { proxyClientActionToServer } from "#app/utils/server-proxy-client-action.ts";
import { PasswordAndConfirmPasswordSchema } from "#app/utils/user-validation.ts";
import { type Route } from "./+types/onboarding.ts";
import { SignupFormBaseSchema } from "./onboarding-shared.ts";
import {
  commitOnboardingSession,
  passwordIsCommon,
  requireOnboardingEmail,
  usernameExists,
} from "./onboarding-shared.server.ts";

const SignupFormSchema = SignupFormBaseSchema.and(PasswordAndConfirmPasswordSchema);

export async function loader({ request }: Route.LoaderArgs) {
  const { email } = await requireOnboardingEmail(request);
  return { email };
}

export async function action({ request }: Route.ActionArgs) {
  const { email } = await requireOnboardingEmail(request);
  const formData = await request.formData();
  await checkHoneypot(formData);
  const submission = await parseWithZod(formData, {
    schema: (intent) =>
      SignupFormSchema.superRefine(async (formValues, ctx) => {
        if (await usernameExists(formValues.username)) {
          ctx.addIssue({
            path: ["username"],
            code: z.ZodIssueCode.custom,
            message: "A user already exists with this username",
          });
          return;
        }
        if (await passwordIsCommon(formValues.password)) {
          ctx.addIssue({
            path: ["password"],
            code: "custom",
            message: "Password is too common",
          });
        }
      }).transform(async (formValues) => {
        if (intent !== null) return { ...formValues, session: null };

        const session = await signup({ ...formValues, email, request });
        return { ...formValues, session };
      }),
    async: true,
  });

  if (submission.status !== "success" || !submission.value.session) {
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

export default function OnboardingRoute({ loaderData, actionData }: Route.ComponentProps) {
  const isPending = useIsPending();
  const [searchParams] = useSearchParams();
  const redirectTo = searchParams.get("redirectTo");

  const [form, fields] = useForm({
    id: "onboarding-form",
    constraint: getZodConstraint(SignupFormSchema),
    defaultValue: { redirectTo },
    lastResult: actionData?.result,
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
          <HoneypotInputs />
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
          <Field
            labelProps={{ htmlFor: fields.password.id, children: "Password" }}
            inputProps={{
              ...getInputProps(fields.password, { type: "password" }),
              autoComplete: "new-password",
            }}
            errors={fields.password.errors}
          />

          <Field
            labelProps={{
              htmlFor: fields.confirmPassword.id,
              children: "Confirm Password",
            }}
            inputProps={{
              ...getInputProps(fields.confirmPassword, { type: "password" }),
              autoComplete: "new-password",
            }}
            errors={fields.confirmPassword.errors}
          />

          <CheckboxField
            labelProps={{
              htmlFor: fields.agreeToTermsOfServiceAndPrivacyPolicy.id,
              children: "Do you agree to our Terms of Service and Privacy Policy?",
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

          <input {...getInputProps(fields.redirectTo, { type: "hidden" })} />
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
