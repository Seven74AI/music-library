import { invariant } from "@epic-web/invariant";
import * as E from "@react-email/components";
import { data } from "react-router";
import {
  requireRecentVerification,
  type VerifyFunctionArgs,
} from "#app/routes/_auth+/verify.server.ts";
import { prisma } from "#app/utils/db.server.ts";
import { sendEmail } from "#app/utils/email.server.ts";
import { redirectWithToast } from "#app/utils/toast.server.ts";
import { verifySessionStorage } from "#app/utils/verification.server.ts";
import { newEmailAddressSessionKey } from "./profile.change-email";

function isUniqueConstraintError(error: unknown): boolean {
  return error instanceof Error && "code" in error && (error as { code?: string }).code === "P2002";
}

export async function handleVerification({ request, submission }: VerifyFunctionArgs) {
  await requireRecentVerification(request);
  invariant(submission.status === "success", "Submission should be successful by now");

  const verifySession = await verifySessionStorage.getSession(request.headers.get("cookie"));
  const newEmail = verifySession.get(newEmailAddressSessionKey);
  if (!newEmail) {
    return data(
      {
        result: submission.reply({
          formErrors: [
            "You must submit the code on the same device that requested the email change.",
          ],
        }),
      },
      { status: 400 },
    );
  }
  const preUpdateUser = await prisma.user.findFirstOrThrow({
    select: { email: true },
    where: { id: submission.value.target },
  });

  // Re-check email uniqueness at commit time: the address may have been claimed
  // by another account between the initial request and this verification. The
  // `email` column is `@unique`, so a taken address would otherwise surface as
  // an unhandled P2002 and a 500.
  const emailTaken = await prisma.user.findFirst({
    select: { id: true },
    where: { email: newEmail, NOT: { id: submission.value.target } },
  });
  if (emailTaken) {
    return data(
      { result: submission.reply({ formErrors: ["This email is already in use."] }) },
      { status: 400 },
    );
  }

  let user: { id: string; email: string; username: string };
  try {
    user = await prisma.user.update({
      where: { id: submission.value.target },
      select: { id: true, email: true, username: true },
      data: { email: newEmail },
    });
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      return data(
        { result: submission.reply({ formErrors: ["This email is already in use."] }) },
        { status: 400 },
      );
    }
    throw error;
  }

  void sendEmail({
    to: preUpdateUser.email,
    subject: "Music Library email changed",
    react: <EmailChangeNoticeEmail userId={user.id} />,
  });

  return redirectWithToast(
    "/settings/profile",
    {
      title: "Email Changed",
      type: "success",
      description: `Your email has been changed to ${user.email}`,
    },
    {
      headers: {
        "set-cookie": await verifySessionStorage.destroySession(verifySession),
      },
    },
  );
}

export function EmailChangeEmail({ verifyUrl, otp }: { verifyUrl: string; otp: string }) {
  return (
    <E.Html lang="en" dir="ltr">
      <E.Container>
        <h1>
          <E.Text>Music Library Email Change</E.Text>
        </h1>
        <p>
          <E.Text>
            Here's your verification code: <strong>{otp}</strong>
          </E.Text>
        </p>
        <p>
          <E.Text>Or click the link:</E.Text>
        </p>
        <E.Link href={verifyUrl}>{verifyUrl}</E.Link>
      </E.Container>
    </E.Html>
  );
}

function EmailChangeNoticeEmail({ userId }: { userId: string }) {
  return (
    <E.Html lang="en" dir="ltr">
      <E.Container>
        <h1>
          <E.Text>Your Music Library email has been changed</E.Text>
        </h1>
        <p>
          <E.Text>
            We're writing to let you know that your Music Library email has been changed.
          </E.Text>
        </p>
        <p>
          <E.Text>
            If you changed your email address, then you can safely ignore this. But if you did not
            change your email address, then please contact support immediately.
          </E.Text>
        </p>
        <p>
          <E.Text>Your Account ID: {userId}</E.Text>
        </p>
      </E.Container>
    </E.Html>
  );
}
