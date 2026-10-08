// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetNextMocks, router, setSearchParams } from "../support/next-mocks";

vi.mock("next/navigation", async () => (await import("../support/next-mocks")).navigationMock);
vi.mock("next/link", async () => ({ default: (await import("../support/next-mocks")).LinkMock }));

const actions = vi.hoisted(() => ({
  registerAction: vi.fn(),
  loginAction: vi.fn(),
  forgotPasswordAction: vi.fn(),
  resetPasswordAction: vi.fn(),
  resendVerificationAction: vi.fn(),
  verifyEmailAction: vi.fn(),
}));
vi.mock("@/lib/auth/actions", () => actions);

import { ForgotPasswordForm } from "@/components/auth/forgot-password-form";
import { LoginForm } from "@/components/auth/login-form";
import { RegisterForm } from "@/components/auth/register-form";
import { ResetPasswordForm } from "@/components/auth/reset-password-form";
import { VerifyEmailPanel } from "@/components/auth/verify-email-panel";

beforeEach(() => {
  resetNextMocks();
  for (const action of Object.values(actions)) action.mockReset();
  window.sessionStorage.clear();
});

async function fillRegistration(user: ReturnType<typeof userEvent.setup>, overrides: Record<string, string> = {}) {
  const values = {
    "First name": "Ada",
    "Last name": "Okafor",
    Username: "ada_o",
    Email: "ada@example.test",
    Password: "correct horse 9",
    "Confirm password": "correct horse 9",
    ...overrides,
  };
  for (const [label, value] of Object.entries(values)) {
    const field = screen.getByLabelText(label, { exact: true });
    await user.clear(field);
    if (value) await user.type(field, value);
  }
}

