import { z } from "zod";

const DNS_1123_LABEL = /^[a-z0-9](?:[-a-z0-9]*[a-z0-9])?$/;

export const kubernetesNamespaceSchema = z
  .string()
  .trim()
  .min(1)
  .max(63)
  .regex(
    DNS_1123_LABEL,
    "Namespace must be a valid DNS-1123 label using lowercase letters, numbers, and hyphens.",
  );

const clusterConfigEntrySchema = z
  .object({
    id: z.string().trim().min(1).max(128),
    displayName: z.string().trim().min(1).max(253).optional(),
    exceptionNamespace: kubernetesNamespaceSchema.default("kyverno"),
    server: z
      .string()
      .trim()
      .url()
      .refine(
        (value) => {
          try {
            return new URL(value).protocol === "https:";
          } catch {
            return false;
          }
        },
        { message: "Kubernetes server URL must use HTTPS." },
      ),
    caData: z.string().trim().min(1).optional(),
    caFile: z.string().trim().min(1).optional(),
    skipTLSVerify: z.boolean().default(false),
    tlsServerName: z.string().trim().min(1).optional(),
    token: z.string().trim().min(1).optional(),
    clientCertData: z.string().trim().min(1).optional(),
    clientKeyData: z.string().trim().min(1).optional(),
    default: z.boolean().default(false),
  })
  .strict()
  .superRefine((entry, ctx) => {
    const hasToken = Boolean(entry.token);
    const hasClientCert = Boolean(entry.clientCertData || entry.clientKeyData);

    if (!hasToken && !hasClientCert) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "A credential is required: provide either 'token' or both 'clientCertData' and 'clientKeyData'.",
      });
    }

    if (hasToken && hasClientCert) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "Only one credential type is allowed: use 'token' or client certificate, not both.",
      });
    }

    if (hasClientCert && !(entry.clientCertData && entry.clientKeyData)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "Client certificate auth requires both 'clientCertData' and 'clientKeyData'.",
      });
    }

    if (!entry.skipTLSVerify && !entry.caData && !entry.caFile) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "TLS trust is required: provide 'caData' or 'caFile', or set 'skipTLSVerify' to true.",
      });
    }
  });

export const clusterConfigListSchema = z
  .array(clusterConfigEntrySchema)
  .min(1, "At least one cluster must be configured.")
  .superRefine((entries, ctx) => {
    const seen = new Set<string>();
    for (const [index, entry] of entries.entries()) {
      if (seen.has(entry.id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [index, "id"],
          message: `Duplicate cluster id '${entry.id}'.`,
        });
      }
      seen.add(entry.id);
    }

    const defaults = entries.filter((entry) => entry.default);
    if (defaults.length > 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "At most one cluster may be marked as 'default'.",
      });
    }
  });

export type ClusterConfigEntry = z.infer<typeof clusterConfigEntrySchema>;

export function parseClusterConfig(raw: unknown): ClusterConfigEntry[] {
  return clusterConfigListSchema.parse(raw);
}

export function parseKubernetesNamespace(raw: unknown): string {
  return kubernetesNamespaceSchema.parse(raw);
}
