import { z } from "zod";

// No external providers configured
// to add another provider, set their name here and add it to the providerNames below

export const providerNames = ["placeholder"] as const;
export const ProviderNameSchema = z.enum(providerNames);
export type ProviderName = z.infer<typeof ProviderNameSchema>;

export const providerLabels: Record<ProviderName, string> = {
  placeholder: "Placeholder",
} as const;

export const providerIcons: Record<ProviderName, React.ReactNode> = {
  placeholder: <span>🔗</span>,
} as const;