describe("registration form", () => {
  it("shows inline errors for every missing field and does not submit", async () => {
    const user = userEvent.setup();
    render(<RegisterForm />);
    await user.click(screen.getByRole("button", { name: "Create account" }));

    expect(await screen.findByText("Enter your first name.")).toBeInTheDocument();
    expect(screen.getByText("Enter your last name.")).toBeInTheDocument();
    expect(screen.getByText("Use at least 3 characters.")).toBeInTheDocument();
    expect(screen.getByText("Enter your email address.")).toBeInTheDocument();
    expect(screen.getByText("Use at least 10 characters.")).toBeInTheDocument();
    expect(screen.getByText("Choose an initial avatar.")).toBeInTheDocument();
    expect(actions.registerAction).not.toHaveBeenCalled();

    // Errors are tied to their fields for assistive technology.
    const email = screen.getByLabelText("Email", { exact: true });
    expect(email).toHaveAttribute("aria-invalid", "true");
    expect(document.getElementById(email.getAttribute("aria-describedby")!)).toHaveTextContent(
      "Enter your email address.",
    );
  });

  it("offers Male and Female and explains what the choice is for", () => {
    render(<RegisterForm />);
    expect(screen.getByRole("radio", { name: "Male" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Female" })).toBeInTheDocument();
    expect(
      screen.getByText("Your selection is used only to generate an initial avatar. You can change your avatar later."),
    ).toBeInTheDocument();
  });

  it("toggles password visibility", async () => {
    const user = userEvent.setup();
    render(<RegisterForm />);
    const password = screen.getByLabelText("Password", { exact: true });
    expect(password).toHaveAttribute("type", "password");
    await user.click(screen.getAllByRole("button", { name: "Show password" })[0]);
    expect(password).toHaveAttribute("type", "text");
    await user.click(screen.getAllByRole("button", { name: "Hide password" })[0]);
    expect(password).toHaveAttribute("type", "password");
  });

  it("rejects mismatched passwords", async () => {
    const user = userEvent.setup();
    render(<RegisterForm />);
    await fillRegistration(user, { "Confirm password": "something else 1" });
    await user.click(screen.getByRole("radio", { name: "Female" }));
    await user.click(screen.getByRole("button", { name: "Create account" }));
    expect(await screen.findByText("The passwords don't match.")).toBeInTheDocument();
    expect(actions.registerAction).not.toHaveBeenCalled();
  });

  it("submits valid details and moves on to email verification", async () => {
    actions.registerAction.mockResolvedValue({ ok: true, data: { email: "ada@example.test" } });
    const user = userEvent.setup();
    render(<RegisterForm />);
    await fillRegistration(user);
    await user.click(screen.getByRole("radio", { name: "Female" }));
    await user.click(screen.getByRole("button", { name: "Create account" }));

    await waitFor(() => expect(router.push).toHaveBeenCalledWith("/verify-email?sent=1"));
    expect(actions.registerAction).toHaveBeenCalledWith({
      firstName: "Ada",
      lastName: "Okafor",
      username: "ada_o",
      email: "ada@example.test",
      password: "correct horse 9",
      confirmPassword: "correct horse 9",
      avatarPreference: "FEMALE",
    });
  });

  it("shows a server-side field error next to the field", async () => {
    actions.registerAction.mockResolvedValue({
      ok: false,
      code: "USERNAME_TAKEN",
      message: "That username is taken. Try another.",
      fields: { username: "That username is taken. Try another." },
    });
    const user = userEvent.setup();
    render(<RegisterForm />);
    await fillRegistration(user);
    await user.click(screen.getByRole("radio", { name: "Male" }));
    await user.click(screen.getByRole("button", { name: "Create account" }));
    await waitFor(() => expect(screen.getByLabelText("Username")).toHaveAttribute("aria-invalid", "true"));
    expect(router.push).not.toHaveBeenCalled();
  });

  it("links to the terms, privacy notice and login", () => {
    render(<RegisterForm />);
    expect(screen.getByRole("link", { name: "Terms" })).toHaveAttribute("href", "/terms");
    expect(screen.getByRole("link", { name: "Privacy notice" })).toHaveAttribute("href", "/privacy");
  });
});

describe("login form", () => {
  it("shows one generic message for invalid credentials", async () => {
    actions.loginAction.mockResolvedValue({
      ok: false,
      code: "INVALID_CREDENTIALS",
      message: "That email and password don't match. Check them and try again.",
    });
    const user = userEvent.setup();
    render(<LoginForm />);
    await user.type(screen.getByLabelText("Email"), "nobody@example.test");
    await user.type(screen.getByLabelText("Password", { exact: true }), "wrong password");
    await user.click(screen.getByRole("button", { name: "Log in" }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("That email and password don't match. Check them and try again.");
    // Nothing that says whether the account exists.
    expect(alert.textContent).not.toMatch(/no account|not found|doesn't exist|unknown user|wrong password/i);
    expect(router.replace).not.toHaveBeenCalled();
  });

  it("passes the requested destination to the server and follows the server's answer", async () => {
    setSearchParams("next=%2Fboards%2Fabc");
    actions.loginAction.mockResolvedValue({ ok: true, data: { redirectTo: "/boards/abc" } });
    const user = userEvent.setup();
    render(<LoginForm />);
    await user.type(screen.getByLabelText("Email"), "ada@example.test");
    await user.type(screen.getByLabelText("Password", { exact: true }), "correct horse 9");
    await user.click(screen.getByRole("button", { name: "Log in" }));
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith("/boards/abc"));
    expect(actions.loginAction).toHaveBeenCalledWith({
      email: "ada@example.test",
      password: "correct horse 9",
      next: "/boards/abc",
    });
  });

  it("validates before submitting and links to recovery and registration", async () => {
    const user = userEvent.setup();
    render(<LoginForm />);
    await user.click(screen.getByRole("button", { name: "Log in" }));
    expect(await screen.findByText("Enter your email address.")).toBeInTheDocument();
    expect(screen.getByText("Enter your password.")).toBeInTheDocument();
    expect(actions.loginAction).not.toHaveBeenCalled();
    expect(screen.getByRole("link", { name: "Forgot your password?" })).toHaveAttribute("href", "/forgot-password");
  });

  it("offers to resend verification when the email is unverified", async () => {
    actions.loginAction.mockResolvedValue({
      ok: false,
      code: "EMAIL_NOT_VERIFIED",
      message: "Verify your email address to use this feature.",
    });
    const user = userEvent.setup();
    render(<LoginForm />);
    await user.type(screen.getByLabelText("Email"), "ada@example.test");
    await user.type(screen.getByLabelText("Password", { exact: true }), "correct horse 9");
    await user.click(screen.getByRole("button", { name: "Log in" }));
    expect(await screen.findByRole("link", { name: "Resend the verification email" })).toHaveAttribute(
      "href",
      "/verify-email",
    );
  });
});

describe("forgot-password form", () => {
  it("gives the same answer whether or not the account exists", async () => {
    actions.forgotPasswordAction.mockResolvedValue({ ok: true, data: undefined });
    const user = userEvent.setup();
    render(<ForgotPasswordForm />);
    await user.type(screen.getByLabelText("Email"), "anyone@example.test");
    await user.click(screen.getByRole("button", { name: "Send reset link" }));
    expect(
      await screen.findByText("If an account exists for this email, a password reset link has been sent."),
    ).toBeInTheDocument();
    expect(actions.forgotPasswordAction).toHaveBeenCalledWith({ email: "anyone@example.test" });
  });

  it("validates the email before sending", async () => {
    const user = userEvent.setup();
    render(<ForgotPasswordForm />);
    await user.type(screen.getByLabelText("Email"), "nope");
    await user.click(screen.getByRole("button", { name: "Send reset link" }));
    expect(await screen.findByText("Enter a valid email address.")).toBeInTheDocument();
    expect(actions.forgotPasswordAction).not.toHaveBeenCalled();
  });
});

describe("reset-password form", () => {
  it("requires matching passwords that meet the policy", async () => {
    const user = userEvent.setup();
    render(<ResetPasswordForm />);
    await user.type(screen.getByLabelText("New password"), "short");
    await user.type(screen.getByLabelText("Confirm new password"), "different");
    await user.click(screen.getByRole("button", { name: "Save new password" }));
    expect(await screen.findByText("Use at least 10 characters.")).toBeInTheDocument();
    expect(screen.getByText("The passwords don't match.")).toBeInTheDocument();
    expect(actions.resetPasswordAction).not.toHaveBeenCalled();
  });

  it("shows a success state that links to login", async () => {
    actions.resetPasswordAction.mockResolvedValue({ ok: true, data: undefined });
    const user = userEvent.setup();
    render(<ResetPasswordForm />);
    await user.type(screen.getByLabelText("New password"), "brand new pass 1");
    await user.type(screen.getByLabelText("Confirm new password"), "brand new pass 1");
    await user.click(screen.getByRole("button", { name: "Save new password" }));
    expect(await screen.findByText(/Your password has been changed/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Log in" })).toHaveAttribute("href", "/login?reset=1");
  });

  it("reports an expired recovery session", async () => {
    actions.resetPasswordAction.mockResolvedValue({
      ok: false,
      code: "RECOVERY_LINK_INVALID",
      message: "This reset link is invalid or has expired. Request a new one.",
    });
    const user = userEvent.setup();
    render(<ResetPasswordForm />);
    await user.type(screen.getByLabelText("New password"), "brand new pass 1");
    await user.type(screen.getByLabelText("Confirm new password"), "brand new pass 1");
    await user.click(screen.getByRole("button", { name: "Save new password" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("This reset link is invalid or has expired.");
  });
});

describe("email verification states", () => {
  it("verifies a token, then replaces the URL so the token is not kept", async () => {
    let resolve!: (value: unknown) => void;
    actions.verifyEmailAction.mockReturnValue(new Promise((done) => (resolve = done)));
    setSearchParams("token_hash=abcdef0123456789abcdef&type=email");
    render(<VerifyEmailPanel />);

    expect(screen.getByRole("heading", { name: "Verifying your email" })).toBeInTheDocument();
    expect(actions.verifyEmailAction).toHaveBeenCalledWith({ tokenHash: "abcdef0123456789abcdef", type: "email" });
    // The token is never rendered.
    expect(document.body.textContent).not.toContain("abcdef0123456789abcdef");

    resolve({ ok: true, data: undefined });
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith("/verify-email?status=verified"));
  });

  it("shows the verified state with a way forward", () => {
    setSearchParams("status=verified&next=%2Fwelcome");
    render(<VerifyEmailPanel />);
    expect(screen.getByRole("heading", { name: "Email verified" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Continue" })).toHaveAttribute("href", "/welcome");
  });

  it("never continues to an external address", () => {
    setSearchParams("status=verified&next=https%3A%2F%2Fevil.example");
    render(<VerifyEmailPanel />);
    expect(screen.getByRole("link", { name: "Continue" })).toHaveAttribute("href", "/welcome");
  });

  it("shows the expired state and lets the person resend, with a generic confirmation", async () => {
    actions.resendVerificationAction.mockResolvedValue({ ok: true, data: undefined });
    setSearchParams("status=invalid");
    const user = userEvent.setup();
    render(<VerifyEmailPanel />);
    expect(screen.getByRole("heading", { name: "That link didn’t work" })).toBeInTheDocument();
    await user.type(screen.getByLabelText("Email"), "ada@example.test");
    await user.click(screen.getByRole("button", { name: "Resend verification email" }));
    expect(
      await screen.findByText("If that address has an account waiting to be verified, a new link is on its way."),
    ).toBeInTheDocument();
  });

  it("reports a failed verification as invalid", async () => {
    actions.verifyEmailAction.mockResolvedValue({ ok: false, code: "RECOVERY_LINK_INVALID", message: "x" });
    setSearchParams("token_hash=abcdef0123456789abcdef&type=email");
    render(<VerifyEmailPanel />);
    expect(await screen.findByRole("heading", { name: "That link didn’t work" })).toBeInTheDocument();
  });

  it("shows the check-your-inbox state after registering", () => {
    setSearchParams("sent=1");
    render(<VerifyEmailPanel />);
    expect(screen.getByRole("heading", { name: "Check your inbox" })).toBeInTheDocument();
  });
});
